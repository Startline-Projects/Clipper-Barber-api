-- ============================================================
-- Barber → My Clients: SECURITY DEFINER fix
--
-- The original functions in 20260429000001_barber_clients.sql are STABLE
-- but not SECURITY DEFINER. They read from auth.users (for email +
-- created_at), which `service_role` has no SELECT on by default. This
-- caused: "permission denied for table users" when called via the API,
-- even though the SQL Editor (running as `postgres`) succeeded.
--
-- Switch both RPCs to SECURITY DEFINER so they execute with the owner's
-- privileges (postgres), which can read auth.users. Pin search_path to
-- prevent search-path-based privilege escalation — required hygiene for
-- any SECURITY DEFINER function.
--
-- Lock EXECUTE down to service_role only: anon/authenticated have no
-- business calling these directly; the Nest backend (service-role key)
-- is the sole caller.
-- ============================================================

ALTER FUNCTION get_barber_clients(uuid, text, text, text, int, int, boolean)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

ALTER FUNCTION get_barber_client_detail(uuid, uuid)
  SECURITY DEFINER
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION get_barber_clients(uuid, text, text, text, int, int, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_barber_client_detail(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION get_barber_clients(uuid, text, text, text, int, int, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION get_barber_client_detail(uuid, uuid)
  TO service_role;

-- Force PostgREST to pick up the new definitions immediately.
NOTIFY pgrst, 'reload schema';
