-- Email verification tracked independently from supabase auth's email_confirmed_at.
-- We auto-confirm at the supabase level (so signup -> immediate sign-in works) and
-- enforce verification at the application layer via EmailVerifiedGuard.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
