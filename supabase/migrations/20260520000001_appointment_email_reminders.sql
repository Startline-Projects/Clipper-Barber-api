-- ============================================================
-- Appointment email reminders (Resend).
--
-- Two independent per-barber reminder groups (CLIENT / SELF), each with a
-- single reminder option (hours_before / minutes_before / morning_of).
-- A hybrid scheduler precomputes one `scheduled_reminders` row per booking
-- per recipient (event-driven on booking + settings changes) and a
-- 1-minute cron dispatches due rows via Resend.
--
-- Convention notes:
--   * barber_id / recipient ids reference auth.users(id) directly — bookings
--     store the auth user id (see 20260413000003_unify_auth_user_id), not the
--     barbers/clients row PK.
--   * All timestamps are UTC (timestamptz); barber-local math (the 9 AM
--     anchor) is done in the app using barbers.timezone.
-- ============================================================

-- ── enums ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE reminder_target AS ENUM ('client', 'self');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reminder_type AS ENUM ('hours_before', 'minutes_before', 'morning_of');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scheduled_reminder_recipient AS ENUM ('client', 'barber');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scheduled_reminder_status AS ENUM (
    'pending',
    'sending',
    'sent',
    'failed',
    'cancelled',
    'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── barber_reminder_settings ────────────────────────────────
-- One row per (barber, target). Both groups are independent: a barber may
-- enable client reminders, self reminders, both, or neither.
CREATE TABLE IF NOT EXISTS barber_reminder_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target          reminder_target NOT NULL,
  enabled         boolean NOT NULL DEFAULT false,
  reminder_type   reminder_type NOT NULL DEFAULT 'hours_before',
  offset_hours    integer,
  offset_minutes  integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barber_reminder_settings_unique UNIQUE (barber_id, target),
  -- The offset relevant to the chosen reminder_type must be present and
  -- positive. morning_of needs neither offset.
  CONSTRAINT barber_reminder_settings_offset_valid CHECK (
    (reminder_type = 'hours_before'   AND offset_hours   IS NOT NULL AND offset_hours   > 0)
    OR (reminder_type = 'minutes_before' AND offset_minutes IS NOT NULL AND offset_minutes > 0)
    OR (reminder_type = 'morning_of')
  )
);

DROP TRIGGER IF EXISTS barber_reminder_settings_updated_at ON barber_reminder_settings;
CREATE TRIGGER barber_reminder_settings_updated_at
  BEFORE UPDATE ON barber_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── scheduled_reminders ─────────────────────────────────────
-- One row per (booking, recipient_type) — the unique constraint guarantees
-- idempotency so repeated precompute upserts never create duplicates.
CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  recipient_type     scheduled_reminder_recipient NOT NULL,
  recipient_email    text NOT NULL,
  send_at            timestamptz NOT NULL,
  status             scheduled_reminder_status NOT NULL DEFAULT 'pending',
  attempts           integer NOT NULL DEFAULT 0,
  resend_message_id  text,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_reminders_unique UNIQUE (booking_id, recipient_type)
);

-- Dispatch query hot path: PENDING rows ordered by due time.
CREATE INDEX IF NOT EXISTS scheduled_reminders_status_send_at
  ON scheduled_reminders (status, send_at);

DROP TRIGGER IF EXISTS scheduled_reminders_updated_at ON scheduled_reminders;
CREATE TRIGGER scheduled_reminders_updated_at
  BEFORE UPDATE ON scheduled_reminders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS — only the service role writes/reads; recipients never query
--    these directly (delivery is server-side). ──────────────
ALTER TABLE barber_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barber_reminder_settings_select_own ON barber_reminder_settings;
CREATE POLICY barber_reminder_settings_select_own ON barber_reminder_settings
  FOR SELECT USING (auth.uid() = barber_id);

-- ── claim_due_reminders ─────────────────────────────────────
-- Atomically claim a batch of due reminders for one cron tick. Uses
-- FOR UPDATE SKIP LOCKED so concurrent cron runs never grab the same row,
-- flips PENDING -> SENDING and bumps attempts in the same statement, and
-- reclaims rows stuck in SENDING (a crashed previous run) once they go
-- stale. Returns the claimed rows for the app to send.
--
-- The compute step is responsible for the "don't schedule late reminders"
-- grace rule (it marks past-due rows SKIPPED at insert). Dispatch therefore
-- claims every PENDING row that is due, and the app does a final
-- appointment-already-passed guard before actually sending.
CREATE OR REPLACE FUNCTION claim_due_reminders(
  p_now            timestamptz,
  p_stale_minutes  integer,
  p_limit          integer
)
RETURNS TABLE (
  id              uuid,
  booking_id      uuid,
  recipient_type  scheduled_reminder_recipient,
  recipient_email text,
  send_at         timestamptz,
  attempts        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT sr.id
    FROM scheduled_reminders sr
    WHERE (
      (sr.status = 'pending' AND sr.send_at <= p_now)
      OR (sr.status = 'sending' AND sr.updated_at < p_now - make_interval(mins => p_stale_minutes))
    )
    ORDER BY sr.send_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE scheduled_reminders sr
  SET status = 'sending', attempts = sr.attempts + 1
  FROM due
  WHERE sr.id = due.id
  RETURNING sr.id, sr.booking_id, sr.recipient_type, sr.recipient_email, sr.send_at, sr.attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_due_reminders(timestamptz, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_reminders(timestamptz, integer, integer)
  TO service_role;

-- Force PostgREST to pick up the new function + tables immediately.
NOTIFY pgrst, 'reload schema';
