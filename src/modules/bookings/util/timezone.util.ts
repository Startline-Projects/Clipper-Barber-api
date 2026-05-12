// Canonical timezone primitives for booking time conversions.
//
// Contract:
//   - All persisted timestamps are UTC (`timestamptz`).
//   - Client requests submit wall-clock values (`date` + `slotTime`)
//     interpreted in the BARBER's IANA timezone (never the server's, never
//     the browser's).
//   - All booking responses pair `scheduledAt` (UTC ISO) with `timezone`
//     (IANA) and the projected local `appointmentDate` / `appointmentTime`
//     so frontends can render without re-deriving the conversion.
//
// Conversions are done with `Intl.DateTimeFormat` rather than a third-party
// library: no extra dep, IANA-aware, DST-correct.

import { InternalServerErrorException } from '@nestjs/common';

// Fallback used when a barber row is missing a timezone. The DB column has a
// default ('America/New_York'), so this should never trigger in practice — but
// when it does, UTC is the safer fallback than guessing a regional default.
export const BARBER_DEFAULT_TIMEZONE = 'UTC';

export interface BookingTimeFields {
  scheduledAt: string;       // UTC ISO 8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`)
  timezone: string;          // IANA tz (e.g. 'America/New_York')
  appointmentDate: string;   // Local calendar date (`YYYY-MM-DD`) in `timezone`
  appointmentTime: string;   // Local wall-clock (`HH:MM`) in `timezone`
}

// Convert a wall-clock (date, time) in the given IANA timezone into a UTC
// instant. Two passes are sufficient because IANA offsets are discrete per
// instant; the second pass resolves wall-clocks near DST transitions.
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

// Offset (ms) of the given instant in the target timezone. Positive for
// timezones east of UTC, negative for those west. DST-aware.
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

// Barber-local "today" (`YYYY-MM-DD`) at the given IANA timezone.
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

// Split a UTC ISO into barber-local (date, time) parts.
export function splitLocalDateTime(
  utcIso: string | Date,
  timezone: string,
): { date: string; time: string } {
  const instant = typeof utcIso === 'string' ? new Date(utcIso) : utcIso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const pick = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const y = pick('year');
  const mo = pick('month');
  const d = pick('day');
  const h = pick('hour') === '24' ? '00' : pick('hour');
  const mi = pick('minute');
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

// Project a stored UTC instant into the canonical booking time shape that
// EVERY booking-returning DTO surfaces. The frontend should never have to
// re-derive these fields — the contract guarantees them.
export function projectBookingTime(
  scheduledAtUtc: string | Date,
  timezone: string,
): BookingTimeFields {
  const instant = typeof scheduledAtUtc === 'string' ? new Date(scheduledAtUtc) : scheduledAtUtc;
  const tz = timezone || BARBER_DEFAULT_TIMEZONE;
  const { date, time } = splitLocalDateTime(instant, tz);
  return {
    scheduledAt: instant.toISOString(),
    timezone: tz,
    appointmentDate: date,
    appointmentTime: time,
  };
}

// Validate an IANA timezone identifier. Returns false for invalid names like
// 'Foo/Bar' or 'EST5EDT' that Intl.DateTimeFormat rejects.
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
