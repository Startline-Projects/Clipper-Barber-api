-- ============================================================
-- Migration: Auth profile fields for barbers and clients
-- Adds onboarding columns to barbers and username to clients
-- to match the auth registration flow (step1 / step2 / step3
-- for barbers, and single-step registration for clients).
-- ============================================================

-- ── barbers ──────────────────────────────────────────────────

-- Step-1 stores full_name; rename the existing `name` column
ALTER TABLE barbers RENAME COLUMN name TO full_name;

-- Onboarding progress (set during each registration step)
ALTER TABLE barbers
  ADD COLUMN onboarding_step     integer NOT NULL DEFAULT 1,
  ADD COLUMN onboarding_complete boolean NOT NULL DEFAULT false;

-- Step-2: shop location & contact
ALTER TABLE barbers
  ADD COLUMN shop_name      text,
  ADD COLUMN phone          text,
  ADD COLUMN street_address text,
  ADD COLUMN city           text,
  ADD COLUMN state          text,
  ADD COLUMN zip_code       text,
  ADD COLUMN latitude       numeric(9, 6),
  ADD COLUMN longitude      numeric(9, 6);

-- Step-3: optional social / branding
ALTER TABLE barbers
  ADD COLUMN instagram_handle text;

-- Index: speeds up the "redirect to next step" look-up on login
CREATE INDEX idx_barbers_onboarding ON barbers (user_id, onboarding_complete);

-- ── clients ──────────────────────────────────────────────────

-- Clients register with a unique username (checked before insert)
ALTER TABLE clients
  ADD COLUMN username text UNIQUE;

-- Index: uniqueness check in registerClient is a point look-up
CREATE INDEX idx_clients_username ON clients (username);
