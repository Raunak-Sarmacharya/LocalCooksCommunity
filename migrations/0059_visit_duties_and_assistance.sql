-- Manual SQL release, per owner confirmation 4 October 2026. No Drizzle journal reconstruction.
-- Apply before deploying Phase 3. Nullable snapshot: no historical duty backfill.
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS visit_duties jsonb;
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS assistance_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS assistance_history jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE storage_bookings ADD COLUMN IF NOT EXISTS visit_duties jsonb;
ALTER TABLE storage_bookings ADD COLUMN IF NOT EXISTS assistance_history jsonb NOT NULL DEFAULT '[]'::jsonb;
