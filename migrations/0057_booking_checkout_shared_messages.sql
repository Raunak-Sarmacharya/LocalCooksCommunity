-- Preserve original chef/internal notes; never backfill unknown provenance.
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS checkout_manager_message text;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS checkout_manager_message text;
