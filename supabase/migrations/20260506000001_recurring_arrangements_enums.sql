-- ============================================================
-- Recurring arrangements (barber-initiated) — Part 1: enum additions
--
-- Postgres forbids referencing a newly-added enum value in the
-- same transaction it was added. This file does ONLY the enum
-- work so the next migration (…_columns_and_policies) can use
-- the new values in indexes, CHECKs, and policies.
--
-- Background: we extend the existing recurring_bookings table
-- to also support barber-initiated offers ("arrangements") in
-- addition to the existing client-initiated flow. No fork.
-- ============================================================


-- ------------------------------------------------------------
-- recurring_booking_status: three new values
--
--   pending_client_approval  — barber has offered, waiting on client
--   rejected                 — client rejected a barber's offer
--   ended                    — barber ended an active arrangement
--
-- "accepted" reuses the existing 'active' value (barber_accepted_at
-- already records the timestamp). "cancelled_by_barber" reuses the
-- existing 'cancelled' + cancelled_by='barber' pair.
-- ------------------------------------------------------------

ALTER TYPE recurring_booking_status ADD VALUE IF NOT EXISTS 'pending_client_approval';
ALTER TYPE recurring_booking_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE recurring_booking_status ADD VALUE IF NOT EXISTS 'ended';


-- ------------------------------------------------------------
-- frequency_type: two new cadences
-- ------------------------------------------------------------

ALTER TYPE frequency_type ADD VALUE IF NOT EXISTS 'every_n_weeks';
ALTER TYPE frequency_type ADD VALUE IF NOT EXISTS 'monthly';


-- ------------------------------------------------------------
-- notification_type: three new lifecycle events
-- ------------------------------------------------------------

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'recurring_arrangement_offered';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'recurring_arrangement_accepted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'recurring_arrangement_rejected';


-- ------------------------------------------------------------
-- recurring_end_type: brand-new enum (CREATE TYPE has no
-- same-transaction restriction, but kept here for grouping).
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurring_end_type') THEN
    CREATE TYPE recurring_end_type AS ENUM ('none', 'after_count', 'on_date');
  END IF;
END $$;


-- ------------------------------------------------------------
-- recurring_initiator: who created the arrangement
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurring_initiator') THEN
    CREATE TYPE recurring_initiator AS ENUM ('client', 'barber');
  END IF;
END $$;
