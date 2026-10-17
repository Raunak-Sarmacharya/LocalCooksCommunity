-- Apply only after the ST12 server/client cutover is merged and live-verified.
-- Legacy rows retain their status and kitchen_bookings.storage_items history.
DROP TABLE pending_storage_extensions;
DROP TABLE storage_overstay_quotes;
ALTER TABLE storage_bookings DROP COLUMN overstay_terms,
  ALTER COLUMN rental_state SET NOT NULL,
  ADD CONSTRAINT storage_rentals_standalone CHECK (kitchen_booking_id IS NULL OR end_reason = 'legacy');
-- price_per_cubic_foot is retained until ChefViewingsList and KitchenPreviewPage
-- stop reading the shared StorageListing field; drop it in a follow-up migration.
ALTER TABLE storage_listings DROP COLUMN availability_calendar,
  DROP COLUMN overstay_grace_period_days, DROP COLUMN overstay_penalty_rate,
  DROP COLUMN overstay_max_penalty_days;
