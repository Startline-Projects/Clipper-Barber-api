import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { SupabaseService } from '../supabase/supabase.service';
import { StripeService } from '../payments/stripe.service';
import { ConnectService } from '../payments/connect.service';
import {
  BarberNoShowStatsDto,
  InitiateNoShowPaymentResponseDto,
  ListNoShowsQueryDto,
  ListNoShowsResponseDto,
  NoShowItemDto,
  NoShowStatusDto,
} from './dto/no-show.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Statuses that count against the client (still owed). Refunded does NOT
// count — it represents a settled, then-reversed charge.
export const UNRESOLVED_STATUSES = ['unresolved', 'failed'] as const;
const RESOLVED_STATUSES = ['paid'] as const;

interface NoShowRow {
  id: string;
  booking_id: string;
  client_id: string;
  barber_id: string;
  amount_usd: string | number;
  currency: string;
  reason: string | null;
  status: NoShowStatusDto;
  stripe_payment_intent_id: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface RecordUnresolvedInput {
  bookingId: string;
  clientAuthId: string;
  barberAuthId: string;
  amountUsd: number;
  reason: string | null;
}

@Injectable()
export class NoShowsService {
  private readonly logger = new Logger(NoShowsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stripeService: StripeService,
    private readonly connectService: ConnectService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Write path — called by BarbersService.markNoShow
  // ────────────────────────────────────────────────────────────

  // Idempotent: re-marking a booking returns the existing row.
  public async recordUnresolved(input: RecordUnresolvedInput): Promise<NoShowItemDto> {
    if (!(input.amountUsd >= 0)) {
      throw new BadRequestException('No-show amount must be non-negative.');
    }

    const { data, error } = await this.db
      .from('no_shows')
      .insert({
        booking_id: input.bookingId,
        client_id: input.clientAuthId,
        barber_id: input.barberAuthId,
        amount_usd: input.amountUsd,
        currency: 'usd',
        reason: input.reason,
        status: 'unresolved',
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        const existing = await this.fetchByBookingId(input.bookingId);
        if (existing) return this.projectRow(existing);
        throw new ConflictException('A no-show already exists for this booking.');
      }
      this.logger.error('Failed to insert no_shows row', error);
      throw new InternalServerErrorException('Failed to record no-show');
    }

    return this.projectRow(data as NoShowRow);
  }

  // ────────────────────────────────────────────────────────────
  // Read paths — list / counts / stats
  // ────────────────────────────────────────────────────────────

  // Cheap, used to surface hasBlockedNoShows + unresolvedNoShowsCount on
  // barber-detail / eligibility endpoints. Calls the SQL helper so the
  // filter logic stays in one place.
  public async unresolvedCount(clientAuthId: string): Promise<number> {
    const { data, error } = await this.db.rpc('client_unresolved_no_show_count', {
      p_client_id: clientAuthId,
    });
    if (error) {
      this.logger.error('client_unresolved_no_show_count failed', error);
      return 0;
    }
    return Number(data ?? 0);
  }

  public async listForClient(
    clientAuthId: string,
    query: ListNoShowsQueryDto
  ): Promise<ListNoShowsResponseDto> {
    return this.listFor('client', clientAuthId, query);
  }

  public async listForBarber(
    barberAuthId: string,
    query: ListNoShowsQueryDto
  ): Promise<ListNoShowsResponseDto> {
    return this.listFor('barber', barberAuthId, query);
  }

  // Single implementation, parameterized by the side requesting the page.
  // Ordering: unresolved/failed (oldest first within bucket), then paid /
  // refunded (newest first). Implemented in JS rather than SQL so we don't
  // need a CASE in the ORDER BY when fetching from Supabase.
  private async listFor(
    side: 'client' | 'barber',
    authId: string,
    query: ListNoShowsQueryDto
  ): Promise<ListNoShowsResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const column = side === 'client' ? 'client_id' : 'barber_id';

    let q = this.db
      .from('no_shows')
      .select('*', { count: 'exact' })
      .eq(column, authId);

    if (query.status) {
      q = q.eq('status', query.status);
    }

    const { data, error, count } = await q;
    if (error) throw new InternalServerErrorException('Failed to fetch no-shows');

    const rows = (data ?? []) as NoShowRow[];
    const sorted = this.sortByBucket(rows);

    const totalItems = count ?? sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const start = (page - 1) * limit;
    const pageRows = sorted.slice(start, start + limit);

    const items = await this.hydrateItems(side, pageRows);

    return {
      items,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        limit,
        hasNextPage: page < totalPages,
      },
    };
  }

  public async getBarberStats(barberAuthId: string): Promise<BarberNoShowStatsDto> {
    const { data, error } = await this.db
      .from('no_shows')
      .select('amount_usd, status')
      .eq('barber_id', barberAuthId);
    if (error) throw new InternalServerErrorException('Failed to fetch no-show stats');

    let unresolvedCount = 0;
    let unresolvedAmount = 0;
    let resolvedCount = 0;
    let resolvedAmount = 0;

    for (const row of (data ?? []) as Array<{ amount_usd: string | number; status: string }>) {
      const amt = Number(row.amount_usd);
      if ((UNRESOLVED_STATUSES as readonly string[]).includes(row.status)) {
        unresolvedCount += 1;
        unresolvedAmount += amt;
      } else if ((RESOLVED_STATUSES as readonly string[]).includes(row.status)) {
        resolvedCount += 1;
        resolvedAmount += amt;
      }
    }

    return {
      unresolvedCount,
      unresolvedAmountUsd: round2(unresolvedAmount),
      resolvedCount,
      resolvedAmountUsd: round2(resolvedAmount),
      totalEarningsUsd: round2(resolvedAmount),
    };
  }

  // ────────────────────────────────────────────────────────────
  // Payment initiation (client-side)
  // ────────────────────────────────────────────────────────────

  // Client pays a single no-show. Returns the PaymentIntent client_secret
  // for the mobile/web SDK to confirm on-session. The webhook is the
  // source of truth — this method only flips status to 'pending_payment'.
  //
  // Idempotent against retries: if a PI is already attached and still in
  // an actionable state, the same client_secret is returned.
  public async initiatePayment(
    clientAuthId: string,
    noShowId: string
  ): Promise<InitiateNoShowPaymentResponseDto> {
    const row = await this.fetchById(noShowId);

    if (row.client_id !== clientAuthId) {
      throw new ForbiddenException('You cannot pay this no-show.');
    }
    if (row.status === 'paid' || row.status === 'refunded') {
      throw new ConflictException('This no-show has already been resolved.');
    }

    // Barber must have an active Connect account that can accept charges,
    // otherwise transfer_data.destination will reject the PaymentIntent.
    const barber = await this.loadBarberForCharge(row.barber_id);
    if (!barber.stripe_connect_account_id) {
      throw new ConflictException('Barber is not set up to receive payments.');
    }
    const chargesOk = await this.connectService
      .hasChargesEnabled(barber.stripe_connect_account_id)
      .catch(() => false);
    if (!chargesOk) {
      throw new ConflictException('Barber Stripe account is not ready to accept payments.');
    }

    const client = await this.loadClientForCharge(clientAuthId);
    const amountCents = Math.round(Number(row.amount_usd) * 100);
    if (amountCents <= 0) {
      throw new BadRequestException('Invalid no-show amount.');
    }

    // Reuse existing PI if one is already attached and recoverable.
    if (row.stripe_payment_intent_id) {
      const existing = await this.retrieveRecoverableIntent(row.stripe_payment_intent_id);
      if (existing) {
        return this.toInitiateResponse(row.id, existing, Number(row.amount_usd), row.currency);
      }
    }

    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.stripeService.stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: row.currency,
          customer: client.stripe_customer_id ?? undefined,
          transfer_data: { destination: barber.stripe_connect_account_id },
          automatic_payment_methods: { enabled: true },
          metadata: {
            kind: 'no_show_resolution',
            no_show_id: row.id,
            booking_id: row.booking_id,
            barber_id: row.barber_id,
            client_id: clientAuthId,
          },
        },
        // Stripe-level idempotency: any retry from the client within 24h
        // returns the same PaymentIntent rather than creating duplicates.
        { idempotencyKey: `no_show_init_${row.id}` }
      );
    } catch (err) {
      this.logger.error(`Stripe create PI failed for no-show ${row.id}`, err as Error);
      throw new InternalServerErrorException('Failed to start payment');
    }

    const { error: upErr } = await this.db
      .from('no_shows')
      .update({
        status: 'pending_payment',
        stripe_payment_intent_id: pi.id,
      })
      .eq('id', row.id)
      .in('status', ['unresolved', 'failed', 'pending_payment']);
    if (upErr) {
      this.logger.error(`Failed to flag pending_payment for ${row.id}`, upErr);
      // Don't roll back the PI — the webhook can still settle it via the
      // metadata.no_show_id linkage.
    }

    return this.toInitiateResponse(row.id, pi, Number(row.amount_usd), row.currency);
  }

  // ────────────────────────────────────────────────────────────
  // Webhook entry point — called by WebhooksService
  // ────────────────────────────────────────────────────────────

  // Settles a no-show row from a payment_intent terminal event. Idempotent:
  // a duplicate webhook against an already-paid row is a no-op.
  public async settleFromPaymentIntent(
    pi: Stripe.PaymentIntent,
    outcome: 'succeeded' | 'failed'
  ): Promise<void> {
    const noShowId = pi.metadata?.no_show_id;
    if (!noShowId) return;

    if (outcome === 'succeeded') {
      const charge = pi.latest_charge;
      const transferId =
        typeof charge === 'object' && charge !== null
          ? (charge.transfer as string | null | undefined) ?? null
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
        this.logger.error(`Failed to mark no-show ${noShowId} paid`, error);
        throw error;
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
        this.logger.error(`Failed to mark no-show ${noShowId} failed`, error);
        throw error;
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  private async fetchById(id: string): Promise<NoShowRow> {
    const { data, error } = await this.db
      .from('no_shows')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch no-show');
    if (!data) throw new NotFoundException('No-show not found');
    return data as NoShowRow;
  }

  private async fetchByBookingId(bookingId: string): Promise<NoShowRow | null> {
    const { data } = await this.db
      .from('no_shows')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();
    return (data as NoShowRow | null) ?? null;
  }

  private async loadBarberForCharge(
    authId: string
  ): Promise<{ stripe_connect_account_id: string | null }> {
    const { data, error } = await this.db
      .from('barbers')
      .select('stripe_connect_account_id')
      .eq('user_id', authId)
      .maybeSingle();
    if (error || !data) throw new InternalServerErrorException('Failed to load barber');
    return data as { stripe_connect_account_id: string | null };
  }

  private async loadClientForCharge(
    authId: string
  ): Promise<{ stripe_customer_id: string | null }> {
    const { data, error } = await this.db
      .from('clients')
      .select('stripe_customer_id')
      .eq('user_id', authId)
      .maybeSingle();
    if (error || !data) throw new InternalServerErrorException('Failed to load client');
    return data as { stripe_customer_id: string | null };
  }

  private async retrieveRecoverableIntent(
    paymentIntentId: string
  ): Promise<Stripe.PaymentIntent | null> {
    try {
      const pi = await this.stripeService.stripe.paymentIntents.retrieve(paymentIntentId);
      const recoverable: Stripe.PaymentIntent.Status[] = [
        'requires_payment_method',
        'requires_confirmation',
        'requires_action',
        'processing',
      ];
      if (recoverable.includes(pi.status)) return pi;
      return null;
    } catch {
      return null;
    }
  }

  private toInitiateResponse(
    noShowId: string,
    pi: Stripe.PaymentIntent,
    amountUsd: number,
    currency: string
  ): InitiateNoShowPaymentResponseDto {
    if (!pi.client_secret) {
      throw new InternalServerErrorException('Stripe did not return a client_secret');
    }
    return {
      noShowId,
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret,
      status: pi.status === 'succeeded' ? NoShowStatusDto.PAID : NoShowStatusDto.PENDING_PAYMENT,
      amountUsd,
      currency,
    };
  }

  // Sort: unresolved/failed first (asc by created_at — oldest first so the
  // most overdue is on top), then paid/refunded (desc by created_at).
  public sortByBucket(rows: NoShowRow[]): NoShowRow[] {
    const unresolved: NoShowRow[] = [];
    const resolved: NoShowRow[] = [];
    for (const r of rows) {
      if ((UNRESOLVED_STATUSES as readonly string[]).includes(r.status)) unresolved.push(r);
      else resolved.push(r);
    }
    unresolved.sort((a, b) => a.created_at.localeCompare(b.created_at));
    resolved.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return [...unresolved, ...resolved];
  }

  private projectRow(row: NoShowRow): NoShowItemDto {
    return {
      id: row.id,
      status: row.status,
      amountUsd: Number(row.amount_usd),
      currency: row.currency,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      booking: { id: row.booking_id, scheduledAt: '', serviceName: null },
      counterparty: { id: row.barber_id, name: '', profilePhotoUrl: null },
    };
  }

  // Joins-by-hand because Supabase joins return embedded objects that the
  // Postgres role would need RLS for. Service role bypasses RLS, but we
  // keep the join explicit so the shape is predictable and the query plan
  // is straightforward.
  private async hydrateItems(
    side: 'client' | 'barber',
    rows: NoShowRow[]
  ): Promise<NoShowItemDto[]> {
    if (rows.length === 0) return [];

    const bookingIds = Array.from(new Set(rows.map((r) => r.booking_id)));
    const counterpartyIds = Array.from(
      new Set(rows.map((r) => (side === 'client' ? r.barber_id : r.client_id)))
    );

    const [bookings, counterparties] = await Promise.all([
      this.loadBookings(bookingIds),
      side === 'client'
        ? this.loadBarbers(counterpartyIds)
        : this.loadClients(counterpartyIds),
    ]);

    return rows.map((r) => {
      const b = bookings.get(r.booking_id);
      const counterpartyId = side === 'client' ? r.barber_id : r.client_id;
      const cp = counterparties.get(counterpartyId);
      return {
        id: r.id,
        status: r.status,
        amountUsd: Number(r.amount_usd),
        currency: r.currency,
        reason: r.reason,
        createdAt: new Date(r.created_at).toISOString(),
        resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
        booking: {
          id: r.booking_id,
          scheduledAt: b?.scheduledAt ?? new Date(r.created_at).toISOString(),
          serviceName: b?.serviceName ?? null,
        },
        counterparty: {
          id: counterpartyId,
          name: cp?.name ?? 'Unknown',
          profilePhotoUrl: cp?.profilePhotoUrl ?? null,
        },
      };
    });
  }

  private async loadBookings(
    ids: string[]
  ): Promise<Map<string, { scheduledAt: string; serviceName: string | null }>> {
    const out = new Map<string, { scheduledAt: string; serviceName: string | null }>();
    if (ids.length === 0) return out;

    const { data, error } = await this.db
      .from('bookings')
      .select('id, scheduled_at, barber_service_id')
      .in('id', ids);
    if (error) return out;

    const serviceIds = Array.from(
      new Set(
        (data ?? [])
          .map((r) => r.barber_service_id as string | null)
          .filter((v): v is string => v !== null)
      )
    );
    const serviceNames = new Map<string, string>();
    if (serviceIds.length > 0) {
      const { data: svcs } = await this.db
        .from('barber_services')
        .select('id, name')
        .in('id', serviceIds);
      for (const s of svcs ?? []) {
        serviceNames.set(s.id as string, s.name as string);
      }
    }

    for (const row of data ?? []) {
      out.set(row.id as string, {
        scheduledAt: new Date(row.scheduled_at as string).toISOString(),
        serviceName:
          row.barber_service_id !== null
            ? serviceNames.get(row.barber_service_id as string) ?? null
            : null,
      });
    }
    return out;
  }

  private async loadBarbers(
    ids: string[]
  ): Promise<Map<string, { name: string; profilePhotoUrl: string | null }>> {
    const out = new Map<string, { name: string; profilePhotoUrl: string | null }>();
    if (ids.length === 0) return out;
    const { data } = await this.db
      .from('barbers')
      .select('user_id, full_name, profile_photo_url')
      .in('user_id', ids);
    for (const r of data ?? []) {
      out.set(r.user_id as string, {
        name: (r.full_name as string) ?? 'Barber',
        profilePhotoUrl: (r.profile_photo_url as string | null) ?? null,
      });
    }
    return out;
  }

  private async loadClients(
    ids: string[]
  ): Promise<Map<string, { name: string; profilePhotoUrl: string | null }>> {
    const out = new Map<string, { name: string; profilePhotoUrl: string | null }>();
    if (ids.length === 0) return out;
    const { data } = await this.db
      .from('clients')
      .select('user_id, name, profile_photo_url')
      .in('user_id', ids);
    for (const r of data ?? []) {
      out.set(r.user_id as string, {
        name: (r.name as string) ?? 'Client',
        profilePhotoUrl: (r.profile_photo_url as string | null) ?? null,
      });
    }
    return out;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
