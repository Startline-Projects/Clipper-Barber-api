-- ============================================================
-- Recurring Bookings (R1)
--
-- Replaces the legacy recurring_* trio
-- (recurring_arrangements / recurring_occurrences / recurring_pauses)
-- with a single source of truth: recurring_bookings. Individual
-- appointment rows live in the existing `bookings` table and are
-- linked back via bookings.recurring_booking_id.
--
-- Safe to re-run on a clean DB; destructive on an existing one
-- because it drops the old tables and two obsolete barber columns.
-- ============================================================


-- ============================================================
-- STEP 1 — Drop old references so enums can be dropped cleanly
-- ============================================================

-- bookings FK + column to the dropped recurring_occurrences
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS fk_recurring_occurrence;
ALTER TABLE bookings DROP COLUMN IF EXISTS recurring_occurrence_id;

-- Legacy recurring tables (children first)
DROP TABLE IF EXISTS recurring_pauses       CASCADE;
DROP TABLE IF EXISTS recurring_occurrences  CASCADE;
DROP TABLE IF EXISTS recurring_arrangements CASCADE;

-- Obsolete barber columns — one of them uses recurring_frequency_options,
-- so drop the column BEFORE we drop the enum.
ALTER TABLE barbers
  DROP COLUMN IF EXISTS recurring_frequency_options,
  DROP COLUMN IF EXISTS recurring_price_usd,
  DROP COLUMN IF EXISTS recurring_visible_on_profile;


-- ============================================================
-- STEP 2 — Drop legacy enums (no live references now)
-- ============================================================

DROP TYPE IF EXISTS arrangement_status;
DROP TYPE IF EXISTS occurrence_status;
DROP TYPE IF EXISTS arrangement_creator;
DROP TYPE IF EXISTS pause_initiator;
DROP TYPE IF EXISTS frequency_type;
DROP TYPE IF EXISTS recurring_frequency_options;


-- ============================================================
-- STEP 3 — Recreate reusable enums (clean slate)
-- ============================================================

CREATE TYPE frequency_type              AS ENUM ('weekly', 'biweekly');
CREATE TYPE recurring_frequency_options AS ENUM ('weekly', 'biweekly', 'both');

CREATE TYPE recurring_booking_status AS ENUM (
  'pending_barber_approval',
  'active',
  'paused',
  'cancelled',
  'expired'
);


-- ============================================================
-- STEP 4 — barber_services: per-service recurring price
-- null = this service does not support recurring bookings
-- ============================================================

ALTER TABLE barber_services
  ADD COLUMN IF NOT EXISTS recurring_price_usd numeric(10,2);


-- ============================================================
-- STEP 5 — barber_schedules: per-day recurring settings
-- ============================================================

ALTER TABLE barber_schedules
  ADD COLUMN IF NOT EXISTS recurring_enabled          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_frequency        recurring_frequency_options,
  ADD COLUMN IF NOT EXISTS recurring_extra_charge_usd numeric(10,2);


-- ============================================================
-- STEP 6 — recurring_bookings (the subscription contract)
-- FKs go to auth.users(id) per project convention
-- ============================================================

CREATE TABLE recurring_bookings (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id                         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  barber_id                         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  barber_service_id                 uuid NOT NULL REFERENCES barber_services(id) ON DELETE RESTRICT,

  day_of_week                       smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  slot_time                         time NOT NULL,

  frequency                         frequency_type NOT NULL,

  price_usd                         numeric(10,2) NOT NULL,

  status                            recurring_booking_status NOT NULL DEFAULT 'pending_barber_approval',

  is_renewal                        boolean NOT NULL DEFAULT false,
  original_recurring_booking_id     uuid REFERENCES recurring_bookings(id) ON DELETE SET NULL,

  barber_accepted_at                timestamptz,
  barber_declined_at                timestamptz,
  declined_reason                   text,

  paused_by                         text CHECK (paused_by IN ('client', 'barber')),
  pause_start_date                  date,
  pause_end_date                    date,

  window_start_date                 date,

  last_booking_notification_sent_at timestamptz,

  cancelled_at                      timestamptz,
  cancelled_by                      cancelled_by_role,

  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

-- Unique slot lock: one non-terminal subscription per (barber, day, time)
CREATE UNIQUE INDEX idx_recurring_bookings_unique_active_slot
  ON recurring_bookings (barber_id, day_of_week, slot_time)
  WHERE status IN ('pending_barber_approval', 'active', 'paused');

CREATE INDEX idx_recurring_bookings_barber_id
  ON recurring_bookings (barber_id, status);

CREATE INDEX idx_recurring_bookings_client_id
  ON recurring_bookings (client_id, status);

-- updated_at trigger (set_updated_at already exists from 20260418000001)
DROP TRIGGER IF EXISTS recurring_bookings_updated_at ON recurring_bookings;
CREATE TRIGGER recurring_bookings_updated_at
  BEFORE UPDATE ON recurring_bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- STEP 7 — bookings: link generated appointment rows back to
-- the subscription that spawned them
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS recurring_booking_id uuid
    REFERENCES recurring_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_recurring_booking_id
  ON bookings (recurring_booking_id)
  WHERE recurring_booking_id IS NOT NULL;


-- ============================================================
-- STEP 8 — RLS on recurring_bookings
-- Mirrors the project-wide auth.uid() = barber_id OR client_id pattern
-- ============================================================

ALTER TABLE recurring_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_bookings_select ON recurring_bookings
  FOR SELECT USING (auth.uid() = barber_id OR auth.uid() = client_id);

-- Only clients create; R6 enforces the client is the owner
CREATE POLICY recurring_bookings_insert_client ON recurring_bookings
  FOR INSERT WITH CHECK (auth.uid() = client_id);

-- Either side may update their own row; service-layer rules decide which
-- transitions each role is actually allowed to make.
CREATE POLICY recurring_bookings_update_own ON recurring_bookings
  FOR UPDATE USING (auth.uid() = barber_id OR auth.uid() = client_id);
