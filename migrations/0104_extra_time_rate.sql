-- Extra time rate (owner, Oct 17): one hourly rate for chef asks / early start / stay-past-the-end.
-- Daily-only kitchens set this; kitchens with an hourly rate use that rate (column stays NULL).
-- Snapshotted onto each booking at creation so later kitchen price edits never change it.
-- Additive: nullable integers, no backfill of existing bookings.
BEGIN;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS extra_time_rate_cents integer;
ALTER TABLE kitchens DROP CONSTRAINT IF EXISTS kitchens_extra_time_rate_cents_check;
ALTER TABLE kitchens ADD CONSTRAINT kitchens_extra_time_rate_cents_check
  CHECK (extra_time_rate_cents IS NULL OR extra_time_rate_cents > 0);
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS extra_time_rate_cents integer;
ALTER TABLE kitchen_bookings DROP CONSTRAINT IF EXISTS kitchen_bookings_extra_time_rate_cents_check;
ALTER TABLE kitchen_bookings ADD CONSTRAINT kitchen_bookings_extra_time_rate_cents_check
  CHECK (extra_time_rate_cents IS NULL OR extra_time_rate_cents > 0);
COMMIT;
