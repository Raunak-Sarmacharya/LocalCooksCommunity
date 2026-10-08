CREATE TABLE IF NOT EXISTS tour_repeat_authorizations (
  id serial PRIMARY KEY,
  source_tour_id integer NOT NULL REFERENCES kitchen_viewings(id) ON DELETE RESTRICT,
  source_version text NOT NULL,
  request_key text NOT NULL UNIQUE,
  granted_by integer NOT NULL CHECK (granted_by > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 2000),
  granted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_tour_id integer UNIQUE REFERENCES kitchen_viewings(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by integer CHECK (revoked_by > 0),
  revoke_reason text CHECK (length(btrim(revoke_reason)) BETWEEN 10 AND 2000),
  CHECK (expires_at > granted_at),
  CHECK ((used_at IS NULL) = (used_by_tour_id IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS tour_repeat_one_unused_idx ON tour_repeat_authorizations(source_tour_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS repeat_authorization_id integer
  REFERENCES tour_repeat_authorizations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS tour_repeat_attempts_idx ON kitchen_viewings(repeat_authorization_id);

-- Keep permission provenance immutable; usage/revocation are irreversible audited transitions.
CREATE OR REPLACE FUNCTION guard_tour_repeat_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Repeat tour permission audit records cannot be deleted'; END IF;
  IF ROW(NEW.source_tour_id, NEW.source_version, NEW.request_key, NEW.granted_by, NEW.reason, NEW.granted_at, NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.source_tour_id, OLD.source_version, OLD.request_key, OLD.granted_by, OLD.reason, OLD.granted_at, OLD.expires_at)
    OR (OLD.used_at IS NOT NULL AND ROW(NEW.used_at, NEW.used_by_tour_id) IS DISTINCT FROM ROW(OLD.used_at, OLD.used_by_tour_id))
    OR (OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at, NEW.revoked_by, NEW.revoke_reason) IS DISTINCT FROM ROW(OLD.revoked_at, OLD.revoked_by, OLD.revoke_reason))
  THEN RAISE EXCEPTION 'Repeat tour permission audit records cannot be rewritten'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tour_repeat_authorization_audit ON tour_repeat_authorizations;
CREATE TRIGGER tour_repeat_authorization_audit BEFORE UPDATE OR DELETE ON tour_repeat_authorizations
  FOR EACH ROW EXECUTE FUNCTION guard_tour_repeat_authorization();
COMMENT ON TABLE tour_repeat_authorizations IS
  'Admin-only permission for one additional kitchen introduction. First request uses it atomically; verified failed attempts may recover under the same permission. Existing applications always prohibit new tours.';

-- Firebase-authenticated staff use the trusted backend connection. Supabase's
-- browser API roles must not read private reasons or issue their own permissions.
ALTER TABLE tour_repeat_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tour_repeat_authorizations FROM PUBLIC;
REVOKE ALL ON SEQUENCE tour_repeat_authorizations_id_seq FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE tour_repeat_authorizations FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE tour_repeat_authorizations_id_seq FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
