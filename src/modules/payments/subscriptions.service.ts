import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { SupabaseService } from '../supabase/supabase.service';
import { StripeService } from './stripe.service';
import { CreateSubscriptionDto, SubscriptionPlanDto } from './dto/create-subscription.dto';
import { SwitchPlanDto } from './dto/switch-plan.dto';
import {
  ActivePlanResponseDto,
  CancelSubscriptionResponseDto,
  CreateSubscriptionResponseDto,
  ReactivateSubscriptionResponseDto,
  SubscriptionStateResponseDto,
  SubscriptionStatusDto,
} from './dto/subscription-response.dto';
import { PlanDowngradeNotAllowed } from './payments.exceptions';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTypeDto } from '../notifications/dto/notification.dto';

interface ClientSubscriptionRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_method_id: string | null;
  subscription_status: SubscriptionStatusDto;
  subscription_plan: 'monthly' | 'yearly' | null;
  subscription_expires_at: string | null;
  subscription_cancel_at_period_end: boolean;
}

const CLIENT_SUBSCRIPTION_COLUMNS =
  'user_id, stripe_customer_id, stripe_subscription_id, stripe_payment_method_id, subscription_status, subscription_plan, subscription_expires_at, subscription_cancel_at_period_end';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stripeService: StripeService,
    private readonly notificationsService: NotificationsService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private get stripe(): Stripe {
    return this.stripeService.stripe;
  }

  // ────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────

  public async createSubscription(
    authUserId: string,
    dto: CreateSubscriptionDto
  ): Promise<CreateSubscriptionResponseDto> {
    const client = await this.loadClient(authUserId);
    const customerId = await this.ensureStripeCustomer(client, authUserId);

    await this.stripe.paymentMethods.attach(dto.paymentMethodId, { customer: customerId });
    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: dto.paymentMethodId },
    });

    const priceId = this.stripeService.priceIdForPlan(dto.plan);
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      // In stripe@22 the Invoice no longer carries `payment_intent`; the
      // SCA client_secret moved onto Invoice.confirmation_secret. Expanding
      // latest_invoice is enough to surface it.
      expand: ['latest_invoice'],
      metadata: { client_user_id: authUserId, plan: dto.plan },
    });

    // Mirror locally. Status stays 'inactive' until customer.subscription.created /
    // .updated webhook flips it; the SCA confirmation roundtrip is what gates that.
    const { error } = await this.db
      .from('clients')
      .update({
        stripe_subscription_id: subscription.id,
        stripe_payment_method_id: dto.paymentMethodId,
        subscription_plan: dto.plan,
        subscription_cancel_at_period_end: false,
      })
      .eq('user_id', authUserId);

    if (error) {
      throw new InternalServerErrorException('Failed to persist subscription state');
    }

    return {
      subscriptionId: subscription.id,
      status: client.subscription_status,
      clientSecret: this.extractClientSecret(subscription),
    };
  }

  public async getSubscriptionState(authUserId: string): Promise<SubscriptionStateResponseDto> {
    const client = await this.loadClient(authUserId);
    return {
      status: client.subscription_status,
      plan: client.subscription_plan as SubscriptionPlanDto | null,
      currentPeriodEnd: client.subscription_expires_at,
      cancelAtPeriodEnd: client.subscription_cancel_at_period_end,
    };
  }

  public async getActivePlan(authUserId: string): Promise<ActivePlanResponseDto> {
    const client = await this.loadClient(authUserId);
    return {
      hasActivePlan: client.subscription_status === 'active',
      plan: client.subscription_plan as SubscriptionPlanDto | null,
      status: client.subscription_status,
      currentPeriodEnd: client.subscription_expires_at,
      cancelAtPeriodEnd: client.subscription_cancel_at_period_end,
    };
  }

  public async switchPlan(
    authUserId: string,
    dto: SwitchPlanDto
  ): Promise<SubscriptionStateResponseDto> {
    if (dto.plan !== SubscriptionPlanDto.YEARLY) {
      throw new PlanDowngradeNotAllowed();
    }

    const client = await this.loadClient(authUserId);
    if (!client.stripe_subscription_id) {
      throw new BadRequestException('No active subscription to switch.');
    }
    if (client.subscription_plan === 'yearly') {
      throw new PlanDowngradeNotAllowed();
    }

    const sub = await this.stripe.subscriptions.retrieve(client.stripe_subscription_id);
    const itemId = sub.items.data[0]?.id;
    if (!itemId) {
      throw new InternalServerErrorException('Subscription has no items — cannot switch plan');
    }

    const updated = await this.stripe.subscriptions.update(client.stripe_subscription_id, {
      items: [{ id: itemId, price: this.stripeService.priceYearly }],
      proration_behavior: 'always_invoice',
      metadata: { client_user_id: authUserId, plan: 'yearly' },
    });

    // Mirror plan and the new period_end immediately so the response reflects
    // the post-proration state without waiting for the customer.subscription.updated
    // webhook race. The webhook will reconfirm shortly.
    const periodEndUnix = updated.items.data[0]?.current_period_end ?? null;
    const periodEndIso = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

    const mirror: Record<string, unknown> = { subscription_plan: 'yearly' };
    if (periodEndIso) mirror.subscription_expires_at = periodEndIso;

    const { error } = await this.db
      .from('clients')
      .update(mirror)
      .eq('user_id', authUserId);

    if (error) {
      throw new InternalServerErrorException('Failed to mirror plan change');
    }

    return this.getSubscriptionState(authUserId);
  }

  public async reactivateSubscription(
    authUserId: string
  ): Promise<ReactivateSubscriptionResponseDto> {
    const client = await this.loadClient(authUserId);
    if (!client.stripe_subscription_id) {
      throw new NotFoundException('No subscription to reactivate.');
    }
    if (!client.subscription_cancel_at_period_end) {
      throw new BadRequestException('Subscription is not scheduled for cancellation.');
    }

    // Clear the pending cancellation on Stripe — keeps the same subscription,
    // no new invoice, no proration. Supabase mirror updated below.
    await this.stripe.subscriptions.update(client.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    const { error } = await this.db
      .from('clients')
      .update({ subscription_cancel_at_period_end: false })
      .eq('user_id', authUserId);

    if (error) {
      throw new InternalServerErrorException('Failed to mirror reactivation');
    }

    return {
      status: client.subscription_status,
      cancelAtPeriodEnd: false,
      plan: client.subscription_plan as SubscriptionPlanDto | null,
      currentPeriodEnd: client.subscription_expires_at,
    };
  }

  public async cancelSubscription(authUserId: string): Promise<CancelSubscriptionResponseDto> {
    const client = await this.loadClient(authUserId);
    if (!client.stripe_subscription_id) {
      throw new BadRequestException('No active subscription to cancel.');
    }

    await this.stripe.subscriptions.update(client.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Mirror immediately. Status stays 'active' until period_end, when the
    // customer.subscription.deleted webhook flips it to 'cancelled'.
    const { error } = await this.db
      .from('clients')
      .update({ subscription_cancel_at_period_end: true })
      .eq('user_id', authUserId);

    if (error) {
      throw new InternalServerErrorException('Failed to mirror cancellation');
    }

    // Best-effort push. NotificationsService swallows its own errors, so the
    // cancel response is never blocked or rolled back by notification failure.
    void this.notificationsService.createAndSendSubscriptionNotification(
      authUserId,
      NotificationTypeDto.SUBSCRIPTION_CANCEL_SCHEDULED
    );

    return {
      status: client.subscription_status,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: client.subscription_expires_at,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async loadClient(authUserId: string): Promise<ClientSubscriptionRow> {
    const { data, error } = await this.db
      .from('clients')
      .select(CLIENT_SUBSCRIPTION_COLUMNS)
      .eq('user_id', authUserId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch client');
    if (!data) throw new NotFoundException('Client profile not found');
    return data as ClientSubscriptionRow;
  }

  private async ensureStripeCustomer(
    client: ClientSubscriptionRow,
    authUserId: string
  ): Promise<string> {
    if (client.stripe_customer_id) return client.stripe_customer_id;

    // Pull email from auth.users — never trust client input for billing identity.
    const { data: authUser, error: authErr } = await this.db.auth.admin.getUserById(authUserId);
    if (authErr || !authUser?.user) {
      throw new InternalServerErrorException('Failed to resolve auth user for Stripe customer');
    }

    const customer = await this.stripe.customers.create({
      email: authUser.user.email ?? undefined,
      metadata: { client_user_id: authUserId },
    });

    const { error } = await this.db
      .from('clients')
      .update({ stripe_customer_id: customer.id })
      .eq('user_id', authUserId);
    if (error) {
      throw new InternalServerErrorException('Failed to persist Stripe customer ID');
    }

    return customer.id;
  }

  private extractClientSecret(subscription: Stripe.Subscription): string | null {
    const invoice = subscription.latest_invoice;
    if (invoice && typeof invoice !== 'string') {
      return invoice.confirmation_secret?.client_secret ?? null;
    }
    return null;
  }
}
