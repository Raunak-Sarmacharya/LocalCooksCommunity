-- Unapplied: standalone storage rentals (WP-ST1, plan-storage-rentals-2026-10.md §1 + §7 owner answers).
-- Additive only; the running app ignores every new column. Refuses to run while open legacy storage rows exist.
-- Needs btree_gist (verify on prod before applying there; dev has it available).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage_bookings WHERE status NOT IN ('cancelled','completed')) THEN
    RAISE EXCEPTION 'Open legacy storage rows exist; end them before the storage cutover'; END IF; END $$;

INSERT INTO platform_settings (key, value, description) VALUES
 ('storage_max_term_days','30','Longest storage term a chef can pay for at once (1-30)'),
 ('storage_kitchen_disposal_enabled','false','Kitchens may record disposal of abandoned items (enable after NL counsel review)')
ON CONFLICT (key) DO NOTHING;

-- base_price is the DAILY price in cents for storage-v1 (the API forces pricing_model 'daily').
ALTER TABLE storage_listings
  ADD COLUMN unit_count integer NOT NULL DEFAULT 1 CHECK (unit_count BETWEEN 1 AND 200),
  ADD COLUMN max_term_days integer CHECK (max_term_days BETWEEN 1 AND 30);  -- NULL = platform max

-- All dates are kitchen-local calendar days; paid_through is the last paid day, inclusive.
ALTER TABLE storage_bookings
  ADD COLUMN rental_state text CHECK (rental_state IN ('requested','declined','expired','withdrawn',
     'reserved','active','move_out_requested','removal_review','ended')),
  ADD COLUMN end_reason text CHECK (end_reason IN ('cleared','auto_cleared','claim','cancelled',
     'kitchen_reclaim','admin_ended','unit_released','legacy')),
  ADD COLUMN unit_index integer,
  ADD COLUMN term_start date,
  ADD COLUMN paid_through date,
  ADD COLUMN timezone text,
  ADD COLUMN rental_terms jsonb,       -- frozen {version:'storage-v1', dailyPriceCents, taxRatePercent, graceDays, removalReviewAfterDays,
                                       --  maxTermDays, cancellationPolicy, acceptedAt, disclosureVersion}
  ADD COLUMN response_deadline timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN decided_by integer REFERENCES users(id),
  ADD COLUMN decline_reason text,
  ADD COLUMN handover_photo_urls jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN handover_at timestamptz,
  ADD COLUMN reclaim_end_on date,
  ADD COLUMN reclaim jsonb,            -- {servedAt, endOn, by:'kitchen'|'local_cooks', actorId, reason, refundCents}
  ADD COLUMN removal_review jsonb,     -- {openedAt, finalNoticeAt, perishablesAfter, othersAfter, items[], photos[], actions[]}
  ADD COLUMN released_on date,
  ADD COLUMN needs_cleaning boolean NOT NULL DEFAULT false,
  ADD COLUMN occupancy daterange,
  ADD COLUMN reopened_from timestamptz;

CREATE EXTENSION IF NOT EXISTS btree_gist;
-- Backstop for "two chefs, one shelf"; services also lock the storage_listings row FOR UPDATE.
ALTER TABLE storage_bookings ADD CONSTRAINT storage_unit_no_overlap
  EXCLUDE USING gist (storage_listing_id WITH =, unit_index WITH =, occupancy WITH &&)
  WHERE (rental_state IN ('requested','reserved','active','move_out_requested','removal_review') OR needs_cleaning);

CREATE TABLE storage_rental_terms (
  id serial PRIMARY KEY,
  rental_id integer NOT NULL REFERENCES storage_bookings(id) ON DELETE RESTRICT,
  seq integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('first','extension')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  days integer NOT NULL CHECK (days BETWEEN 1 AND 30),
  daily_price_cents integer NOT NULL,
  subtotal_cents integer NOT NULL,
  tax_cents integer NOT NULL,
  service_fee_cents integer NOT NULL,
  total_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('awaiting_payment','authorized','paid','failed','cancelled')),
  request_key text NOT NULL UNIQUE,
  operation jsonb,                     -- {key, attemptKey, action:'authorize'|'pay', state, checkout, returnUrl}
  checkout_session_id text,
  payment_intent_id text UNIQUE,
  payment_transaction_id integer REFERENCES payment_transactions(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, seq),
  CHECK (ends_on = starts_on + days - 1)
);
CREATE UNIQUE INDEX storage_terms_one_open ON storage_rental_terms (rental_id) WHERE status IN ('awaiting_payment','authorized');

CREATE INDEX payment_transactions_storage_payout_due ON payment_transactions (payout_eligible_at, id)
  WHERE payout_timing = 'storage_term' AND transfer_id IS NULL;

ALTER TABLE commitment_problems ADD COLUMN storage_booking_id integer REFERENCES storage_bookings(id);
ALTER TABLE booking_flags ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN storage_booking_id integer REFERENCES storage_bookings(id),
  ADD CONSTRAINT booking_flags_one_parent CHECK (num_nonnulls(booking_id, storage_booking_id) = 1);
CREATE UNIQUE INDEX booking_flags_storage_provider_unique ON booking_flags (storage_booking_id, kind, provider_ref)
  WHERE provider_ref IS NOT NULL AND storage_booking_id IS NOT NULL;
ALTER TABLE support_actions ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN storage_booking_id integer REFERENCES storage_bookings(id),
  ADD CONSTRAINT support_actions_one_parent CHECK (num_nonnulls(booking_id, storage_booking_id) = 1);
-- booking_documents.booking_id has no FK, so a type column is enough to key storage documents.
ALTER TABLE booking_documents ADD COLUMN booking_type text NOT NULL DEFAULT 'kitchen' CHECK (booking_type IN ('kitchen','storage'));

UPDATE storage_bookings SET rental_state = 'ended', end_reason = 'legacy' WHERE rental_state IS NULL;
