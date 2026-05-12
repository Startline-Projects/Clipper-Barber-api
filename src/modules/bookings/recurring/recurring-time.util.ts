// Recurrence-specific helpers. The general-purpose timezone primitives live
// in `../util/timezone.util.ts` and are re-exported below so existing
// imports keep working.

import {
  composeUtcFromLocal,
  localDateInTz,
  splitLocalDateTime,
  tzOffsetMs,
} from '../util/timezone.util';

const MINUTE_MS = 60_000;

export { composeUtcFromLocal, localDateInTz, splitLocalDateTime, tzOffsetMs };

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const m = (totalMinutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD calendar date.
export function dayOfWeekFromDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Return the calendar dates (YYYY-MM-DD in barber-local tz) within the next
// `windowDays` whose day_of_week matches `targetDow`. The first date is on or
// after `startLocalDate`.
export function nextMatchingDates(
  startLocalDate: string,
  targetDow: number,
  windowDays: number,
): string[] {
  const [y, m, d] = startLocalDate.split('-').map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d);
  const results: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const ms = startUtcMs + i * 86_400_000;
    const day = new Date(ms);
    if (day.getUTCDay() === targetDow) {
      const yy = day.getUTCFullYear();
      const mm = (day.getUTCMonth() + 1).toString().padStart(2, '0');
      const dd = day.getUTCDate().toString().padStart(2, '0');
      results.push(`${yy}-${mm}-${dd}`);
    }
  }
  return results;
}

export { MINUTE_MS };
