-- ============================================================
-- Barber Home — multi-service awareness
--
-- Replaces get_barber_home() so each pending/schedule item carries
-- a `services` array sourced from booking_services. The legacy
-- `service` object stays for older clients, but `durationMinutes`
-- on it now reflects the TOTAL block duration (bookings.duration_minutes),
-- not the primary service's nominal duration — old calendars were
-- rendering only half-blocks for multi-service bookings.
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
  pending_services AS (
    SELECT bs.booking_id,
           jsonb_agg(
             jsonb_build_object(
               'id',              bs.barber_service_id,
               'name',            COALESCE(svc.name, 'Service'),
               'durationMinutes', COALESCE(svc.duration_minutes, bs.duration_minutes, 0),
               'bookingType',     bs.booking_type
             )
             ORDER BY bs.sort_order ASC
           ) AS items
    FROM booking_services bs
    LEFT JOIN barber_services svc ON svc.id = bs.barber_service_id
    WHERE bs.booking_id IN (SELECT id FROM pending_top)
    GROUP BY bs.booking_id
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
             'services',     COALESCE(ps.items, '[]'::jsonb),
             'scheduledAt',  p.scheduled_at,
             'priceUsd',     p.price_usd,
             'status',       p.status,
             'requestedAt',  p.created_at
           ) AS item,
           p.created_at,
           p.id
    FROM pending_top p
    LEFT JOIN clients c            ON c.user_id = p.client_id
    LEFT JOIN barber_services svc  ON svc.id   = p.barber_service_id
    LEFT JOIN pending_services ps  ON ps.booking_id = p.id
  ),

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
  schedule_services AS (
    SELECT bs.booking_id,
           jsonb_agg(
             jsonb_build_object(
               'id',              bs.barber_service_id,
               'name',            COALESCE(svc.name, 'Service'),
               'durationMinutes', COALESCE(svc.duration_minutes, bs.duration_minutes, 0),
               'bookingType',     bs.booking_type
             )
             ORDER BY bs.sort_order ASC
           ) AS items
    FROM booking_services bs
    LEFT JOIN barber_services svc ON svc.id = bs.barber_service_id
    WHERE bs.booking_id IN (SELECT id FROM schedule_top)
    GROUP BY bs.booking_id
  ),
  schedule_items AS (
    SELECT jsonb_build_object(
             'bookingId',   s.id,
             'client', jsonb_build_object(
               'id',              s.client_id,
               'fullName',        COALESCE(c.name, 'Unknown'),
               'profilePhotoUrl', c.profile_photo_url
             ),
             -- Legacy single-service block. durationMinutes is now the
             -- TOTAL block (s.duration_minutes), so older calendars that
             -- pre-date the `services` array still render the full slot.
             'service', CASE
               WHEN s.barber_service_id IS NULL THEN NULL
               ELSE jsonb_build_object(
                 'id',               s.barber_service_id,
                 'name',             COALESCE(svc.name, 'Service'),
                 'durationMinutes',  COALESCE(s.duration_minutes, svc.duration_minutes, 0)
               )
             END,
             'services',          COALESCE(ss.items, '[]'::jsonb),
             'totalDurationMinutes', COALESCE(s.duration_minutes, 0),
             'scheduledAt',       s.scheduled_at,
             'endAt',             s.scheduled_at + (COALESCE(s.duration_minutes, 0) * interval '1 minute'),
             'minutesUntilStart', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (s.scheduled_at - p_now)) / 60))::int,
             'priceUsd',          s.price_usd,
             'status',            s.status
           ) AS item,
           s.scheduled_at,
           s.id
    FROM schedule_top s
    LEFT JOIN clients c             ON c.user_id = s.client_id
    LEFT JOIN barber_services svc   ON svc.id   = s.barber_service_id
    LEFT JOIN schedule_services ss  ON ss.booking_id = s.id
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
