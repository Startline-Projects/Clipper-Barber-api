-- ============================================================
-- Notifications (Phase 9)
--
-- Adds four pieces of schema for Expo-based push notifications:
--   1. device_tokens              — one row per (user, platform, token)
--   2. notifications              — persisted notification inbox
--   3. barber_notification_settings — per-category opt-out toggles
--   4. recurring_bookings.expiry_notified — idempotency flag for the
--      daily "recurring about to expire" cron
--
-- All FKs reference auth.users(id) directly — same pattern used
-- across the rest of the schema (see 20260413000003_unify_auth_user_id).
-- ============================================================


-- ============================================================
-- STEP 1 — Enums
-- ============================================================

CREATE TYPE device_platform AS ENUM ('ios', 'android');

CREATE TYPE recipient_role AS ENUM ('client', 'barber');

CREATE TYPE notification_type AS ENUM (
  -- Barber-facing
  'new_booking',
  'cancelled_booking',
  'new_recurring_request',
  'recurring_cancelled',
  'recurring_paused',
  -- Client-facing
  'booking_confirmed',
  'booking_cancelled',
  'recurring_accepted',
  'recurring_refused',
  'recurring_expiring'
);


-- ============================================================
-- STEP 2 — device_tokens
--
-- One device token row per (user, platform). Re-registering the
-- same (user, platform) upserts the token and bumps updated_at.
-- A single user may have multiple rows (phone + tablet).
-- ============================================================

CREATE TABLE device_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_type   recipient_role NOT NULL,
  token       text NOT NULL,
  platform    device_platform NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Upsert target: one row per (user, platform)
CREATE UNIQUE INDEX idx_device_tokens_user_platform
  ON device_tokens (user_id, platform);

-- Fast lookup by token (used on delete + stale-token cleanup)
CREATE UNIQUE INDEX idx_device_tokens_token
  ON device_tokens (token);

CREATE INDEX idx_device_tokens_user
  ON device_tokens (user_id);

DROP TRIGGER IF EXISTS device_tokens_updated_at ON device_tokens;
CREATE TRIGGER device_tokens_updated_at
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_tokens_select_own ON device_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY device_tokens_insert_own ON device_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY device_tokens_update_own ON device_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY device_tokens_delete_own ON device_tokens
  FOR DELETE USING (auth.uid() = user_id);


-- ============================================================
-- STEP 3 — notifications
--
-- Persisted inbox. Writes happen via service-role (backend fan-out),
-- reads happen via the user's session — RLS enforces ownership on
-- the read path so a user only ever sees their own notifications.
--
-- booking_id / recurring_booking_id are optional because notification
-- triggers (e.g. recurring_expiring) may reference a subscription
-- instead of a single booking row. `data` carries the free-form
-- payload for deep-linking.
-- ============================================================

CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_type       recipient_role NOT NULL,
  sender_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  booking_id           uuid REFERENCES bookings(id) ON DELETE SET NULL,
  recurring_booking_id uuid REFERENCES recurring_bookings(id) ON DELETE SET NULL,
  type                 notification_type NOT NULL,
  title                text NOT NULL,
  body                 text NOT NULL,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read              boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Feed: newest first, per recipient
CREATE INDEX idx_notifications_recipient_created
  ON notifications (recipient_id, created_at DESC);

-- Unread-count query
CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_id)
  WHERE is_read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select_own ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

-- Clients/barbers only update their own rows (read receipts)
CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

-- No INSERT/DELETE policies: the backend writes with the service-role
-- key, which bypasses RLS. Users cannot create/delete notifications.


-- ============================================================
-- STEP 4 — barber_notification_settings
--
-- Per-barber category toggles. Default = both categories enabled.
-- Seeded for every existing barber; a trigger keeps it in sync as
-- new barbers onboard.
-- ============================================================

CREATE TABLE barber_notification_settings (
  barber_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  normal_bookings    boolean NOT NULL DEFAULT true,
  recurring_bookings boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS barber_notification_settings_updated_at
  ON barber_notification_settings;
CREATE TRIGGER barber_notification_settings_updated_at
  BEFORE UPDATE ON barber_notification_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE barber_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY barber_notification_settings_select_own
  ON barber_notification_settings
  FOR SELECT USING (auth.uid() = barber_id);

CREATE POLICY barber_notification_settings_update_own
  ON barber_notification_settings
  FOR UPDATE USING (auth.uid() = barber_id);

CREATE POLICY barber_notification_settings_insert_own
  ON barber_notification_settings
  FOR INSERT WITH CHECK (auth.uid() = barber_id);

-- Seed defaults for every existing barber
INSERT INTO barber_notification_settings (barber_id)
SELECT user_id FROM barbers
ON CONFLICT (barber_id) DO NOTHING;

-- Auto-seed on barber profile insert
CREATE OR REPLACE FUNCTION seed_barber_notification_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO barber_notification_settings (barber_id)
  VALUES (NEW.user_id)
  ON CONFLICT (barber_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_seed_barber_notification_settings ON barbers;
CREATE TRIGGER trigger_seed_barber_notification_settings
  AFTER INSERT ON barbers
  FOR EACH ROW EXECUTE FUNCTION seed_barber_notification_settings();


-- ============================================================
-- STEP 5 — recurring_bookings.expiry_notified
--
-- Idempotency flag so the daily "about to expire" cron only
-- fires once per subscription.
-- ============================================================

ALTER TABLE recurring_bookings
  ADD COLUMN IF NOT EXISTS expiry_notified boolean NOT NULL DEFAULT false;
