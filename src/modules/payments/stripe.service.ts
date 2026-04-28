import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// VALUE comes from the package root — its bootstrap calls Stripe.initialize()
// with the Node platform functions on first import. TYPES come from the deep
// core module where the class+namespace declaration merge is intact (the cjs
// root entry flattens it under StripeConstructor and breaks `Stripe.Subscription`
// type access).
import StripeSDK from 'stripe';
import type { Stripe } from 'stripe/cjs/stripe.core';

// Single owner of the Stripe SDK. Every other payments service injects this
// — no other file in the project should `import Stripe from 'stripe'`.
//
// Required env vars are resolved with getOrThrow() inside the constructor so
// the app fails fast on boot if any of them are missing, rather than failing
// at request time. STRIPE_CONNECT_CLIENT_ID is read but unused (Express
// accounts don't need it); validation here keeps the spec's env contract
// honest so `.env.example` and reality stay aligned.
@Injectable()
export class StripeService {
  public readonly stripe: Stripe;
  public readonly priceMonthly: string;
  public readonly priceYearly: string;
  public readonly clientAppUrl: string;
  public readonly barberAppUrl: string;
  public readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    this.priceMonthly = this.config.getOrThrow<string>('STRIPE_PRICE_MONTHLY');
    this.priceYearly = this.config.getOrThrow<string>('STRIPE_PRICE_YEARLY');
    this.clientAppUrl = this.config.getOrThrow<string>('APP_URL_CLIENT');
    this.barberAppUrl = this.config.getOrThrow<string>('APP_URL_BARBER');
    this.config.getOrThrow<string>('STRIPE_CONNECT_CLIENT_ID');

    // apiVersion is intentionally omitted — stripe@22 enforces apiVersion to
    // match the SDK's bundled LatestApiVersion at the type level. Letting the
    // SDK pick its own version keeps runtime behavior aligned with the types.
    this.stripe = new StripeSDK(secretKey, {});
  }

  public priceIdForPlan(plan: 'monthly' | 'yearly'): string {
    return plan === 'monthly' ? this.priceMonthly : this.priceYearly;
  }
}
