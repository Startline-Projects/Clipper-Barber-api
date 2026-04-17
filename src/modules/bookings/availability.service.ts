import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { GetAvailabilityQueryDto } from './dto/get-availability-query.dto';
import {
  AvailabilityDayDto,
  AvailabilityResponseDto,
  ServiceSummaryDto,
  SlotDto,
} from './dto/availability-response.dto';

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
  regular_price_usd: number;
  after_hours_price_usd: number | null;
  day_off_price_usd: number | null;
  is_active: boolean;
}

interface GenerateSlotsParams {
  date: string;
  startTime: string;
  endTime: string;
  slotDuration: number;
  price: number;
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

    const barberTimezone = (barberRow as RawBarberRow).timezone;

    // Step 2 — Fetch the service (barber_id is auth UUID here)
    const { data: serviceRow, error: serviceError } = await this.db
      .from('barber_services')
      .select(
        'id, barber_id, name, duration_minutes, regular_price_usd, after_hours_price_usd, day_off_price_usd, is_active'
      )
      .eq('id', query.serviceId)
      .eq('barber_id', barberId)
      .eq('is_active', true)
      .maybeSingle();

    if (serviceError) throw new InternalServerErrorException('Failed to fetch service');
    if (!serviceRow) throw new NotFoundException('Service not found or inactive');

    const service = serviceRow as RawBarberServiceRow;

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

    // Clamp effective start to today (never return past dates)
    const now = new Date();
    const todayStr = this.formatDate(now);
    const requestedStart = new Date(query.startDate);
    const today = new Date(todayStr);
    const effectiveStart = requestedStart < today ? today : requestedStart;
    const endDate = new Date(query.endDate);

    // Step 4 — Fetch blocking bookings in range.
    //   Widen by ±1 day: slot calendar dates are in the barber's TZ, but
    //   scheduled_at is UTC — a slot near midnight local can map to the
    //   adjacent UTC date, so we fetch a little extra and match on UTC ms.
    const rangeStart = new Date(effectiveStart);
    rangeStart.setDate(rangeStart.getDate() - 1);
    const rangeEnd = new Date(endDate);
    rangeEnd.setDate(rangeEnd.getDate() + 2);

    const { data: bookingRows, error: bookingError } = await this.db
      .from('bookings')
      .select('scheduled_at')
      .eq('barber_id', barberId)
      .gte('scheduled_at', this.formatDate(rangeStart))
      .lt('scheduled_at', this.formatDate(rangeEnd))
      .in('status', ['confirmed', 'pending']);

    if (bookingError) throw new InternalServerErrorException('Failed to fetch bookings');

    const blockedSlotUtcMs = new Set<number>();
    for (const booking of bookingRows ?? []) {
      const ms = new Date(booking.scheduled_at as string).getTime();
      blockedSlotUtcMs.add(Math.floor(ms / MINUTE_MS) * MINUTE_MS);
    }


    // Steps 5 & 6 — Generate and mark slots for each date
    const days: AvailabilityDayDto[] = [];
    const totalDays = Math.floor((endDate.getTime() - effectiveStart.getTime()) / 86_400_000) + 1;

    for (let i = 0; i < totalDays; i++) {
      const current = new Date(effectiveStart);
      current.setDate(current.getDate() + i);
      const dateStr = this.formatDate(current);
      const dayOfWeek = current.getDay();
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

      const dayDto: AvailabilityDayDto = {
        date: dateStr,
        dayOfWeek,
        isWorkingDay: schedule.is_working,
        slotDurationMinutes: slotDuration,
        slots: { regular: [], afterHours: [], dayOff: [] },
      };

      if (schedule.is_working) {
        // Regular slots
        if (schedule.regular_start_time && schedule.regular_end_time) {
          dayDto.slots.regular = this.generateSlots({
            date: dateStr,
            startTime: schedule.regular_start_time,
            endTime: schedule.regular_end_time,
            slotDuration,
            price: service.regular_price_usd,
            blockedSlotUtcMs,
            advanceCutoffMs,
            timezone: barberTimezone,
          });
        }

        // After-hours slots
        if (
          schedule.after_hours_enabled &&
          schedule.after_hours_start &&
          schedule.after_hours_end &&
          service.after_hours_price_usd != null
        ) {
          dayDto.slots.afterHours = this.generateSlots({
            date: dateStr,
            startTime: schedule.after_hours_start,
            endTime: schedule.after_hours_end,
            slotDuration,
            price: service.after_hours_price_usd,
            blockedSlotUtcMs,
            advanceCutoffMs,
            timezone: barberTimezone,
          });
        }
      } else {
        // Day-off slots
        if (
          schedule.day_off_booking_enabled &&
          schedule.day_off_start_time &&
          schedule.day_off_end_time &&
          service.day_off_price_usd != null
        ) {
          dayDto.slots.dayOff = this.generateSlots({
            date: dateStr,
            startTime: schedule.day_off_start_time,
            endTime: schedule.day_off_end_time,
            slotDuration,
            price: service.day_off_price_usd,
            blockedSlotUtcMs,
            advanceCutoffMs,
            timezone: barberTimezone,
          });
        }
      }

      days.push(dayDto);
    }

    const serviceSummary: ServiceSummaryDto = {
      id: service.id,
      name: service.name,
      durationMinutes: service.duration_minutes,
      regularPrice: service.regular_price_usd,
      afterHoursPrice: service.after_hours_price_usd,
      dayOffPrice: service.day_off_price_usd,
    };

    return { barberId, service: serviceSummary, days };
  }

  private generateSlots(params: GenerateSlotsParams): SlotDto[] {
    const {
      date,
      startTime,
      endTime,
      slotDuration,
      price,
      blockedSlotUtcMs,
      advanceCutoffMs,
      timezone,
    } = params;
    const startMinutes = this.timeToMinutes(startTime);
    const endMinutes = this.timeToMinutes(endTime);
    const slots: SlotDto[] = [];

    for (let m = startMinutes; m + slotDuration <= endMinutes; m += slotDuration) {
      const time = this.minutesToTime(m);
      const slotUtcMs = this.composeUtcFromLocal(date, time, timezone).getTime();

      // Exclude slots that violate advance notice or are in the past
      if (slotUtcMs < advanceCutoffMs) continue;

      const slotKey = Math.floor(slotUtcMs / MINUTE_MS) * MINUTE_MS;
      slots.push({
        time,
        endTime: this.minutesToTime(m + slotDuration),
        available: !blockedSlotUtcMs.has(slotKey),
        price,
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

  // Convert a wall-clock (date, time) in the given IANA timezone into a UTC
  // Date. Two passes are enough because IANA offsets are discrete per instant;
  // the second pass resolves wall-clocks near DST transitions.
  private composeUtcFromLocal(date: string, time: string, timezone: string): Date {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const targetUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);

    let offsetMs = this.tzOffsetMs(new Date(targetUtcMs), timezone);
    let guess = new Date(targetUtcMs - offsetMs);
    offsetMs = this.tzOffsetMs(guess, timezone);
    guess = new Date(targetUtcMs - offsetMs);
    return guess;
  }

  // Offset (in ms) that the given IANA timezone is ahead of UTC at `instant`.
  private tzOffsetMs(instant: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(instant);

    const pick = (t: string): number => {
      const part = parts.find((p) => p.type === t);
      if (!part) throw new InternalServerErrorException(`Invalid timezone: ${timezone}`);
      return Number(part.value);
    };

    const wallAsUtcMs = Date.UTC(
      pick('year'),
      pick('month') - 1,
      pick('day'),
      pick('hour') === 24 ? 0 : pick('hour'),
      pick('minute'),
      pick('second')
    );
    return wallAsUtcMs - instant.getTime();
  }
}
