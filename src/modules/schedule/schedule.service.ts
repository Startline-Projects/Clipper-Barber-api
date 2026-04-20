import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  RecurringFrequencyOption,
  UpdateScheduleDayDto,
} from './dto/update-schedule-day.dto';
import { ScheduleDayDto } from './dto/schedule-day-response.dto';
import {
  DayOffConflict,
  Forbidden,
  InvalidAdvanceNotice,
  InvalidAfterHours,
  InvalidDayOffHours,
  InvalidRecurringConfig,
  InvalidRegularHours,
  InvalidSlotDuration,
  ScheduleNotFound,
} from './schedule.exceptions';

interface RawScheduleDay {
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
  recurring_enabled: boolean;
  recurring_frequency: RecurringFrequencyOption | null;
  recurring_extra_charge_usd: string | number | null;
  created_at: string;
  updated_at: string;
}

const VALID_SLOT_DURATIONS = [15, 30, 45, 60] as const;

@Injectable()
export class ScheduleService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // PostgreSQL time columns come back as "HH:mm:ss" — normalise to "HH:mm"
  private trimTime(value: string | null): string | null {
    if (value === null) return null;
    return value.substring(0, 5);
  }

  private mapRow(row: RawScheduleDay): ScheduleDayDto {
    return {
      id: row.id,
      barberId: row.barber_id,
      dayOfWeek: row.day_of_week,
      isWorking: row.is_working,
      regularStartTime: this.trimTime(row.regular_start_time),
      regularEndTime: this.trimTime(row.regular_end_time),
      slotDurationMinutes: row.slot_duration_minutes,
      afterHoursEnabled: row.after_hours_enabled,
      afterHoursStart: this.trimTime(row.after_hours_start),
      afterHoursEnd: this.trimTime(row.after_hours_end),
      dayOffBookingEnabled: row.day_off_booking_enabled,
      dayOffStartTime: this.trimTime(row.day_off_start_time),
      dayOffEndTime: this.trimTime(row.day_off_end_time),
      advanceNoticeMinutes: row.advance_notice_minutes,
      recurringEnabled: row.recurring_enabled,
      recurringFrequency: row.recurring_frequency,
      recurringExtraChargeUsd:
        row.recurring_extra_charge_usd !== null && row.recurring_extra_charge_usd !== undefined
          ? Number(row.recurring_extra_charge_usd)
          : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Ensures the auth user has a barbers row (i.e., finished enough of onboarding).
  // Returns the auth user id — which is also the FK value for barber_schedules.barber_id
  // now that the schema references auth.users(id) directly.
  private async resolveBarber(authUserId: string): Promise<string> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id')
      .eq('user_id', authUserId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Forbidden('No barber profile found for this user');

    return authUserId;
  }

  // Lexicographic comparison is correct for zero-padded "HH:mm" strings
  private compareTime(a: string, b: string): number {
    return a.substring(0, 5).localeCompare(b.substring(0, 5));
  }

  private validateMerged(row: RawScheduleDay): void {
    // Rule h — advance notice
    if (row.advance_notice_minutes < 0) {
      throw new InvalidAdvanceNotice('advanceNoticeMinutes must be >= 0');
    }

    // Rule g — slot duration
    if (!(VALID_SLOT_DURATIONS as readonly number[]).includes(row.slot_duration_minutes)) {
      throw new InvalidSlotDuration('slotDurationMinutes must be one of 15, 30, 45, 60');
    }

    // Rule d — day-off conflict
    if (row.day_off_booking_enabled && row.is_working) {
      throw new DayOffConflict('Day-off bookings can only be enabled on non-working days');
    }

    if (row.is_working) {
      // Rule a — regular times required
      if (!row.regular_start_time || !row.regular_end_time) {
        throw new InvalidRegularHours(
          'regularStartTime and regularEndTime are required when isWorking is true',
        );
      }

      // Rule e — regular start < end
      if (this.compareTime(row.regular_start_time, row.regular_end_time) >= 0) {
        throw new InvalidRegularHours('regularStartTime must be before regularEndTime');
      }

      if (row.after_hours_enabled) {
        // Rule b — after-hours times required
        if (!row.after_hours_start || !row.after_hours_end) {
          throw new InvalidAfterHours(
            'afterHoursStart and afterHoursEnd are required when afterHoursEnabled is true',
          );
        }

        // Rule b — after-hours start must be >= regular end
        if (this.compareTime(row.after_hours_start, row.regular_end_time) < 0) {
          throw new InvalidAfterHours('afterHoursStart must be >= regularEndTime');
        }

        // Rule b — after-hours end > after-hours start
        if (this.compareTime(row.after_hours_end, row.after_hours_start) <= 0) {
          throw new InvalidAfterHours('afterHoursEnd must be after afterHoursStart');
        }
      }
    }

    if (row.day_off_booking_enabled && !row.is_working) {
      // Rule c — day-off times required
      if (!row.day_off_start_time || !row.day_off_end_time) {
        throw new InvalidDayOffHours(
          'dayOffStartTime and dayOffEndTime are required when dayOffBookingEnabled is true',
        );
      }

      // Rule f — day-off start < end
      if (this.compareTime(row.day_off_start_time, row.day_off_end_time) >= 0) {
        throw new InvalidDayOffHours('dayOffStartTime must be before dayOffEndTime');
      }
    }

    // Recurring: frequency is mandatory when enabled; both only if the day
    // actually has a slot window (working hours or day-off bookings).
    if (row.recurring_enabled) {
      if (!row.recurring_frequency) {
        throw new InvalidRecurringConfig(
          'recurringFrequency is required when recurringEnabled is true',
        );
      }
      if (!row.is_working && !row.day_off_booking_enabled) {
        throw new InvalidRecurringConfig(
          'Recurring bookings require either regular hours or day-off bookings to be enabled for this day',
        );
      }
    }
  }

  public async getSchedule(authUserId: string): Promise<ScheduleDayDto[]> {
    const barberId = await this.resolveBarber(authUserId);

    const { data, error } = await this.db
      .from('barber_schedules')
      .select('*')
      .eq('barber_id', barberId)
      .order('day_of_week', { ascending: true });

    if (error) throw error;

    return (data as RawScheduleDay[]).map((row) => this.mapRow(row));
  }

  public async updateScheduleDay(
    authUserId: string,
    dayOfWeek: number,
    dto: UpdateScheduleDayDto,
  ): Promise<ScheduleDayDto> {
    const barberId = await this.resolveBarber(authUserId);

    const { data: existing, error: fetchError } = await this.db
      .from('barber_schedules')
      .select('*')
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) throw new ScheduleNotFound('No schedule row found for this day');

    const row = existing as RawScheduleDay;

    // Merge: if a field is undefined (not sent), keep DB value; if explicitly sent, use sent value
    const merged: RawScheduleDay = {
      id: row.id,
      barber_id: row.barber_id,
      day_of_week: row.day_of_week,
      is_working: dto.isWorking !== undefined ? dto.isWorking : row.is_working,
      regular_start_time:
        dto.regularStartTime !== undefined ? dto.regularStartTime : row.regular_start_time,
      regular_end_time:
        dto.regularEndTime !== undefined ? dto.regularEndTime : row.regular_end_time,
      slot_duration_minutes:
        dto.slotDurationMinutes !== undefined
          ? dto.slotDurationMinutes
          : row.slot_duration_minutes,
      after_hours_enabled:
        dto.afterHoursEnabled !== undefined ? dto.afterHoursEnabled : row.after_hours_enabled,
      after_hours_start:
        dto.afterHoursStart !== undefined ? dto.afterHoursStart : row.after_hours_start,
      after_hours_end:
        dto.afterHoursEnd !== undefined ? dto.afterHoursEnd : row.after_hours_end,
      day_off_booking_enabled:
        dto.dayOffBookingEnabled !== undefined
          ? dto.dayOffBookingEnabled
          : row.day_off_booking_enabled,
      day_off_start_time:
        dto.dayOffStartTime !== undefined ? dto.dayOffStartTime : row.day_off_start_time,
      day_off_end_time:
        dto.dayOffEndTime !== undefined ? dto.dayOffEndTime : row.day_off_end_time,
      advance_notice_minutes:
        dto.advanceNoticeMinutes !== undefined
          ? dto.advanceNoticeMinutes
          : row.advance_notice_minutes,
      recurring_enabled:
        dto.recurringEnabled !== undefined ? dto.recurringEnabled : row.recurring_enabled,
      // Disabling recurring clears the frequency and extra charge; otherwise
      // we honour whatever the caller sent (or keep the existing value).
      recurring_frequency: this.resolveRecurringFrequency(dto, row),
      recurring_extra_charge_usd: this.resolveRecurringExtraCharge(dto, row),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    this.validateMerged(merged);

    const { data: updated, error: updateError } = await this.db
      .from('barber_schedules')
      .update({
        is_working: merged.is_working,
        regular_start_time: merged.regular_start_time,
        regular_end_time: merged.regular_end_time,
        slot_duration_minutes: merged.slot_duration_minutes,
        after_hours_enabled: merged.after_hours_enabled,
        after_hours_start: merged.after_hours_start,
        after_hours_end: merged.after_hours_end,
        day_off_booking_enabled: merged.day_off_booking_enabled,
        day_off_start_time: merged.day_off_start_time,
        day_off_end_time: merged.day_off_end_time,
        advance_notice_minutes: merged.advance_notice_minutes,
        recurring_enabled: merged.recurring_enabled,
        recurring_frequency: merged.recurring_frequency,
        recurring_extra_charge_usd: merged.recurring_extra_charge_usd,
        updated_at: new Date().toISOString(),
      })
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .select()
      .single();

    if (updateError) throw updateError;

    // Keep the barber-level flag in sync: true iff any schedule day has
    // recurring_enabled = true. Barber can still manually toggle this via
    // PATCH /barber/settings/recurring (R3); the manual toggle overrides
    // until the next schedule save.
    await this.syncBarberRecurringFlag(barberId);

    return this.mapRow(updated as RawScheduleDay);
  }

  private resolveRecurringFrequency(
    dto: UpdateScheduleDayDto,
    row: RawScheduleDay,
  ): RecurringFrequencyOption | null {
    const enabled =
      dto.recurringEnabled !== undefined ? dto.recurringEnabled : row.recurring_enabled;

    if (!enabled) return null;

    if (dto.recurringFrequency !== undefined) return dto.recurringFrequency;
    return row.recurring_frequency;
  }

  private resolveRecurringExtraCharge(
    dto: UpdateScheduleDayDto,
    row: RawScheduleDay,
  ): number | null {
    const enabled =
      dto.recurringEnabled !== undefined ? dto.recurringEnabled : row.recurring_enabled;

    if (!enabled) return null;

    if (dto.recurringExtraChargeUsd !== undefined) return dto.recurringExtraChargeUsd;
    return row.recurring_extra_charge_usd !== null && row.recurring_extra_charge_usd !== undefined
      ? Number(row.recurring_extra_charge_usd)
      : null;
  }

  private async syncBarberRecurringFlag(barberId: string): Promise<void> {
    const { count, error: countError } = await this.db
      .from('barber_schedules')
      .select('id', { head: true, count: 'exact' })
      .eq('barber_id', barberId)
      .eq('recurring_enabled', true);

    if (countError) throw new InternalServerErrorException('Failed to sync recurring flag');

    const anyRecurring = (count ?? 0) > 0;

    const { error: updateError } = await this.db
      .from('barbers')
      .update({ recurring_enabled: anyRecurring })
      .eq('user_id', barberId);

    if (updateError) throw new InternalServerErrorException('Failed to sync recurring flag');
  }
}
