-- Adds a barber-level toggle controlling whether the barber accepts
-- "in-house" services (services performed at the barber's location, as
-- opposed to mobile / client-location work). Defaults to false so
-- existing barbers must opt in via the settings endpoint.

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS in_house_services boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.barbers.in_house_services IS
  'Whether the barber offers in-house (on-premises) services. Toggled via PATCH /barber/settings/in-house-services.';
