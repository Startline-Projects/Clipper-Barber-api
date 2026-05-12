import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { GetAvailabilityQueryDto } from './dto/get-availability-query.dto';
import {
  AvailabilityDayDto,
  AvailabilityResponseDto,
  ServiceSummaryDto,
  SlotDto,
} from './dto/availability-response.dto';
import { BARBER_DEFAULT_TIMEZONE, composeUtcFromLocal } from './util/timezone.util';
import { dayOfWeekFromDate } from './recurring/recurring-time.util';

interface RawBarberRow {
  user_id: string;
  timezone: string;
}

interface RawScheduleRow {
  id: string;
  barber_id: string;
  day_of_week: number;
  is_working: boolean;
  regular_start_time: string | null;
  regular_end_time: string | null;
  slot_duration_minutes: number;
  after_hours_enabled: boolean;
  after_hours_start: string | null;
  after_hours_end: string | null;
  day_off_booking_enabled: boolean;
  day_off_start_time: string | null;
  day_off_end_time: string | null;
  advance_notice_minutes: number;
}

interface RawBarberServiceRow {
  id: string;
  barber_id: string;
  name: string;
  duration_minutes: number;
  regular_price_usd: string | number;
  after_hours_price_usd: string | number | null;
  day_off_price_usd: string | number | null;
  is_active: boolean;
}

interface GenerateSlotsParams {
  date: string;
  startTime: string;
  endTime: string;
  slotDuration: number;
  blockDuration: number;
  slotsNeeded: number;
  totalPrice: number;
  blockedSlotUtcMs: Set<number>;
  advanceCutoffMs: number;
  timezone: string;
}

const MINUTE_MS = 60_000;

@Injectable()
export class AvailabilityService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  public async getAvailability(
    barberId: string,
    query: GetAvailabilityQueryDto
  ): Promise<AvailabilityResponseDto> {
    // Step 1 — Existence check: barber profile must exist for this auth user
    const { data: barberRow, error: barberError } = await this.db
      .from('barbers')
      .select('user_id, timezone')
      .eq('user_id', barberId)
      .maybeSingle();

    if (barberError) throw new InternalServerErrorException('Failed to fetch barber');
    if (!barberRow) throw new NotFoundException('Barber not found');

    const barberTimezone =
      (barberRow as RawBarberRow).timezone || BARBER_DEFAULT_TIMEZONE;

    // Step 2 — Fetch all requested services, preserving client-supplied order
    const requestedIds = query.serviceIds;
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException('Duplicate services are not allowed.');
    }

    const { data: serviceRows, error: serviceError } = await this.db
      .from('barber_services')
      .select(
        'id, barber_id, name, duration_minutes, regular_price_usd, after_hours_price_usd, day_off_price_usd, is_active'
      )
      .in('id', requestedIds)
      .eq('barber_id', barberId)
      .eq('is_active', true);

    if (serviceError) throw new InternalServerErrorException('Failed to fetch services');

    const serviceById = new Map<string, RawBarberServiceRow>();
    for (const row of (serviceRows ?? []) as RawBarberServiceRow[]) {
      serviceById.set(row.id, row);
    }
    if (serviceById.size !== requestedIds.length) {
      throw new NotFoundException('One or more services not found or inactive');
    }

    const orderedServices = requestedIds.map((id) => serviceById.get(id) as RawBarberServiceRow);

    // Each service occupies exactly one grid slot. Block duration is computed
    // per-day (since slot_duration_minutes lives on the schedule), so we hold
    // off on totalDuration here. Aggregate prices, on the other hand, are
    // service-driven and don't depend on the day. When a service has no
    // explicit after_hours_price_usd / day_off_price_usd we fall back to its
    // regular_price_usd — keeps the slot bookable instead of dropping the
    // whole window because of a missing price column.
    const regularSum = this.sumPrices(orderedServices, (s) => Number(s.regular_price_usd));
    const afterHoursSum = this.sumPrices(orderedServices, (s) =>
      s.after_hours_price_usd !== null ? Number(s.after_hours_price_usd) : Number(s.regular_price_usd),
    );
    const dayOffSum = this.sumPrices(orderedServices, (s) =>
      s.day_off_price_usd !== null ? Number(s.day_off_price_usd) : Number(s.regular_price_usd),
    );

    // Step 3 — Fetch schedule rows, index by day_of_week
    const { data: scheduleRows, error: scheduleError } = await this.db
      .from('barber_schedules')
      .select('*')
      .eq('barber_id', barberId);

    if (scheduleError) throw new InternalServerErrorException('Failed to fetch schedule');

    const scheduleByDay = new Map<number, RawScheduleRow>();
    for (const row of scheduleRows ?? []) {
      scheduleByDay.set((row as RawScheduleRow).day_of_week, row as RawScheduleRow);
    }

    // All date math is done in UTC-ms space against the calendar dates
    // supplied by the client. The barber's tz is only consulted when we
    // convert local wall-clock slot times into UTC instants for overlap
    // checks. We never lean on server-local Date arithmetic.
    const requestedStartMs = parseCalendarDateUtcMs(query.startDate);
    const endDateMs = parseCalendarDateUtcMs(query.endDate);
    const now = new Date();
    const todayMs = parseCalendarDateUtcMs(this.formatDate(now));
    const effectiveStartMs = Math.max(requestedStartMs, todayMs);

    // Step 4 — Fetch blocking bookings in range.
    //   Widen by ±1 day for TZ safety. For each booking we expand into the set
    //   of grid slots it occupies based on its duration, so multi-slot bookings
    //   block every grid position they cover — not just the start.
    const rangeStartMs = effectiveStartMs - 86_400_000;
    const rangeEndMs = endDateMs + 2 * 86_400_000;

    const { data: bookingRows, error: bookingError } = await this.db
      .from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('barber_id', barberId)
      .gte('scheduled_at', utcMsToDateStr(rangeStartMs))
      .lt('scheduled_at', utcMsToDateStr(rangeEndMs))
      .in('status', ['confirmed', 'pending']);

    if (bookingError) throw new InternalServerErrorException('Failed to fetch bookings');

    // Steps 5 & 6 — Generate and mark slots for each date
    const days: AvailabilityDayDto[] = [];
    const totalDays = Math.floor((endDateMs - effectiveStartMs) / 86_400_000) + 1;

    for (let i = 0; i < totalDays; i++) {
      const currentMs = effectiveStartMs + i * 86_400_000;
      const dateStr = utcMsToDateStr(currentMs);
      const dayOfWeek = dayOfWeekFromDate(dateStr);
      const schedule = scheduleByDay.get(dayOfWeek);

      if (!schedule) {
        days.push({
          date: dateStr,
          dayOfWeek,
          isWorkingDay: false,
          slotDurationMinutes: null,
          slots: { regular: [], afterHours: [], dayOff: [] },
        });
        continue;
      }

      const advanceCutoffMs = now.getTime() + schedule.advance_notice_minutes * MINUTE_MS;
      const slotDuration = schedule.slot_duration_minutes;
      // Each requested service consumes exactly one grid slot — block size
      // is driven by the day's grid, NOT by the service's own duration.
      const slotsNeeded = orderedServices.length;
      const blockDuration = slotsNeeded * slotDuration;

      // Expand every existing booking into the set of grid-slot-start ms it
      // occupies (using THIS day's slot duration), so a multi-slot booking
      // blocks every grid position it covers.
      const blockedSlotUtcMs = this.buildBlockedSlotSet(
        (bookingRows ?? []) as { scheduled_at: string; duration_minutes: number | null }[],
        slotDuration,
      );

      const dayDto: AvailabilityDayDto = {
        date: dateStr,
        dayOfWeek,
        isWorkingDay: schedule.is_working,
        slotDurationMinutes: slotDuration,
        slots: { regular: [], afterHours: [], dayOff: [] },
      };

      if (schedule.is_working) {
        if (schedule.regular_start_time && schedule.regular_end_time) {
          dayDto.slots.regular = this.generateSlots({
            date: dateStr,
            startTime: schedule.regular_start_time,
            endTime: schedule.regular_end_time,
            slotDuration,
            blockDuration,
            slotsNeeded,
            totalPrice: regularSum,
            blockedSlotUtcMs,
            advanceCutoffMs,
            timezone: barberTimezone,
          });
        }

        if (
          schedule.after_hours_enabled &&
          schedule.after_hours_start &&
          schedule.after_hours_end
        ) {
          dayDto.slots.afterHours = this.generateSlots({
            date: dateStr,
            startTime: schedule.after_hours_start,
            endTime: schedule.after_hours_end,
            slotDuration,
            blockDuration,
            slotsNeeded,
            totalPrice: afterHoursSum,
            blockedSlotUtcMs,
            advanceCutoffMs,
            timezone: barberTimezone,
          });
        }
      } else {
        if (
          schedule.day_off_booking_enabled &&
          schedule.day_off_start_time &&
          schedule.day_off_end_time
        ) {
          dayDto.slots.dayOff = this.generateSlots({
            date: dateStr,
            startTime: schedule.day_off_start_time,
            endTime: schedule.day_off_end_time,
            slotDuration,
            blockDuration,
            slotsNeeded,
            totalPrice: dayOffSum,
            blockedSlotUtcMs,
            advanceCutoffMs,
            timezone: barberTimezone,
          });
        }
      }

      days.push(dayDto);
    }

    const services: ServiceSummaryDto[] = orderedServices.map((s) => ({
      id: s.id,
      name: s.name,
      durationMinutes: s.duration_minutes,
      regularPrice: Number(s.regular_price_usd),
      // Surface the regular fallback explicitly — `null` here would mislead
      // the client into thinking the slot is unbookable for that type.
      afterHoursPrice:
        s.after_hours_price_usd !== null
          ? Number(s.after_hours_price_usd)
          : Number(s.regular_price_usd),
      dayOffPrice:
        s.day_off_price_usd !== null
          ? Number(s.day_off_price_usd)
          : Number(s.regular_price_usd),
    }));

    // Representative block duration for the response root: use the most
    // common slot_duration_minutes across the barber's schedule rows. In
    // practice all days share the same grid, so this is unambiguous.
    const representativeSlotDuration =
      this.pickRepresentativeSlotDuration(scheduleByDay) ?? 0;
    const totalDurationMinutes = orderedServices.length * representativeSlotDuration;

    return {
      barberId,
      services,
      totalDurationMinutes,
      days,
    };
  }

  private sumPrices(
    services: RawBarberServiceRow[],
    pick: (s: RawBarberServiceRow) => number,
  ): number {
    let sum = 0;
    for (const s of services) sum += pick(s);
    return Number(sum.toFixed(2));
  }

  private pickRepresentativeSlotDuration(
    scheduleByDay: Map<number, RawScheduleRow>,
  ): number | null {
    const counts = new Map<number, number>();
    for (const row of scheduleByDay.values()) {
      counts.set(row.slot_duration_minutes, (counts.get(row.slot_duration_minutes) ?? 0) + 1);
    }
    let best: { value: number; count: number } | null = null;
    for (const [value, count] of counts) {
      if (!best || count > best.count) best = { value, count };
    }
    return best ? best.value : null;
  }

  private buildBlockedSlotSet(
    bookings: { scheduled_at: string; duration_minutes: number | null }[],
    slotDurationMinutes: number,
  ): Set<number> {
    const blocked = new Set<number>();
    const stepMs = slotDurationMinutes * MINUTE_MS;
    for (const b of bookings) {
      const startMs = new Date(b.scheduled_at).getTime();
      const duration = b.duration_minutes ?? slotDurationMinutes;
      const endMs = startMs + duration * MINUTE_MS;
      const startKey = Math.floor(startMs / MINUTE_MS) * MINUTE_MS;
      for (let ms = startKey; ms < endMs; ms += stepMs) {
        blocked.add(ms);
      }
    }
    return blocked;
  }

  private generateSlots(params: GenerateSlotsParams): SlotDto[] {
    const {
      date,
      startTime,
      endTime,
      slotDuration,
      blockDuration,
      slotsNeeded,
      totalPrice,
      blockedSlotUtcMs,
      advanceCutoffMs,
      timezone,
    } = params;
    const startMinutes = this.timeToMinutes(startTime);
    const endMinutes = this.timeToMinutes(endTime);
    const slots: SlotDto[] = [];

    for (let m = startMinutes; m + blockDuration <= endMinutes; m += slotDuration) {
      const time = this.minutesToTime(m);
      const slotUtcMs = composeUtcFromLocal(date, time, timezone).getTime();
      if (slotUtcMs < advanceCutoffMs) continue;

      let available = true;
      for (let k = 0; k < slotsNeeded; k++) {
        const gridMs = slotUtcMs + k * slotDuration * MINUTE_MS;
        const gridKey = Math.floor(gridMs / MINUTE_MS) * MINUTE_MS;
        if (blockedSlotUtcMs.has(gridKey)) {
          available = false;
          break;
        }
      }

      slots.push({
        time,
        endTime: this.minutesToTime(m + blockDuration),
        available,
        price: totalPrice,
      });
    }

    return slots;
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private minutesToTime(totalMinutes: number): string {
    const h = Math.floor(totalMinutes / 60)
      .toString()
      .padStart(2, '0');
    const m = (totalMinutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

// Parse a YYYY-MM-DD calendar date into a UTC-midnight instant in ms.
// Used as the canonical frame for date arithmetic so server-local TZ never
// leaks into the result.
function parseCalendarDateUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToDateStr(ms: number): string {
  const day = new Date(ms);
  const yy = day.getUTCFullYear();
  const mm = (day.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = day.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
