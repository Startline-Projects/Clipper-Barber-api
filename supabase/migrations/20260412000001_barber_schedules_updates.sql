-- ============================================================
-- Migration: barber_schedules — remove pricing, add day-off
-- time windows and per-day advance notice
-- ============================================================

-- 1. Drop price columns (pricing now lives on barber_services only)
ALTER TABLE barber_schedules
  DROP COLUMN IF EXISTS regular_price_usd,
  DROP COLUMN IF EXISTS after_hours_price_usd,
  DROP COLUMN IF EXISTS day_off_price_usd;

-- 2. Add day-off time window columns
--    (barber picks when they're available on their day off)
ALTER TABLE barber_schedules
  ADD COLUMN IF NOT EXISTS day_off_start_time time,
  ADD COLUMN IF NOT EXISTS day_off_end_time   time;

-- 3. Move advance_notice_minutes from barbers to per-day schedule
ALTER TABLE barber_schedules
  ADD COLUMN IF NOT EXISTS advance_notice_minutes integer DEFAULT 60 NOT NULL;

-- 4. Add updated_at for cache invalidation
ALTER TABLE barber_schedules
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;

-- 5. Drop global advance_notice from barbers table
ALTER TABLE barbers
  DROP COLUMN IF EXISTS advance_notice_minutes;

-- ============================================================
-- Seed: ensure every barber has 7 schedule rows (Sun=0 .. Sat=6)
-- Runs idempotently — skips if the row already exists
-- ============================================================

INSERT INTO barber_schedules (barber_id, day_of_week, is_working)
SELECT b.id, d.day, false
FROM barbers b
CROSS JOIN generate_series(0, 6) AS d(day)
WHERE NOT EXISTS (
  SELECT 1 FROM barber_schedules bs
  WHERE bs.barber_id = b.id AND bs.day_of_week = d.day
);

-- ============================================================
-- Trigger: auto-create 7 schedule rows when a new barber signs up
-- ============================================================

CREATE OR REPLACE FUNCTION seed_barber_schedule()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO barber_schedules (barber_id, day_of_week, is_working)
  SELECT NEW.id, d.day, false
  FROM generate_series(0, 6) AS d(day);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_seed_barber_schedule ON barbers;

CREATE TRIGGER trigger_seed_barber_schedule
  AFTER INSERT ON barbers
  FOR EACH ROW EXECUTE FUNCTION seed_barber_schedule();


-- ============================================================
-- Constraints: enforce time field presence when features are enabled
-- ============================================================

ALTER TABLE barber_schedules
  ADD CONSTRAINT chk_day_off_times CHECK (
    (day_off_booking_enabled = false)
    OR (day_off_start_time IS NOT NULL AND day_off_end_time IS NOT NULL)
  );

ALTER TABLE barber_schedules
  ADD CONSTRAINT chk_after_hours_times CHECK (
    (after_hours_enabled = false)
    OR (after_hours_start IS NOT NULL AND after_hours_end IS NOT NULL)
  );

ALTER TABLE barber_schedules
  ADD CONSTRAINT chk_regular_times CHECK (
    (is_working = false)
    OR (regular_start_time IS NOT NULL AND regular_end_time IS NOT NULL)
  );
