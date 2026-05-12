-- ============================================================
-- No-show payment flow — client-initiated resolution model.
--
-- Replaces the legacy auto-charge flow (no_show_charges table + on-mark
-- off_session PaymentIntent) with explicit "unresolved" rows that each
-- client must pay individually. Each booking marked as no-show creates
-- exactly one row in `no_shows`. The client initiates a Stripe Payment
-- Intent for each row; the webhook flips status to 'paid' on success.
--
-- The legacy `no_show_charges` audit table is left in place for history
-- but is no longer written to by the application.
-- ============================================================

-- ── status enum ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE no_show_status AS ENUM (
    'unresolved',
    'pending_payment',
    'paid',
    'failed',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── primary table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS no_shows (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  barber_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_usd                numeric(10,2) NOT NULL CHECK (amount_usd >= 0),
  currency                  text          NOT NULL DEFAULT 'usd',
  reason                    text,
  status                    no_show_status NOT NULL DEFAULT 'unresolved',
  stripe_payment_intent_id  text,
  stripe_transfer_id        text,
  payment_metadata          jsonb         NOT NULL DEFAULT '{}'::jsonb,
  resolved_at               timestamptz,
  created_at                timestamptz   NOT NULL DEFAULT now(),
  updated_at                timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS no_shows_one_per_booking
  ON no_shows (booking_id);

CREATE UNIQUE INDEX IF NOT EXISTS no_shows_payment_intent_unique
  ON no_shows (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS no_shows_client_status_created
  ON no_shows (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS no_shows_barber_status_created
  ON no_shows (barber_id, status, created_at DESC);

-- updated_at touch trigger
CREATE OR REPLACE FUNCTION no_shows_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS no_shows_touch ON no_shows;
CREATE TRIGGER no_shows_touch
  BEFORE UPDATE ON no_shows
  FOR EACH ROW EXECUTE FUNCTION no_shows_touch_updated_at();

-- ── RLS — read-own for both sides; only service role writes ──
ALTER TABLE no_shows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS no_shows_select_client ON no_shows;
CREATE POLICY no_shows_select_client ON no_shows
  FOR SELECT USING (auth.uid() = client_id);

DROP POLICY IF EXISTS no_shows_select_barber ON no_shows;
CREATE POLICY no_shows_select_barber ON no_shows
  FOR SELECT USING (auth.uid() = barber_id);

-- ── unresolved-count helper used to surface the soft-warning flag
--    on barber-facing client APIs. 'failed' is grouped with
--    'unresolved' so a declined attempt still counts as owed.
CREATE OR REPLACE FUNCTION client_unresolved_no_show_count(p_client_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::int
  FROM no_shows
  WHERE client_id = p_client_id
    AND status IN ('unresolved', 'failed');
$$;

-- ── Backfill from existing data ─────────────────────────────
-- Bookings already in 'no_show' status get a row. If the legacy
-- auto-charge flow already settled them (no_show_charged=true), the
-- new row is marked 'paid' with a synthetic resolved_at. Otherwise
-- it lands as 'unresolved' for the client to pay.
INSERT INTO no_shows (booking_id, client_id, barber_id, amount_usd, status, resolved_at, created_at)
SELECT
  b.id,
  b.client_id,
  b.barber_id,
  COALESCE(b.no_show_charge_amount_usd, br.no_show_charge_amount_usd, 0)::numeric(10,2),
  CASE WHEN b.no_show_charged THEN 'paid'::no_show_status
       ELSE 'unresolved'::no_show_status END,
  CASE WHEN b.no_show_charged THEN now() ELSE NULL END,
  COALESCE(b.scheduled_at, now())
FROM bookings b
LEFT JOIN barbers br ON br.user_id = b.barber_id
WHERE b.status = 'no_show'
ON CONFLICT (booking_id) DO NOTHING;
