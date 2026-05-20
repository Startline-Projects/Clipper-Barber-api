import { computeSendAt, isPastDue } from './reminder-schedule.util';

describe('reminder-schedule.util', () => {
  // ────────────────────────────────────────────────────────────
  // computeSendAt
  // ────────────────────────────────────────────────────────────
  describe('computeSendAt', () => {
    const tz = 'America/New_York';

    it('HOURS_BEFORE subtracts an absolute hour offset from the appointment', () => {
      const scheduled = new Date('2026-07-15T18:00:00.000Z'); // 14:00 EDT
      const sendAt = computeSendAt(
        scheduled,
        { reminderType: 'hours_before', offsetHours: 2, offsetMinutes: null },
        tz,
      );
      expect(sendAt.toISOString()).toBe('2026-07-15T16:00:00.000Z');
    });

    it('MINUTES_BEFORE subtracts an absolute minute offset from the appointment', () => {
      const scheduled = new Date('2026-07-15T18:00:00.000Z');
      const sendAt = computeSendAt(
        scheduled,
        { reminderType: 'minutes_before', offsetHours: null, offsetMinutes: 30 },
        tz,
      );
      expect(sendAt.toISOString()).toBe('2026-07-15T17:30:00.000Z');
    });

    it('MORNING_OF anchors to 09:00 barber-local on the appointment date (EDT, UTC-4)', () => {
      // 14:00 EDT appointment → 09:00 EDT same day = 13:00Z.
      const scheduled = new Date('2026-07-15T18:00:00.000Z');
      const sendAt = computeSendAt(
        scheduled,
        { reminderType: 'morning_of', offsetHours: null, offsetMinutes: null },
        tz,
      );
      expect(sendAt.toISOString()).toBe('2026-07-15T13:00:00.000Z');
    });

    it('MORNING_OF anchors to 09:00 barber-local in winter (EST, UTC-5)', () => {
      const scheduled = new Date('2026-01-15T15:00:00.000Z'); // 10:00 EST
      const sendAt = computeSendAt(
        scheduled,
        { reminderType: 'morning_of', offsetHours: null, offsetMinutes: null },
        tz,
      );
      expect(sendAt.toISOString()).toBe('2026-01-15T14:00:00.000Z'); // 09:00 EST
    });

    it('MORNING_OF uses the appointment\'s LOCAL date when the UTC date differs', () => {
      // 00:30Z 2026-05-12 is 20:30 EDT on 2026-05-11. Morning-of must anchor
      // to 09:00 on 2026-05-11 local (13:00Z), not the UTC calendar date.
      const scheduled = new Date('2026-05-12T00:30:00.000Z');
      const sendAt = computeSendAt(
        scheduled,
        { reminderType: 'morning_of', offsetHours: null, offsetMinutes: null },
        tz,
      );
      expect(sendAt.toISOString()).toBe('2026-05-11T13:00:00.000Z');
    });

    it('HOURS_BEFORE respects a UTC-positive timezone identically (offset is absolute)', () => {
      const scheduled = new Date('2026-05-12T00:00:00.000Z'); // 09:00 JST
      const sendAt = computeSendAt(
        scheduled,
        { reminderType: 'hours_before', offsetHours: 3, offsetMinutes: null },
        'Asia/Tokyo',
      );
      expect(sendAt.toISOString()).toBe('2026-05-11T21:00:00.000Z');
    });
  });

  // ────────────────────────────────────────────────────────────
  // isPastDue
  // ────────────────────────────────────────────────────────────
  describe('isPastDue', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');

    it('is false for a future send_at', () => {
      expect(isPastDue(new Date('2026-07-15T13:00:00.000Z'), now, 0)).toBe(false);
    });

    it('is true for a past send_at with zero grace', () => {
      expect(isPastDue(new Date('2026-07-15T11:59:00.000Z'), now, 0)).toBe(true);
    });

    it('is false when the lateness is within the grace window', () => {
      expect(isPastDue(new Date('2026-07-15T11:55:00.000Z'), now, 10)).toBe(false);
    });

    it('is true when the lateness exceeds the grace window', () => {
      expect(isPastDue(new Date('2026-07-15T11:40:00.000Z'), now, 10)).toBe(true);
    });
  });
});
