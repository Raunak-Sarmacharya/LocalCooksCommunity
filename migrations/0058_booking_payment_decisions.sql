ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS payment_decision jsonb;
ALTER TABLE storage_bookings ADD COLUMN IF NOT EXISTS cancellation_accepted_at timestamp;
CREATE TABLE IF NOT EXISTS booking_lifecycle_events (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id),
  kind text NOT NULL,
  actor_id integer REFERENCES users(id),
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  emails jsonb NOT NULL DEFAULT '[]',
  delivered_email_keys jsonb NOT NULL DEFAULT '[]',
  lease_until timestamp,
  lease_token text,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_lifecycle_history_idx ON booking_lifecycle_events (booking_id, id);
