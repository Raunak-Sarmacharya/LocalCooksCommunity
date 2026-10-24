-- Kitchen "Add customer" (owner, Oct 24): the kitchen invites someone by email; they accept by signing in or creating an
-- account with that email. Only a hash of the link token is stored. Documents the kitchen uploads now wait here and
-- are copied to the customer's application (as approved) when they accept.
CREATE TABLE IF NOT EXISTS kitchen_customer_invites (
  id serial PRIMARY KEY,
  location_id integer NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  invited_by integer REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  business_name text,
  requirements_choice text NOT NULL CHECK (requirements_choice IN ('customer', 'uploaded', 'waived')),
  documents jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'withdrawn', 'expired')),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_by integer REFERENCES users(id) ON DELETE SET NULL,
  application_id integer REFERENCES chef_kitchen_applications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_customer_invites_token_idx ON kitchen_customer_invites (token_hash);
-- One open invitation per person per location.
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_customer_invites_open_idx ON kitchen_customer_invites (location_id, lower(email)) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS kitchen_customer_invites_location_idx ON kitchen_customer_invites (location_id, status, created_at);
ALTER TABLE kitchen_customer_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE kitchen_customer_invites FROM PUBLIC;
