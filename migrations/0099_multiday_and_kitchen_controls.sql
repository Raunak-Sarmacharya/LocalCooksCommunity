-- CP1: multi-day booking schema + kitchen controls (additive, nullable/defaulted).
-- Do not apply from this task; rollout gate booking_multiday_enabled stays 'false'.
BEGIN;
ALTER TABLE locations ALTER COLUMN max_advance_booking_days SET DEFAULT 60;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS max_booking_days integer NOT NULL DEFAULT 7
  CHECK (max_booking_days BETWEEN 1 AND 14);
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS max_booking_days integer
  CHECK (max_booking_days BETWEEN 1 AND 14);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS allow_multiday_bookings boolean NOT NULL DEFAULT true;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS allow_multiday_bookings boolean;
-- Existing numeric NULLs inherit the old boolean (false=0, true=60); new locations default Off.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS booking_buffer_minutes integer CHECK (booking_buffer_minutes IN (0,60,120));
ALTER TABLE locations ALTER COLUMN booking_buffer_minutes SET DEFAULT 0;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS booking_buffer_minutes integer CHECK (booking_buffer_minutes IN (0,60,120));
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS weekly_chef_hours_limit integer CHECK (weekly_chef_hours_limit BETWEEN 1 AND 168);
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS buffer_minutes_snapshot integer CHECK (buffer_minutes_snapshot IN (0,60,120));
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS booking_rule_overrides jsonb;
ALTER TABLE kitchen_checkout_holds ADD COLUMN IF NOT EXISTS buffer_minutes_snapshot integer CHECK (buffer_minutes_snapshot IN (0,60,120));
ALTER TABLE kitchen_invitations ADD COLUMN IF NOT EXISTS buffer_minutes_snapshot integer CHECK (buffer_minutes_snapshot IN (0,60,120));
ALTER TABLE kitchen_invitations ADD COLUMN IF NOT EXISTS booking_rule_overrides jsonb;
INSERT INTO platform_settings (key, value, description) VALUES
  ('booking_max_days_cap', '14', 'Maximum selected days in one kitchen booking'),
  ('booking_multiday_enabled', 'false', 'Enable dated kitchen booking creation after rollout')
ON CONFLICT (key) DO NOTHING;
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS schedule_revision integer NOT NULL DEFAULT 0
  CHECK (schedule_revision >= 0);
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS kitchen_day_cancellation_offer jsonb;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS visit_date date;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS schedule_revision integer;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS schedule_state text DEFAULT 'active'
  CHECK (schedule_state IN ('active', 'cancelled', 'superseded'));
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS operating_window_start_time text;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS pricing_mode text
  CHECK (pricing_mode IN ('hourly', 'daily'));
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS selected_slots jsonb;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS price_snapshot jsonb;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS cancellation_plan jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_visits_revision_day_unique
  ON kitchen_booking_visits (booking_id, schedule_revision, visit_date)
  WHERE schedule_revision IS NOT NULL AND visit_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS kitchen_visits_date_lookup
  ON kitchen_booking_visits (visit_date, booking_id) WHERE visit_date IS NOT NULL;
ALTER TABLE equipment_bookings ADD COLUMN IF NOT EXISTS kitchen_booking_visit_id integer
  REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS equipment_booking_visit_lookup
  ON equipment_bookings (kitchen_booking_visit_id) WHERE kitchen_booking_visit_id IS NOT NULL;
ALTER TABLE kitchen_checkout_holds ADD COLUMN IF NOT EXISTS group_id text;
ALTER TABLE kitchen_checkout_holds ADD COLUMN IF NOT EXISTS quote_snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_holds_group_day_unique
  ON kitchen_checkout_holds (group_id, operating_date) WHERE group_id IS NOT NULL;
ALTER TABLE kitchen_invitations ADD COLUMN IF NOT EXISTS days_snapshot jsonb;
ALTER TABLE kitchen_checkout_incidents ADD COLUMN IF NOT EXISTS quote_snapshot jsonb;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payout_partition text
  CHECK (payout_partition IS NULL OR payout_partition = 'per_day');
CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations (
  id serial PRIMARY KEY,
  source_id integer NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  visit_id integer NOT NULL REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT,
  allocation_revision integer NOT NULL DEFAULT 1 CHECK (allocation_revision > 0),
  component_key text NOT NULL,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents integer NOT NULL CHECK (tax_cents >= 0),
  service_fee_cents integer NOT NULL CHECK (service_fee_cents >= 0),
  stripe_fee_cents integer CHECK (stripe_fee_cents >= 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, allocation_revision, visit_id, component_key)
);
CREATE TABLE IF NOT EXISTS kitchen_booking_day_payouts (
  id serial PRIMARY KEY,
  source_id integer NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  visit_id integer NOT NULL REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT,
  allocation_revision integer NOT NULL DEFAULT 1 CHECK (allocation_revision > 0),
  operation_key text NOT NULL UNIQUE,
  eligible_at timestamptz,
  hold_reason text,
  released_at timestamptz,
  transfer_amount_cents integer CHECK (transfer_amount_cents >= 0),
  transfer_id text UNIQUE,
  no_entitlement boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, allocation_revision, visit_id)
);
CREATE INDEX IF NOT EXISTS kitchen_day_payout_due
  ON kitchen_booking_day_payouts (eligible_at, id)
  WHERE transfer_id IS NULL AND no_entitlement = false;
DROP TRIGGER IF EXISTS kitchen_booking_visits_on_insert ON kitchen_bookings;
CREATE TRIGGER kitchen_booking_visits_on_insert AFTER INSERT ON kitchen_bookings
  FOR EACH ROW WHEN (NEW.schedule_revision = 0)
  EXECUTE FUNCTION create_kitchen_booking_visits();
COMMIT;
