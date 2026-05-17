-- Notification types for the no-show fee flow.
--   no_show_recorded → client, when a barber marks them as no-show and a fee
--                      is owed.
--   no_show_resolved → barber, when the client successfully pays the fee.
-- Additive only.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'no_show_recorded';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'no_show_resolved';
