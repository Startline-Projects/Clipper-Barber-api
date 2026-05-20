import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { MailService } from './mail.service';
import {
  ReminderEmailData,
  ReminderRecipient,
  renderReminderEmail,
} from './templates/reminder-email.template';
import { computeSendAt, isPastDue, ReminderTypeValue } from './util/reminder-schedule.util';
import {
  DEFAULT_GRACE_MINUTES,
  DISPATCH_BATCH_LIMIT,
  MAX_ATTEMPTS,
  RECONCILE_WINDOW_DAYS,
  STALE_SENDING_MINUTES,
} from './reminders.constants';
import {
  ReminderGroupDto,
  ReminderSettingsResponseDto,
  ReminderTargetDto,
  ReminderTypeDto,
  UpdateReminderGroupDto,
} from './dto/reminder-settings.dto';
import { BARBER_DEFAULT_TIMEZONE } from '../bookings/util/timezone.util';

// Booking statuses for which a reminder is meaningful. Anything else
// (cancelled / completed / no_show) means existing reminders are cancelled
// and none are created.
const ELIGIBLE_STATUSES = ['pending', 'confirmed'] as const;

type SettingTarget = 'client' | 'self';
type RecipientType = ReminderRecipient; // 'client' | 'barber'

interface SettingRow {
  target: SettingTarget;
  enabled: boolean;
  reminder_type: ReminderTypeValue;
  offset_hours: number | null;
  offset_minutes: number | null;
}

interface BookingRow {
  id: string;
  barber_id: string;
  client_id: string;
  scheduled_at: string;
  status: string;
  price_usd: number | null;
  duration_minutes: number | null;
}

interface BarberRow {
  full_name: string | null;
  shop_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  timezone: string | null;
}

interface ClaimedReminder {
  id: string;
  booking_id: string;
  recipient_type: RecipientType;
  recipient_email: string;
  send_at: string;
  attempts: number;
}

// What a single (booking, recipient) reminder should look like after compute.
type DesiredReminder =
  | { action: 'schedule'; email: string; sendAt: Date; skipped: boolean; reason: string | null }
  | { action: 'cancel' };

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private readonly graceMinutes: number;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {
    const configured = Number(this.configService.get<string>('REMINDER_GRACE_MINUTES'));
    this.graceMinutes = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_GRACE_MINUTES;
  }

  private get db(): SupabaseClient {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Settings CRUD (barber-scoped)
  // ────────────────────────────────────────────────────────────

  public async getSettings(barberAuthId: string): Promise<ReminderSettingsResponseDto> {
    const rows = await this.fetchSettings(barberAuthId);
    return {
      client: this.toGroupDto(rows.get('client')),
      self: this.toGroupDto(rows.get('self')),
    };
  }

  public async updateGroup(
    barberAuthId: string,
    target: ReminderTargetDto,
    dto: UpdateReminderGroupDto,
  ): Promise<ReminderSettingsResponseDto> {
    const { offsetHours, offsetMinutes } = this.normalizeOffsets(dto);

    const { error } = await this.db.from('barber_reminder_settings').upsert(
      {
        barber_id: barberAuthId,
        target,
        enabled: dto.enabled,
        reminder_type: dto.reminderType,
        offset_hours: offsetHours,
        offset_minutes: offsetMinutes,
      },
      { onConflict: 'barber_id,target' },
    );

    if (error) {
      this.logger.error(`Failed to upsert reminder settings: ${error.message}`);
      throw error;
    }

    // Reconcile this barber's future bookings to match the new settings.
    void this.recomputeForBarber(barberAuthId).catch((err) =>
      this.logger.error(`recomputeForBarber(${barberAuthId}) failed`, err as Error),
    );

    return this.getSettings(barberAuthId);
  }

  private normalizeOffsets(dto: UpdateReminderGroupDto): {
    offsetHours: number | null;
    offsetMinutes: number | null;
  } {
    switch (dto.reminderType) {
      case ReminderTypeDto.HOURS_BEFORE:
        return { offsetHours: dto.offsetHours ?? null, offsetMinutes: null };
      case ReminderTypeDto.MINUTES_BEFORE:
        return { offsetHours: null, offsetMinutes: dto.offsetMinutes ?? null };
      case ReminderTypeDto.MORNING_OF:
        return { offsetHours: null, offsetMinutes: null };
    }
  }

  private toGroupDto(row: SettingRow | undefined): ReminderGroupDto {
    if (!row) {
      return {
        enabled: false,
        reminderType: ReminderTypeDto.HOURS_BEFORE,
        offsetHours: null,
        offsetMinutes: null,
      };
    }
    return {
      enabled: row.enabled,
      reminderType: row.reminder_type as ReminderTypeDto,
      offsetHours: row.offset_hours,
      offsetMinutes: row.offset_minutes,
    };
  }

  private async fetchSettings(barberAuthId: string): Promise<Map<SettingTarget, SettingRow>> {
    const { data, error } = await this.db
      .from('barber_reminder_settings')
      .select('target, enabled, reminder_type, offset_hours, offset_minutes')
      .eq('barber_id', barberAuthId);

    const map = new Map<SettingTarget, SettingRow>();
    if (error) {
      this.logger.error(`Failed to fetch reminder settings: ${error.message}`);
      return map;
    }
    for (const row of (data ?? []) as SettingRow[]) {
      map.set(row.target, row);
    }
    return map;
  }

  // ────────────────────────────────────────────────────────────
  // Lifecycle hooks (called from BookingsService — fire-and-forget)
  // ────────────────────────────────────────────────────────────

  public async onBookingCreated(bookingId: string): Promise<void> {
    const booking = await this.fetchBooking(bookingId);
    if (!booking) return;
    await this.computeForBooking(booking);
  }

  public async onBookingCancelled(bookingId: string): Promise<void> {
    await this.cancelPendingForBooking(bookingId);
  }

  // Recompute every future eligible booking for one barber after a settings
  // change — schedules newly-enabled reminders and cancels disabled ones.
  public async recomputeForBarber(barberAuthId: string): Promise<void> {
    const bookings = await this.fetchFutureBookingsForBarber(barberAuthId);
    for (const booking of bookings) {
      await this.computeForBooking(booking);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Compute core
  // ────────────────────────────────────────────────────────────

  private async computeForBooking(booking: BookingRow): Promise<void> {
    // Ineligible bookings (cancelled/completed/no_show) cancel any pending rows.
    if (!ELIGIBLE_STATUSES.includes(booking.status as (typeof ELIGIBLE_STATUSES)[number])) {
      await this.cancelPendingForBooking(booking.id);
      return;
    }

    const settings = await this.fetchSettings(booking.barber_id);
    const barber = await this.fetchBarber(booking.barber_id);
    const timezone = barber?.timezone || BARBER_DEFAULT_TIMEZONE;
    const now = new Date();
    const scheduledAt = new Date(booking.scheduled_at);

    // client group → recipient 'client'; self group → recipient 'barber'.
    await this.applyDesired(
      booking.id,
      'client',
      await this.desiredFor(settings.get('client'), booking.client_id, scheduledAt, timezone, now),
    );
    await this.applyDesired(
      booking.id,
      'barber',
      await this.desiredFor(settings.get('self'), booking.barber_id, scheduledAt, timezone, now),
    );
  }

  private async desiredFor(
    setting: SettingRow | undefined,
    recipientAuthId: string,
    scheduledAt: Date,
    timezone: string,
    now: Date,
  ): Promise<DesiredReminder> {
    if (!setting || !setting.enabled) return { action: 'cancel' };

    const sendAt = computeSendAt(
      scheduledAt,
      {
        reminderType: setting.reminder_type,
        offsetHours: setting.offset_hours,
        offsetMinutes: setting.offset_minutes,
      },
      timezone,
    );

    const email = await this.resolveEmail(recipientAuthId);
    if (!email) {
      // Snapshot a skipped row so the miss is visible and not retried.
      return { action: 'schedule', email: '', sendAt, skipped: true, reason: 'recipient has no email' };
    }

    if (isPastDue(sendAt, now, this.graceMinutes)) {
      return { action: 'schedule', email, sendAt, skipped: true, reason: 'send_at already past' };
    }

    return { action: 'schedule', email, sendAt, skipped: false, reason: null };
  }

  // Reconciles one (booking, recipient) row toward the desired state. SENT and
  // SENDING rows are never disturbed (no re-send, no clobbering an in-flight send).
  private async applyDesired(
    bookingId: string,
    recipientType: RecipientType,
    desired: DesiredReminder,
  ): Promise<void> {
    const existing = await this.fetchReminder(bookingId, recipientType);

    if (desired.action === 'cancel') {
      if (existing && existing.status === 'pending') {
        await this.updateReminder(existing.id, { status: 'cancelled' });
      }
      return;
    }

    if (existing && (existing.status === 'sent' || existing.status === 'sending')) return;

    const status = desired.skipped ? 'skipped' : 'pending';
    const { error } = await this.db.from('scheduled_reminders').upsert(
      {
        booking_id: bookingId,
        recipient_type: recipientType,
        recipient_email: desired.email,
        send_at: desired.sendAt.toISOString(),
        status,
        attempts: 0,
        resend_message_id: null,
        error: desired.reason,
      },
      { onConflict: 'booking_id,recipient_type' },
    );

    if (error) {
      this.logger.error(
        `Failed to upsert scheduled_reminder (${bookingId}/${recipientType}): ${error.message}`,
      );
    }
  }

  private async cancelPendingForBooking(bookingId: string): Promise<void> {
    const { error } = await this.db
      .from('scheduled_reminders')
      .update({ status: 'cancelled' })
      .eq('booking_id', bookingId)
      .eq('status', 'pending');

    if (error) {
      this.logger.error(`Failed to cancel reminders for booking ${bookingId}: ${error.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Dispatch (called by ReminderDispatchCron)
  // ────────────────────────────────────────────────────────────

  public async dispatchDueReminders(): Promise<void> {
    const { data, error } = await this.db.rpc('claim_due_reminders', {
      p_now: new Date().toISOString(),
      p_stale_minutes: STALE_SENDING_MINUTES,
      p_limit: DISPATCH_BATCH_LIMIT,
    });

    if (error) {
      this.logger.error(`claim_due_reminders failed: ${error.message}`);
      return;
    }

    const claimed = (data ?? []) as ClaimedReminder[];
    for (const reminder of claimed) {
      try {
        await this.dispatchOne(reminder);
      } catch (err) {
        await this.markFailureOrRetry(reminder, (err as Error).message);
      }
    }
  }

  private async dispatchOne(reminder: ClaimedReminder): Promise<void> {
    if (!reminder.recipient_email) {
      await this.updateReminder(reminder.id, {
        status: 'skipped',
        error: 'recipient has no email',
      });
      return;
    }

    const context = await this.loadEmailContext(reminder.booking_id);
    if (!context) {
      await this.updateReminder(reminder.id, { status: 'skipped', error: 'booking not found' });
      return;
    }

    // Don't send a reminder for a booking that's no longer eligible or whose
    // appointment time has already passed.
    if (!ELIGIBLE_STATUSES.includes(context.booking.status as (typeof ELIGIBLE_STATUSES)[number])) {
      await this.updateReminder(reminder.id, {
        status: 'skipped',
        error: `booking status is ${context.booking.status}`,
      });
      return;
    }
    if (new Date(context.booking.scheduled_at).getTime() <= Date.now()) {
      await this.updateReminder(reminder.id, { status: 'skipped', error: 'appointment already passed' });
      return;
    }

    const emailData = this.buildEmailData(reminder.recipient_type, reminder, context);
    const rendered = renderReminderEmail(emailData);
    const result = await this.mailService.send({
      to: reminder.recipient_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (result.ok) {
      await this.updateReminder(reminder.id, {
        status: 'sent',
        resend_message_id: result.messageId,
        error: null,
      });
      return;
    }

    await this.markFailureOrRetry(reminder, result.error ?? 'send failed');
  }

  private async markFailureOrRetry(reminder: ClaimedReminder, error: string): Promise<void> {
    // attempts was already incremented by claim_due_reminders.
    const status = reminder.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    await this.updateReminder(reminder.id, { status, error });
  }

  // Safety-net sweep: create reminder rows for future eligible bookings that
  // are missing them (handler missed, booking generated by a cron, etc.).
  // Only fills gaps — existing rows are left to the normal compute path.
  public async reconcileUpcomingReminders(): Promise<void> {
    const barberIds = await this.fetchBarbersWithEnabledReminders();
    if (barberIds.length === 0) return;

    for (const barberId of barberIds) {
      const bookings = await this.fetchFutureBookingsForBarber(barberId);
      if (bookings.length === 0) continue;

      const covered = await this.fetchExistingReminderKeys(bookings.map((b) => b.id));
      for (const booking of bookings) {
        const hasClient = covered.has(`${booking.id}:client`);
        const hasBarber = covered.has(`${booking.id}:barber`);
        if (hasClient && hasBarber) continue;
        await this.computeForBooking(booking);
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // Email payload assembly
  // ────────────────────────────────────────────────────────────

  private buildEmailData(
    recipientType: RecipientType,
    reminder: ClaimedReminder,
    context: EmailContext,
  ): ReminderEmailData {
    const timezone = context.barber?.timezone || BARBER_DEFAULT_TIMEZONE;
    return {
      recipientType,
      scheduledAtUtc: new Date(context.booking.scheduled_at).toISOString(),
      timezone,
      barberName: context.barber?.full_name ?? 'your barber',
      clientName: context.clientName ?? 'your client',
      shopName: context.barber?.shop_name ?? null,
      address: this.buildAddress(context.barber),
      serviceNames: context.serviceNames,
      durationMinutes: context.booking.duration_minutes,
      priceUsd: context.booking.price_usd,
    };
  }

  private buildAddress(barber: BarberRow | null): string | null {
    if (!barber) return null;
    const cityState = [barber.city, barber.state].filter((p) => !!p && p.trim()).join(', ');
    const parts = [barber.street_address, cityState, barber.zip_code].filter(
      (p): p is string => !!p && p.trim().length > 0,
    );
    return parts.length > 0 ? parts.join(', ') : null;
  }

  // ────────────────────────────────────────────────────────────
  // Data access helpers
  // ────────────────────────────────────────────────────────────

  private async fetchBooking(bookingId: string): Promise<BookingRow | null> {
    const { data, error } = await this.db
      .from('bookings')
      .select('id, barber_id, client_id, scheduled_at, status, price_usd, duration_minutes')
      .eq('id', bookingId)
      .maybeSingle();
    if (error) {
      this.logger.error(`Failed to fetch booking ${bookingId}: ${error.message}`);
      return null;
    }
    return (data as BookingRow | null) ?? null;
  }

  private async fetchFutureBookingsForBarber(barberAuthId: string): Promise<BookingRow[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + RECONCILE_WINDOW_DAYS * 86_400_000);
    const { data, error } = await this.db
      .from('bookings')
      .select('id, barber_id, client_id, scheduled_at, status, price_usd, duration_minutes')
      .eq('barber_id', barberAuthId)
      .in('status', ELIGIBLE_STATUSES as unknown as string[])
      .gt('scheduled_at', now.toISOString())
      .lt('scheduled_at', horizon.toISOString());

    if (error) {
      this.logger.error(`Failed to fetch future bookings for ${barberAuthId}: ${error.message}`);
      return [];
    }
    return (data ?? []) as BookingRow[];
  }

  private async fetchBarber(barberAuthId: string): Promise<BarberRow | null> {
    const { data, error } = await this.db
      .from('barbers')
      .select('full_name, shop_name, street_address, city, state, zip_code, timezone')
      .eq('user_id', barberAuthId)
      .maybeSingle();
    if (error) {
      this.logger.error(`Failed to fetch barber ${barberAuthId}: ${error.message}`);
      return null;
    }
    return (data as BarberRow | null) ?? null;
  }

  private async fetchReminder(
    bookingId: string,
    recipientType: RecipientType,
  ): Promise<{ id: string; status: string } | null> {
    const { data } = await this.db
      .from('scheduled_reminders')
      .select('id, status')
      .eq('booking_id', bookingId)
      .eq('recipient_type', recipientType)
      .maybeSingle();
    return (data as { id: string; status: string } | null) ?? null;
  }

  private async fetchExistingReminderKeys(bookingIds: string[]): Promise<Set<string>> {
    const keys = new Set<string>();
    if (bookingIds.length === 0) return keys;
    const { data, error } = await this.db
      .from('scheduled_reminders')
      .select('booking_id, recipient_type')
      .in('booking_id', bookingIds);
    if (error) {
      this.logger.error(`Failed to fetch existing reminder keys: ${error.message}`);
      return keys;
    }
    for (const row of (data ?? []) as Array<{ booking_id: string; recipient_type: string }>) {
      keys.add(`${row.booking_id}:${row.recipient_type}`);
    }
    return keys;
  }

  private async fetchBarbersWithEnabledReminders(): Promise<string[]> {
    const { data, error } = await this.db
      .from('barber_reminder_settings')
      .select('barber_id')
      .eq('enabled', true);
    if (error) {
      this.logger.error(`Failed to fetch barbers with enabled reminders: ${error.message}`);
      return [];
    }
    const ids = new Set<string>();
    for (const row of (data ?? []) as Array<{ barber_id: string }>) ids.add(row.barber_id);
    return [...ids];
  }

  private async updateReminder(
    id: string,
    patch: Partial<{
      status: string;
      resend_message_id: string | null;
      error: string | null;
    }>,
  ): Promise<void> {
    const { error } = await this.db.from('scheduled_reminders').update(patch).eq('id', id);
    if (error) {
      this.logger.error(`Failed to update reminder ${id}: ${error.message}`);
    }
  }

  private async resolveEmail(authUserId: string): Promise<string | null> {
    const { data, error } = await this.db.auth.admin.getUserById(authUserId);
    if (error || !data.user?.email) return null;
    return data.user.email;
  }

  private async loadEmailContext(bookingId: string): Promise<EmailContext | null> {
    const booking = await this.fetchBooking(bookingId);
    if (!booking) return null;

    const [barber, clientName, serviceNames] = await Promise.all([
      this.fetchBarber(booking.barber_id),
      this.fetchClientName(booking.client_id),
      this.fetchServiceNames(booking.id),
    ]);

    return { booking, barber, clientName, serviceNames };
  }

  private async fetchClientName(clientAuthId: string): Promise<string | null> {
    const { data } = await this.db
      .from('clients')
      .select('name')
      .eq('user_id', clientAuthId)
      .maybeSingle();
    return (data?.name as string | undefined) ?? null;
  }

  private async fetchServiceNames(bookingId: string): Promise<string[]> {
    const { data: links } = await this.db
      .from('booking_services')
      .select('barber_service_id, sort_order')
      .eq('booking_id', bookingId)
      .order('sort_order', { ascending: true });

    const ids = (links ?? []).map((l) => l.barber_service_id as string);
    if (ids.length === 0) return [];

    const { data: services } = await this.db
      .from('barber_services')
      .select('id, name')
      .in('id', ids);

    const nameById = new Map<string, string>();
    for (const s of (services ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(s.id, s.name);
    }
    return ids.map((id) => nameById.get(id)).filter((n): n is string => !!n);
  }
}

interface EmailContext {
  booking: BookingRow;
  barber: BarberRow | null;
  clientName: string | null;
  serviceNames: string[];
}
