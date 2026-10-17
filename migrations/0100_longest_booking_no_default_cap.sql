-- Longest booking: no per-request hours cap by default.
-- NULL at location and kitchen = unlimited (opening hours only).
-- Additive: drop NOT NULL + default; existing rows keep their values.
BEGIN;
ALTER TABLE locations ALTER COLUMN default_daily_booking_limit DROP NOT NULL;
ALTER TABLE locations ALTER COLUMN default_daily_booking_limit DROP DEFAULT;
COMMIT;
