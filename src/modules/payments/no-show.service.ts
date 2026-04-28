import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import StripeSDK from 'stripe';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { SupabaseService } from '../supabase/supabase.service';
import { StripeService } from './stripe.service';
import { ConnectService } from './connect.service';
import { NoShowChargeResultDto, NoShowChargeSkippedReason } from './dto/no-show-charge.dto';

interface NoShowChargeInput {
  bookingId: string;
  barberAuthId: string;
  clientAuthId: string;
}

interface BarberChargeContext {
  no_show_charge_enabled: boolean;
  no_show_charge_amount_usd: string | number | null;
  stripe_connect_account_id: string | null;
}

interface ClientChargeContext {
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
}

// Service called by BarbersService.markNoShow() AFTER the booking state has
// already transitioned to 'no_show'. Decides whether to charge based on the
// barber/client/Connect setup, makes the charge if eligible, and persists
// the audit row in `no_show_charges`. The unique index on booking_id makes
// a second invocation against the same booking surface as a 409.
@Injectable()
export class NoShowService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stripeService: StripeService,
    private readonly connectService: ConnectService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private get stripe(): Stripe {
    return this.stripeService.stripe;
  }

  public async charge(input: NoShowChargeInput): Promise<NoShowChargeResultDto> {
    await this.assertNoExistingChargeRow(input.bookingId);

    const [barber, client] = await Promise.all([
      this.loadBarber(input.barberAuthId),
      this.loadClient(input.clientAuthId),
    ]);

    const skipReason = await this.computeSkipReason(barber, client);
    if (skipReason) {
      return { charged: false, amountUsd: null, noShowChargeId: null, reason: skipReason };
    }

    const amountUsd = Number(barber.no_show_charge_amount_usd);
    return this.runCharge(input, barber, client, amountUsd);
  }

  // ────────────────────────────────────────────────────────────
  // Eligibility
  // ────────────────────────────────────────────────────────────

  private async computeSkipReason(
    barber: BarberChargeContext,
    client: ClientChargeContext
  ): Promise<NoShowChargeSkippedReason | null> {
    if (!barber.no_show_charge_enabled) return 'disabled';
    if (!barber.stripe_connect_account_id) return 'no_connect';
    if (!client.stripe_payment_method_id || !client.stripe_customer_id) return 'no_card';

    const amount = Number(barber.no_show_charge_amount_usd ?? 0);
    if (!(amount > 0)) return 'disabled';

    const chargesEnabled = await this.connectService
      .hasChargesEnabled(barber.stripe_connect_account_id)
      .catch(() => false);
    if (!chargesEnabled) return 'connect_not_charges_enabled';

    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Charge + audit row
  // ────────────────────────────────────────────────────────────

  private async runCharge(
    input: NoShowChargeInput,
    barber: BarberChargeContext,
    client: ClientChargeContext,
    amountUsd: number
  ): Promise<NoShowChargeResultDto> {
    const amountCents = Math.round(amountUsd * 100);

    let pi: Stripe.PaymentIntent | null = null;
    let stripeError: InstanceType<typeof StripeSDK.errors.StripeError> | null = null;

    try {
      pi = await this.stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: client.stripe_customer_id ?? undefined,
        payment_method: client.stripe_payment_method_id ?? undefined,
        confirm: true,
        off_session: true,
        transfer_data: { destination: barber.stripe_connect_account_id ?? '' },
        metadata: {
          kind: 'no_show',
          booking_id: input.bookingId,
          barber_id: input.barberAuthId,
          client_id: input.clientAuthId,
        },
      });
    } catch (err) {
      if (err instanceof StripeSDK.errors.StripeError) {
        stripeError = err;
      } else {
        throw err;
      }
    }

    const status = pi ? this.mapPaymentIntentStatus(pi.status) : ('failed' as const);
    const failureReason = stripeError?.message ?? null;

    const auditRow = await this.insertAuditRow({
      bookingId: input.bookingId,
      barberAuthId: input.barberAuthId,
      clientAuthId: input.clientAuthId,
      amountUsd,
      stripePaymentIntentId: pi?.id ?? null,
      status,
      failureReason,
    });

    if (status === 'succeeded') {
      await this.markBookingChargedFlag(input.bookingId, amountUsd);
      return { charged: true, amountUsd, noShowChargeId: auditRow.id, reason: null };
    }

    // Surface failures explicitly so the caller can include them in the
    // response. Status 'requires_action' is treated as not-charged for now;
    // off_session intents that need SCA aren't recoverable without re-prompting.
    return { charged: false, amountUsd, noShowChargeId: auditRow.id, reason: null };
  }

  private mapPaymentIntentStatus(
    status: Stripe.PaymentIntent.Status
  ): 'succeeded' | 'failed' | 'requires_action' {
    if (status === 'succeeded') return 'succeeded';
    if (status === 'requires_action' || status === 'requires_confirmation')
      return 'requires_action';
    return 'failed';
  }

  private async insertAuditRow(args: {
    bookingId: string;
    barberAuthId: string;
    clientAuthId: string;
    amountUsd: number;
    stripePaymentIntentId: string | null;
    status: 'succeeded' | 'failed' | 'requires_action';
    failureReason: string | null;
  }): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from('no_show_charges')
      .insert({
        booking_id: args.bookingId,
        barber_id: args.barberAuthId,
        client_id: args.clientAuthId,
        amount_usd: args.amountUsd,
        stripe_payment_intent_id: args.stripePaymentIntentId,
        status: args.status,
        failure_reason: args.failureReason,
      })
      .select('id')
      .single();

    if (error) {
      // The unique index `no_show_charges_one_per_booking` makes a second
      // invocation against the same booking surface as Postgres 23505. The
      // pre-flight assertNoExistingChargeRow check covers the non-racing
      // case; this is the race-safe path.
      if (error.code === '23505') {
        throw new ConflictException('A no-show charge already exists for this booking.');
      }
      throw new InternalServerErrorException('Failed to record no-show charge audit row');
    }
    return data as { id: string };
  }

  private async markBookingChargedFlag(bookingId: string, amountUsd: number): Promise<void> {
    const { error } = await this.db
      .from('bookings')
      .update({
        no_show_charged: true,
        no_show_charge_amount_usd: amountUsd,
      })
      .eq('id', bookingId);
    if (error) {
      // The audit row is the source of truth — log and continue rather than
      // unwinding a successful Stripe charge.
      console.error('Failed to flip bookings.no_show_charged for', bookingId, error);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Lookups
  // ────────────────────────────────────────────────────────────

  private async assertNoExistingChargeRow(bookingId: string): Promise<void> {
    const { count, error } = await this.db
      .from('no_show_charges')
      .select('id', { head: true, count: 'exact' })
      .eq('booking_id', bookingId);
    if (error) {
      throw new InternalServerErrorException('Failed to check existing no-show charges');
    }
    if ((count ?? 0) > 0) {
      throw new ConflictException('A no-show charge already exists for this booking.');
    }
  }

  private async loadBarber(authUserId: string): Promise<BarberChargeContext> {
    const { data, error } = await this.db
      .from('barbers')
      .select('no_show_charge_enabled, no_show_charge_amount_usd, stripe_connect_account_id')
      .eq('user_id', authUserId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch barber');
    if (!data) {
      // Defensive — can't reach here unless the booking row is orphaned.
      throw new InternalServerErrorException('Barber profile missing for booking');
    }
    return data as BarberChargeContext;
  }

  private async loadClient(authUserId: string): Promise<ClientChargeContext> {
    const { data, error } = await this.db
      .from('clients')
      .select('stripe_customer_id, stripe_payment_method_id')
      .eq('user_id', authUserId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch client');
    if (!data) {
      throw new InternalServerErrorException('Client profile missing for booking');
    }
    return data as ClientChargeContext;
  }
}
