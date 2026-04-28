import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { StripeService } from './stripe.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';
import { NoShowService } from './no-show.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { SubscriptionRequiredGuard } from './guards/subscription-required.guard';

@Module({
  imports: [SupabaseModule],
  controllers: [SubscriptionsController, CardsController, ConnectController, WebhooksController],
  providers: [
    StripeService,
    SubscriptionsService,
    CardsService,
    ConnectService,
    NoShowService,
    WebhooksService,
    SubscriptionRequiredGuard,
  ],
  exports: [StripeService, NoShowService, ConnectService, SubscriptionRequiredGuard],
})
export class PaymentsModule {}
