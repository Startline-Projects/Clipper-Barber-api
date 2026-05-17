-- ============================================================
-- Step 1 of the no-show payment hardening: enum extension only.
--
-- ALTER TYPE ... ADD VALUE adds the label, but Postgres forbids
-- referencing the new value in the SAME transaction (SQLSTATE 55P04).
-- The Supabase CLI wraps each migration file in a transaction, so we
-- split the enum extension from the rest of the hardening migration
-- (which uses the new values in functions / triggers / CHECKs).
--
-- All ADDs are idempotent — safe to re-apply.
-- ============================================================

ALTER TYPE no_show_status ADD VALUE IF NOT EXISTS 'payment_intent_created';
ALTER TYPE no_show_status ADD VALUE IF NOT EXISTS 'requires_action';
ALTER TYPE no_show_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE no_show_status ADD VALUE IF NOT EXISTS 'payment_failed';
ALTER TYPE no_show_status ADD VALUE IF NOT EXISTS 'canceled';
ALTER TYPE no_show_status ADD VALUE IF NOT EXISTS 'reconciliation_required';
