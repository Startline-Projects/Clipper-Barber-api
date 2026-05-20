// Pure send-at computation for appointment reminders.
//
// All math respects the barber's IANA timezone. HOURS_BEFORE / MINUTES_BEFORE
// are absolute offsets from the appointment instant; MORNING_OF anchors to
// 09:00 barber-local on the appointment's local calendar date. Reuses the
// canonical timezone primitives so DST is handled identically to bookings.

import { composeUtcFromLocal, splitLocalDateTime } from '../../bookings/util/timezone.util';
import { MORNING_OF_LOCAL_TIME } from '../reminders.constants';

export type ReminderTypeValue = 'hours_before' | 'minutes_before' | 'morning_of';

export interface ReminderOffsetConfig {
  reminderType: ReminderTypeValue;
  offsetHours: number | null;
  offsetMinutes: number | null;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

// Compute the UTC instant a reminder should be sent for an appointment.
export function computeSendAt(
  scheduledAtUtc: Date,
  config: ReminderOffsetConfig,
  timezone: string,
): Date {
  switch (config.reminderType) {
    case 'hours_before': {
      const hours = config.offsetHours ?? 0;
      return new Date(scheduledAtUtc.getTime() - hours * MS_PER_HOUR);
    }
    case 'minutes_before': {
      const minutes = config.offsetMinutes ?? 0;
      return new Date(scheduledAtUtc.getTime() - minutes * MS_PER_MINUTE);
    }
    case 'morning_of': {
      const { date } = splitLocalDateTime(scheduledAtUtc, timezone);
      return composeUtcFromLocal(date, MORNING_OF_LOCAL_TIME, timezone);
    }
  }
}

// True when send_at is too far in the past to send (older than the grace
// window). Such reminders are stored as SKIPPED rather than sent late.
export function isPastDue(sendAt: Date, now: Date, graceMinutes: number): boolean {
  return sendAt.getTime() < now.getTime() - graceMinutes * MS_PER_MINUTE;
}
