-- Add subscription lifecycle values to notification_type enum so the
-- payments webhook handlers and the cancel/reactivate endpoints can
-- push state-change notifications through the existing pipeline.
-- Additive only.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subscription_activated';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subscription_reactivated';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subscription_cancel_scheduled';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subscription_cancelled';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subscription_past_due';
