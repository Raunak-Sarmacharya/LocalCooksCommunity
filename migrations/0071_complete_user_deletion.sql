-- Complete account deletion, including manager-owned locations and kitchens.
-- Apply atomically before deploying the updated deletion service.
-- Names are resolved from the catalog; no assumptions about FK naming.
DO $$
DECLARE
  target text[];
  existing record;
  relation regclass;
  targets text[][] := ARRAY[
    ARRAY['locations','manager_id','users','CASCADE'],
    ARRAY['kitchens','location_id','locations','CASCADE'],
    ARRAY['kitchen_bookings','kitchen_id','kitchens','CASCADE'],
    ARRAY['manager_notifications','location_id','locations','CASCADE'],
    ARRAY['storage_overstay_quotes','chef_id','users','CASCADE'],
    ARRAY['storage_overstay_quotes','storage_listing_id','storage_listings','CASCADE'],
    ARRAY['kitchen_booking_attendance_events','booking_id','kitchen_bookings','CASCADE'],
    ARRAY['kitchen_booking_attendance_events','visit_id','kitchen_booking_visits','CASCADE'],
    ARRAY['kitchen_booking_attendance_events','actor_id','users','CASCADE'],
    ARRAY['booking_lifecycle_events','booking_id','kitchen_bookings','CASCADE'],
    ARRAY['booking_lifecycle_events','actor_id','users','CASCADE'],
    ARRAY['kitchen_booking_changes','booking_id','kitchen_bookings','CASCADE'],
    ARRAY['kitchen_booking_changes','manager_id','users','CASCADE'],
    ARRAY['commitment_problems','booking_id','kitchen_bookings','CASCADE'],
    ARRAY['commitment_problems','viewing_id','kitchen_viewings','CASCADE'],
    ARRAY['commitment_problems','kitchen_id','kitchens','CASCADE'],
    ARRAY['commitment_problems','reported_by','users','CASCADE'],
    ARRAY['commitment_problems','claimed_by','users','SET NULL'],
    ARRAY['platform_settings','updated_by','users','SET NULL'],
    ARRAY['chef_kitchen_applications','source_tour_id','kitchen_viewings','SET NULL'],
    ARRAY['tour_feedback_responses','viewing_id','kitchen_viewings','CASCADE'],
    ARRAY['tour_repeat_authorizations','source_tour_id','kitchen_viewings','CASCADE'],
    ARRAY['tour_repeat_authorizations','used_by_tour_id','kitchen_viewings','CASCADE'],
    ARRAY['kitchen_viewings','repeat_authorization_id','tour_repeat_authorizations','SET NULL']
  ];
BEGIN
  FOREACH target SLICE 1 IN ARRAY targets LOOP
    relation := to_regclass(format('%I', target[1]));
    IF relation IS NULL THEN RAISE EXCEPTION 'Missing deletion prerequisite: %',target[1]; END IF;
    SELECT c.conname INTO existing FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.contype='f' AND c.conrelid=relation AND a.attname=target[2]
        AND c.confrelid=to_regclass(format('%I',target[3]));
    IF existing.conname IS NULL THEN RAISE EXCEPTION 'Missing deletion FK: %.%',target[1],target[2]; END IF;
    IF target[4]='SET NULL' THEN
      EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL',relation,target[2]);
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',relation,existing.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s',
      relation,existing.conname,target[2],target[3],target[4]);
  END LOOP;
END $$;

-- Ordinary permission edits/deletes stay immutable. A parent cascade or a
-- transaction scoped to the account that owns this record may remove it.
CREATE OR REPLACE FUNCTION guard_tour_repeat_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleting_id integer := nullif(current_setting('localcooks.deleting_user_id',true),'')::integer;
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM kitchen_viewings WHERE id=OLD.source_tour_id)
      OR (OLD.used_by_tour_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM kitchen_viewings WHERE id=OLD.used_by_tour_id))
      OR (deleting_id IS NOT NULL AND (
        OLD.granted_by=deleting_id OR OLD.revoked_by=deleting_id
        OR EXISTS(SELECT 1 FROM kitchen_viewings v LEFT JOIN locations l ON l.id=v.location_id
          WHERE v.id IN (OLD.source_tour_id,OLD.used_by_tour_id) AND (v.chef_id=deleting_id OR l.manager_id=deleting_id))
      )) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Repeat tour permission audit records cannot be deleted';
  END IF;
  IF ROW(NEW.source_tour_id,NEW.source_version,NEW.request_key,NEW.granted_by,NEW.reason,NEW.granted_at,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.source_tour_id,OLD.source_version,OLD.request_key,OLD.granted_by,OLD.reason,OLD.granted_at,OLD.expires_at)
    OR (OLD.used_at IS NOT NULL AND ROW(NEW.used_at,NEW.used_by_tour_id) IS DISTINCT FROM ROW(OLD.used_at,OLD.used_by_tour_id))
    OR (OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at,NEW.revoked_by,NEW.revoke_reason) IS DISTINCT FROM ROW(OLD.revoked_at,OLD.revoked_by,OLD.revoke_reason))
  THEN RAISE EXCEPTION 'Repeat tour permission audit records cannot be rewritten'; END IF;
  RETURN NEW;
END $$;

-- On somebody else's surviving tour, erase only the departing actor's identity.
-- All visit times, results, explanations and correction links stay immutable.
CREATE OR REPLACE FUNCTION protect_tour_visit_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleting_id integer := nullif(current_setting('localcooks.deleting_user_id',true),'')::integer;
BEGIN
  IF TG_OP='UPDATE' AND deleting_id IS NOT NULL AND OLD.actor_id=deleting_id AND NEW.actor_id IS NULL
    AND (to_jsonb(NEW)-'actor_id')=(to_jsonb(OLD)-'actor_id') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM kitchen_viewings WHERE id=OLD.viewing_id)
    THEN RAISE EXCEPTION 'Tour visit events are immutable; append a correction'; END IF;
  RETURN OLD;
END $$;

-- A failed external cleanup remains retryable after the Postgres user is gone.
-- There is deliberately no FK to users; delete the job after external success.
CREATE TABLE IF NOT EXISTS user_deletion_jobs (
  user_id integer PRIMARY KEY,
  username text NOT NULL,
  role text,
  firebase_uid text,
  location_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_deletion_jobs FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE user_deletion_jobs FROM %I',api_role);
    END IF;
  END LOOP;
END $$;

-- A Firebase identity awaiting cleanup cannot register itself again while the
-- external delete is being retried. Enforce this for every insert/update path.
CREATE OR REPLACE FUNCTION prevent_user_recreation_during_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.firebase_uid IS NOT NULL AND EXISTS(SELECT 1 FROM user_deletion_jobs WHERE firebase_uid=NEW.firebase_uid)
    THEN RAISE EXCEPTION 'Account deletion is still in progress' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_pending_deletion ON users;
DO $$ BEGIN
  EXECUTE format('CREATE TRIGGER users_pending_deletion BEFORE INSERT OR UPDATE OF firebase_uid ON users FOR EACH ROW EXECUTE FUNCTION %I.prevent_user_recreation_during_deletion()',current_schema());
END $$;
