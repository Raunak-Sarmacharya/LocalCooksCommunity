-- A replacement license submission and the license it replaces are two different
-- documents with two different expiry dates, but there was only one date column.
--
-- POST /api/manager/locations/:id wrote the NEW date into kitchen_license_expiry the
-- moment a replacement was uploaded, while kitchen_license_url still pointed at the
-- OLD (still-live) document. From that moment the date no longer described the
-- document that was actually governing the listing:
--
--   * a live license expiring in 5 days + a 2028 replacement = the "expiring soon"
--     warning disappeared immediately, even though nothing had been approved;
--   * if the admin never reviewed the submission, the warning never came back.
--
-- The live document's expiry must keep describing the live document. The pending
-- document gets its own column, mirroring kitchen_license_pending_url /
-- kitchen_license_pending_submitted_at which already model this pair.
--
-- Promotion happens in the admin approval handler (server/routes/admin.ts):
-- approve copies pending -> live and clears pending; reject clears pending and
-- leaves the live date untouched.
--
-- Nullable with no default, so this is a metadata-only change in Postgres 11+.
ALTER TABLE locations
ADD COLUMN IF NOT EXISTS kitchen_license_pending_expiry date;

COMMENT ON COLUMN locations.kitchen_license_pending_expiry IS
  'Expiry date printed on the replacement license awaiting admin review. kitchen_license_expiry keeps describing the live/approved document until the replacement is approved.';
