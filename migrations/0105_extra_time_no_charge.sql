-- A kitchen's "No charge" decision for a late checkout is recorded as an extra_time row: status 'waived', free, $0.
-- It blocks a later charge for that visit and shows in both booking histories. Nothing is sent or charged.
ALTER TABLE kitchen_booking_extensions DROP CONSTRAINT IF EXISTS kitchen_booking_extensions_status_check;
ALTER TABLE kitchen_booking_extensions ADD CONSTRAINT kitchen_booking_extensions_status_check
  CHECK (status IN ('requested','offered','approved','declined','expired','paid','cancelled','disputed','waived'));

ALTER TABLE kitchen_booking_extensions DROP CONSTRAINT IF EXISTS kitchen_booking_extensions_free_amount;
ALTER TABLE kitchen_booking_extensions ADD CONSTRAINT kitchen_booking_extensions_free_amount CHECK (
  (free AND amount_cents = 0 AND kind IN ('offer','early_start'))
  OR (free AND amount_cents = 0 AND kind = 'extra_time' AND status = 'waived')
  OR (free AND kind = 'request' AND amount_cents > 0)
  OR (NOT free AND amount_cents > 0));
