-- ============================================================
-- Payments module — subscription state, audit tables, analytics.
--
-- Adds the schema needed by the payments module (Stripe subs,
-- saved cards, Connect-funded no-show charges) plus the rewritten
-- get_barber_analytics() function used by GET /bookings/analytics.
--
-- Notes on the existing schema state:
--   - The legacy recurring_arrangements / recurring_occurrences /
--     recurring_pauses tables were dropped in 20260419000001 and
--     replaced with the recurring_bookings + bookings.recurring_booking_id
--     model. The analytics function below pulls completed recurring
--     earnings from `bookings` directly and joins recurring_bookings
--     for contract metadata.
--   - subscription_status is an enum widened in 20260427000001
--     (past_due + cancelled added).
--   - clients.subscription_expires_at already exists and is reused
--     as the "current_period_end" mirror — no second column added.
--   - bookings.no_show_charged + no_show_charge_amount_usd already
--     exist; the new no_show_charges table is the Stripe audit row.
--     Both are kept; the no-show flow writes to both.
-- ============================================================


-- ============================================================
-- 1. clients — subscription state additions
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS subscription_plan text
    CHECK (subscription_plan IN ('monthly', 'yearly')),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end boolean NOT NULL DEFAULT false;


-- ============================================================
-- 2. is_client_subscribed() — entitlement check used by guard + RLS.
--
-- Keyed on the auth.users id (the project's unified FK convention),
-- not clients.id.
-- ============================================================

CREATE OR REPLACE FUNCTION is_client_subscribed(p_client_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clients
    WHERE user_id = p_client_user_id
      AND (
        subscription_status = 'active'
        OR (
          subscription_status = 'cancelled'
          AND subscription_expires_at IS NOT NULL
          AND subscription_expires_at > now()
        )
      )
  );
$$;


-- ============================================================
-- 3. subscription_events — audit table for Stripe subscription events
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_event_id text UNIQUE NOT NULL,
  event_type      text NOT NULL,
  plan            text,
  amount_usd      numeric,
  raw_payload     jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_client_created
  ON subscription_events (client_id, created_at DESC);


-- ============================================================
-- 4. no_show_charges — audit table for Stripe Connect no-show charges
-- ============================================================

CREATE TABLE IF NOT EXISTS no_show_charges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id               uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  barber_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_usd               numeric(10,2) NOT NULL,
  stripe_payment_intent_id text,
  status                   text NOT NULL CHECK (status IN ('succeeded', 'failed', 'requires_action')),
  failure_reason           text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS no_show_charges_one_per_booking
  ON no_show_charges (booking_id);


-- ============================================================
-- 5. RLS — auth.uid() direct comparison (matches project convention)
-- ============================================================

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_show_charges     ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_events_select_own ON subscription_events
  FOR SELECT USING (auth.uid() = client_id);

CREATE POLICY no_show_charges_select_barber ON no_show_charges
  FOR SELECT USING (auth.uid() = barber_id);

CREATE POLICY no_show_charges_select_client ON no_show_charges
  FOR SELECT USING (auth.uid() = client_id);

-- No INSERT/UPDATE/DELETE policies — only the service role writes.


-- ============================================================
-- 6. get_barber_analytics() — rewritten for the recurring_bookings model.
--
-- Standard buckets (regular / after_hours / day_off) come from
-- non-recurring completed bookings only. Recurring earnings come
-- from completed bookings whose recurring_booking_id is set, with
-- contract metadata pulled from recurring_bookings + the first
-- recurring_booking_services entry.
-- ============================================================

CREATE OR REPLACE FUNCTION get_barber_analytics(p_barber_id uuid, p_days_back int)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_window_start timestamptz := now() - (p_days_back || ' days')::interval;
  v_result jsonb;
BEGIN
  WITH std AS (
    SELECT b.booking_type::text AS booking_type,
           COUNT(*)              AS cnt,
           COALESCE(SUM(b.price_usd), 0) AS total
    FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.status = 'completed'
      AND b.scheduled_at >= v_window_start
      AND b.recurring_booking_id IS NULL
    GROUP BY b.booking_type
  ),
  rec_occ AS (
    SELECT b.recurring_booking_id,
           COUNT(*) AS occurrences_completed,
           COALESCE(SUM(b.price_usd), 0) AS total_usd
    FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.status = 'completed'
      AND b.scheduled_at >= v_window_start
      AND b.recurring_booking_id IS NOT NULL
    GROUP BY b.recurring_booking_id
  ),
  rec AS (
    SELECT r.id                         AS arrangement_id,
           COALESCE(c.name, 'Client')   AS client_name,
           COALESCE(svc.name, 'Service') AS service_name,
           r.day_of_week,
           r.slot_time                  AS time_slot,
           r.frequency::text            AS frequency,
           ro.occurrences_completed,
           ro.total_usd
    FROM rec_occ ro
    JOIN recurring_bookings r ON r.id = ro.recurring_booking_id
    LEFT JOIN clients c ON c.user_id = r.client_id
    LEFT JOIN LATERAL (
      SELECT bs.name
      FROM recurring_booking_services rbs
      JOIN barber_services bs ON bs.id = rbs.barber_service_id
      WHERE rbs.recurring_booking_id = r.id
      ORDER BY rbs.sort_order ASC
      LIMIT 1
    ) svc ON true
  )
  SELECT jsonb_build_object(
    'period_days',  p_days_back,
    'window_start', v_window_start,
    'window_end',   now(),
    'standard_bookings', jsonb_build_object(
      'regular',     COALESCE((SELECT jsonb_build_object('count', cnt, 'total_usd', total) FROM std WHERE booking_type = 'regular'),     jsonb_build_object('count', 0, 'total_usd', 0)),
      'after_hours', COALESCE((SELECT jsonb_build_object('count', cnt, 'total_usd', total) FROM std WHERE booking_type = 'after_hours'), jsonb_build_object('count', 0, 'total_usd', 0)),
      'day_off',     COALESCE((SELECT jsonb_build_object('count', cnt, 'total_usd', total) FROM std WHERE booking_type = 'day_off'),     jsonb_build_object('count', 0, 'total_usd', 0))
    ),
    'recurring', jsonb_build_object(
      'total_occurrences_completed', COALESCE((SELECT SUM(occurrences_completed) FROM rec), 0),
      'total_usd',                   COALESCE((SELECT SUM(total_usd)               FROM rec), 0),
      'per_arrangement',             COALESCE((SELECT jsonb_agg(rec) FROM rec), '[]'::jsonb)
    ),
    'total_earnings_usd',
      COALESCE((SELECT SUM(total)     FROM std), 0)
      + COALESCE((SELECT SUM(total_usd) FROM rec), 0)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
