-- WP-I: Stripe webhook event ledger (idempotent receipt) and equipment listing archive/delete safety.
-- NOT APPLIED. The Stripe webhook route requires stripe_webhook_events once this ships; apply before deploying the code.

-- 1) One row per Stripe event id. processed_at is set only after the handler succeeded, so a failed
--    delivery stays unprocessed and Stripe's retry runs the handler again.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_unprocessed_idx ON stripe_webhook_events (received_at) WHERE processed_at IS NULL;

-- 2) Equipment listings with booking history are archived, never deleted.
ALTER TABLE equipment_listings ADD COLUMN IF NOT EXISTS archived_at timestamp;

-- 3) equipment_bookings.equipment_listing_id: ON DELETE CASCADE -> RESTRICT, whatever the existing constraint is named.
DO $$
DECLARE fk record;
BEGIN
  FOR fk IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = 'equipment_bookings'::regclass
      AND con.confrelid = 'equipment_listings'::regclass
      AND att.attname = 'equipment_listing_id'
  LOOP
    EXECUTE format('ALTER TABLE equipment_bookings DROP CONSTRAINT %I', fk.conname);
  END LOOP;
  ALTER TABLE equipment_bookings
    ADD CONSTRAINT equipment_bookings_equipment_listing_id_fkey
    FOREIGN KEY (equipment_listing_id) REFERENCES equipment_listings(id) ON DELETE RESTRICT;
END $$;
