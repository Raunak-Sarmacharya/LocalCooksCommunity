-- Write only: the lead applies this migration to dev.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS max_advance_booking_days integer NOT NULL DEFAULT 30;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS turnover_buffer_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS max_advance_booking_days integer;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS turnover_buffer_enabled boolean;
INSERT INTO platform_settings (key, value, description) VALUES
  ('booking_max_advance_days_cap', '90', 'Kitchens cannot set a booking window longer than this many days')
  ON CONFLICT (key) DO NOTHING;
