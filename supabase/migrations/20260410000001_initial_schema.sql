-- ============================================================
-- STEP 1 — Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- STEP 2 — Custom Enum Types
-- ============================================================

CREATE TYPE service_type AS ENUM ('haircut', 'beard', 'haircut_beard', 'eyebrows', 'other');
CREATE TYPE booking_type AS ENUM ('regular', 'after_hours', 'day_off');
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
CREATE TYPE sender_role AS ENUM ('barber', 'client');
CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'trialing');
CREATE TYPE cancelled_by_role AS ENUM ('barber', 'client');
CREATE TYPE arrangement_status AS ENUM ('pending_client_approval', 'active', 'paused', 'cancelled');
CREATE TYPE frequency_type AS ENUM ('weekly', 'biweekly');
CREATE TYPE occurrence_status AS ENUM ('scheduled', 'charged', 'completed', 'skipped', 'failed_payment', 'no_show');
CREATE TYPE recurring_frequency_options AS ENUM ('weekly', 'biweekly', 'both');
CREATE TYPE arrangement_creator AS ENUM ('barber', 'client');
CREATE TYPE pause_initiator AS ENUM ('barber', 'client');

-- ============================================================
-- STEP 3 — Core Tables
-- ============================================================

CREATE TABLE barbers (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                        uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name                           text NOT NULL,
  bio                            text,
  profile_photo_url              text,
  average_rating                 numeric(3,2) DEFAULT 0,
  total_reviews                  integer DEFAULT 0,
  stripe_customer_id             text,
  stripe_connect_account_id      text,
  allow_auto_confirm             boolean DEFAULT true NOT NULL,
  advance_notice_minutes         integer DEFAULT 60 NOT NULL,
  no_show_charge_enabled         boolean DEFAULT false NOT NULL,
  no_show_charge_amount_usd      numeric(10,2),
  recurring_enabled              boolean DEFAULT false NOT NULL,
  recurring_frequency_options    recurring_frequency_options DEFAULT 'weekly',
  recurring_price_usd            numeric(10,2),
  recurring_visible_on_profile   boolean DEFAULT false NOT NULL,
  created_at                     timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE barber_schedules (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id                uuid REFERENCES barbers(id) ON DELETE CASCADE NOT NULL,
  day_of_week              integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_working               boolean DEFAULT true NOT NULL,
  regular_start_time       time,
  regular_end_time         time,
  regular_price_usd        numeric(10,2),
  slot_duration_minutes    integer DEFAULT 30 CHECK (slot_duration_minutes IN (30, 45, 60)),
  after_hours_enabled      boolean DEFAULT false NOT NULL,
  after_hours_start        time,
  after_hours_end          time,
  after_hours_price_usd    numeric(10,2),
  day_off_booking_enabled  boolean DEFAULT false NOT NULL,
  day_off_price_usd        numeric(10,2),
  UNIQUE (barber_id, day_of_week)
);

CREATE TABLE clients (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name                      text NOT NULL,
  profile_photo_url         text,
  stripe_customer_id        text,
  stripe_payment_method_id  text,
  subscription_status       subscription_status DEFAULT 'inactive' NOT NULL,
  subscription_expires_at   timestamptz,
  created_at                timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE bookings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id                 uuid REFERENCES barbers(id) ON DELETE RESTRICT NOT NULL,
  client_id                 uuid REFERENCES clients(id) ON DELETE RESTRICT NOT NULL,
  recurring_occurrence_id   uuid, -- FK to recurring_occurrences added after that table is created
  service_type              service_type NOT NULL,
  booking_type              booking_type NOT NULL,
  scheduled_at              timestamptz NOT NULL,
  price_usd                 numeric(10,2) NOT NULL,
  status                    booking_status DEFAULT 'pending' NOT NULL,
  confirmed_at              timestamptz,
  cancelled_at              timestamptz,
  cancelled_by              cancelled_by_role,
  no_show_charged           boolean DEFAULT false NOT NULL,
  no_show_charge_amount_usd numeric(10,2),
  stripe_payment_intent_id  text,
  created_at                timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid REFERENCES bookings(id) ON DELETE RESTRICT NOT NULL UNIQUE,
  barber_id   uuid REFERENCES barbers(id) ON DELETE CASCADE NOT NULL,
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id    uuid REFERENCES barbers(id) ON DELETE CASCADE NOT NULL,
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  sender_role  sender_role NOT NULL,
  body         text NOT NULL,
  read_at      timestamptz,
  created_at   timestamptz DEFAULT now() NOT NULL
);

-- ============================================================
-- STEP 4 — Recurring Tables
-- ============================================================

CREATE TABLE recurring_arrangements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id                uuid REFERENCES barbers(id) ON DELETE RESTRICT NOT NULL,
  client_id                uuid REFERENCES clients(id) ON DELETE RESTRICT NOT NULL,
  created_by               arrangement_creator NOT NULL,
  day_of_week              integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_slot                time NOT NULL,
  service_type             service_type NOT NULL,
  frequency                frequency_type NOT NULL,
  price_usd                numeric(10,2) NOT NULL,
  status                   arrangement_status DEFAULT 'pending_client_approval' NOT NULL,
  auto_charge_enabled      boolean DEFAULT true NOT NULL,
  stripe_payment_method_id text,
  pauses_used_this_year    integer DEFAULT 0 NOT NULL,
  current_pause_id         uuid, -- FK to recurring_pauses added after that table is created
  next_occurrence_at       timestamptz,
  activated_at             timestamptz,
  cancelled_at             timestamptz,
  cancelled_by             cancelled_by_role,
  cancellation_reason      text,
  created_at               timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE recurring_occurrences (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arrangement_id           uuid REFERENCES recurring_arrangements(id) ON DELETE CASCADE NOT NULL,
  barber_id                uuid NOT NULL,
  client_id                uuid NOT NULL,
  scheduled_at             timestamptz NOT NULL,
  price_usd                numeric(10,2) NOT NULL,
  status                   occurrence_status DEFAULT 'scheduled' NOT NULL,
  stripe_payment_intent_id text,
  charged_at               timestamptz,
  charge_failed_at         timestamptz,
  charge_failure_reason    text,
  no_show_charged          boolean DEFAULT false NOT NULL,
  created_at               timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE recurring_pauses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arrangement_id   uuid REFERENCES recurring_arrangements(id) ON DELETE CASCADE NOT NULL,
  initiated_by     pause_initiator NOT NULL,
  pause_start_date date NOT NULL,
  pause_end_date   date NOT NULL,
  weeks_paused     integer NOT NULL,
  reason           text,
  created_at       timestamptz DEFAULT now() NOT NULL
);

-- Deferred FK: recurring_arrangements.current_pause_id → recurring_pauses
ALTER TABLE recurring_arrangements
  ADD CONSTRAINT fk_current_pause
  FOREIGN KEY (current_pause_id) REFERENCES recurring_pauses(id);

-- Deferred FK: bookings.recurring_occurrence_id → recurring_occurrences
ALTER TABLE bookings
  ADD CONSTRAINT fk_recurring_occurrence
  FOREIGN KEY (recurring_occurrence_id) REFERENCES recurring_occurrences(id);

-- ============================================================
-- STEP 5 — Critical Constraints and Indexes
-- ============================================================

-- Prevent double-booking at the DB level: no two active bookings per barber at the same time
CREATE UNIQUE INDEX bookings_no_double_booking
  ON bookings (barber_id, scheduled_at)
  WHERE status NOT IN ('cancelled');

-- Performance indexes
CREATE INDEX idx_bookings_barber_status ON bookings(barber_id, status);
CREATE INDEX idx_bookings_client ON bookings(client_id);
CREATE INDEX idx_bookings_scheduled_at ON bookings(scheduled_at);
CREATE INDEX idx_messages_barber_client ON messages(barber_id, client_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_recurring_occurrences_arrangement ON recurring_occurrences(arrangement_id);
CREATE INDEX idx_recurring_occurrences_scheduled ON recurring_occurrences(scheduled_at);
CREATE INDEX idx_recurring_occurrences_status ON recurring_occurrences(status);

-- ============================================================
-- STEP 6 — Row Level Security
-- ============================================================

ALTER TABLE barbers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_occurrences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_pauses       ENABLE ROW LEVEL SECURITY;

-- ── barbers ──────────────────────────────────────────────────

CREATE POLICY barbers_select_all ON barbers
  FOR SELECT USING (true);

CREATE POLICY barbers_insert_own ON barbers
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY barbers_update_own ON barbers
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY barbers_delete_own ON barbers
  FOR DELETE USING (user_id = auth.uid());

-- ── barber_schedules ─────────────────────────────────────────

CREATE POLICY barber_schedules_select_all ON barber_schedules
  FOR SELECT USING (true);

CREATE POLICY barber_schedules_insert_own ON barber_schedules
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM barbers
      WHERE barbers.id = barber_schedules.barber_id
        AND barbers.user_id = auth.uid()
    )
  );

CREATE POLICY barber_schedules_update_own ON barber_schedules
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM barbers
      WHERE barbers.id = barber_schedules.barber_id
        AND barbers.user_id = auth.uid()
    )
  );

CREATE POLICY barber_schedules_delete_own ON barber_schedules
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM barbers
      WHERE barbers.id = barber_schedules.barber_id
        AND barbers.user_id = auth.uid()
    )
  );

-- ── clients ──────────────────────────────────────────────────

CREATE POLICY clients_select_own ON clients
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bookings b
      JOIN barbers br ON br.id = b.barber_id
      WHERE b.client_id = clients.id
        AND br.user_id = auth.uid()
    )
  );

CREATE POLICY clients_insert_own ON clients
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY clients_update_own ON clients
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY clients_delete_own ON clients
  FOR DELETE USING (user_id = auth.uid());

-- ── bookings ─────────────────────────────────────────────────

CREATE POLICY bookings_select_own ON bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM barbers WHERE barbers.id = bookings.barber_id AND barbers.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM clients WHERE clients.id = bookings.client_id AND clients.user_id = auth.uid()
    )
  );

CREATE POLICY bookings_insert_client ON bookings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients WHERE clients.id = bookings.client_id AND clients.user_id = auth.uid()
    )
  );

-- Barber can update any field; client can only cancel their own booking
CREATE POLICY bookings_update_barber ON bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM barbers WHERE barbers.id = bookings.barber_id AND barbers.user_id = auth.uid()
    )
  );

CREATE POLICY bookings_update_client_cancel ON bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM clients WHERE clients.id = bookings.client_id AND clients.user_id = auth.uid()
    )
  )
  WITH CHECK (status = 'cancelled');

-- ── reviews ──────────────────────────────────────────────────

CREATE POLICY reviews_select_all ON reviews
  FOR SELECT USING (true);

CREATE POLICY reviews_insert_client ON reviews
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN clients c ON c.id = b.client_id
      WHERE b.id = reviews.booking_id
        AND c.user_id = auth.uid()
        AND b.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM reviews r2 WHERE r2.booking_id = b.id
        )
    )
  );

-- No UPDATE or DELETE policies — reviews are immutable

-- ── messages ─────────────────────────────────────────────────

CREATE POLICY messages_select_own ON messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = messages.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = messages.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY messages_insert_own ON messages
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = messages.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = messages.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY messages_update_own ON messages
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = messages.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = messages.client_id AND clients.user_id = auth.uid())
  );

-- ── recurring_arrangements ───────────────────────────────────

CREATE POLICY recurring_arrangements_select ON recurring_arrangements
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = recurring_arrangements.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = recurring_arrangements.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY recurring_arrangements_insert ON recurring_arrangements
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = recurring_arrangements.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = recurring_arrangements.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY recurring_arrangements_update ON recurring_arrangements
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = recurring_arrangements.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = recurring_arrangements.client_id AND clients.user_id = auth.uid())
  );

-- ── recurring_occurrences ────────────────────────────────────

CREATE POLICY recurring_occurrences_select ON recurring_occurrences
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = recurring_occurrences.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = recurring_occurrences.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY recurring_occurrences_insert ON recurring_occurrences
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = recurring_occurrences.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = recurring_occurrences.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY recurring_occurrences_update ON recurring_occurrences
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM barbers WHERE barbers.id = recurring_occurrences.barber_id AND barbers.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM clients WHERE clients.id = recurring_occurrences.client_id AND clients.user_id = auth.uid())
  );

-- ── recurring_pauses ─────────────────────────────────────────

CREATE POLICY recurring_pauses_select ON recurring_pauses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      JOIN barbers b ON b.id = ra.barber_id
      WHERE ra.id = recurring_pauses.arrangement_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      JOIN clients c ON c.id = ra.client_id
      WHERE ra.id = recurring_pauses.arrangement_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY recurring_pauses_insert ON recurring_pauses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      JOIN barbers b ON b.id = ra.barber_id
      WHERE ra.id = recurring_pauses.arrangement_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      JOIN clients c ON c.id = ra.client_id
      WHERE ra.id = recurring_pauses.arrangement_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY recurring_pauses_update ON recurring_pauses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      JOIN barbers b ON b.id = ra.barber_id
      WHERE ra.id = recurring_pauses.arrangement_id AND b.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      JOIN clients c ON c.id = ra.client_id
      WHERE ra.id = recurring_pauses.arrangement_id AND c.user_id = auth.uid()
    )
  );

-- ============================================================
-- STEP 7 — Database Function for Average Rating
-- ============================================================

CREATE OR REPLACE FUNCTION update_barber_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE barbers
  SET
    average_rating = (SELECT AVG(rating)   FROM reviews WHERE barber_id = NEW.barber_id),
    total_reviews  = (SELECT COUNT(*)      FROM reviews WHERE barber_id = NEW.barber_id)
  WHERE id = NEW.barber_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_barber_rating
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_barber_rating();
