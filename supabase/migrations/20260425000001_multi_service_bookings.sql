-- ============================================================
-- Multi-service bookings
--
-- A single booking may now contain 1..N consecutive services.
-- Each service carries its own booking_type (regular/after_hours/day_off)
-- and its own pricing snapshot. The bookings row keeps aggregated
-- snapshots (summed duration + summed price) so existing queries keep
-- working and the DB-level anti-overlap constraint can use
-- duration_minutes as the block length.
-- ============================================================

-- (no extra extensions required — overlap is enforced via a trigger, see bottom)

-- ============================================================
-- booking_services — one row per selected service per booking
-- ============================================================

CREATE TABLE booking_services (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  barber_service_id       uuid NOT NULL REFERENCES barber_services(id) ON DELETE RESTRICT,
  service_type            service_type NOT NULL,
  booking_type            booking_type NOT NULL,
  duration_minutes        integer NOT NULL CHECK (duration_minutes > 0),
  base_price_usd          numeric(10,2) NOT NULL,
  slot_type_surcharge_usd numeric(10,2) NOT NULL DEFAULT 0,
  price_usd               numeric(10,2) NOT NULL,
  sort_order              integer NOT NULL CHECK (sort_order >= 0),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_services_booking ON booking_services (booking_id);
CREATE UNIQUE INDEX idx_booking_services_unique_service ON booking_services (booking_id, barber_service_id);
CREATE UNIQUE INDEX idx_booking_services_unique_sort   ON booking_services (booking_id, sort_order);

ALTER TABLE booking_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_services_select ON booking_services
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_services.booking_id
        AND (auth.uid() = b.barber_id OR auth.uid() = b.client_id)
    )
  );

CREATE POLICY booking_services_insert ON booking_services
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_services.booking_id
        AND auth.uid() = b.client_id
    )
  );

CREATE POLICY booking_services_update ON booking_services
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_services.booking_id
        AND (auth.uid() = b.barber_id OR auth.uid() = b.client_id)
    )
  );

CREATE POLICY booking_services_delete ON booking_services
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_services.booking_id
        AND auth.uid() = b.client_id
    )
  );

-- ============================================================
-- recurring_booking_services — mirror for recurring contracts
-- ============================================================

CREATE TABLE recurring_booking_services (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_booking_id    uuid NOT NULL REFERENCES recurring_bookings(id) ON DELETE CASCADE,
  barber_service_id       uuid NOT NULL REFERENCES barber_services(id) ON DELETE RESTRICT,
  service_type            service_type NOT NULL,
  booking_type            booking_type NOT NULL,
  duration_minutes        integer NOT NULL CHECK (duration_minutes > 0),
  base_price_usd          numeric(10,2) NOT NULL,
  slot_type_surcharge_usd numeric(10,2) NOT NULL DEFAULT 0,
  price_usd               numeric(10,2) NOT NULL,
  sort_order              integer NOT NULL CHECK (sort_order >= 0),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_booking_services_parent ON recurring_booking_services (recurring_booking_id);
CREATE UNIQUE INDEX idx_recurring_booking_services_unique_service ON recurring_booking_services (recurring_booking_id, barber_service_id);
CREATE UNIQUE INDEX idx_recurring_booking_services_unique_sort   ON recurring_booking_services (recurring_booking_id, sort_order);

ALTER TABLE recurring_booking_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_booking_services_select ON recurring_booking_services
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM recurring_bookings r
      WHERE r.id = recurring_booking_services.recurring_booking_id
        AND (auth.uid() = r.barber_id OR auth.uid() = r.client_id)
    )
  );

CREATE POLICY recurring_booking_services_insert ON recurring_booking_services
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM recurring_bookings r
      WHERE r.id = recurring_booking_services.recurring_booking_id
        AND auth.uid() = r.client_id
    )
  );

-- ============================================================
-- recurring_bookings: store aggregate duration snapshot
-- ============================================================

ALTER TABLE recurring_bookings
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

-- ============================================================
-- Anti-overlap enforcement on bookings
--
-- The old `bookings_no_double_booking` unique index only blocked exact
-- same-start collisions. With multi-slot blocks we need a real interval
-- overlap check.
--
-- We can't use an EXCLUDE constraint here: the expression
--   `scheduled_at + (duration_minutes * interval '1 minute')`
-- is not allowed in an index expression because Postgres marks
-- `timestamptz + interval` as STABLE (interval can hold months/days whose
-- semantics depend on the session timezone). That restriction applies to
-- index and EXCLUDE expressions, but NOT to plpgsql function bodies.
--
-- So we move the same logic into a BEFORE trigger and serialise concurrent
-- inserts per barber via a transaction-scoped advisory lock — that closes
-- the obvious race between two clients trying to grab overlapping slots.
-- The trigger raises with SQLSTATE 23P01 (exclusion_violation), which is
-- already mapped to "slot taken" by the application layer.
-- ============================================================

DROP INDEX IF EXISTS bookings_no_double_booking;

CREATE OR REPLACE FUNCTION assert_bookings_no_overlap()
RETURNS trigger AS $$
DECLARE
  conflict_id uuid;
BEGIN
  IF NEW.status = 'cancelled' OR NEW.duration_minutes IS NULL THEN
    RETURN NEW;
  END IF;

  -- Per-barber transactional lock: two concurrent INSERTs for the same
  -- barber serialise here, so the overlap check below is race-safe.
  PERFORM pg_advisory_xact_lock(hashtextextended('booking_overlap:' || NEW.barber_id::text, 0));

  SELECT b.id INTO conflict_id
    FROM bookings b
   WHERE b.barber_id = NEW.barber_id
     AND b.id IS DISTINCT FROM NEW.id
     AND b.status <> 'cancelled'
     AND b.duration_minutes IS NOT NULL
     AND tstzrange(
           b.scheduled_at,
           b.scheduled_at + (b.duration_minutes * interval '1 minute'),
           '[)'
         )
       && tstzrange(
           NEW.scheduled_at,
           NEW.scheduled_at + (NEW.duration_minutes * interval '1 minute'),
           '[)'
         )
   LIMIT 1;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'bookings_no_overlap: barber % already has a booking overlapping this slot',
      NEW.barber_id
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_no_overlap_trigger ON bookings;
CREATE TRIGGER bookings_no_overlap_trigger
  BEFORE INSERT OR UPDATE OF scheduled_at, duration_minutes, barber_id, status
  ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION assert_bookings_no_overlap();
