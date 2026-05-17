-- ============================================================
-- Step 2 of no-show payment hardening: audit table, columns,
-- finality trigger, helper update, realtime publication.
--
-- The enum-value additions live in 20260517000002_no_show_payment_enum.sql
-- because Postgres forbids referencing a freshly-added enum value in
-- the same transaction (SQLSTATE 55P04).
--
-- Legacy values kept for backwards-compat with existing rows:
--   'unresolved'      → still the initial "owed" state
--   'pending_payment' → treat as alias for 'processing' going forward;
--                       no new writes use it. Mapped at the API layer.
--   'failed'          → alias for 'payment_failed'; mapped at API layer.
-- ============================================================

-- ── 2. Audit / observability columns on no_shows ────────────
ALTER TABLE no_shows
  ADD COLUMN IF NOT EXISTS idempotency_key          text,
  ADD COLUMN IF NOT EXISTS payment_attempts         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_known_pi_status     text,
  ADD COLUMN IF NOT EXISTS last_reconciled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_reason      text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_at    timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS no_shows_idempotency_key_unique
  ON no_shows (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── 3. Audit table for every payment lifecycle transition ───
CREATE TABLE IF NOT EXISTS no_show_payment_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  no_show_id               uuid NOT NULL REFERENCES no_shows(id) ON DELETE CASCADE,
  stripe_event_id          text,
  stripe_payment_intent_id text,
  source                   text NOT NULL CHECK (source IN ('webhook','reconcile','client_init','manual')),
  from_status              no_show_status,
  to_status                no_show_status NOT NULL,
  stripe_pi_status         text,
  amount_usd               numeric(10,2),
  failure_reason           text,
  raw_payload              jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS no_show_payment_events_by_no_show
  ON no_show_payment_events (no_show_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS no_show_payment_events_event_id_unique
  ON no_show_payment_events (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

ALTER TABLE no_show_payment_events ENABLE ROW LEVEL SECURITY;
-- Audit table is service-role only; no client/barber policies. Frontends
-- read history via API endpoints that gate on auth.uid().

-- ── 4. Add no_shows to the realtime publication ─────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'no_shows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.no_shows;
  END IF;
END $$;

-- ── 5. Finality guard ───────────────────────────────────────
-- 'paid' is terminal except via an explicit refund (paid → refunded).
-- 'refunded' and 'canceled' are also terminal.
CREATE OR REPLACE FUNCTION no_shows_enforce_finality()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'refunded') THEN
    RAISE EXCEPTION 'Illegal no-show status transition: paid → %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'Illegal no-show status transition: refunded → %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'canceled' AND NEW.status NOT IN ('canceled','unresolved') THEN
    RAISE EXCEPTION 'Illegal no-show status transition: canceled → %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS no_shows_finality ON no_shows;
CREATE TRIGGER no_shows_finality
  BEFORE UPDATE OF status ON no_shows
  FOR EACH ROW EXECUTE FUNCTION no_shows_enforce_finality();

-- ── 6. Update the unresolved-count helper to recognise new failure states.
--      'payment_failed' is the new canonical "owed" failure status;
--      'failed' is kept for legacy rows.
CREATE OR REPLACE FUNCTION client_unresolved_no_show_count(p_client_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int
  FROM no_shows
  WHERE client_id = p_client_id
    AND status IN ('unresolved', 'failed', 'payment_failed', 'reconciliation_required');
$$;
