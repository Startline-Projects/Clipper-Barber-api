-- ============================================================
-- Notifications: chat (new_message) support
--
-- Adds the NEW_MESSAGE notification type plus optional FKs to the
-- conversations / messages tables so chat pushes can be persisted in
-- the notification inbox and tapped to deep-link back to the thread.
-- ============================================================


-- Add the new enum value. `ADD VALUE IF NOT EXISTS` is idempotent; the
-- value is not referenced elsewhere in this migration, which avoids the
-- "unsafe use of new value" restriction.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_message';


-- Deep-link context for chat notifications. Left nullable for the
-- booking / recurring types that existed before this migration.
ALTER TABLE notifications
  ADD COLUMN conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN message_id      uuid REFERENCES messages(id)      ON DELETE SET NULL;
