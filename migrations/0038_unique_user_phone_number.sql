-- A phone number is a LOGIN identifier in Local Cooks: `resolveAuthIdentifier`
-- accepts one and phone OTP exists, so it must resolve to exactly one account.
--
-- Nothing enforced that until now. Migration 0033 deprecated the only unique
-- index (`users.auth_phone_number`), and `users.phone_number` has never had a
-- constraint, so two accounts can hold the same number. Firebase links a number
-- to exactly one user, so such a pair can never be reconciled: only one of the
-- two can ever be phone-loginable, while both display the number as theirs.
--
-- The index normalises exactly the way the application does
-- (`nationalPhoneDigits` in shared/phone-validation.ts, and
-- `UserRepository.findByPhoneNationalDigits`): the last ten digits, so
-- `+1 (709) 655-5123`, `7096555123` and `17096555123` all collide.
--
-- ---------------------------------------------------------------------------
-- RUN THE PRE-FLIGHT QUERY FIRST.
--
-- A unique index cannot be built while duplicates exist, and the failure is a
-- single opaque error. This lists every conflict:
--
--   SELECT right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10) AS national,
--          count(*)                        AS accounts,
--          array_agg(id   ORDER BY id)     AS user_ids,
--          array_agg(role ORDER BY id)     AS roles,
--          array_agg(username ORDER BY id) AS emails
--   FROM users
--   WHERE phone_number IS NOT NULL
--     AND length(regexp_replace(phone_number, '[^0-9]', '', 'g')) >= 10
--   GROUP BY 1
--   HAVING count(*) > 1
--   ORDER BY accounts DESC;
--
-- Each row is a real conflict to resolve by hand: decide which account keeps the
-- number and clear it on the other
-- (`UPDATE users SET phone_number = NULL WHERE id = <the one that loses>;`).
-- Do not guess — the number is an authentication identifier, so clearing the
-- wrong side locks somebody out of their own account. Prefer keeping the account
-- that is Firebase-linked for the number if either is, and tell the other
-- account holder to re-add a different number.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_national_unique
ON users (right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10))
WHERE phone_number IS NOT NULL
  AND length(regexp_replace(phone_number, '[^0-9]', '', 'g')) >= 10;

COMMENT ON INDEX users_phone_number_national_unique IS
  'Phone numbers are login identifiers, so each resolves to exactly one account. Mirrors nationalPhoneDigits() in shared/phone-validation.ts.';
