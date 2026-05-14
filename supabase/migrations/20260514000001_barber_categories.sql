-- ============================================================
-- Barber category / specialty tags (signup step 4).
--
-- Adds an optional, multi-select `categories` array to the barber
-- profile. Barbers pick these during the new optional signup step 4 or
-- edit them later from their profile; clients filter barbers by them.
--
-- The column defaults to an empty array so existing barbers keep working
-- without any required action. The legacy `in_house_services` boolean is
-- backfilled into the array as the `IN_HOUSE_SERVICES` tag so the two
-- representations stay consistent.
-- ============================================================

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.barbers.categories IS
  'Barber category/specialty tags (BarberCategoryTag enum values). Set via POST /auth/barber/step4 or PATCH /barber/profile. Used for client-facing barber listing filters.';

-- ── Backfill: existing barbers with in_house_services = true get the
--    IN_HOUSE_SERVICES tag. Idempotent — array_append only runs where the
--    tag is not already present.
UPDATE public.barbers
SET categories = array_append(categories, 'IN_HOUSE_SERVICES')
WHERE in_house_services = true
  AND NOT ('IN_HOUSE_SERVICES' = ANY (categories));

-- ── GIN index supports `categories && '{...}'` overlap filtering used by
--    the client barber-listing APIs (match ANY selected category).
CREATE INDEX IF NOT EXISTS barbers_categories_gin
  ON public.barbers USING GIN (categories);
