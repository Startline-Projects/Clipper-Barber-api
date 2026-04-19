-- ============================================================
-- Reviews system: add updated_at column + trigger + indexes.
--
-- The reviews table already exists (20260410000001_initial_schema.sql)
-- and its FKs were moved to auth.users(id) in 20260413000003.
-- This migration rounds it out for the review feature:
--   * updated_at column with trigger
--   * idx_reviews_barber_id  (barber_id, created_at DESC)
--   * idx_reviews_client_id  (client_id)
-- booking_id uniqueness is already enforced by UNIQUE constraint.
-- ============================================================

-- 1. updated_at column
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Shared trigger function (idempotent)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger on reviews
DROP TRIGGER IF EXISTS reviews_updated_at ON reviews;
CREATE TRIGGER reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_reviews_barber_id
  ON reviews (barber_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_client_id
  ON reviews (client_id);
