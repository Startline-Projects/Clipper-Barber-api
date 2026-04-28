import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { SupabaseService, SupabaseUserPayload } from '../supabase/supabase.service';
import { StripeService } from './stripe.service';
import {
  ConnectDisconnectResponseDto,
  ConnectOnboardResponseDto,
  ConnectStatusResponseDto,
} from './dto/connect-response.dto';

interface BarberConnectRow {
  user_id: string;
  stripe_connect_account_id: string | null;
}

@Injectable()
export class ConnectService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stripeService: StripeService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private get stripe(): Stripe {
    return this.stripeService.stripe;
  }

  public async onboard(user: SupabaseUserPayload): Promise<ConnectOnboardResponseDto> {
    const barber = await this.loadBarber(user.sub);
    const accountId = await this.ensureExpressAccount(barber, user);

    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: `${this.stripeService.barberAppUrl}/connect/return`,
      refresh_url: `${this.stripeService.barberAppUrl}/connect/refresh`,
    });

    return { onboardingUrl: link.url };
  }

  public async getStatus(authUserId: string): Promise<ConnectStatusResponseDto> {
    const barber = await this.loadBarber(authUserId);
    if (!barber.stripe_connect_account_id) {
      return {
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        requirementsCurrentlyDue: [],
      };
    }

    const account = await this.stripe.accounts.retrieve(barber.stripe_connect_account_id);
    return {
      connected: true,
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
    };
  }

  public async disconnect(authUserId: string): Promise<ConnectDisconnectResponseDto> {
    const barber = await this.loadBarber(authUserId);
    if (!barber.stripe_connect_account_id) {
      // Idempotent — disconnecting an already-disconnected account is a no-op.
      return { disconnected: true };
    }

    // Express accounts created by the platform are owned by the platform and
    // must be deleted with accounts.del. oauth.deauthorize is for Standard.
    await this.stripe.accounts.del(barber.stripe_connect_account_id).catch(() => undefined);

    const { error } = await this.db
      .from('barbers')
      .update({
        stripe_connect_account_id: null,
        no_show_charge_enabled: false,
      })
      .eq('user_id', authUserId);
    if (error) {
      throw new InternalServerErrorException('Failed to clear Connect account');
    }

    return { disconnected: true };
  }

  // Used by the no-show flow to gate Stripe charges and by barbers.service to
  // gate the no_show_charge_enabled toggle.
  public async hasChargesEnabled(connectAccountId: string | null): Promise<boolean> {
    if (!connectAccountId) return false;
    const account = await this.stripe.accounts.retrieve(connectAccountId);
    return account.charges_enabled === true;
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async loadBarber(authUserId: string): Promise<BarberConnectRow> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, stripe_connect_account_id')
      .eq('user_id', authUserId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch barber');
    if (!data) throw new NotFoundException('Barber profile not found');
    return data as BarberConnectRow;
  }

  private async ensureExpressAccount(
    barber: BarberConnectRow,
    user: SupabaseUserPayload
  ): Promise<string> {
    if (barber.stripe_connect_account_id) return barber.stripe_connect_account_id;

    const account = await this.stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: user.email || undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { barber_user_id: user.sub },
    });

    const { error } = await this.db
      .from('barbers')
      .update({ stripe_connect_account_id: account.id })
      .eq('user_id', user.sub);
    if (error) {
      throw new InternalServerErrorException('Failed to persist Connect account ID');
    }

    return account.id;
  }
}
