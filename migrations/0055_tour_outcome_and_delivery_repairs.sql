-- Additive only: do not infer or rewrite historical attendance or note visibility.
ALTER TYPE no_show_reason ADD VALUE IF NOT EXISTS 'visitor_absent';
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS shared_manager_notes text;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS disruption_reason text;

-- The event and state change commit together. Payloads retain the event's snapshot.
CREATE TABLE IF NOT EXISTS tour_delivery_events (
  id serial PRIMARY KEY,
  viewing_id integer NOT NULL REFERENCES kitchen_viewings(id) ON DELETE CASCADE,
  event_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  delivered_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamp,
  last_error text,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tour_delivery_pending_idx
  ON tour_delivery_events(next_attempt_at, id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS tour_delivery_order_idx
  ON tour_delivery_events(viewing_id, id) WHERE completed_at IS NULL;
