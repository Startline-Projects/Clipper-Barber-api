-- ============================================================
-- Barber → My Clients
--
-- Powers GET /barber/clients and GET /barber/clients/:clientId.
-- A "client of barber X" is any auth user with at least one
-- non-cancelled booking with X (no_show counts; cancelled does not).
--
-- Aggregates are computed in Postgres so the list endpoint runs
-- a constant number of round-trips regardless of page size.
-- ============================================================


-- ============================================================
-- 1. Indexes
-- ============================================================

-- (barber_id, client_id, scheduled_at) — drives the per-client GROUP BY,
-- next-booking lateral, and first/last visit windows.
CREATE INDEX IF NOT EXISTS idx_bookings_barber_client_scheduled
  ON bookings (barber_id, client_id, scheduled_at);

-- (barber_id, status, scheduled_at) — speeds up the "upcoming for this
-- barber" filter in the hasUpcoming branch.
CREATE INDEX IF NOT EXISTS idx_bookings_barber_status_scheduled
  ON bookings (barber_id, status, scheduled_at);


-- ============================================================
-- 2. get_barber_clients
--
-- Paginated list of distinct clients with rolled-up stats.
--
-- Returns jsonb { items: [...], total: int }.
--   items[i] shape:
--     {
--       clientId, name, profilePhotoUrl,
--       totalVisits, totalSpendUsd,
--       firstVisitAt, lastVisitAt, nextBookingAt,
--       hasUpcoming
--     }
--
-- Sorting whitelist: 'lastVisit' | 'totalSpend' | 'totalVisits' | 'name'.
-- Order whitelist:   'asc' | 'desc'.
--
-- totalVisits  = COUNT(bookings WHERE status = 'completed')
-- totalSpendUsd = SUM(price_usd WHERE status = 'completed')
--   `price_usd` is the booking-level total (already includes per-service
--   surcharges via the snapshot written by the bookings flow). No
--   payment_status column exists, so we can't currently distinguish
--   refunded/pending/failed at the DB level — completed === paid in this
--   model. Documented as a deviation in the PR.
-- ============================================================

CREATE OR REPLACE FUNCTION get_barber_clients(
  p_barber_id     uuid,
  p_search        text,
  p_sort_by       text,
  p_order         text,
  p_offset        int,
  p_limit         int,
  p_has_upcoming  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_search_pattern text := CASE
    WHEN p_search IS NULL OR length(trim(p_search)) = 0 THEN NULL
    ELSE '%' || lower(trim(p_search)) || '%'
  END;
  v_sort_by text := COALESCE(p_sort_by, 'lastVisit');
  v_order   text := lower(COALESCE(p_order, 'desc'));
  v_total   int;
  v_items   jsonb;
BEGIN
  IF v_sort_by NOT IN ('lastVisit', 'totalSpend', 'totalVisits', 'name') THEN
    v_sort_by := 'lastVisit';
  END IF;
  IF v_order NOT IN ('asc', 'desc') THEN
    v_order := 'desc';
  END IF;

  -- Per-client stats. One row per (barber, client) pair where the client
  -- has at least one non-cancelled booking with this barber.
  WITH client_stats AS (
    SELECT
      b.client_id                                         AS client_id,
      COUNT(*) FILTER (WHERE b.status = 'completed')      AS total_visits,
      COALESCE(SUM(b.price_usd) FILTER (WHERE b.status = 'completed'), 0) AS total_spend,
      MIN(b.scheduled_at) FILTER (WHERE b.status = 'completed') AS first_visit_at,
      MAX(b.scheduled_at) FILTER (WHERE b.status = 'completed') AS last_visit_at
    FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.status <> 'cancelled'
    GROUP BY b.client_id
  ),
  -- Earliest future scheduled/confirmed booking per client.
  client_next AS (
    SELECT
      b.client_id,
      MIN(b.scheduled_at) AS next_booking_at
    FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.status IN ('pending', 'confirmed')
      AND b.scheduled_at > now()
    GROUP BY b.client_id
  ),
  joined AS (
    SELECT
      cs.client_id,
      c.name              AS name,
      c.profile_photo_url AS profile_photo_url,
      u.email             AS email,
      cs.total_visits,
      cs.total_spend,
      cs.first_visit_at,
      cs.last_visit_at,
      cn.next_booking_at,
      (cn.next_booking_at IS NOT NULL) AS has_upcoming
    FROM client_stats cs
    LEFT JOIN clients     c  ON c.user_id  = cs.client_id
    LEFT JOIN auth.users  u  ON u.id       = cs.client_id
    LEFT JOIN client_next cn ON cn.client_id = cs.client_id
    WHERE
      (v_search_pattern IS NULL
       OR lower(coalesce(c.name, '')) LIKE v_search_pattern
       OR lower(coalesce(u.email, '')) LIKE v_search_pattern)
      AND (NOT COALESCE(p_has_upcoming, false) OR cn.next_booking_at IS NOT NULL)
  ),
  sorted AS (
    SELECT *,
      COUNT(*) OVER () AS total_count
    FROM joined
    ORDER BY
      CASE WHEN v_sort_by = 'lastVisit'   AND v_order = 'asc'  THEN last_visit_at  END ASC  NULLS LAST,
      CASE WHEN v_sort_by = 'lastVisit'   AND v_order = 'desc' THEN last_visit_at  END DESC NULLS LAST,
      CASE WHEN v_sort_by = 'totalSpend'  AND v_order = 'asc'  THEN total_spend    END ASC  NULLS LAST,
      CASE WHEN v_sort_by = 'totalSpend'  AND v_order = 'desc' THEN total_spend    END DESC NULLS LAST,
      CASE WHEN v_sort_by = 'totalVisits' AND v_order = 'asc'  THEN total_visits   END ASC  NULLS LAST,
      CASE WHEN v_sort_by = 'totalVisits' AND v_order = 'desc' THEN total_visits   END DESC NULLS LAST,
      CASE WHEN v_sort_by = 'name'        AND v_order = 'asc'  THEN lower(name)    END ASC  NULLS LAST,
      CASE WHEN v_sort_by = 'name'        AND v_order = 'desc' THEN lower(name)    END DESC NULLS LAST,
      client_id ASC -- stable tiebreak
  ),
  page AS (
    SELECT * FROM sorted
    OFFSET GREATEST(p_offset, 0)
    LIMIT  GREATEST(p_limit,  0)
  )
  SELECT
    COALESCE((SELECT MIN(total_count) FROM sorted), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'clientId',         p.client_id,
      'name',             COALESCE(p.name, 'Unknown'),
      'profilePhotoUrl',  p.profile_photo_url,
      'email',            p.email,
      'totalVisits',      p.total_visits,
      'totalSpendUsd',    round(p.total_spend::numeric, 2),
      'firstVisitAt',     p.first_visit_at,
      'lastVisitAt',      p.last_visit_at,
      'nextBookingAt',    p.next_booking_at,
      'hasUpcoming',      p.has_upcoming
    )), '[]'::jsonb)
  INTO v_total, v_items
  FROM page p;

  RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$$;


-- ============================================================
-- 3. get_barber_client_detail
--
-- Aggregate stats for a single client of this barber. Used by
-- GET /barber/clients/:clientId. Returns NULL if the client has
-- no non-cancelled bookings with this barber — the caller turns
-- that into 404 (do not leak existence with 403).
-- ============================================================

CREATE OR REPLACE FUNCTION get_barber_client_detail(
  p_barber_id uuid,
  p_client_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_visits        int;
  v_total_spend         numeric(12,2);
  v_first_visit_at      timestamptz;
  v_last_visit_at       timestamptz;
  v_no_show_count       int;
  v_cancellation_count  int;
  v_next_booking_at     timestamptz;
  v_favourite_service   jsonb;
  v_relationship_exists boolean;
  v_profile             jsonb;
BEGIN
  -- Relationship check: at least one non-cancelled booking together.
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.barber_id = p_barber_id
      AND b.client_id = p_client_id
      AND b.status <> 'cancelled'
  ) INTO v_relationship_exists;

  IF NOT v_relationship_exists THEN
    RETURN NULL;
  END IF;

  -- Profile snapshot — name/photo from clients (may be NULL if the user
  -- never finished onboarding); email + auth-side createdAt from auth.users.
  SELECT jsonb_build_object(
    'id',              p_client_id,
    'name',            COALESCE(c.name, 'Unknown'),
    'profilePhotoUrl', c.profile_photo_url,
    'email',           u.email,
    'createdAt',       u.created_at
  )
  INTO v_profile
  FROM auth.users u
  LEFT JOIN clients c ON c.user_id = u.id
  WHERE u.id = p_client_id;

  SELECT
    COUNT(*) FILTER (WHERE b.status = 'completed'),
    COALESCE(SUM(b.price_usd) FILTER (WHERE b.status = 'completed'), 0),
    MIN(b.scheduled_at)       FILTER (WHERE b.status = 'completed'),
    MAX(b.scheduled_at)       FILTER (WHERE b.status = 'completed'),
    COUNT(*) FILTER (WHERE b.status = 'no_show'),
    COUNT(*) FILTER (WHERE b.status = 'cancelled')
  INTO
    v_total_visits, v_total_spend, v_first_visit_at, v_last_visit_at,
    v_no_show_count, v_cancellation_count
  FROM bookings b
  WHERE b.barber_id = p_barber_id
    AND b.client_id = p_client_id;

  SELECT MIN(b.scheduled_at)
  INTO v_next_booking_at
  FROM bookings b
  WHERE b.barber_id = p_barber_id
    AND b.client_id = p_client_id
    AND b.status IN ('pending', 'confirmed')
    AND b.scheduled_at > now();

  -- Favourite = service appearing most often in completed bookings.
  -- Tie-break: most recent completed booking using that service.
  -- Counts every line in booking_services (so multi-service bookings
  -- contribute one tally per service line).
  WITH per_service AS (
    SELECT bs.barber_service_id,
           COUNT(*)               AS uses,
           MAX(b.scheduled_at)    AS last_used_at
    FROM bookings b
    JOIN booking_services bs ON bs.booking_id = b.id
    WHERE b.barber_id = p_barber_id
      AND b.client_id = p_client_id
      AND b.status = 'completed'
    GROUP BY bs.barber_service_id
  )
  SELECT jsonb_build_object('id', svc.id, 'name', svc.name)
  INTO v_favourite_service
  FROM per_service ps
  JOIN barber_services svc ON svc.id = ps.barber_service_id
  ORDER BY ps.uses DESC, ps.last_used_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'profile',             v_profile,
    'totalVisits',         v_total_visits,
    'totalSpendUsd',       round(v_total_spend, 2),
    'firstVisitAt',        v_first_visit_at,
    'lastVisitAt',         v_last_visit_at,
    'noShowCount',         v_no_show_count,
    'cancellationCount',   v_cancellation_count,
    'nextBookingAt',       v_next_booking_at,
    'favouriteService',    v_favourite_service
  );
END;
$$;
