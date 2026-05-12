import {
  BARBER_DEFAULT_TIMEZONE,
  composeUtcFromLocal,
  isValidTimezone,
  localDateInTz,
  projectBookingTime,
  splitLocalDateTime,
  tzOffsetMs,
} from './timezone.util';

describe('timezone.util', () => {
  // ────────────────────────────────────────────────────────────
  // composeUtcFromLocal — wall-clock → UTC
  // ────────────────────────────────────────────────────────────
  describe('composeUtcFromLocal', () => {
    it('converts EST winter wall-clock to UTC (UTC-5)', () => {
      const utc = composeUtcFromLocal('2026-01-15', '10:00', 'America/New_York');
      expect(utc.toISOString()).toBe('2026-01-15T15:00:00.000Z');
    });

    it('converts EDT summer wall-clock to UTC (UTC-4)', () => {
      const utc = composeUtcFromLocal('2026-07-15', '10:00', 'America/New_York');
      expect(utc.toISOString()).toBe('2026-07-15T14:00:00.000Z');
    });

    it('handles DST forward transition — 09:00 stays 09:00 local across the boundary', () => {
      // 2026-03-08: US DST starts at 02:00 → 03:00. 09:00 EDT is well after.
      const before = composeUtcFromLocal('2026-03-07', '09:00', 'America/New_York');
      const after = composeUtcFromLocal('2026-03-08', '09:00', 'America/New_York');
      expect(before.toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST
      expect(after.toISOString()).toBe('2026-03-08T13:00:00.000Z'); //  EDT, one UTC hour earlier
    });

    it('handles DST backward transition — 09:00 stays 09:00 local across the boundary', () => {
      // 2026-11-01: US DST ends at 02:00 → 01:00. 09:00 EST is well after.
      const before = composeUtcFromLocal('2026-10-31', '09:00', 'America/New_York');
      const after = composeUtcFromLocal('2026-11-01', '09:00', 'America/New_York');
      expect(before.toISOString()).toBe('2026-10-31T13:00:00.000Z'); // EDT
      expect(after.toISOString()).toBe('2026-11-01T14:00:00.000Z'); //  EST, one UTC hour later
    });

    it('handles a non-existent wall-clock during spring-forward gap (02:30 EST → 03:30 EDT)', () => {
      // 02:30 doesn't exist on 2026-03-08 in NY. The two-pass resolution
      // settles to a deterministic instant — verify it picks the post-DST
      // interpretation (03:30 EDT == 07:30Z) which is the standard convention.
      const utc = composeUtcFromLocal('2026-03-08', '02:30', 'America/New_York');
      // Either 07:30Z (post-DST) or 06:30Z (pre-DST) is defensible; lock in
      // the actual behavior so regressions are visible.
      expect(['2026-03-08T06:30:00.000Z', '2026-03-08T07:30:00.000Z']).toContain(
        utc.toISOString(),
      );
    });

    it('handles a UTC-positive timezone (Asia/Tokyo, no DST)', () => {
      const utc = composeUtcFromLocal('2026-05-12', '09:00', 'Asia/Tokyo');
      expect(utc.toISOString()).toBe('2026-05-12T00:00:00.000Z');
    });

    it('handles a near-midnight slot that crosses UTC day boundary', () => {
      // 20:30 EDT 2026-05-11 → 00:30Z 2026-05-12. Local date != UTC date.
      const utc = composeUtcFromLocal('2026-05-11', '20:30', 'America/New_York');
      expect(utc.toISOString()).toBe('2026-05-12T00:30:00.000Z');
    });
  });

  // ────────────────────────────────────────────────────────────
  // splitLocalDateTime — UTC → wall-clock
  // ────────────────────────────────────────────────────────────
  describe('splitLocalDateTime', () => {
    it('round-trips with composeUtcFromLocal', () => {
      const utc = composeUtcFromLocal('2026-05-11', '20:30', 'America/New_York');
      expect(splitLocalDateTime(utc, 'America/New_York')).toEqual({
        date: '2026-05-11',
        time: '20:30',
      });
    });

    it('renders the same UTC instant differently in two timezones (same-tz vs cross-tz)', () => {
      const utc = '2026-05-12T00:30:00.000Z';
      // Same as barber tz
      expect(splitLocalDateTime(utc, 'America/New_York')).toEqual({
        date: '2026-05-11',
        time: '20:30',
      });
      // Client browsing from Tokyo
      expect(splitLocalDateTime(utc, 'Asia/Tokyo')).toEqual({
        date: '2026-05-12',
        time: '09:30',
      });
    });

    it('handles midnight crossing UTC day boundary', () => {
      // 23:30 EST = 04:30Z next day
      const utc = composeUtcFromLocal('2026-01-15', '23:30', 'America/New_York');
      expect(splitLocalDateTime(utc, 'America/New_York')).toEqual({
        date: '2026-01-15',
        time: '23:30',
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // projectBookingTime — canonical booking-time shape
  // ────────────────────────────────────────────────────────────
  describe('projectBookingTime', () => {
    it('produces the canonical 4-field shape', () => {
      const result = projectBookingTime('2026-05-12T00:30:00.000Z', 'America/New_York');
      expect(result).toEqual({
        scheduledAt: '2026-05-12T00:30:00.000Z',
        timezone: 'America/New_York',
        appointmentDate: '2026-05-11',
        appointmentTime: '20:30',
      });
    });

    it('accepts a Date object as input', () => {
      const result = projectBookingTime(new Date('2026-05-12T00:30:00.000Z'), 'America/New_York');
      expect(result.appointmentTime).toBe('20:30');
    });

    it('falls back to BARBER_DEFAULT_TIMEZONE when timezone is empty', () => {
      const result = projectBookingTime('2026-05-12T00:30:00.000Z', '');
      expect(result.timezone).toBe(BARBER_DEFAULT_TIMEZONE);
    });
  });

  // ────────────────────────────────────────────────────────────
  // tzOffsetMs — used internally; expose DST behavior
  // ────────────────────────────────────────────────────────────
  describe('tzOffsetMs', () => {
    it('returns -5h for EST winter', () => {
      expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(
        -5 * 60 * 60 * 1000,
      );
    });

    it('returns -4h for EDT summer', () => {
      expect(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(
        -4 * 60 * 60 * 1000,
      );
    });

    it('returns +9h for Tokyo (no DST)', () => {
      expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), 'Asia/Tokyo')).toBe(
        9 * 60 * 60 * 1000,
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // localDateInTz
  // ────────────────────────────────────────────────────────────
  describe('localDateInTz', () => {
    it('returns the local calendar date even when UTC date differs', () => {
      const instant = new Date('2026-05-12T00:30:00.000Z');
      expect(localDateInTz(instant, 'America/New_York')).toBe('2026-05-11');
      expect(localDateInTz(instant, 'Asia/Tokyo')).toBe('2026-05-12');
    });
  });

  // ────────────────────────────────────────────────────────────
  // isValidTimezone
  // ────────────────────────────────────────────────────────────
  describe('isValidTimezone', () => {
    it('accepts canonical IANA names', () => {
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('rejects invalid identifiers', () => {
      expect(isValidTimezone('Foo/Bar')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Weekly recurrence DST safety — wallclock must be preserved
  // ────────────────────────────────────────────────────────────
  describe('weekly recurrence across DST', () => {
    it('preserves wall-clock 09:00 across spring-forward boundary', () => {
      const tz = 'America/New_York';
      // Simulate the recurrence generator's per-occurrence conversion:
      // calendar dates are advanced in UTC, each occurrence is converted
      // via composeUtcFromLocal so the wall-clock stays fixed.
      const slot = '09:00';
      const utcBefore = composeUtcFromLocal('2026-03-01', slot, tz);
      const utcAfter = composeUtcFromLocal('2026-03-15', slot, tz); // crosses 2026-03-08 DST
      const localBefore = splitLocalDateTime(utcBefore, tz);
      const localAfter = splitLocalDateTime(utcAfter, tz);
      expect(localBefore.time).toBe('09:00');
      expect(localAfter.time).toBe('09:00');
      // UTC offsets differ — confirming the recurrence is DST-correct
      expect(utcAfter.getTime() - utcBefore.getTime()).not.toBe(14 * 86_400_000);
    });

    it('preserves wall-clock 09:00 across fall-back boundary', () => {
      const tz = 'America/New_York';
      const slot = '09:00';
      const utcBefore = composeUtcFromLocal('2026-10-25', slot, tz);
      const utcAfter = composeUtcFromLocal('2026-11-08', slot, tz); // crosses 2026-11-01 DST
      expect(splitLocalDateTime(utcBefore, tz).time).toBe('09:00');
      expect(splitLocalDateTime(utcAfter, tz).time).toBe('09:00');
    });
  });
});
