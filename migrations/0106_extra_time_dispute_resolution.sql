-- A disputed extra-time charge is settled by Local Cooks like a damage claim: uphold, reduce or waive.
-- resolution keeps the customer's dispute note and the admin's decision (outcome, note, original amount, who, when).
-- upheld_at starts the 7-day pay-by; after it, an unpaid charge pauses new bookings (same rule as claims).
ALTER TABLE kitchen_booking_extensions ADD COLUMN IF NOT EXISTS upheld_at timestamptz;
ALTER TABLE kitchen_booking_extensions ADD COLUMN IF NOT EXISTS resolution jsonb;
CREATE INDEX IF NOT EXISTS kitchen_booking_extensions_upheld_unpaid_idx ON kitchen_booking_extensions (booking_id)
  WHERE kind = 'extra_time' AND upheld_at IS NOT NULL AND paid_at IS NULL AND status = 'offered';
