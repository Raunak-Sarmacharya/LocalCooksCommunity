BEGIN;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS cancellation_policy_hours integer;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS minimum_booking_window_hours integer;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS default_daily_booking_limit integer;
-- Initialize existing kitchens from the shared checklist; new kitchens start OFF.
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS checkin_checkout_enabled boolean;
UPDATE kitchens k SET checkin_checkout_enabled = EXISTS (
  SELECT 1 FROM checkin_checkout_checklists c WHERE c.location_id = k.location_id
    AND (c.checkin_enabled OR c.checkout_enabled)
) WHERE k.checkin_checkout_enabled IS NULL;
ALTER TABLE kitchens ALTER COLUMN checkin_checkout_enabled SET DEFAULT false;
ALTER TABLE kitchens ALTER COLUMN checkin_checkout_enabled SET NOT NULL;

ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS cancellation_policy_hours integer;
-- Older accepted policies were not recorded. Preserve the cutoff currently enforced for them.
UPDATE kitchen_bookings b SET cancellation_policy_hours = l.cancellation_policy_hours
FROM kitchens k JOIN locations l ON l.id = k.location_id
WHERE b.kitchen_id = k.id AND b.cancellation_policy_hours IS NULL;

CREATE OR REPLACE FUNCTION snapshot_kitchen_booking_policy() RETURNS trigger AS $$
BEGIN
  IF NEW.cancellation_policy_hours IS NULL THEN
    SELECT COALESCE(k.cancellation_policy_hours, l.cancellation_policy_hours, 24)
    INTO NEW.cancellation_policy_hours
    FROM kitchens k JOIN locations l ON l.id = k.location_id WHERE k.id = NEW.kitchen_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS snapshot_kitchen_booking_policy ON kitchen_bookings;
CREATE TRIGGER snapshot_kitchen_booking_policy BEFORE INSERT ON kitchen_bookings
FOR EACH ROW EXECUTE FUNCTION snapshot_kitchen_booking_policy();
COMMIT;
