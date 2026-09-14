-- Firebase phone identity used for phone-first registration and sign-in.
-- Nullable preserves existing email/Google accounts during the staged rollout.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS auth_phone_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_phone_number_unique
ON users (auth_phone_number)
WHERE auth_phone_number IS NOT NULL;
