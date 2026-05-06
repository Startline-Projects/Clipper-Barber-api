import { computeOccurrenceDatesLocal } from './recurring-booking-generator.service';

// Pure tests for the occurrence generator. Covers each frequency cross
// each end condition, plus the boundary cases the spec calls out.

describe('computeOccurrenceDatesLocal', () => {
  describe('weekly', () => {
    it('emits every matching day-of-week inside the horizon', () => {
      // 2026-05-09 is a Saturday (dayOfWeek=6)
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'weekly',
        intervalN: null,
        endType: 'none',
        endCount: null,
        endDate: null,
        horizonDays: 56,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual([
        '2026-05-09',
        '2026-05-16',
        '2026-05-23',
        '2026-05-30',
        '2026-06-06',
        '2026-06-13',
        '2026-06-20',
        '2026-06-27',
      ]);
    });

    it('snaps forward when start_date is not on the chosen day_of_week', () => {
      // 2026-05-09 is Saturday; ask for Wednesday (dayOfWeek=3)
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 3,
        frequency: 'weekly',
        intervalN: null,
        endType: 'none',
        endCount: null,
        endDate: null,
        horizonDays: 14,
        existingCountConsumed: 0,
      });
      expect(dates[0]).toBe('2026-05-13');
    });
  });

  describe('biweekly', () => {
    it('steps every 14 days from the first matching dow', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09', // Sat
        dayOfWeek: 6,
        frequency: 'biweekly',
        intervalN: null,
        endType: 'none',
        endCount: null,
        endDate: null,
        horizonDays: 56,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual([
        '2026-05-09',
        '2026-05-23',
        '2026-06-06',
        '2026-06-20',
      ]);
    });
  });

  describe('every_n_weeks', () => {
    it('respects intervalN = 3', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'every_n_weeks',
        intervalN: 3,
        endType: 'none',
        endCount: null,
        endDate: null,
        horizonDays: 84,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual([
        '2026-05-09',
        '2026-05-30',
        '2026-06-20',
        '2026-07-11',
      ]);
    });

    it('respects intervalN = 4', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'every_n_weeks',
        intervalN: 4,
        endType: 'none',
        endCount: null,
        endDate: null,
        horizonDays: 90,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual([
        '2026-05-09',
        '2026-06-06',
        '2026-07-04',
        '2026-08-01',
      ]);
    });
  });

  describe('monthly', () => {
    it('keeps the same calendar day each month', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-15',
        dayOfWeek: 5, // informational for monthly
        frequency: 'monthly',
        intervalN: null,
        endType: 'none',
        endCount: null,
        endDate: null,
        horizonDays: 200,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual([
        '2026-05-15',
        '2026-06-15',
        '2026-07-15',
        '2026-08-15',
        '2026-09-15',
        '2026-10-15',
        '2026-11-15',
      ]);
    });

    it('clamps to the last day of shorter months when start day = 31', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-01-31',
        dayOfWeek: 6,
        frequency: 'monthly',
        intervalN: null,
        endType: 'after_count',
        endCount: 4,
        endDate: null,
        horizonDays: 365,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
      ]);
    });
  });

  describe('end conditions', () => {
    it('after_count = 1 returns exactly one occurrence', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'weekly',
        intervalN: null,
        endType: 'after_count',
        endCount: 1,
        endDate: null,
        horizonDays: 56,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual(['2026-05-09']);
    });

    it('after_count discounts already-generated occurrences', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'weekly',
        intervalN: null,
        endType: 'after_count',
        endCount: 5,
        endDate: null,
        horizonDays: 56,
        existingCountConsumed: 3,
      });
      expect(dates).toHaveLength(2);
    });

    it('on_date includes the end_date when it lands exactly on an occurrence', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'weekly',
        intervalN: null,
        endType: 'on_date',
        endCount: null,
        endDate: '2026-05-23',
        horizonDays: 56,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual(['2026-05-09', '2026-05-16', '2026-05-23']);
    });

    it('on_date excludes occurrences after end_date', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'weekly',
        intervalN: null,
        endType: 'on_date',
        endCount: null,
        endDate: '2026-05-22',
        horizonDays: 56,
        existingCountConsumed: 0,
      });
      expect(dates).toEqual(['2026-05-09', '2026-05-16']);
    });

    it('horizon caps the open-ended series', () => {
      const dates = computeOccurrenceDatesLocal({
        startDate: '2026-05-09',
        dayOfWeek: 6,
        frequency: 'weekly',
        intervalN: null,
        endType: 'none',
        endCount: null,
        endDate: null,
        horizonDays: 21,
        existingCountConsumed: 0,
      });
      expect(dates).toHaveLength(3);
    });
  });
});
