-- Unapplied: durable checkout references exist even when no booking was created.
CREATE TABLE kitchen_checkout_incidents (
  id serial PRIMARY KEY,
  session_id text NOT NULL UNIQUE,
  chef_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kitchen_id integer NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  payment_intent_id text,
  booking_id integer REFERENCES kitchen_bookings(id) ON DELETE RESTRICT,
  operating_date text NOT NULL,
  outcome text NOT NULL DEFAULT 'awaiting_checkout',
  inventory_conflict boolean NOT NULL DEFAULT false,
  money_status text NOT NULL DEFAULT 'unverified',
  amount_cents integer,
  currency text NOT NULL DEFAULT 'cad',
  refund_id text,
  money_attempted_at timestamptz,
  error text,
  notification_state text,
  recovery_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kitchen_checkout_incidents_recovery ON kitchen_checkout_incidents(id)
  WHERE outcome NOT IN ('booking_created', 'closed');
CREATE INDEX kitchen_checkout_incidents_payment ON kitchen_checkout_incidents(payment_intent_id);
