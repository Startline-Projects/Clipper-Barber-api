-- ============================================================
-- Unify the downstream `barber_id` / `client_id` columns across
-- the schema so they all reference `auth.users(id)` directly
-- (same pattern already used by `barber_services`).
--
-- Effect:
--   * RLS becomes a direct `auth.uid() = barber_id` check
--     instead of a join through barbers / clients
--   * Services stop translating `user_id -> barbers.id` on every
--     request — the JWT `sub` is the FK value
--   * `barbers.id` / `clients.id` remain as internal profile PKs
--     but are no longer referenced by any other table
-- ============================================================


-- ============================================================
-- 1.  bookings
-- ============================================================

-- Drop RLS policies that join through barbers / clients
DROP POLICY IF EXISTS bookings_select_own           ON bookings;
DROP POLICY IF EXISTS bookings_insert_client        ON bookings;
DROP POLICY IF EXISTS bookings_update_barber        ON bookings;
DROP POLICY IF EXISTS bookings_update_client_cancel ON bookings;

-- Backfill: translate existing barbers.id / clients.id refs into
-- their corresponding auth.users.id values.
UPDATE bookings b
SET barber_id = br.user_id
FROM barbers br
WHERE b.barber_id = br.id;

UPDATE bookings b
SET client_id = c.user_id
FROM clients c
WHERE b.client_id = c.id;

-- Swap the FK constraints
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_barber_id_fkey;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_client_id_fkey;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_barber_id_fkey
  FOREIGN KEY (barber_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- New RLS — direct JWT-sub comparison
CREATE POLICY bookings_select_own ON bookings
  FOR SELECT USING (
    auth.uid() = barber_id OR auth.uid() = client_id
  );

CREATE POLICY bookings_insert_client ON bookings
  FOR INSERT WITH CHECK (auth.uid() = client_id);

CREATE POLICY bookings_update_barber ON bookings
  FOR UPDATE USING (auth.uid() = barber_id);

CREATE POLICY bookings_update_client_cancel ON bookings
  FOR UPDATE USING (auth.uid() = client_id)
  WITH CHECK (status = 'cancelled');


-- ============================================================
-- 2.  barber_schedules
-- ============================================================

DROP POLICY IF EXISTS barber_schedules_select_all  ON barber_schedules;
DROP POLICY IF EXISTS barber_schedules_insert_own  ON barber_schedules;
DROP POLICY IF EXISTS barber_schedules_update_own  ON barber_schedules;
DROP POLICY IF EXISTS barber_schedules_delete_own  ON barber_schedules;

UPDATE barber_schedules bs
SET barber_id = br.user_id
FROM barbers br
WHERE bs.barber_id = br.id;

ALTER TABLE barber_schedules DROP CONSTRAINT IF EXISTS barber_schedules_barber_id_fkey;
ALTER TABLE barber_schedules
  ADD CONSTRAINT barber_schedules_barber_id_fkey
  FOREIGN KEY (barber_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE POLICY barber_schedules_select_all ON barber_schedules
  FOR SELECT USING (true);

CREATE POLICY barber_schedules_insert_own ON barber_schedules
  FOR INSERT WITH CHECK (auth.uid() = barber_id);

CREATE POLICY barber_schedules_update_own ON barber_schedules
  FOR UPDATE USING (auth.uid() = barber_id);

CREATE POLICY barber_schedules_delete_own ON barber_schedules
  FOR DELETE USING (auth.uid() = barber_id);


-- ============================================================
-- 3.  Keep seed-trigger in sync with new FK
--     (trigger fires on barber profile insert; now stores the
--     auth user_id as barber_schedules.barber_id)
-- ============================================================

CREATE OR REPLACE FUNCTION seed_barber_schedule()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO barber_schedules (barber_id, day_of_week, is_working)
  SELECT NEW.user_id, d.day, false
  FROM generate_series(0, 6) AS d(day);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 4.  reviews
-- ============================================================

DROP POLICY IF EXISTS reviews_select_all     ON reviews;
DROP POLICY IF EXISTS reviews_insert_client  ON reviews;

UPDATE reviews r
SET barber_id = br.user_id
FROM barbers br
WHERE r.barber_id = br.id;

UPDATE reviews r
SET client_id = c.user_id
FROM clients c
WHERE r.client_id = c.id;

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_barber_id_fkey;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_client_id_fkey;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_barber_id_fkey
  FOREIGN KEY (barber_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE POLICY reviews_select_all ON reviews
  FOR SELECT USING (true);

CREATE POLICY reviews_insert_client ON reviews
  FOR INSERT WITH CHECK (
    auth.uid() = client_id
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = reviews.booking_id
        AND b.client_id = auth.uid()
        AND b.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM reviews r2 WHERE r2.booking_id = b.id)
    )
  );


-- ============================================================
-- 5.  messages
-- ============================================================

DROP POLICY IF EXISTS messages_select_own ON messages;
DROP POLICY IF EXISTS messages_insert_own ON messages;
DROP POLICY IF EXISTS messages_update_own ON messages;

UPDATE messages m
SET barber_id = br.user_id
FROM barbers br
WHERE m.barber_id = br.id;

UPDATE messages m
SET client_id = c.user_id
FROM clients c
WHERE m.client_id = c.id;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_barber_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_client_id_fkey;

ALTER TABLE messages
  ADD CONSTRAINT messages_barber_id_fkey
  FOREIGN KEY (barber_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE messages
  ADD CONSTRAINT messages_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE POLICY messages_select_own ON messages
  FOR SELECT USING (auth.uid() = barber_id OR auth.uid() = client_id);

CREATE POLICY messages_insert_own ON messages
  FOR INSERT WITH CHECK (auth.uid() = barber_id OR auth.uid() = client_id);

CREATE POLICY messages_update_own ON messages
  FOR UPDATE USING (auth.uid() = barber_id OR auth.uid() = client_id);


-- ============================================================
-- 6.  recurring_arrangements
-- ============================================================

DROP POLICY IF EXISTS recurring_arrangements_select ON recurring_arrangements;
DROP POLICY IF EXISTS recurring_arrangements_insert ON recurring_arrangements;
DROP POLICY IF EXISTS recurring_arrangements_update ON recurring_arrangements;

UPDATE recurring_arrangements ra
SET barber_id = br.user_id
FROM barbers br
WHERE ra.barber_id = br.id;

UPDATE recurring_arrangements ra
SET client_id = c.user_id
FROM clients c
WHERE ra.client_id = c.id;

ALTER TABLE recurring_arrangements DROP CONSTRAINT IF EXISTS recurring_arrangements_barber_id_fkey;
ALTER TABLE recurring_arrangements DROP CONSTRAINT IF EXISTS recurring_arrangements_client_id_fkey;

ALTER TABLE recurring_arrangements
  ADD CONSTRAINT recurring_arrangements_barber_id_fkey
  FOREIGN KEY (barber_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE recurring_arrangements
  ADD CONSTRAINT recurring_arrangements_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE POLICY recurring_arrangements_select ON recurring_arrangements
  FOR SELECT USING (auth.uid() = barber_id OR auth.uid() = client_id);

CREATE POLICY recurring_arrangements_insert ON recurring_arrangements
  FOR INSERT WITH CHECK (auth.uid() = barber_id OR auth.uid() = client_id);

CREATE POLICY recurring_arrangements_update ON recurring_arrangements
  FOR UPDATE USING (auth.uid() = barber_id OR auth.uid() = client_id);


-- ============================================================
-- 7.  recurring_occurrences
--     (barber_id / client_id were raw uuids with no FK — add one now)
-- ============================================================

DROP POLICY IF EXISTS recurring_occurrences_select ON recurring_occurrences;
DROP POLICY IF EXISTS recurring_occurrences_insert ON recurring_occurrences;
DROP POLICY IF EXISTS recurring_occurrences_update ON recurring_occurrences;

UPDATE recurring_occurrences ro
SET barber_id = br.user_id
FROM barbers br
WHERE ro.barber_id = br.id;

UPDATE recurring_occurrences ro
SET client_id = c.user_id
FROM clients c
WHERE ro.client_id = c.id;

ALTER TABLE recurring_occurrences
  ADD CONSTRAINT recurring_occurrences_barber_id_fkey
  FOREIGN KEY (barber_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE recurring_occurrences
  ADD CONSTRAINT recurring_occurrences_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE POLICY recurring_occurrences_select ON recurring_occurrences
  FOR SELECT USING (auth.uid() = barber_id OR auth.uid() = client_id);

CREATE POLICY recurring_occurrences_insert ON recurring_occurrences
  FOR INSERT WITH CHECK (auth.uid() = barber_id OR auth.uid() = client_id);

CREATE POLICY recurring_occurrences_update ON recurring_occurrences
  FOR UPDATE USING (auth.uid() = barber_id OR auth.uid() = client_id);


-- ============================================================
-- 8.  recurring_pauses — unchanged FK (arrangements), but its RLS
--     policies join through barbers / clients. Rewrite them so they
--     use the arrangements' now-auth-uid barber_id / client_id.
-- ============================================================

DROP POLICY IF EXISTS recurring_pauses_select ON recurring_pauses;
DROP POLICY IF EXISTS recurring_pauses_insert ON recurring_pauses;
DROP POLICY IF EXISTS recurring_pauses_update ON recurring_pauses;

CREATE POLICY recurring_pauses_select ON recurring_pauses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      WHERE ra.id = recurring_pauses.arrangement_id
        AND (auth.uid() = ra.barber_id OR auth.uid() = ra.client_id)
    )
  );

CREATE POLICY recurring_pauses_insert ON recurring_pauses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      WHERE ra.id = recurring_pauses.arrangement_id
        AND (auth.uid() = ra.barber_id OR auth.uid() = ra.client_id)
    )
  );

CREATE POLICY recurring_pauses_update ON recurring_pauses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM recurring_arrangements ra
      WHERE ra.id = recurring_pauses.arrangement_id
        AND (auth.uid() = ra.barber_id OR auth.uid() = ra.client_id)
    )
  );


-- ============================================================
-- 9.  clients — select policy used to allow barber read via bookings
--     join. Rewrite it to compare directly against auth.users.id.
-- ============================================================

DROP POLICY IF EXISTS clients_select_own ON clients;

CREATE POLICY clients_select_own ON clients
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.client_id = clients.user_id
        AND b.barber_id = auth.uid()
    )
  );


-- ============================================================
-- 10. Keep the average-rating trigger consistent — barber_id on
--     reviews is now an auth user id, so the UPDATE target (barbers)
--     needs to filter on barbers.user_id instead of barbers.id.
-- ============================================================

CREATE OR REPLACE FUNCTION update_barber_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE barbers
  SET
    average_rating = (SELECT AVG(rating)  FROM reviews WHERE barber_id = NEW.barber_id),
    total_reviews  = (SELECT COUNT(*)     FROM reviews WHERE barber_id = NEW.barber_id)
  WHERE user_id = NEW.barber_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
