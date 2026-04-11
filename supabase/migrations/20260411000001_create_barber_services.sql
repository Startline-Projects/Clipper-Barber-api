CREATE TABLE barber_services (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id              uuid REFERENCES barbers(id) ON DELETE CASCADE NOT NULL,
  name                   text NOT NULL,
  service_type           service_type NOT NULL,
  duration_minutes       integer NOT NULL CHECK (duration_minutes IN (15, 30, 45, 60)),
  regular_price_usd      numeric(10,2) NOT NULL,
  after_hours_price_usd  numeric(10,2),
  day_off_price_usd      numeric(10,2),
  is_active              boolean DEFAULT true NOT NULL,
  sort_order             integer DEFAULT 0 NOT NULL,
  created_at             timestamptz DEFAULT now() NOT NULL,
  updated_at             timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX idx_barber_services_unique_name
  ON barber_services (barber_id, lower(name))
  WHERE is_active = true;

CREATE INDEX idx_barber_services_barber ON barber_services (barber_id, is_active);

ALTER TABLE barber_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY barber_services_select_all ON barber_services
  FOR SELECT USING (true);

CREATE POLICY barber_services_insert_own ON barber_services
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM barbers
      WHERE barbers.id = barber_services.barber_id
        AND barbers.user_id = auth.uid()
    )
  );

CREATE POLICY barber_services_update_own ON barber_services
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM barbers
      WHERE barbers.id = barber_services.barber_id
        AND barbers.user_id = auth.uid()
    )
  );

CREATE POLICY barber_services_delete_own ON barber_services
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM barbers
      WHERE barbers.id = barber_services.barber_id
        AND barbers.user_id = auth.uid()
    )
  );

-- Link bookings to the actual service
ALTER TABLE bookings
  ADD COLUMN barber_service_id uuid REFERENCES barber_services(id) ON DELETE RESTRICT;

CREATE INDEX idx_bookings_service ON bookings (barber_service_id);
