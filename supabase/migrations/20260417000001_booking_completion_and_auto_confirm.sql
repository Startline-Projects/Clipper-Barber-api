-- ============================================================
-- Task 8 + Auto-Confirm Toggle:
--   * review_prompt_sent_at marker on bookings (set when a
--     completed booking first transitions — no message sent yet)
--   * auto_confirm_today flag on barbers (date-scoped auto-confirm)
--   * idx_bookings_completion_cron to make the hourly cron fast
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS review_prompt_sent_at timestamptz;

ALTER TABLE barbers
  ADD COLUMN IF NOT EXISTS auto_confirm_today boolean NOT NULL DEFAULT false;

-- The cron scans confirmed bookings whose window has elapsed.
-- Partial index keeps it tiny and skips already-completed rows.
CREATE INDEX IF NOT EXISTS idx_bookings_completion_cron
  ON bookings (status, scheduled_at)
  WHERE status = 'confirmed';
