import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateScheduleDayDto } from './dto/update-schedule-day.dto';
import { ScheduleDayDto } from './dto/schedule-day-response.dto';
import {
  DayOffConflict,
  Forbidden,
  InvalidAdvanceNotice,
  InvalidAfterHours,
  InvalidDayOffHours,
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Returns barber.id (UUID), not the auth user_id
  private async resolveBarber(authUserId: string): Promise<string> {
    const { data, error } = await this.db
      .from('barbers')
      .select('id')
      .eq('user_id', authUserId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Forbidden('No barber profile found for this user');

    return (data as { id: string }).id;
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
        updated_at: new Date().toISOString(),
      })
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .select()
      .single();

    if (updateError) throw updateError;

    return this.mapRow(updated as RawScheduleDay);
  }
}
