-- Add audit fields without assigning attendance outcomes to historical tours.
ALTER TYPE no_show_reason ADD VALUE IF NOT EXISTS 'manager_no_show';
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS no_show_at timestamp;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS outcome_recorded_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS outcome_history jsonb DEFAULT '[]'::jsonb;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS outcome_reminder_sent_at timestamp;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS outcome_notification_pending boolean NOT NULL DEFAULT false;
ALTER TABLE storage_listings ALTER COLUMN overstay_grace_period_days DROP NOT NULL;
ALTER TABLE storage_listings ALTER COLUMN overstay_grace_period_days DROP DEFAULT;
ALTER TABLE storage_listings ALTER COLUMN overstay_penalty_rate DROP NOT NULL;
ALTER TABLE storage_listings ALTER COLUMN overstay_penalty_rate DROP DEFAULT;
ALTER TABLE storage_listings ALTER COLUMN overstay_max_penalty_days DROP NOT NULL;
ALTER TABLE storage_listings ALTER COLUMN overstay_max_penalty_days DROP DEFAULT;
ALTER TABLE storage_bookings ADD COLUMN IF NOT EXISTS overstay_terms jsonb;
CREATE TABLE IF NOT EXISTS storage_overstay_quotes (
  id text PRIMARY KEY, chef_id integer NOT NULL REFERENCES users(id),
  storage_listing_id integer NOT NULL REFERENCES storage_listings(id),
  terms jsonb NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS payment_route text;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS checkout_attempt integer NOT NULL DEFAULT 0;
ALTER TABLE storage_overstay_records ADD COLUMN IF NOT EXISTS payment_route text;
ALTER TABLE storage_overstay_records ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
ALTER TABLE storage_overstay_records ADD COLUMN IF NOT EXISTS checkout_attempt integer NOT NULL DEFAULT 0;
ALTER TABLE storage_overstay_records ADD COLUMN IF NOT EXISTS items_removed_at timestamp;
ALTER TABLE storage_overstay_records
  ADD COLUMN IF NOT EXISTS penalty_notice_sent_at timestamp,
  ADD COLUMN IF NOT EXISTS chef_dispute_deadline timestamp,
  ADD COLUMN IF NOT EXISTS chef_disputed_at timestamp,
  ADD COLUMN IF NOT EXISTS chef_dispute_reason text,
  ADD COLUMN IF NOT EXISTS dispute_reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS dispute_reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispute_decision_reason text;
