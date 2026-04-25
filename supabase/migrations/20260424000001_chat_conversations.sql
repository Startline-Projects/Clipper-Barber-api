-- ============================================================
-- Chat Conversations
--
-- Groups every barber-client thread into a single `conversations`
-- row with denormalized last-message preview + per-side unread
-- counters. `messages.conversation_id` becomes the canonical link
-- between a message and its thread (the (barber_id, client_id) pair
-- on messages is kept so existing RLS keeps working).
--
-- Enables realtime on both tables so the Expo apps can subscribe to:
--   * INSERTs on messages, filtered by conversation_id
--   * UPDATEs on conversations, filtered by the viewer's user id
--
-- All FKs reference auth.users(id), matching the schema-wide unify
-- (see 20260413000003_unify_auth_user_id.sql).
-- ============================================================


-- ============================================================
-- STEP 1 — conversations
-- ============================================================

CREATE TABLE conversations (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_body          text,
  last_message_at            timestamptz,
  last_message_sender_role   sender_role,
  barber_unread_count        integer NOT NULL DEFAULT 0 CHECK (barber_unread_count >= 0),
  client_unread_count        integer NOT NULL DEFAULT 0 CHECK (client_unread_count >= 0),
  has_booking                boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (barber_id, client_id)
);

-- Chat-list feed: newest thread first, per participant.
CREATE INDEX idx_conversations_barber_last_msg
  ON conversations (barber_id, last_message_at DESC NULLS LAST);

CREATE INDEX idx_conversations_client_last_msg
  ON conversations (client_id, last_message_at DESC NULLS LAST);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Participants may read their own threads. Writes are funnelled through
-- the backend service-role client (bypasses RLS), so no insert / update
-- policies are exposed to authenticated sessions.
CREATE POLICY conversations_select_own ON conversations
  FOR SELECT USING (auth.uid() = barber_id OR auth.uid() = client_id);


-- ============================================================
-- STEP 2 — messages.conversation_id
--
-- The messages table is empty in every environment, so the column
-- is added NOT NULL directly with no backfill.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN conversation_id uuid NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE;

CREATE INDEX idx_messages_conversation_created
  ON messages (conversation_id, created_at DESC);


-- ============================================================
-- STEP 3 — Realtime publication
--
-- Adds both tables to supabase_realtime if not already present so the
-- Expo apps can subscribe to inserts / updates. Idempotent so re-runs
-- on Supabase Cloud (where the tables may already be enabled via the
-- dashboard) are safe.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;
