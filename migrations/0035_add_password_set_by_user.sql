-- Registration never collects a password: email-verification, Google and phone
-- signups all store a server-generated placeholder in users.password so the
-- NOT NULL column is satisfied and the client can sign in with
-- accounts:signInWithPassword. Nothing in Firebase or the hash itself can tell a
-- generated secret from one the account holder chose, so the profile password tab
-- had no way to know whether to ask for a "current password" — it always did.
--
-- This flag is the missing signal. It is flipped to true only by
-- POST /api/user/sync-password, which is the single sink for both the "set" and
-- "change" flows on the profile password tab.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_set_by_user BOOLEAN NOT NULL DEFAULT false;

-- Backfill false for every existing row. Accounts that did previously choose a
-- password are indistinguishable from ones that did not, and the safe direction
-- to be wrong in is the one that never blocks: those users simply get the
-- two-field "set password" form and choose a new secret. No account is left
-- unable to reach a working password.
UPDATE users SET password_set_by_user = false WHERE password_set_by_user IS DISTINCT FROM false;

COMMENT ON COLUMN users.password_set_by_user IS
  'True only once the account holder chose the password themselves. False means users.password is a registration placeholder and no "current password" prompt may be shown.';
