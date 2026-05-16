-- Add 'recurring_resumed' to notification_type enum so resume events can be
-- delivered via the existing notifications pipeline. Additive change only.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'recurring_resumed';
