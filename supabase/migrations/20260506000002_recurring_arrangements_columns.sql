-- ============================================================
-- Recurring arrangements (barber-initiated) — Part 2: columns,
-- indexes, CHECK constraints, RLS policy adjustments.
--
-- Runs in a separate transaction from Part 1 so the new enum
-- values added there are visible to the constraints below.
-- ============================================================


-- ------------------------------------------------------------
-- recurring_bookings: new columns for barber-initiated flow
-- ------------------------------------------------------------

ALTER TABLE recurring_bookings
  ADD COLUMN IF NOT EXISTS initiator       recurring_initiator NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS interval_n      smallint,
  ADD COLUMN IF NOT EXISTS end_type        recurring_end_type NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS end_count       smallint,
  ADD COLUMN IF NOT EXISTS end_date        date,
  ADD COLUMN IF NOT EXISTS note_to_client  text;


-- ------------------------------------------------------------
-- CHECK constraints — keep these idempotent so the migration
-- can re-run on a fresh DB without conflict.
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_bookings_end_shape'
  ) THEN
    ALTER TABLE recurring_bookings ADD CONSTRAINT recurring_bookings_end_shape
      CHECK (
        (end_type = 'none'        AND end_count IS NULL  AND end_date IS NULL) OR
        (end_type = 'after_count' AND end_count IS NOT NULL AND end_count >= 1 AND end_date IS NULL) OR
        (end_type = 'on_date'     AND end_count IS NULL  AND end_date IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_bookings_interval_shape'
  ) THEN
    ALTER TABLE recurring_bookings ADD CONSTRAINT recurring_bookings_interval_shape
      CHECK (
        (frequency = 'every_n_weeks' AND interval_n IS NOT NULL AND interval_n >= 2) OR
        (frequency <> 'every_n_weeks' AND interval_n IS NULL)
      );

  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_bookings_note_length'
  ) THEN
    ALTER TABLE recurring_bookings ADD CONSTRAINT recurring_bookings_note_length
      CHECK (note_to_client IS NULL OR char_length(note_to_client) <= 1000);
  END IF;
END $$;


-- ------------------------------------------------------------
-- Unique slot lock — recreate so pending_client_approval is
-- ALSO part of the "this slot is held" set. Existing pending /
-- active / paused statuses keep their meaning.
-- ------------------------------------------------------------

DROP INDEX IF EXISTS idx_recurring_bookings_unique_active_slot;

CREATE UNIQUE INDEX idx_recurring_bookings_unique_active_slot
  ON recurring_bookings (barber_id, day_of_week, slot_time)
  WHERE status IN (
    'pending_barber_approval',
    'pending_client_approval',
    'active',
    'paused'
  );


-- ------------------------------------------------------------
-- Lookup index for client-side arrangement listing (the spec
-- asks for filters on (client_id, status); the existing
-- (barber_id, status) index already covers the barber side).
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_recurring_bookings_client_status_initiator
  ON recurring_bookings (client_id, status, initiator);


-- ------------------------------------------------------------
-- RLS: allow barber to INSERT their own arrangement rows when
-- initiator='barber'. The original client INSERT policy stays
-- as-is so the existing flow is unaffected.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS recurring_bookings_insert_barber ON recurring_bookings;
CREATE POLICY recurring_bookings_insert_barber ON recurring_bookings
  FOR INSERT WITH CHECK (auth.uid() = barber_id AND initiator = 'barber');


-- ------------------------------------------------------------
-- RLS on recurring_booking_services: existing policy only lets
-- the client insert child rows. Replace with a unified rule —
-- whichever party owns the parent (per its initiator) may
-- insert children for it.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS recurring_booking_services_insert ON recurring_booking_services;

CREATE POLICY recurring_booking_services_insert ON recurring_booking_services
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM recurring_bookings r
      WHERE r.id = recurring_booking_services.recurring_booking_id
        AND (
          (r.initiator = 'client' AND auth.uid() = r.client_id) OR
          (r.initiator = 'barber' AND auth.uid() = r.barber_id)
        )
    )
  );
