-- Migration: change barber_services.barber_id to reference auth.users(id)
-- instead of barbers(id), so the URL param (auth UUID) maps directly to
-- the FK without needing a barbers row lookup.

-- ============================================================
-- 1. Drop old FK constraint
-- ============================================================
ALTER TABLE barber_services
  DROP CONSTRAINT barber_services_barber_id_fkey;

-- ============================================================
-- 2. Add new FK pointing at auth.users
-- ============================================================
ALTER TABLE barber_services
  ADD CONSTRAINT barber_services_barber_id_fkey
    FOREIGN KEY (barber_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;

-- ============================================================
-- 3. Drop old RLS policies (they joined through barbers table)
-- ============================================================
DROP POLICY IF EXISTS barber_services_insert_own ON barber_services;
DROP POLICY IF EXISTS barber_services_update_own ON barber_services;
DROP POLICY IF EXISTS barber_services_delete_own ON barber_services;

-- ============================================================
-- 4. Re-create policies using auth.uid() = barber_id directly
--    (no barbers join needed — barber_id IS the auth UUID now)
-- ============================================================
CREATE POLICY barber_services_insert_own ON barber_services
  FOR INSERT WITH CHECK (auth.uid() = barber_id);

CREATE POLICY barber_services_update_own ON barber_services
  FOR UPDATE USING (auth.uid() = barber_id);

CREATE POLICY barber_services_delete_own ON barber_services
  FOR DELETE USING (auth.uid() = barber_id);
