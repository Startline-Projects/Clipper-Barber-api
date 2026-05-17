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
  ReconcileNoShowResponseDto,
} from './dto/no-show.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Statuses that count against the client (still owed). Refunded and paid
// do NOT count. Includes the legacy 'failed' alias for old rows.
export const UNRESOLVED_STATUSES = [
  'unresolved',
  'failed',
  'payment_failed',
  'reconciliation_required',
] as const;

// Statuses that represent in-flight settlement — UI should show "settling"
// not "pay now" and not "owed".
export const IN_FLIGHT_STATUSES = [
  'payment_intent_created',
  'requires_action',
  'processing',
  'pending_payment', // legacy
] as const;

const RESOLVED_STATUSES = ['paid'] as const;
const TERMINAL_STATUSES = ['paid', 'refunded', 'canceled'] as const;

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
  idempotency_key: string | null;
  payment_attempts: number;
  last_known_pi_status: string | null;
  last_reconciled_at: string | null;
  last_failure_reason: string | null;
}

interface RecordUnresolvedInput {
  bookingId: string;
  clientAuthId: string;
  barberAuthId: string;
  amountUsd: number;
  reason: string | null;
}

type AuditSource = 'webhook' | 'reconcile' | 'client_init' | 'manual';

interface AuditWriteInput {
  noShowId: string;
  source: AuditSource;
  fromStatus: NoShowStatusDto | string | null;
  toStatus: NoShowStatusDto | string;
  stripePiId?: string | null;
  stripePiStatus?: string | null;
  stripeEventId?: string | null;
  amountUsd?: number | null;
  failureReason?: string | null;
  rawPayload?: Record<string, unknown> | null;
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
  // Stripe ↔ internal status mapping
  // ────────────────────────────────────────────────────────────

  // Single source of truth for translating a Stripe PaymentIntent.status
  // into a canonical NoShowStatusDto. Never returns the legacy aliases.
  public mapStripeStatus(stripeStatus: Stripe.PaymentIntent.Status): NoShowStatusDto {
    switch (stripeStatus) {
      case 'succeeded':
        return NoShowStatusDto.PAID;
      case 'processing':
        return NoShowStatusDto.PROCESSING;
      case 'requires_action':
      case 'requires_confirmation':
        return NoShowStatusDto.REQUIRES_ACTION;
      case 'requires_capture':
        // Manual-capture is unused in this flow, but defensively treat as
        // processing — webhook will follow with succeeded/failed.
        return NoShowStatusDto.PROCESSING;
      case 'requires_payment_method':
        // First-time creation lands here. The caller decides whether to
        // surface as PAYMENT_INTENT_CREATED (fresh PI) vs PAYMENT_FAILED
        // (Stripe re-flagged after a declined attempt). Default to failed
        // for safety; callers override on first create.
        return NoShowStatusDto.PAYMENT_FAILED;
      case 'canceled':
        return NoShowStatusDto.CANCELED;
      default:
        return NoShowStatusDto.RECONCILIATION_REQUIRED;
    }
  }

  // Normalises legacy/alias statuses for any downstream UX. Persisted rows
  // may still hold 'pending_payment' or 'failed' from before the migration;
  // we surface them as the new canonical names to API consumers.
  public normaliseStatus(status: NoShowStatusDto | string): NoShowStatusDto {
    if (status === 'pending_payment') return NoShowStatusDto.PROCESSING;
    if (status === 'failed') return NoShowStatusDto.PAYMENT_FAILED;
    return status as NoShowStatusDto;
  }

  // ────────────────────────────────────────────────────────────
  // Write path — called by BarbersService.markNoShow
  // ────────────────────────────────────────────────────────────

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

    await this.writeAudit({
      noShowId: (data as NoShowRow).id,
      source: 'manual',
      fromStatus: null,
      toStatus: 'unresolved',
      amountUsd: input.amountUsd,
    });

    return this.projectRow(data as NoShowRow);
  }

  // ────────────────────────────────────────────────────────────
  // Read paths
  // ────────────────────────────────────────────────────────────

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
      // In-flight rows (processing / requires_action / etc.) are counted in
      // neither bucket — they are transient.
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

  public async initiatePayment(
    clientAuthId: string,
    noShowId: string
  ): Promise<InitiateNoShowPaymentResponseDto> {
    const row = await this.fetchById(noShowId);

    if (row.client_id !== clientAuthId) {
      throw new ForbiddenException('You cannot pay this no-show.');
    }
    if ((TERMINAL_STATUSES as readonly string[]).includes(row.status)) {
      throw new ConflictException('This no-show has already been resolved.');
    }

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

    // Reuse a recoverable PI if one exists. This is the frontend-double-tap
    // safety net layered on top of Stripe's own idempotency key.
    if (row.stripe_payment_intent_id) {
      const existing = await this.retrieveRecoverableIntent(row.stripe_payment_intent_id);
      if (existing) {
        return this.toInitiateResponse(row, existing);
      }
    }

    // Stable, per-no-show idempotency key. Any retry within 24h returns the
    // same PI rather than creating duplicates.
    const idempotencyKey = `no_show_init_${row.id}`;

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
        { idempotencyKey }
      );
    } catch (err) {
      this.logger.error(`Stripe create PI failed for no-show ${row.id}`, err as Error);
      throw new InternalServerErrorException('Failed to start payment');
    }

    // Flip the row to payment_intent_created (or whatever the live PI status
    // maps to). Increment payment_attempts so we can spot retry loops.
    const initialStatus = this.mapStripeStatus(pi.status);
    const persistedStatus: NoShowStatusDto =
      pi.status === 'requires_payment_method'
        ? NoShowStatusDto.PAYMENT_INTENT_CREATED
        : initialStatus;

    const { error: upErr } = await this.db
      .from('no_shows')
      .update({
        status: persistedStatus,
        stripe_payment_intent_id: pi.id,
        idempotency_key: idempotencyKey,
        payment_attempts: row.payment_attempts + 1,
        last_known_pi_status: pi.status,
      })
      .eq('id', row.id)
      .in('status', [
        'unresolved',
        'failed',
        'payment_failed',
        'pending_payment',
        'payment_intent_created',
        'requires_action',
        'processing',
        'reconciliation_required',
      ]);

    if (upErr) {
      this.logger.error(`Failed to flag ${persistedStatus} for ${row.id}`, upErr);
      // Don't roll back the PI — webhook + reconcile can still settle it.
    } else {
      await this.writeAudit({
        noShowId: row.id,
        source: 'client_init',
        fromStatus: row.status,
        toStatus: persistedStatus,
        stripePiId: pi.id,
        stripePiStatus: pi.status,
        amountUsd: Number(row.amount_usd),
      });
    }

    return this.toInitiateResponse({ ...row, idempotency_key: idempotencyKey }, pi);
  }

  // ────────────────────────────────────────────────────────────
  // Reconciliation — authoritative self-heal against Stripe
  // ────────────────────────────────────────────────────────────

  public async reconcile(
    clientAuthId: string,
    noShowId: string
  ): Promise<ReconcileNoShowResponseDto> {
    const row = await this.fetchById(noShowId);
    if (row.client_id !== clientAuthId) {
      throw new ForbiddenException('You cannot reconcile this no-show.');
    }

    const now = new Date().toISOString();

    if (!row.stripe_payment_intent_id) {
      await this.db
        .from('no_shows')
        .update({ last_reconciled_at: now })
        .eq('id', row.id);
      return {
        noShowId: row.id,
        status: this.normaliseStatus(row.status),
        stripePaymentIntentStatus: null,
        changed: false,
        reconciledAt: now,
      };
    }

    let pi: Stripe.PaymentIntent | null = null;
    try {
      pi = await this.stripeService.stripe.paymentIntents.retrieve(
        row.stripe_payment_intent_id
      );
    } catch (err) {
      this.logger.error(
        `Reconcile: Stripe retrieve failed for PI ${row.stripe_payment_intent_id}`,
        err as Error
      );
      // Mark for follow-up so an operator/cron can investigate.
      await this.db
        .from('no_shows')
        .update({
          status: 'reconciliation_required',
          last_reconciled_at: now,
          last_failure_reason: 'stripe_retrieve_failed',
        })
        .eq('id', row.id)
        .not('status', 'in', `(${TERMINAL_STATUSES.map((s) => `"${s}"`).join(',')})`);
      throw new InternalServerErrorException('Unable to verify payment with Stripe.');
    }

    const changed = await this.applyPiToRow(row, pi, 'reconcile');

    const fresh = await this.fetchById(row.id);
    return {
      noShowId: fresh.id,
      status: this.normaliseStatus(fresh.status),
      stripePaymentIntentStatus: pi.status,
      changed,
      reconciledAt: now,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Webhook entry point — called by WebhooksService
  // ────────────────────────────────────────────────────────────

  // Idempotent: a duplicate webhook against a terminal row is a no-op.
  public async settleFromPaymentIntent(
    pi: Stripe.PaymentIntent,
    _outcome: 'succeeded' | 'failed' | 'processing' | 'requires_action' | 'canceled',
    eventId?: string
  ): Promise<void> {
    const noShowId = pi.metadata?.no_show_id;
    if (!noShowId) return;

    const row = await this.fetchById(noShowId).catch(() => null);
    if (!row) return;

    await this.applyPiToRow(row, pi, 'webhook', eventId);
  }

  // Core state-transition primitive. Used by both webhook + reconcile.
  // Returns true if the DB row changed.
  private async applyPiToRow(
    row: NoShowRow,
    pi: Stripe.PaymentIntent,
    source: AuditSource,
    eventId?: string
  ): Promise<boolean> {
    // Never reverse a terminal state. The DB trigger also enforces this;
    // the early-return saves an audit row + a noisy 23514.
    if ((TERMINAL_STATUSES as readonly string[]).includes(row.status)) {
      return false;
    }

    const nextStatus = this.mapStripeStatus(pi.status);
    const now = new Date().toISOString();
    const failureReason = pi.last_payment_error?.message ?? null;

    const update: Record<string, unknown> = {
      stripe_payment_intent_id: pi.id,
      last_known_pi_status: pi.status,
      last_webhook_event_at: source === 'webhook' ? now : undefined,
      last_reconciled_at: source === 'reconcile' ? now : undefined,
      last_failure_reason: failureReason,
    };

    if (nextStatus === NoShowStatusDto.PAID) {
      const latest = pi.latest_charge;
      const transferId =
        typeof latest === 'object' && latest !== null
          ? ((latest as Stripe.Charge).transfer as string | null | undefined) ?? null
          : null;
      update.status = 'paid';
      update.resolved_at = now;
      update.stripe_transfer_id = transferId;
      update.payment_metadata = {
        amount_received: pi.amount_received ?? pi.amount,
        reconciled_via: source,
      };
    } else {
      update.status = nextStatus;
    }

    // Strip undefined so Supabase doesn't try to set them to null.
    for (const k of Object.keys(update)) {
      if (update[k] === undefined) delete update[k];
    }

    const { error } = await this.db
      .from('no_shows')
      .update(update)
      .eq('id', row.id)
      // Guard against concurrent finalisers racing us.
      .not('status', 'in', `(${TERMINAL_STATUSES.map((s) => `"${s}"`).join(',')})`);

    if (error) {
      this.logger.error(`applyPiToRow failed for ${row.id}`, error);
      // Don't throw on webhook path — Stripe would retry forever. The
      // reconcile path catches its own errors.
      if (source === 'reconcile') {
        throw new InternalServerErrorException('Failed to apply Stripe state.');
      }
      return false;
    }

    if (row.status !== update.status) {
      await this.writeAudit({
        noShowId: row.id,
        source,
        fromStatus: row.status,
        toStatus: update.status as string,
        stripePiId: pi.id,
        stripePiStatus: pi.status,
        stripeEventId: eventId ?? null,
        amountUsd: (pi.amount_received ?? pi.amount) / 100,
        failureReason,
      });

      // Best-effort booking mirror for legacy consumers on success only.
      if (update.status === 'paid' && pi.metadata?.booking_id) {
        const amountUsd = (pi.amount_received ?? pi.amount) / 100;
        const { error: bErr } = await this.db
          .from('bookings')
          .update({ no_show_charged: true, no_show_charge_amount_usd: amountUsd })
          .eq('id', pi.metadata.booking_id);
        if (bErr) {
          this.logger.error(`Failed to mirror booking flag for ${pi.metadata.booking_id}`, bErr);
        }
      }
    }

    return row.status !== update.status;
  }

  // ────────────────────────────────────────────────────────────
  // Audit
  // ────────────────────────────────────────────────────────────

  private async writeAudit(input: AuditWriteInput): Promise<void> {
    const { error } = await this.db.from('no_show_payment_events').insert({
      no_show_id: input.noShowId,
      stripe_event_id: input.stripeEventId ?? null,
      stripe_payment_intent_id: input.stripePiId ?? null,
      source: input.source,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus,
      stripe_pi_status: input.stripePiStatus ?? null,
      amount_usd: input.amountUsd ?? null,
      failure_reason: input.failureReason ?? null,
      raw_payload: input.rawPayload ?? null,
    });
    if (error) {
      // Duplicate event_id is fine (Stripe retry).
      if (error.code === '23505') return;
      this.logger.error('Failed to write no_show_payment_events row', error);
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
    row: NoShowRow,
    pi: Stripe.PaymentIntent
  ): InitiateNoShowPaymentResponseDto {
    if (!pi.client_secret) {
      throw new InternalServerErrorException('Stripe did not return a client_secret');
    }
    const mapped =
      pi.status === 'requires_payment_method'
        ? NoShowStatusDto.PAYMENT_INTENT_CREATED
        : this.mapStripeStatus(pi.status);
    return {
      noShowId: row.id,
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret,
      status: mapped,
      stripePaymentIntentStatus: pi.status,
      idempotencyKey: row.idempotency_key ?? `no_show_init_${row.id}`,
      amountUsd: Number(row.amount_usd),
      currency: row.currency,
    };
  }

  public sortByBucket(rows: NoShowRow[]): NoShowRow[] {
    const unresolved: NoShowRow[] = [];
    const inFlight: NoShowRow[] = [];
    const resolved: NoShowRow[] = [];
    for (const r of rows) {
      if ((UNRESOLVED_STATUSES as readonly string[]).includes(r.status)) unresolved.push(r);
      else if ((IN_FLIGHT_STATUSES as readonly string[]).includes(r.status)) inFlight.push(r);
      else resolved.push(r);
    }
    unresolved.sort((a, b) => a.created_at.localeCompare(b.created_at));
    inFlight.sort((a, b) => b.created_at.localeCompare(a.created_at));
    resolved.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return [...unresolved, ...inFlight, ...resolved];
  }

  private projectRow(row: NoShowRow): NoShowItemDto {
    return {
      id: row.id,
      status: this.normaliseStatus(row.status),
      amountUsd: Number(row.amount_usd),
      currency: row.currency,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      booking: { id: row.booking_id, scheduledAt: '', serviceName: null },
      counterparty: { id: row.barber_id, name: '', profilePhotoUrl: null },
    };
  }

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
        status: this.normaliseStatus(r.status),
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
