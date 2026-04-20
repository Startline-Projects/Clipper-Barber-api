import { InternalServerErrorException } from '@nestjs/common';

const MINUTE_MS = 60_000;

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

// Convert a wall-clock (date, time) in the given IANA timezone into a UTC Date.
// Two passes are enough because IANA offsets are discrete per instant;
// the second pass resolves wall-clocks near DST transitions.
export function composeUtcFromLocal(date: string, time: string, timezone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const targetUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);

  let offsetMs = tzOffsetMs(new Date(targetUtcMs), timezone);
  let guess = new Date(targetUtcMs - offsetMs);
  offsetMs = tzOffsetMs(guess, timezone);
  guess = new Date(targetUtcMs - offsetMs);
  return guess;
}

export function tzOffsetMs(instant: Date, timezone: string): number {
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
    pick('second'),
  );
  return wallAsUtcMs - instant.getTime();
}

// Barber-local "today" (YYYY-MM-DD) at the given IANA timezone
export function localDateInTz(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${d}`;
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
