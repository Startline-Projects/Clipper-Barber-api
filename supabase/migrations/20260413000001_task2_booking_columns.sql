-- ============================================================
-- Task 2 — Booking: add pricing breakdown + duration columns
-- so that a booking row preserves the full cost split and the
-- service duration at the moment the booking was created.
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS duration_minutes        integer,
  ADD COLUMN IF NOT EXISTS base_price_usd          numeric(10,2),
  ADD COLUMN IF NOT EXISTS slot_type_surcharge_usd numeric(10,2);
