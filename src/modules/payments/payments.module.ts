import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { StripeService } from './stripe.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { SubscriptionRequiredGuard } from './guards/subscription-required.guard';

// Note: the legacy NoShowService (auto-charge on mark) has been removed.
// The replacement lives in modules/no-shows (client-initiated payments).
// WebhooksService still exposes a hook the no-shows module wires into via
// the ModuleRef pattern documented in webhooks.service.ts.
@Module({
  imports: [SupabaseModule],
  controllers: [SubscriptionsController, CardsController, ConnectController, WebhooksController],
  providers: [
    StripeService,
    SubscriptionsService,
    CardsService,
    ConnectService,
    WebhooksService,
    SubscriptionRequiredGuard,
  ],
  exports: [StripeService, ConnectService, WebhooksService, SubscriptionRequiredGuard],
})
export class PaymentsModule {}
