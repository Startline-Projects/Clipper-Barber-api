-- ============================================================
-- Add IANA timezone to barbers so schedule times (regular hours,
-- after-hours, day-off windows) can be interpreted in the barber's
-- local wall-clock regardless of where the API server runs.
-- ============================================================

ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York';
