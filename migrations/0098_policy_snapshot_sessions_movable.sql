-- Applied to dev Oct 17 (prod pending owner go-ahead). The accepted policy terms stay immutable, but a confirmed-booking
-- change (WP-RS) moves the session time the deadlines are measured from. The old trigger refused ANY snapshot edit, so every
-- approved change failed after the chef's extra payment was captured.
CREATE OR REPLACE FUNCTION protect_booking_cancellation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancellation_policy_snapshot IS NOT NULL
     AND (NEW.cancellation_policy_snapshot IS NULL
          OR (NEW.cancellation_policy_snapshot - 'sessions') IS DISTINCT FROM (OLD.cancellation_policy_snapshot - 'sessions'))
    THEN RAISE EXCEPTION 'Accepted cancellation policy snapshots are immutable'; END IF;
  RETURN NEW;
END $$;
