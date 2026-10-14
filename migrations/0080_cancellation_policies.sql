-- Write only: apply before deploying code. Published versions are append-only;
-- current policy is the highest published version, so old versions remain published.
CREATE TABLE kitchen_cancellation_policies (
  id serial PRIMARY KEY, kitchen_id integer NOT NULL REFERENCES kitchens(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'retired')),
  notice_hours integer NOT NULL CHECK (notice_hours IN (24,48,72)),
  late_charge_percent integer NOT NULL CHECK (late_charge_percent IN (50,100)),
  tiers jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
  published_by integer REFERENCES users(id), admin_override_reason text,
  CONSTRAINT kitchen_cancellation_policy_version UNIQUE (kitchen_id, version),
  CHECK (tiers = jsonb_build_array(jsonb_build_object('minHoursBeforeStart', notice_hours, 'refundPercent', 100),
    jsonb_build_object('minHoursBeforeStart', 0, 'refundPercent', 100-late_charge_percent)))
);
CREATE FUNCTION protect_published_cancellation_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN RAISE EXCEPTION 'Published cancellation policies are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cancellation_policy_immutable BEFORE UPDATE OR DELETE ON kitchen_cancellation_policies
  FOR EACH ROW EXECUTE FUNCTION protect_published_cancellation_policy();
ALTER TABLE kitchen_bookings ADD COLUMN cancellation_policy_snapshot jsonb;
ALTER TABLE kitchen_bookings ADD COLUMN cancellation_effective_at timestamptz;
ALTER TABLE kitchen_bookings ADD COLUMN cancellation_operation_key text;
ALTER TABLE kitchen_bookings ADD COLUMN cancellation_cause text;
CREATE FUNCTION protect_booking_cancellation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancellation_policy_snapshot IS NOT NULL AND NEW.cancellation_policy_snapshot IS DISTINCT FROM OLD.cancellation_policy_snapshot
    THEN RAISE EXCEPTION 'Accepted cancellation policy snapshots are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_cancellation_snapshot_immutable BEFORE UPDATE ON kitchen_bookings
  FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot();
CREATE TABLE cancellation_policy_audit (
  id serial PRIMARY KEY, kitchen_id integer REFERENCES kitchens(id), actor_id integer NOT NULL REFERENCES users(id),
  reason text NOT NULL, before_state jsonb, after_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (key,value,description) VALUES
  ('cancellation_notice_options','[24,48,72]','Allowed cancellation notice periods'),
  ('cancellation_charge_options','[50,100]','Allowed late cancellation percentages'),
  ('cancellation_default','{"notice":24,"charge":100}','Default for new kitchens') ON CONFLICT (key) DO NOTHING;
-- Each mapping is emitted as a NOTICE for the deployment log. No existing booking is changed.
DO $$ DECLARE mapping record; BEGIN
  FOR mapping IN SELECT k.id, COALESCE(k.cancellation_policy_hours,l.cancellation_policy_hours,24) original_hours,
    (SELECT h FROM unnest(ARRAY[24,48,72]) h ORDER BY abs(h-COALESCE(k.cancellation_policy_hours,l.cancellation_policy_hours,24)),h LIMIT 1) notice
    FROM kitchens k LEFT JOIN locations l ON l.id=k.location_id LOOP
    INSERT INTO kitchen_cancellation_policies(kitchen_id,version,notice_hours,late_charge_percent,tiers)
    VALUES(mapping.id,1,mapping.notice,100,jsonb_build_array(jsonb_build_object('minHoursBeforeStart',mapping.notice,'refundPercent',100),
      jsonb_build_object('minHoursBeforeStart',0,'refundPercent',0)));
    RAISE NOTICE 'Cancellation policy kitchen %: % hours -> % hours, charge 100%%',mapping.id,mapping.original_hours,mapping.notice;
  END LOOP;
END $$;
-- Server-only tables: same posture as 0075/0077 (RLS on, no browser roles).
ALTER TABLE kitchen_cancellation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_policy_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE kitchen_cancellation_policies, cancellation_policy_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE kitchen_cancellation_policies_id_seq, cancellation_policy_audit_id_seq FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE kitchen_cancellation_policies, cancellation_policy_audit FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE kitchen_cancellation_policies_id_seq, cancellation_policy_audit_id_seq FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
