import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  composeUtcFromLocal,
  localDateInTz,
} from './recurring-time.util';

const RECURRING_WINDOW_DAYS = 60;

interface RecurringBookingRow {
  id: string;
  client_id: string;
  barber_id: string;
  barber_service_id: string;
  day_of_week: number;
  slot_time: string;
  frequency: 'weekly' | 'biweekly';
  price_usd: string | number;
  status: string;
  window_start_date: string | null;
  pause_start_date: string | null;
  pause_end_date: string | null;
  paused_by: 'client' | 'barber' | null;
}

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

@Injectable()
export class RecurringBookingGeneratorService {
  private readonly logger = new Logger(RecurringBookingGeneratorService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

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
    const service = await this.fetchService(recurring.barber_service_id);
    const schedule = await this.fetchSchedule(recurring.barber_id, recurring.day_of_week);

    if (!barber || !service || !schedule) return;
    if (service.recurring_price_usd === null) return;

    const targetDates = this.computeTargetDates(
      recurring.window_start_date,
      recurring.day_of_week,
      recurring.frequency,
      recurring.pause_start_date,
      recurring.pause_end_date,
    );

    if (targetDates.length === 0) return;

    const existing = await this.fetchExistingScheduledAt(recurringBookingId);
    const slotTime = recurring.slot_time.substring(0, 5);
    const basePrice = Number(service.recurring_price_usd);
    const extraCharge =
      schedule.recurring_extra_charge_usd !== null &&
      schedule.recurring_extra_charge_usd !== undefined
        ? Number(schedule.recurring_extra_charge_usd)
        : 0;
    const totalPrice = Number(recurring.price_usd);
    const bookingType = schedule.is_working ? 'regular' : 'day_off';

    for (const date of targetDates) {
      const scheduledAt = composeUtcFromLocal(date, slotTime, barber.timezone);
      const scheduledIso = scheduledAt.toISOString();
      if (existing.has(scheduledIso)) continue;

      const nowIso = new Date().toISOString();
      const { error } = await this.db.from('bookings').insert({
        barber_id: recurring.barber_id,
        client_id: recurring.client_id,
        barber_service_id: recurring.barber_service_id,
        recurring_booking_id: recurringBookingId,
        service_type: service.service_type,
        booking_type: bookingType,
        scheduled_at: scheduledIso,
        duration_minutes: service.duration_minutes,
        base_price_usd: basePrice,
        slot_type_surcharge_usd: extraCharge,
        price_usd: totalPrice,
        status: 'confirmed',
        confirmed_at: nowIso,
      });

      // 23505 = one-off booking already holds this exact slot. Skip per
      // agreed generator policy; the client keeps their other occurrences.
      if (error && error.code !== '23505') {
        throw new InternalServerErrorException(
          `Failed to generate recurring booking occurrence: ${error.message}`,
        );
      }
      if (error && error.code === '23505') {
        this.logger.warn(
          `Generator skipped ${scheduledIso} for recurring_booking ${recurringBookingId} — slot held by one-off booking`,
        );
      }
    }
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
        'id, client_id, barber_id, barber_service_id, day_of_week, slot_time, frequency, price_usd, status, window_start_date, pause_start_date, pause_end_date, paused_by',
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

  // weekly: every matching day-of-week in window.
  // biweekly: first occurrence on or after window_start_date matching
  // day-of-week, then every 14 days.
  private computeTargetDates(
    windowStartLocal: string,
    dayOfWeek: number,
    frequency: 'weekly' | 'biweekly',
    pauseStart: string | null,
    pauseEnd: string | null,
  ): string[] {
    const [y, m, d] = windowStartLocal.split('-').map(Number);
    const startMs = Date.UTC(y, m - 1, d);
    const firstMatchMs = this.firstMatchingDowOnOrAfter(startMs, dayOfWeek);

    const stepMs = (frequency === 'weekly' ? 7 : 14) * 86_400_000;
    const endMs = startMs + (RECURRING_WINDOW_DAYS - 1) * 86_400_000;

    const dates: string[] = [];
    for (let ms = firstMatchMs; ms <= endMs; ms += stepMs) {
      const iso = this.utcMsToDateStr(ms);
      if (pauseStart && iso >= pauseStart) {
        if (!pauseEnd || iso <= pauseEnd) continue;
      }
      dates.push(iso);
    }
    return dates;
  }

  private firstMatchingDowOnOrAfter(startUtcMs: number, dow: number): number {
    const startDow = new Date(startUtcMs).getUTCDay();
    const diff = (dow - startDow + 7) % 7;
    return startUtcMs + diff * 86_400_000;
  }

  private utcMsToDateStr(ms: number): string {
    const day = new Date(ms);
    const y = day.getUTCFullYear();
    const m = (day.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = day.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
