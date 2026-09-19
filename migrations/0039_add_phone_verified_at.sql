-- A phone number is a LOGIN identifier in Local Cooks, so it must not be usable
-- to sign in until its owner has proved control of it. Until now there was
-- nowhere to record that proof, and the phone path ignored verification entirely:
-- `resolveIdentifierStep("phone")` returned "phone-otp" unconditionally, so ANY
-- number — registered to someone else, or registered to nobody — received an SMS
-- and then landed on a signup form.
--
-- `users.phone_number` is a plain contact field, and `users.auth_phone_number`
-- (deprecated by migration 0033) is null for every row. There was no phone
-- equivalent of `email_verified_at` at all.
--
-- WHY THE DATABASE AND NOT FIREBASE
-- Firebase cannot answer this question for us. Verified against the live project
-- on 2026-09-18: 175 Firebase users, ZERO with a `phoneNumber`, and
-- `getUserByPhoneNumber` returned auth/user-not-found for every phone number held
-- in `users`. The app has never linked a phone as a Firebase credential, so the
-- Firebase user record is not a usable source of truth. This column is.
--
-- WHY EVERY EXISTING ROW STAYS NULL
-- No phone in this project has ever been proved, so none is verified. Leaving
-- them NULL is the truthful state, not an oversight: it means phone sign-in is
-- closed for every account until the number is verified from inside the account.
-- That is the intended behaviour, and it is not a regression — the phone path was
-- broken for these accounts already (it sent them to signup).
--
-- The write side is POST /api/sync-verification-status, which mirrors a verified
-- Firebase `phone_number` claim into this column, exactly as it already mirrors
-- `email_verified` into `is_verified` / `email_verified_at`.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamp without time zone;

COMMENT ON COLUMN users.phone_verified_at IS
  'When this phone number was proved to belong to this account (null = never). Read by the sign-in gate: an unverified number may not receive an OTP. Written by POST /api/sync-verification-status. Mirrors email_verified_at.';
