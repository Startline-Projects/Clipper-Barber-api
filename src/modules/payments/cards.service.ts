import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { SupabaseService } from '../supabase/supabase.service';
import { StripeService } from './stripe.service';
import { ReplaceCardDto, CardActionResponseDto } from './dto/replace-card.dto';
import { ActiveRecurring, ActiveSubscription } from './payments.exceptions';

interface ClientCardRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
}

@Injectable()
export class CardsService {
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

  public async replaceCard(
    authUserId: string,
    dto: ReplaceCardDto
  ): Promise<CardActionResponseDto> {
    const client = await this.loadClient(authUserId);
    if (!client.stripe_customer_id) {
      throw new BadRequestException('No Stripe customer on file. Subscribe first.');
    }

    await this.stripe.paymentMethods.attach(dto.paymentMethodId, {
      customer: client.stripe_customer_id,
    });
    await this.stripe.customers.update(client.stripe_customer_id, {
      invoice_settings: { default_payment_method: dto.paymentMethodId },
    });

    const previous = client.stripe_payment_method_id;

    const { error } = await this.db
      .from('clients')
      .update({ stripe_payment_method_id: dto.paymentMethodId })
      .eq('user_id', authUserId);
    if (error) {
      throw new InternalServerErrorException('Failed to mirror payment method');
    }

    if (previous && previous !== dto.paymentMethodId) {
      // Best-effort detach. If Stripe returns an error (e.g. PM already detached
      // by a webhook) we ignore — payment_method.detached webhook would have
      // already nulled the column on its own.
      await this.stripe.paymentMethods.detach(previous).catch(() => undefined);
    }

    return { ok: true, paymentMethodId: dto.paymentMethodId };
  }

  public async removeCard(authUserId: string): Promise<CardActionResponseDto> {
    const client = await this.loadClient(authUserId);
    if (!client.stripe_payment_method_id) {
      throw new BadRequestException('No saved card to remove.');
    }

    await this.assertNoActiveSubscription(authUserId);
    await this.assertNoActiveRecurring(authUserId);

    await this.stripe.paymentMethods.detach(client.stripe_payment_method_id);

    const { error } = await this.db
      .from('clients')
      .update({ stripe_payment_method_id: null })
      .eq('user_id', authUserId);
    if (error) {
      throw new InternalServerErrorException('Failed to clear payment method');
    }

    return { ok: true, paymentMethodId: null };
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async loadClient(authUserId: string): Promise<ClientCardRow> {
    const { data, error } = await this.db
      .from('clients')
      .select('user_id, stripe_customer_id, stripe_payment_method_id')
      .eq('user_id', authUserId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch client');
    if (!data) throw new NotFoundException('Client profile not found');
    return data as ClientCardRow;
  }

  private async assertNoActiveSubscription(authUserId: string): Promise<void> {
    const { data, error } = await this.db.rpc('is_client_subscribed', {
      p_client_user_id: authUserId,
    });
    if (error) {
      throw new InternalServerErrorException('Failed to check subscription state');
    }
    if (data === true) {
      throw new ActiveSubscription();
    }
  }

  private async assertNoActiveRecurring(authUserId: string): Promise<void> {
    const { count, error } = await this.db
      .from('recurring_bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('client_id', authUserId)
      .in('status', ['pending_barber_approval', 'active', 'paused']);
    if (error) {
      throw new InternalServerErrorException('Failed to check recurring arrangements');
    }
    if ((count ?? 0) > 0) {
      throw new ActiveRecurring();
    }
  }
}
