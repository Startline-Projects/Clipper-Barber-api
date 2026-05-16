import { Injectable, Logger } from '@nestjs/common';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { SupabaseService } from '../supabase/supabase.service';
import { StripeService } from './stripe.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTypeDto } from '../notifications/dto/notification.dto';

interface InsertEventResult {
  duplicate: boolean;
}

// Routes Stripe webhook events to the right side-effect. Idempotency comes
// from inserting into subscription_events keyed on stripe_event_id; a
// unique-violation means we've already processed this event and we short-circuit.
//
// Always returns gracefully — Stripe retries on non-2xx and we don't want
// retries (we have idempotency on event_id, but burning the retry budget on
// internal errors is still worth avoiding).
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stripeService: StripeService,
    private readonly notificationsService: NotificationsService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // Verifies signature, returns the parsed event, or throws.
  public verifyAndParse(rawBody: Buffer, signatureHeader: string | undefined): Stripe.Event {
    if (!signatureHeader) {
      throw new Error('Missing Stripe-Signature header');
    }
    return this.stripeService.stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.stripeService.webhookSecret
    );
  }

  public async handleEvent(event: Stripe.Event): Promise<void> {
    const insert = await this.recordEventIdempotent(event);
    if (insert.duplicate) {
      this.logger.log(`Duplicate webhook ${event.id} (${event.type}) — skipping`);
      return;
    }

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentTerminal(
            event.data.object as Stripe.PaymentIntent,
            'succeeded'
          );
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentTerminal(
            event.data.object as Stripe.PaymentIntent,
            'failed'
          );
          break;
        case 'account.updated':
          await this.handleAccountUpdated(event.data.object as Stripe.Account);
          break;
        case 'payment_method.detached':
          await this.handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
          break;
        default:
          this.logger.log(`Ignoring webhook event type ${event.type}`);
      }
    } catch (err) {
      this.logger.error(`Webhook handler failed for ${event.id} (${event.type})`, err as Error);
      // Swallow — the audit row is already inserted; Stripe should not retry.
    }
  }

  // ────────────────────────────────────────────────────────────
  // Idempotency
  // ────────────────────────────────────────────────────────────

  private async recordEventIdempotent(event: Stripe.Event): Promise<InsertEventResult> {
    const clientUserId = await this.resolveClientFromEvent(event);
    const plan = this.extractPlanFromEvent(event);
    const amountUsd = this.extractAmountFromEvent(event);

    const { error } = await this.db.from('subscription_events').insert({
      client_id: clientUserId,
      stripe_event_id: event.id,
      event_type: event.type,
      plan,
      amount_usd: amountUsd,
      raw_payload: event as unknown as Record<string, unknown>,
    });

    if (error) {
      if (error.code === '23505') {
        return { duplicate: true };
      }
      this.logger.error('Failed to record subscription_events row', error);
      // Don't fail the webhook — continue processing. Lack of audit row is
      // worse than a duplicate run, but Stripe won't retry on 200.
    }
    return { duplicate: false };
  }

  private async resolveClientFromEvent(event: Stripe.Event): Promise<string | null> {
    const obj = event.data.object as unknown as Record<string, unknown>;
    const customerId = (obj.customer as string | undefined) ?? null;
    if (!customerId) return null;

    const { data } = await this.db
      .from('clients')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    return (data?.user_id as string | undefined) ?? null;
  }

  private extractPlanFromEvent(event: Stripe.Event): string | null {
    if (!event.type.startsWith('customer.subscription.')) return null;
    const sub = event.data.object as Stripe.Subscription;
    return this.planFromSubscription(sub);
  }

  private extractAmountFromEvent(event: Stripe.Event): number | null {
    if (event.type.startsWith('invoice.')) {
      const inv = event.data.object as Stripe.Invoice;
      return inv.amount_paid != null ? inv.amount_paid / 100 : null;
    }
    if (event.type.startsWith('payment_intent.')) {
      const pi = event.data.object as Stripe.PaymentIntent;
      return pi.amount != null ? pi.amount / 100 : null;
    }
    return null;
  }

  // ────────────────────────────────────────────────────────────
  // Event handlers
  // ────────────────────────────────────────────────────────────

  private async handleSubscriptionUpsert(sub: Stripe.Subscription): Promise<void> {
    const clientUserId = await this.lookupClientByCustomerId(sub.customer as string);
    if (!clientUserId) return;

    const plan = this.planFromSubscription(sub);
    const status = this.mapSubscriptionStatus(sub.status, sub.cancel_at_period_end);
    // current_period_end lives on SubscriptionItem in stripe@22 (it was moved
    // off Subscription in v18). For our single-item subscriptions, the first
    // item's value is authoritative.
    const periodEndUnix = sub.items.data[0]?.current_period_end ?? null;
    const periodEndIso = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

    // Read prior state so we can detect transitions and emit one-shot
    // activation/reactivation pushes once per status change.
    const { data: prior } = await this.db
      .from('clients')
      .select('subscription_status')
      .eq('user_id', clientUserId)
      .maybeSingle();
    const priorStatus = prior?.subscription_status as
      | 'inactive'
      | 'active'
      | 'past_due'
      | 'cancelled'
      | undefined;

    const { error } = await this.db
      .from('clients')
      .update({
        stripe_subscription_id: sub.id,
        subscription_status: status,
        subscription_plan: plan,
        subscription_expires_at: periodEndIso,
        subscription_cancel_at_period_end: sub.cancel_at_period_end === true,
      })
      .eq('user_id', clientUserId);

    if (error) {
      throw new Error(`Failed to mirror subscription ${sub.id}: ${error.message}`);
    }

    if (status === 'active' && priorStatus !== 'active') {
      const type =
        priorStatus === 'past_due'
          ? NotificationTypeDto.SUBSCRIPTION_REACTIVATED
          : NotificationTypeDto.SUBSCRIPTION_ACTIVATED;
      void this.notificationsService.createAndSendSubscriptionNotification(clientUserId, type);
    }
  }

  private async handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
    const clientUserId = await this.lookupClientByCustomerId(sub.customer as string);
    if (!clientUserId) return;

    const { error } = await this.db
      .from('clients')
      .update({
        subscription_status: 'cancelled',
        subscription_cancel_at_period_end: false,
      })
      .eq('user_id', clientUserId);
    if (error) {
      throw new Error(`Failed to mark subscription cancelled for ${sub.id}: ${error.message}`);
    }

    void this.notificationsService.createAndSendSubscriptionNotification(
      clientUserId,
      NotificationTypeDto.SUBSCRIPTION_CANCELLED
    );
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string | null;
    if (!customerId) return;
    const clientUserId = await this.lookupClientByCustomerId(customerId);
    if (!clientUserId) return;

    // If the client was past_due, recover them. We don't blanket-set 'active'
    // because cancelled/inactive clients shouldn't be resurrected by an old
    // invoice settling.
    const { data, error: readErr } = await this.db
      .from('clients')
      .select('subscription_status')
      .eq('user_id', clientUserId)
      .maybeSingle();
    if (readErr || !data) return;

    if (data.subscription_status === 'past_due') {
      const { error } = await this.db
        .from('clients')
        .update({ subscription_status: 'active' })
        .eq('user_id', clientUserId);
      if (error) {
        throw new Error(`Failed to recover past_due client ${clientUserId}: ${error.message}`);
      }
      void this.notificationsService.createAndSendSubscriptionNotification(
        clientUserId,
        NotificationTypeDto.SUBSCRIPTION_REACTIVATED
      );
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string | null;
    if (!customerId) return;
    const clientUserId = await this.lookupClientByCustomerId(customerId);
    if (!clientUserId) return;

    const { data: prior } = await this.db
      .from('clients')
      .select('subscription_status')
      .eq('user_id', clientUserId)
      .maybeSingle();
    const wasPastDue = prior?.subscription_status === 'past_due';

    const { error } = await this.db
      .from('clients')
      .update({ subscription_status: 'past_due' })
      .eq('user_id', clientUserId);
    if (error) {
      throw new Error(`Failed to mark past_due for ${clientUserId}: ${error.message}`);
    }

    if (!wasPastDue) {
      void this.notificationsService.createAndSendSubscriptionNotification(
        clientUserId,
        NotificationTypeDto.SUBSCRIPTION_PAST_DUE
      );
    }
  }

  private async handlePaymentIntentTerminal(
    pi: Stripe.PaymentIntent,
    outcome: 'succeeded' | 'failed'
  ): Promise<void> {
    // New client-initiated no-show resolution flow. Settles the no_shows
    // row keyed by metadata.no_show_id. The row is the source of truth;
    // bookings.no_show_charged is mirrored below for backwards compat.
    if (pi.metadata?.kind === 'no_show_resolution') {
      await this.settleNoShowResolution(pi, outcome);
      return;
    }

    // Legacy auto-charge audit table — left in place so previously-fired
    // webhooks still update their original audit row. New no-shows do not
    // write to no_show_charges.
    if (pi.metadata?.kind !== 'no_show') return;

    const status = outcome === 'succeeded' ? 'succeeded' : 'failed';
    const failureReason = outcome === 'failed' ? (pi.last_payment_error?.message ?? null) : null;

    const { error } = await this.db
      .from('no_show_charges')
      .update({ status, failure_reason: failureReason })
      .eq('stripe_payment_intent_id', pi.id);
    if (error) {
      throw new Error(`Failed to update no_show_charges for PI ${pi.id}: ${error.message}`);
    }

    if (outcome === 'succeeded' && pi.metadata?.booking_id) {
      const amountUsd = pi.amount / 100;
      const { error: bookingErr } = await this.db
        .from('bookings')
        .update({
          no_show_charged: true,
          no_show_charge_amount_usd: amountUsd,
        })
        .eq('id', pi.metadata.booking_id);
      if (bookingErr) {
        this.logger.error(`Failed to flip booking flag for ${pi.metadata.booking_id}`, bookingErr);
      }
    }
  }

  private async settleNoShowResolution(
    pi: Stripe.PaymentIntent,
    outcome: 'succeeded' | 'failed'
  ): Promise<void> {
    const noShowId = pi.metadata?.no_show_id;
    if (!noShowId) return;

    if (outcome === 'succeeded') {
      const latest = pi.latest_charge;
      const transferId =
        typeof latest === 'object' && latest !== null
          ? ((latest.transfer as string | null | undefined) ?? null)
          : null;

      const { error } = await this.db
        .from('no_shows')
        .update({
          status: 'paid',
          resolved_at: new Date().toISOString(),
          stripe_payment_intent_id: pi.id,
          stripe_transfer_id: transferId,
          payment_metadata: { amount_received: pi.amount_received ?? pi.amount },
        })
        .eq('id', noShowId)
        .in('status', ['unresolved', 'pending_payment', 'failed']);
      if (error) {
        throw new Error(`Failed to mark no-show ${noShowId} paid: ${error.message}`);
      }

      // Mirror booking flag for legacy consumers. Best-effort: a failure
      // here doesn't unwind the no_shows row.
      const bookingId = pi.metadata?.booking_id;
      if (bookingId) {
        const amountUsd = (pi.amount_received ?? pi.amount) / 100;
        const { error: bErr } = await this.db
          .from('bookings')
          .update({ no_show_charged: true, no_show_charge_amount_usd: amountUsd })
          .eq('id', bookingId);
        if (bErr) {
          this.logger.error(`Failed to mirror booking flag for ${bookingId}`, bErr);
        }
      }
    } else {
      const failureReason = pi.last_payment_error?.message ?? null;
      const { error } = await this.db
        .from('no_shows')
        .update({
          status: 'failed',
          stripe_payment_intent_id: pi.id,
          payment_metadata: { last_failure: failureReason },
        })
        .eq('id', noShowId)
        .in('status', ['pending_payment', 'unresolved']);
      if (error) {
        throw new Error(`Failed to mark no-show ${noShowId} failed: ${error.message}`);
      }
    }
  }

  private async handleAccountUpdated(_account: Stripe.Account): Promise<void> {
    // We do not mirror Connect.charges_enabled or payouts_enabled into a
    // local column. Eligibility is checked live at action-time via
    // ConnectService.hasChargesEnabled, so there is nothing to mirror here.
    // The audit row in subscription_events is the receipt.
  }

  private async handlePaymentMethodDetached(pm: Stripe.PaymentMethod): Promise<void> {
    const { error } = await this.db
      .from('clients')
      .update({ stripe_payment_method_id: null })
      .eq('stripe_payment_method_id', pm.id);
    if (error) {
      throw new Error(`Failed to clear detached PM ${pm.id}: ${error.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  private async lookupClientByCustomerId(customerId: string | null): Promise<string | null> {
    if (!customerId) return null;
    const { data } = await this.db
      .from('clients')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    return (data?.user_id as string | undefined) ?? null;
  }

  private planFromSubscription(sub: Stripe.Subscription): 'monthly' | 'yearly' | null {
    const priceId = sub.items.data[0]?.price?.id;
    if (!priceId) return null;
    if (priceId === this.stripeService.priceMonthly) return 'monthly';
    if (priceId === this.stripeService.priceYearly) return 'yearly';
    return null;
  }

  private mapSubscriptionStatus(
    stripeStatus: Stripe.Subscription.Status,
    cancelAtPeriodEnd: boolean
  ): 'inactive' | 'active' | 'past_due' | 'cancelled' {
    if (stripeStatus === 'active' || stripeStatus === 'trialing') {
      return 'active';
    }
    if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') {
      return 'past_due';
    }
    if (stripeStatus === 'canceled') {
      return 'cancelled';
    }
    if (stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired') {
      return cancelAtPeriodEnd ? 'cancelled' : 'inactive';
    }
    return 'inactive';
  }
}
