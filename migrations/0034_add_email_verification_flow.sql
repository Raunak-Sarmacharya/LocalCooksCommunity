-- Email is the primary identifier and the notification channel, so an account
-- must hold exactly one confirmed address before it can operate. Firebase Auth
-- remains authoritative for ownership; these columns hold the in-flight request
-- so the server can send a branded, single-use-token link without requiring a
-- recent Firebase sign-in (which phone-first registrations do not have).
--
-- `username` stays the confirmed-email mirror and is rewritten atomically when a
-- pending address is confirmed. `is_verified` mirrors Firebase's email_verified.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS pending_email TEXT,
ADD COLUMN IF NOT EXISTS pending_email_token_hash TEXT,
ADD COLUMN IF NOT EXISTS pending_email_expires_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS pending_email_sent_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

-- Backfill the audit trail for accounts that are already verified so the profile
-- card can render a confirmation date instead of an empty state.
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, updated_at, created_at)
WHERE is_verified = true
  AND email_verified_at IS NULL;

-- Confirmation lookups resolve an account from the token digest, so index the
-- column without penalising the overwhelmingly common null case.
CREATE INDEX IF NOT EXISTS users_pending_email_token_hash_idx
ON users (pending_email_token_hash)
WHERE pending_email_token_hash IS NOT NULL;

COMMENT ON COLUMN users.pending_email IS
  'Address awaiting confirmation. Never treated as the account email until the emailed token is consumed.';
COMMENT ON COLUMN users.pending_email_token_hash IS
  'SHA-256 of the single-use confirmation token. The raw token only ever exists in the email link.';
COMMENT ON COLUMN users.username IS
  'Confirmed email address (legacy column name). Firebase Auth is authoritative; rewritten on email change.';
