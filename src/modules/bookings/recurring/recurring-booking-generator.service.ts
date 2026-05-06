import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { ConversationsService } from '../../messages/conversations.service';
import {
  composeUtcFromLocal,
  localDateInTz,
} from './recurring-time.util';

const RECURRING_WINDOW_DAYS = 60;

export type ArrangementFrequency =
  | 'weekly'
  | 'biweekly'
  | 'every_n_weeks'
  | 'monthly';

export type ArrangementEndType = 'none' | 'after_count' | 'on_date';

interface RecurringBookingRow {
  id: string;
  client_id: string;
  barber_id: string;
  barber_service_id: string;
  day_of_week: number;
  slot_time: string;
  frequency: ArrangementFrequency;
  price_usd: string | number;
  duration_minutes: number | null;
  status: string;
  initiator: 'client' | 'barber';
  interval_n: number | null;
  end_type: ArrangementEndType;
  end_count: number | null;
  end_date: string | null;
  window_start_date: string | null;
  pause_start_date: string | null;
  pause_end_date: string | null;
  paused_by: 'client' | 'barber' | null;
}

export interface OccurrenceSpec {
  dayOfWeek: number;
  timeOfDay: string; // HH:mm local
  frequency: ArrangementFrequency;
  intervalN: number | null;
  startDate: string; // YYYY-MM-DD local
  endType: ArrangementEndType;
  endCount: number | null;
  endDate: string | null;
  timezone: string;
  horizonDays: number;
}

// Horizon for barber-initiated arrangement top-up (spec: ~8 weeks ahead).
export const ARRANGEMENT_HORIZON_DAYS = 56;

interface BarberRow {
  user_id: string;
  timezone: string;
}

interface ServiceRow {
  id: string;
  service_type: string;
  duration_minutes: number;
  recurring_price_usd: number | string | null;
}

interface ScheduleRow {
  is_working: boolean;
  recurring_extra_charge_usd: number | string | null;
}

interface RecurringServiceSnapshot {
  barber_service_id: string;
  service_type: string;
  booking_type: string;
  duration_minutes: number;
  base_price_usd: string | number;
  slot_type_surcharge_usd: string | number;
  price_usd: string | number;
  sort_order: number;
}

@Injectable()
export class RecurringBookingGeneratorService {
  private readonly logger = new Logger(RecurringBookingGeneratorService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly conversationsService: ConversationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // Generates all booking rows for the active 60-day window on a recurring
  // subscription. Idempotent — rerunning it after partial generation only
  // inserts the missing rows. Called on acceptance (R7), resume (R9), and
  // renewal acceptance (R11).
  public async generate(recurringBookingId: string): Promise<void> {
    const recurring = await this.fetchRecurring(recurringBookingId);
    if (!recurring) return;
    if (recurring.status !== 'active') return;
    if (!recurring.window_start_date) return;

    const barber = await this.fetchBarber(recurring.barber_id);
    const schedule = await this.fetchSchedule(recurring.barber_id, recurring.day_of_week);
    if (!barber || !schedule) return;

    const serviceSnapshots = await this.fetchServiceSnapshots(recurringBookingId);
    if (serviceSnapshots.length === 0) {
      // Legacy row with no child rows — nothing to materialise against the
      // multi-service contract. Safe to skip.
      return;
    }

    const totalDuration =
      recurring.duration_minutes ??
      serviceSnapshots.reduce((acc, s) => acc + s.duration_minutes, 0);

    const primary = serviceSnapshots[0];

    const horizonDays =
      recurring.initiator === 'barber' ? ARRANGEMENT_HORIZON_DAYS : RECURRING_WINDOW_DAYS;
    const targetDates = this.computeTargetDates(
      recurring.window_start_date,
      recurring.day_of_week,
      recurring.frequency,
      recurring.pause_start_date,
      recurring.pause_end_date,
      {
        intervalN: recurring.interval_n,
        endType: recurring.end_type,
        endCount: recurring.end_count,
        endDate: recurring.end_date,
        horizonDays,
        existingCountConsumed: recurring.initiator === 'barber'
          ? await this.countAlreadyGenerated(recurring.id)
          : 0,
      },
    );

    if (targetDates.length === 0) return;

    const existing = await this.fetchExistingScheduledAt(recurringBookingId);
    const slotTime = recurring.slot_time.substring(0, 5);
    const totalPrice = Number(recurring.price_usd);
    const totalBase = Number(
      serviceSnapshots.reduce((acc, s) => acc + Number(s.base_price_usd), 0).toFixed(2),
    );
    const totalSurcharge = Number(
      serviceSnapshots.reduce((acc, s) => acc + Number(s.slot_type_surcharge_usd), 0).toFixed(2),
    );

    for (const date of targetDates) {
      const scheduledAt = composeUtcFromLocal(date, slotTime, barber.timezone);
      const scheduledIso = scheduledAt.toISOString();
      if (existing.has(scheduledIso)) continue;

      const nowIso = new Date().toISOString();
      const { data: inserted, error } = await this.db
        .from('bookings')
        .insert({
          barber_id: recurring.barber_id,
          client_id: recurring.client_id,
          barber_service_id: primary.barber_service_id,
          recurring_booking_id: recurringBookingId,
          service_type: primary.service_type,
          booking_type: primary.booking_type,
          scheduled_at: scheduledIso,
          duration_minutes: totalDuration,
          base_price_usd: totalBase,
          slot_type_surcharge_usd: totalSurcharge,
          price_usd: totalPrice,
          status: 'confirmed',
          confirmed_at: nowIso,
        })
        .select('id')
        .single();

      // 23505 / 23P01 = another booking already holds an overlapping slot.
      // Skip per agreed generator policy; the client keeps their other
      // occurrences.
      if (error && error.code !== '23505' && error.code !== '23P01') {
        throw new InternalServerErrorException(
          `Failed to generate recurring booking occurrence: ${error.message}`,
        );
      }
      if (error) {
        this.logger.warn(
          `Generator skipped ${scheduledIso} for recurring_booking ${recurringBookingId} — slot held by another booking`,
        );
        continue;
      }

      const bookingId = (inserted as { id: string }).id;
      const childRows = serviceSnapshots.map((s) => ({
        booking_id: bookingId,
        barber_service_id: s.barber_service_id,
        service_type: s.service_type,
        booking_type: s.booking_type,
        duration_minutes: s.duration_minutes,
        base_price_usd: s.base_price_usd,
        slot_type_surcharge_usd: s.slot_type_surcharge_usd,
        price_usd: s.price_usd,
        sort_order: s.sort_order,
      }));

      const { error: childError } = await this.db
        .from('booking_services')
        .insert(childRows);

      if (childError) {
        // Undo the just-inserted booking so the row doesn't sit without children.
        await this.db.from('bookings').delete().eq('id', bookingId);
        throw new InternalServerErrorException(
          `Failed to fan out booking services: ${childError.message}`,
        );
      }
    }

    void this.conversationsService.markHasBookingIfConversationExists(
      recurring.barber_id,
      recurring.client_id,
    );
  }

  private async fetchServiceSnapshots(
    recurringBookingId: string,
  ): Promise<RecurringServiceSnapshot[]> {
    const { data, error } = await this.db
      .from('recurring_booking_services')
      .select(
        'barber_service_id, service_type, booking_type, duration_minutes, base_price_usd, slot_type_surcharge_usd, price_usd, sort_order',
      )
      .eq('recurring_booking_id', recurringBookingId)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch recurring booking services');
    return (data ?? []) as RecurringServiceSnapshot[];
  }

  // When a pause is applied, cancel the already-generated booking rows that
  // fall inside the pause window. Past occurrences are never touched.
  public async cancelPausedBookings(recurringBookingId: string): Promise<void> {
    const recurring = await this.fetchRecurring(recurringBookingId);
    if (!recurring) return;
    if (!recurring.pause_start_date) return;

    const barber = await this.fetchBarber(recurring.barber_id);
    if (!barber) return;

    const { data, error } = await this.db
      .from('bookings')
      .select('id, scheduled_at, status')
      .eq('recurring_booking_id', recurringBookingId)
      .in('status', ['pending', 'confirmed']);

    if (error) throw new InternalServerErrorException('Failed to fetch bookings for pause');

    const pauseStart = recurring.pause_start_date;
    const pauseEnd = recurring.pause_end_date;
    const cancelledBy: 'client' | 'barber' = recurring.paused_by ?? 'client';
    const nowIso = new Date().toISOString();

    const toCancel: string[] = [];
    for (const row of data ?? []) {
      const scheduledIso = row.scheduled_at as string;
      const localDate = localDateInTz(new Date(scheduledIso), barber.timezone);
      if (localDate < pauseStart) continue;
      if (pauseEnd && localDate > pauseEnd) continue;
      toCancel.push(row.id as string);
    }

    if (toCancel.length === 0) return;

    const { error: updateError } = await this.db
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: cancelledBy,
      })
      .in('id', toCancel);

    if (updateError) {
      throw new InternalServerErrorException('Failed to cancel bookings for pause');
    }
  }

  // Same as cancelPausedBookings but with no date filter — used by R9 cancel.
  public async cancelFutureBookings(
    recurringBookingId: string,
    cancelledBy: 'client' | 'barber',
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const { error } = await this.db
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: cancelledBy,
      })
      .eq('recurring_booking_id', recurringBookingId)
      .gte('scheduled_at', nowIso)
      .in('status', ['pending', 'confirmed']);

    if (error) {
      throw new InternalServerErrorException('Failed to cancel future recurring bookings');
    }
  }

  // ───────────── internal helpers ─────────────

  private async fetchRecurring(id: string): Promise<RecurringBookingRow | null> {
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select(
        'id, client_id, barber_id, barber_service_id, day_of_week, slot_time, frequency, price_usd, duration_minutes, status, initiator, interval_n, end_type, end_count, end_date, window_start_date, pause_start_date, pause_end_date, paused_by',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch recurring booking');
    return (data as RecurringBookingRow | null) ?? null;
  }

  private async fetchBarber(barberId: string): Promise<BarberRow | null> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, timezone')
      .eq('user_id', barberId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch barber');
    return (data as BarberRow | null) ?? null;
  }

  private async fetchService(serviceId: string): Promise<ServiceRow | null> {
    const { data, error } = await this.db
      .from('barber_services')
      .select('id, service_type, duration_minutes, recurring_price_usd')
      .eq('id', serviceId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch service');
    return (data as ServiceRow | null) ?? null;
  }

  private async fetchSchedule(
    barberId: string,
    dayOfWeek: number,
  ): Promise<ScheduleRow | null> {
    const { data, error } = await this.db
      .from('barber_schedules')
      .select('is_working, recurring_extra_charge_usd')
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch schedule');
    return (data as ScheduleRow | null) ?? null;
  }

  private async fetchExistingScheduledAt(recurringBookingId: string): Promise<Set<string>> {
    const { data, error } = await this.db
      .from('bookings')
      .select('scheduled_at')
      .eq('recurring_booking_id', recurringBookingId);

    if (error) throw new InternalServerErrorException('Failed to fetch existing bookings');

    const set = new Set<string>();
    for (const row of data ?? []) {
      set.add(new Date(row.scheduled_at as string).toISOString());
    }
    return set;
  }

  private computeTargetDates(
    windowStartLocal: string,
    dayOfWeek: number,
    frequency: ArrangementFrequency,
    pauseStart: string | null,
    pauseEnd: string | null,
    extras: {
      intervalN: number | null;
      endType: ArrangementEndType;
      endCount: number | null;
      endDate: string | null;
      horizonDays: number;
      existingCountConsumed: number;
    },
  ): string[] {
    const dates = computeOccurrenceDatesLocal({
      startDate: windowStartLocal,
      dayOfWeek,
      frequency,
      intervalN: extras.intervalN,
      endType: extras.endType,
      endCount: extras.endCount,
      endDate: extras.endDate,
      horizonDays: extras.horizonDays,
      existingCountConsumed: extras.existingCountConsumed,
    });

    if (!pauseStart) return dates;
    return dates.filter((iso) => {
      if (iso < pauseStart) return true;
      if (pauseEnd && iso > pauseEnd) return true;
      return false;
    });
  }

  // Pure helper. Composes UTC datetimes for the next `count` occurrences
  // from the spec, useful for both the conflict check at offer creation
  // and the "next occurrences" preview in API responses. Does not touch
  // the DB.
  public previewOccurrencesUtc(spec: OccurrenceSpec, count: number): Date[] {
    const dates = computeOccurrenceDatesLocal({
      startDate: spec.startDate,
      dayOfWeek: spec.dayOfWeek,
      frequency: spec.frequency,
      intervalN: spec.intervalN,
      endType: spec.endType,
      endCount: spec.endCount,
      endDate: spec.endDate,
      horizonDays: spec.horizonDays,
      existingCountConsumed: 0,
    });
    return dates
      .slice(0, count)
      .map((d) => composeUtcFromLocal(d, spec.timeOfDay, spec.timezone));
  }

  // For the offer-creation conflict check: returns each candidate datetime
  // that already collides with an existing one-off booking, recurring
  // booking, or live arrangement on this barber's calendar.
  public async findCalendarConflicts(
    barberId: string,
    candidates: Date[],
    durationMinutes: number,
    excludeRecurringId: string | null,
  ): Promise<{
    scheduledAt: string;
    conflictingBookingId: string | null;
    reason: 'one_off_booking' | 'recurring_booking' | 'recurring_arrangement';
  }[]> {
    if (candidates.length === 0) return [];

    const minMs = Math.min(...candidates.map((c) => c.getTime()));
    const maxMs = Math.max(...candidates.map((c) => c.getTime())) + durationMinutes * 60_000;
    const leadMs = 4 * 60 * 60_000;

    let bookingsQuery = this.db
      .from('bookings')
      .select('id, scheduled_at, duration_minutes, recurring_booking_id')
      .eq('barber_id', barberId)
      .gte('scheduled_at', new Date(minMs - leadMs).toISOString())
      .lte('scheduled_at', new Date(maxMs).toISOString())
      .neq('status', 'cancelled');

    if (excludeRecurringId) {
      bookingsQuery = bookingsQuery.or(
        `recurring_booking_id.is.null,recurring_booking_id.neq.${excludeRecurringId}`,
      );
    }

    const { data: bookingRows, error: bookingsErr } = await bookingsQuery;
    if (bookingsErr) {
      throw new InternalServerErrorException('Failed to query existing bookings');
    }

    const conflicts: {
      scheduledAt: string;
      conflictingBookingId: string | null;
      reason: 'one_off_booking' | 'recurring_booking' | 'recurring_arrangement';
    }[] = [];

    for (const cand of candidates) {
      const candStart = cand.getTime();
      const candEnd = candStart + durationMinutes * 60_000;
      for (const b of bookingRows ?? []) {
        const bStart = new Date(b.scheduled_at as string).getTime();
        const bDuration = (b.duration_minutes as number | null) ?? 0;
        const bEnd = bStart + bDuration * 60_000;
        if (bStart < candEnd && bEnd > candStart) {
          conflicts.push({
            scheduledAt: cand.toISOString(),
            conflictingBookingId: b.id as string,
            reason:
              (b.recurring_booking_id as string | null) === null
                ? 'one_off_booking'
                : 'recurring_booking',
          });
          break;
        }
      }
    }

    return conflicts;
  }

  private async countAlreadyGenerated(recurringBookingId: string): Promise<number> {
    const { count, error } = await this.db
      .from('bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('recurring_booking_id', recurringBookingId)
      .neq('status', 'cancelled');
    if (error) throw new InternalServerErrorException('Failed to count generated bookings');
    return count ?? 0;
  }
}

// ────────────────────────────────────────────────────────────
// Pure occurrence-date computation. Exported for testing.
//
// Returns calendar dates (YYYY-MM-DD) inside the rolling horizon,
// respecting the end condition. The caller turns each date into
// a UTC datetime by composing it with timeOfDay + timezone.
// ────────────────────────────────────────────────────────────

interface OccurrenceArgs {
  startDate: string;
  dayOfWeek: number;
  frequency: ArrangementFrequency;
  intervalN: number | null;
  endType: ArrangementEndType;
  endCount: number | null;
  endDate: string | null;
  horizonDays: number;
  // For top-up: how many occurrences have already been generated. Counts
  // toward end_count so we don't exceed the configured total.
  existingCountConsumed: number;
}

export function computeOccurrenceDatesLocal(args: OccurrenceArgs): string[] {
  const {
    startDate,
    dayOfWeek,
    frequency,
    intervalN,
    endType,
    endCount,
    endDate,
    horizonDays,
    existingCountConsumed,
  } = args;

  const [y, m, d] = startDate.split('-').map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d);
  const horizonEndMs = startUtcMs + (horizonDays - 1) * 86_400_000;

  const remainingByCount =
    endType === 'after_count' && endCount !== null
      ? Math.max(0, endCount - existingCountConsumed)
      : Number.POSITIVE_INFINITY;

  const endDateMs = (() => {
    if (endType !== 'on_date' || !endDate) return Number.POSITIVE_INFINITY;
    const [ey, em, ed] = endDate.split('-').map(Number);
    return Date.UTC(ey, em - 1, ed);
  })();

  const dates: string[] = [];

  if (frequency === 'monthly') {
    // Anchor: start_date itself (day-of-week constraint is informational
    // for monthly — we keep the same calendar day each month and clamp
    // to the last day of shorter months).
    let yi = y;
    let mi = m;
    while (true) {
      const dayInMonth = clampDayToMonth(yi, mi, d);
      const ms = Date.UTC(yi, mi - 1, dayInMonth);
      if (ms > horizonEndMs) break;
      if (ms > endDateMs) break;
      if (dates.length >= remainingByCount) break;
      if (ms >= startUtcMs) {
        dates.push(utcMsToDateStr(ms));
      }
      mi += 1;
      if (mi > 12) {
        mi = 1;
        yi += 1;
      }
    }
    return dates;
  }

  // Weekly / biweekly / every_n_weeks share the same shape: snap to the
  // first matching day_of_week on or after start_date, then step by N weeks.
  const stepWeeks = (() => {
    if (frequency === 'weekly') return 1;
    if (frequency === 'biweekly') return 2;
    if (frequency === 'every_n_weeks') return Math.max(2, intervalN ?? 2);
    return 1;
  })();
  const stepMs = stepWeeks * 7 * 86_400_000;
  const firstMs = firstMatchingDowOnOrAfter(startUtcMs, dayOfWeek);

  for (let ms = firstMs; ms <= horizonEndMs; ms += stepMs) {
    if (ms > endDateMs) break;
    if (dates.length >= remainingByCount) break;
    dates.push(utcMsToDateStr(ms));
  }
  return dates;
}

function firstMatchingDowOnOrAfter(startUtcMs: number, dow: number): number {
  const startDow = new Date(startUtcMs).getUTCDay();
  const diff = (dow - startDow + 7) % 7;
  return startUtcMs + diff * 86_400_000;
}

function utcMsToDateStr(ms: number): string {
  const day = new Date(ms);
  const yy = day.getUTCFullYear();
  const mm = (day.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = day.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function clampDayToMonth(year: number, month1to12: number, desiredDay: number): number {
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return Math.min(desiredDay, lastDay);
}
