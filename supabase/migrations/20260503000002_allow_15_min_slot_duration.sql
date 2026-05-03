ALTER TABLE public.barber_schedules
  DROP CONSTRAINT IF EXISTS barber_schedules_slot_duration_minutes_check;

ALTER TABLE public.barber_schedules
  ADD CONSTRAINT barber_schedules_slot_duration_minutes_check
  CHECK (slot_duration_minutes IN (15, 30, 45, 60));
