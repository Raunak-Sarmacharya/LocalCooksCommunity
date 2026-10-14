-- WRITE ONLY: session extensions and chef-approved extra-time charges. Do not apply in the build session.
-- docs/architecture/phase0/build-session-extensions.md. Each extension/extra-time charge is its own separate charge;
-- the accepted cancellation snapshot (0080 trigger) is never rewritten: paid extra time is excluded from cancellation refunds.
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS auto_approve_session_extensions boolean NOT NULL DEFAULT false;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS session_extensions_admin_override boolean;

CREATE TABLE IF NOT EXISTS kitchen_booking_extensions (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id) ON DELETE CASCADE,
  visit_id integer REFERENCES kitchen_booking_visits(id),
  block_index integer NOT NULL,
  request_key text NOT NULL,
  -- early_start: original_end_* / end_* hold the original and new START (the moved boundary).
  kind text NOT NULL CHECK (kind IN ('request','offer','extra_time','early_start')),
  minutes integer NOT NULL CHECK (minutes > 0),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  -- The manager chose Free (applied at once, no payment) or Charge (the chef accepts and pays).
  free boolean NOT NULL DEFAULT false,
  quote jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','offered','approved','declined','expired','paid','cancelled','disputed')),
  payment_intent_id text UNIQUE,
  requested_by integer NOT NULL REFERENCES users(id),
  decided_by integer REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  note text,
  original_end_at timestamptz NOT NULL,
  original_end_time text NOT NULL,
  end_at timestamptz NOT NULL,
  end_time text NOT NULL,
  hold_id text,
  operation jsonb,
  authorized_at timestamptz,
  auto_approve boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  applied_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Free offers/early starts carry no amount; a chef request approved for free keeps the released hold amount for the record.
  CONSTRAINT kitchen_booking_extensions_free_amount CHECK ((free AND amount_cents = 0 AND kind IN ('offer','early_start')) OR (free AND kind = 'request' AND amount_cents > 0) OR (NOT free AND amount_cents > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_booking_extensions_request_key ON kitchen_booking_extensions (booking_id, request_key);
CREATE INDEX IF NOT EXISTS kitchen_booking_extensions_booking_idx ON kitchen_booking_extensions (booking_id, id);
CREATE INDEX IF NOT EXISTS kitchen_booking_extensions_expiry_idx ON kitchen_booking_extensions (expires_at, id)
  WHERE status IN ('requested','offered') AND escalated_at IS NULL;
CREATE INDEX IF NOT EXISTS kitchen_booking_extensions_recovery_idx ON kitchen_booking_extensions (id) WHERE operation->>'state' = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_booking_extensions_active_idx ON kitchen_booking_extensions (booking_id, block_index)
  WHERE kind <> 'extra_time' AND status IN ('requested','offered','approved') AND applied_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_booking_extensions_extra_time_idx ON kitchen_booking_extensions (booking_id, block_index)
  WHERE kind = 'extra_time' AND status NOT IN ('declined','cancelled');

-- Explicit kill switch; default enabled, while every kitchen's automatic approval remains OFF.
INSERT INTO platform_settings (key, value, description) VALUES
  ('session_extensions_enabled', '1', 'Allow session extensions and chef-approved extra-time charges; 0 pauses new money operations')
  ON CONFLICT (key) DO NOTHING;

-- Server-only table: same posture as 0075/0077/0080 (RLS on, no browser roles).
ALTER TABLE kitchen_booking_extensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE kitchen_booking_extensions FROM PUBLIC;
REVOKE ALL ON SEQUENCE kitchen_booking_extensions_id_seq FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE kitchen_booking_extensions FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE kitchen_booking_extensions_id_seq FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
