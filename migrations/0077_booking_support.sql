-- Additive, server-only booking support records. The lead applies this migration.
CREATE TABLE IF NOT EXISTS support_actions (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id),
  case_ref text NOT NULL,
  action_type text NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  acting_for text NOT NULL CHECK (acting_for IN ('chef', 'manager', 'local_cooks')),
  request_source text NOT NULL CHECK (request_source IN ('message', 'call', 'email', 'in_person', 'proactive')),
  source_ref text,
  reason_code text NOT NULL CHECK (length(btrim(reason_code)) > 0),
  internal_note text NOT NULL CHECK (length(btrim(internal_note)) >= 10),
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency text NOT NULL DEFAULT 'CAD',
  funded_by text NOT NULL CHECK (funded_by IN ('manager', 'local_cooks', 'none')),
  exception boolean NOT NULL DEFAULT false,
  before_state jsonb NOT NULL,
  after_state jsonb,
  operation_key text NOT NULL UNIQUE,
  provider_refs jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'executing' CHECK (status IN ('executing', 'verified', 'failed', 'recovery_required')),
  error text,
  notified_event_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS support_actions_booking_idx ON support_actions(booking_id, id);

-- Request/why/before evidence is immutable; only the executing outcome may be completed.
CREATE OR REPLACE FUNCTION protect_support_action_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Support action evidence cannot be deleted'; END IF;
  IF OLD.status NOT IN ('executing','recovery_required') OR
    (to_jsonb(NEW) - ARRAY['status','after_state','provider_refs','error','notified_event_ids','completed_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','after_state','provider_refs','error','notified_event_ids','completed_at']) THEN
    RAISE EXCEPTION 'Support action evidence is append-only';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_action_evidence ON support_actions;
CREATE TRIGGER support_action_evidence BEFORE UPDATE OR DELETE ON support_actions
  FOR EACH ROW EXECUTE FUNCTION protect_support_action_evidence();

CREATE TABLE IF NOT EXISTS booking_flags (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id),
  kind text NOT NULL CHECK (kind IN ('chargeback', 'payout_failed', 'transfer_failed', 'manual_hold')),
  provider_ref text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by integer REFERENCES users(id),
  note text
);
CREATE INDEX IF NOT EXISTS booking_flags_booking_idx ON booking_flags(booking_id);
-- Keep closed provider flags as tombstones: an old webhook cannot reopen a resolved incident.
CREATE UNIQUE INDEX IF NOT EXISTS booking_flags_provider_unique ON booking_flags(booking_id, kind, provider_ref)
  WHERE provider_ref IS NOT NULL;
ALTER TABLE support_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE support_actions, booking_flags FROM PUBLIC;
REVOKE ALL ON SEQUENCE support_actions_id_seq, booking_flags_id_seq FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE support_actions, booking_flags FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE support_actions_id_seq, booking_flags_id_seq FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
