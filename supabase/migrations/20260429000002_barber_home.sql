-- ============================================================
-- Barber Home / Dashboard
--
-- One round-trip RPC powering GET /barber/home. Returns the four
-- blocks the home screen needs:
--
--   1. today.*           — counts + earnings-so-far for the calendar
--                          day in the resolved IANA timezone
--   2. pendingApproval   — bookings still in `pending` status that
--                          either fall on today OR have any
--                          scheduled_at (the spec accepted "today
--                          OR will be held today" — implemented as
--                          status='pending' AND scheduled_at on
--                          today's calendar in the barber's tz)
--   3. schedule          — next 4 confirmed bookings starting >= now
--                          on today's calendar
--
-- Earnings definition (matches get_barber_analytics):
--   sum(price_usd) over bookings whose status='completed' AND
--   scheduled_at falls within today (resolved tz). There is no
--   payment_status column on bookings — completed implies earned.
--
-- Today boundary is computed as
--   [start_of_day_local_in_tz, start_of_day_local_in_tz + 1 day)
-- so the half-open interval crosses DST transitions safely.
--
-- A composite index on (barber_id, status, scheduled_at) is added
-- so all four sub-queries are index-only seeks scoped to one barber.
-- ============================================================


-- ============================================================
-- Composite index — one barber's bookings filtered by status and
-- ordered by scheduled_at. Powers the home-screen sub-queries and
-- general (status, scheduled_at) range scans.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_bookings_barber_status_scheduled
  ON bookings (barber_id, status, scheduled_at);


-- ============================================================
-- get_barber_home(barber_id, tz, now)
--
-- Splitting `now` out as a parameter (rather than calling now()
-- inline) keeps the function deterministic per call and makes
-- timezone-arithmetic testable from the application layer.
-- ============================================================

CREATE OR REPLACE FUNCTION get_barber_home(
  p_barber_id uuid,
  p_tz        text,
  p_now       timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local_today date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_result      jsonb;
BEGIN
  -- Resolve "today" as the calendar date in the barber's tz, then
  -- convert each midnight back to UTC. AT TIME ZONE handles DST
  -- transitions correctly (the spring-forward / fall-back day still
  -- gets exactly one [start, end) range covering its local 00:00).
  v_local_today := (p_now AT TIME ZONE p_tz)::date;
  v_day_start   := (v_local_today::timestamp)            AT TIME ZONE p_tz;
  v_day_end     := ((v_local_today + 1)::timestamp)      AT TIME ZONE p_tz;

  WITH today_bookings AS (
    SELECT b.id,
           b.status,
           b.scheduled_at,
           b.duration_minutes,
           b.price_usd
    FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.scheduled_at >= v_day_start
      AND b.scheduled_at <  v_day_end
  ),
  today_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE status <> 'cancelled')                                            AS total_appointments,
      COUNT(*) FILTER (WHERE status = 'completed')                                              AS completed_count,
      COUNT(*) FILTER (
        WHERE status IN ('confirmed', 'pending')
          AND scheduled_at + (COALESCE(duration_minutes, 0) * interval '1 minute') > p_now
      )                                                                                         AS remaining_count,
      COALESCE(SUM(price_usd) FILTER (WHERE status = 'completed'), 0)                           AS earnings_so_far_usd
    FROM today_bookings
  ),

  -- ── pendingApproval ──────────────────────────────────────
  -- Pending bookings whose scheduled_at is today (will be held today
  -- OR has already passed today but still awaits approval).
  pending_all AS (
    SELECT b.id,
           b.scheduled_at,
           b.duration_minutes,
           b.price_usd,
           b.status,
           b.created_at,
           b.client_id,
           b.barber_service_id
    FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.status = 'pending'
      AND b.scheduled_at >= v_day_start
      AND b.scheduled_at <  v_day_end
  ),
  pending_total AS (
    SELECT COUNT(*) AS total_count FROM pending_all
  ),
  pending_top AS (
    SELECT *
    FROM pending_all
    ORDER BY created_at ASC, id ASC
    LIMIT 3
  ),
  pending_items AS (
    SELECT jsonb_build_object(
             'bookingId',   p.id,
             'client', jsonb_build_object(
               'id',              p.client_id,
               'fullName',        COALESCE(c.name, 'Unknown'),
               'profilePhotoUrl', c.profile_photo_url
             ),
             'service', CASE
               WHEN p.barber_service_id IS NULL THEN NULL
               ELSE jsonb_build_object(
                 'id',   p.barber_service_id,
                 'name', COALESCE(svc.name, 'Service')
               )
             END,
             'scheduledAt',  p.scheduled_at,
             'priceUsd',     p.price_usd,
             'status',       p.status,
             'requestedAt',  p.created_at
           ) AS item,
           p.created_at,
           p.id
    FROM pending_top p
    LEFT JOIN clients c          ON c.user_id = p.client_id
    LEFT JOIN barber_services svc ON svc.id  = p.barber_service_id
  ),

  -- ── schedule ────────────────────────────────────────────
  -- Confirmed bookings on today's calendar starting after now.
  schedule_all AS (
    SELECT b.id,
           b.scheduled_at,
           b.duration_minutes,
           b.price_usd,
           b.status,
           b.client_id,
           b.barber_service_id
    FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.status = 'confirmed'
      AND b.scheduled_at >= GREATEST(p_now, v_day_start)
      AND b.scheduled_at <  v_day_end
  ),
  schedule_total AS (
    SELECT COUNT(*) AS total_upcoming_today FROM schedule_all
  ),
  schedule_top AS (
    SELECT *
    FROM schedule_all
    ORDER BY scheduled_at ASC, id ASC
    LIMIT 4
  ),
  schedule_items AS (
    SELECT jsonb_build_object(
             'bookingId',   s.id,
             'client', jsonb_build_object(
               'id',              s.client_id,
               'fullName',        COALESCE(c.name, 'Unknown'),
               'profilePhotoUrl', c.profile_photo_url
             ),
             'service', CASE
               WHEN s.barber_service_id IS NULL THEN NULL
               ELSE jsonb_build_object(
                 'id',               s.barber_service_id,
                 'name',             COALESCE(svc.name, 'Service'),
                 'durationMinutes',  COALESCE(svc.duration_minutes, s.duration_minutes, 0)
               )
             END,
             'scheduledAt',       s.scheduled_at,
             'endAt',             s.scheduled_at + (COALESCE(s.duration_minutes, 0) * interval '1 minute'),
             'minutesUntilStart', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (s.scheduled_at - p_now)) / 60))::int,
             'priceUsd',          s.price_usd,
             'status',            s.status
           ) AS item,
           s.scheduled_at,
           s.id
    FROM schedule_top s
    LEFT JOIN clients c          ON c.user_id = s.client_id
    LEFT JOIN barber_services svc ON svc.id  = s.barber_service_id
  )

  SELECT jsonb_build_object(
    'today', jsonb_build_object(
      'date',              to_char(v_local_today, 'YYYY-MM-DD'),
      'timezone',          p_tz,
      'totalAppointments', (SELECT total_appointments     FROM today_counts),
      'completedCount',    (SELECT completed_count        FROM today_counts),
      'remainingCount',    (SELECT remaining_count        FROM today_counts),
      'earningsSoFarUsd',  (SELECT earnings_so_far_usd    FROM today_counts)
    ),
    'pendingApproval', jsonb_build_object(
      'totalCount', (SELECT total_count FROM pending_total),
      'items',      COALESCE(
        (SELECT jsonb_agg(item ORDER BY created_at ASC, id ASC) FROM pending_items),
        '[]'::jsonb
      )
    ),
    'schedule', jsonb_build_object(
      'totalUpcomingToday', (SELECT total_upcoming_today FROM schedule_total),
      'items', COALESCE(
        (SELECT jsonb_agg(item ORDER BY scheduled_at ASC, id ASC) FROM schedule_items),
        '[]'::jsonb
      )
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_barber_home(uuid, text, timestamptz) TO authenticated, service_role;
