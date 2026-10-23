-- Document tracking and "approve for booking without documents" (owner, Oct 23).
-- Per document the kitchen chooses Not needed / Track it / Required. The existing *_required booleans stay the
-- "Required" flag (Step 2 asks for it; new bookings pause when it is missing or expired); the new *_tracked flags mean
-- "Track it": asked as optional, kept with its expiry date and reminded, never pausing bookings.
ALTER TABLE location_requirements ADD COLUMN IF NOT EXISTS food_handler_cert_tracked boolean NOT NULL DEFAULT false;
ALTER TABLE location_requirements ADD COLUMN IF NOT EXISTS food_establishment_cert_tracked boolean NOT NULL DEFAULT false;
ALTER TABLE location_requirements ADD COLUMN IF NOT EXISTS insurance_tracked boolean NOT NULL DEFAULT false;

-- Insurance becomes a document like the other two: a file, a review status and an expiry date.
ALTER TABLE chef_kitchen_applications ADD COLUMN IF NOT EXISTS insurance_url text;
ALTER TABLE chef_kitchen_applications ADD COLUMN IF NOT EXISTS insurance_status text;
ALTER TABLE chef_kitchen_applications ADD COLUMN IF NOT EXISTS insurance_expiry date;
-- An insurance file already sent with kitchen documents moves over (no date yet: the customer is asked for one).
UPDATE chef_kitchen_applications
SET insurance_url = tier_data->'tierFiles'->>'tier2_insurance_document',
    insurance_status = CASE WHEN status = 'approved' AND current_tier >= 3 THEN 'approved' ELSE 'pending' END
WHERE insurance_url IS NULL AND tier_data->'tierFiles'->>'tier2_insurance_document' IS NOT NULL;

-- The kitchen approved this customer for booking without its documents (logged in kitchen_document_waiver_events).
ALTER TABLE chef_kitchen_applications ADD COLUMN IF NOT EXISTS documents_waived_at timestamptz;
ALTER TABLE chef_kitchen_applications ADD COLUMN IF NOT EXISTS documents_waived_by integer REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS kitchen_document_waiver_events (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES chef_kitchen_applications(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('waived', 'ended')),
  actor_id integer REFERENCES users(id) ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('manager', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_document_waiver_events_application_idx ON kitchen_document_waiver_events (application_id, created_at);
ALTER TABLE kitchen_document_waiver_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE kitchen_document_waiver_events FROM PUBLIC;
