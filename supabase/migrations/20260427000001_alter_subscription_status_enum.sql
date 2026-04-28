-- ============================================================
-- Widen the subscription_status enum so the payments module can
-- represent Stripe-managed sub states.
--
-- The initial schema declared the enum as ('active','inactive','trialing').
-- Payments needs 'past_due' and 'cancelled'. 'trialing' lingers but is
-- never written by the app.
--
-- This file MUST run in its own migration (own transaction) so the
-- new enum values commit BEFORE the next migration creates functions
-- that reference them as literals.
-- ============================================================

ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'past_due';
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'cancelled';
