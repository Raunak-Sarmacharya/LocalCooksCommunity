CREATE TABLE IF NOT EXISTS kitchen_checkout_holds (
  id text PRIMARY KEY,
  kitchen_id integer NOT NULL REFERENCES kitchens(id) ON DELETE CASCADE,
  chef_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operating_date text NOT NULL,
  window_start_time text NOT NULL,
  selected_slots jsonb NOT NULL,
  stripe_session_id text UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kitchen_checkout_holds_active_lookup
  ON kitchen_checkout_holds (kitchen_id, operating_date, expires_at);

ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS operating_window_start_time text;
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS pricing_mode text;

-- These constraints make booking fulfillment and operating schedules idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_bookings_payment_intent_unique
  ON kitchen_bookings (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_availability_kitchen_day_unique
  ON kitchen_availability (kitchen_id, day_of_week);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_date_overrides_kitchen_day_unique
  ON kitchen_date_overrides (kitchen_id, (specific_date::date));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kitchen_bookings_pricing_mode_check'
      AND conrelid = 'kitchen_bookings'::regclass
  ) THEN
    ALTER TABLE kitchen_bookings
      ADD CONSTRAINT kitchen_bookings_pricing_mode_check
      CHECK (pricing_mode IS NULL OR pricing_mode IN ('hourly', 'daily'));
  END IF;
END $$;
