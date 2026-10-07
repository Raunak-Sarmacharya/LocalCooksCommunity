-- Immutable visit facts are independent of notification delivery. JSON is retained as an archive.
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'pending';
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS visit_result text;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS confirmation_verified boolean NOT NULL DEFAULT false;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS visit_evidence_state text NOT NULL DEFAULT 'ready';
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS visit_evidence_issue text;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS visit_evidence_migrated_at timestamp;
ALTER TABLE kitchen_viewings ALTER COLUMN visit_evidence_migrated_at SET DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE IF NOT EXISTS tour_visit_events (
  id serial PRIMARY KEY, viewing_id integer NOT NULL REFERENCES kitchen_viewings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('arrival','departure','result','legacy_evidence','repair')),
  event_key text NOT NULL UNIQUE, supersedes_id integer REFERENCES tour_visit_events(id),
  actor_id integer, actor_role text, source text NOT NULL, actual_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, scheduled_at timestamptz NOT NULL,
  appointment_revision integer NOT NULL DEFAULT 1,
  result text CHECK(result IS NULL OR result IN ('completed','visitor_absent','disrupted')),
  shared_explanation text, internal_notes text, data jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS tour_visit_events_viewing_order ON tour_visit_events(viewing_id,recorded_at,id);
CREATE UNIQUE INDEX IF NOT EXISTS tour_visit_events_one_successor ON tour_visit_events(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE OR REPLACE FUNCTION pg_temp.tour_visit_instant(value jsonb) RETURNS timestamptz LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN RETURN NULL; END IF;
  RETURN (value #>> '{}')::timestamptz;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.tour_visit_actor(value jsonb) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  IF (value #>> '{}') ~ '^[1-9][0-9]{0,9}$' THEN
    IF (value #>> '{}')::numeric<=2147483647 THEN RETURN (value #>> '{}')::integer; END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DO $$
DECLARE
  tour record; entry jsonb; ordinal integer; arrival_count integer; departure_count integer;
  arrival timestamptz; departure timestamptz; actual timestamptz; recorded timestamptz; schedule timestamptz;
  actor integer; valid boolean; confirmed boolean; issue text; result_value text; last_result_id integer;
  inserted_id integer; last_result_value text; previous_recorded timestamptz;
BEGIN
  FOR tour IN SELECT * FROM kitchen_viewings WHERE visit_evidence_migrated_at IS NULL ORDER BY id FOR UPDATE LOOP
    valid:=true; issue:=NULL; arrival:=NULL; departure:=NULL; arrival_count:=0; departure_count:=0;
    schedule:=tour.scheduled_at AT TIME ZONE 'UTC';
    confirmed:=tour.status::text='confirmed' OR tour.confirmed_at IS NOT NULL;
    IF jsonb_typeof(COALESCE(tour.outcome_history,'[]'::jsonb))='array' THEN
      confirmed:=confirmed OR EXISTS(SELECT 1 FROM jsonb_array_elements(tour.outcome_history) e
        WHERE (e->>'from'='confirmed' OR e->>'to'='confirmed') AND pg_temp.tour_visit_instant(e->'recordedAt')<=CURRENT_TIMESTAMP);
    END IF;
    INSERT INTO tour_visit_events(viewing_id,kind,event_key,source,scheduled_at,data)
      VALUES(tour.id,'legacy_evidence','legacy-snapshot:'||tour.id,'legacy_snapshot',schedule,
        jsonb_build_object('attendanceHistory',tour.attendance_history,'outcomeHistory',tour.outcome_history,
          'checkedInAt',tour.checked_in_at,'checkedOutAt',tour.checked_out_at,'status',tour.status,
          'completedAt',tour.completed_at,'noShowAt',tour.no_show_at,'disruptionReason',tour.disruption_reason)) ON CONFLICT(event_key) DO NOTHING;
    IF jsonb_typeof(COALESCE(tour.attendance_history,'[]'::jsonb))<>'array' THEN valid:=false;
    ELSE
      FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(tour.attendance_history,'[]'::jsonb)) LOOP
        actual:=pg_temp.tour_visit_instant(entry->'actualAt'); recorded:=pg_temp.tour_visit_instant(entry->'recordedAt');
        actor:=pg_temp.tour_visit_actor(entry->'actorId');
        IF jsonb_typeof(entry)<>'object' OR entry->>'action' IS NULL OR entry->>'action' NOT IN ('check_in','check_out')
          OR actor IS NULL OR entry->>'source' IS NULL OR entry->>'source' NOT IN ('visitor','manager_assisted')
          OR actual IS NULL OR recorded IS NULL OR actual>recorded OR recorded>CURRENT_TIMESTAMP
          OR pg_temp.tour_visit_instant(entry->'scheduledAt') IS DISTINCT FROM schedule
          OR (entry->>'source'='manager_assisted' AND (jsonb_typeof(entry->'reason') IS DISTINCT FROM 'string' OR length(trim(entry->>'reason')) NOT BETWEEN 10 AND 2000))
          THEN valid:=false; END IF;
        IF entry->>'action'='check_in' THEN arrival_count:=arrival_count+1; arrival:=actual; END IF;
        IF entry->>'action'='check_out' THEN departure_count:=departure_count+1; departure:=actual; END IF;
      END LOOP;
    END IF;
    IF arrival_count>1 OR departure_count>1 OR arrival IS DISTINCT FROM (tour.checked_in_at AT TIME ZONE 'UTC')
      OR departure IS DISTINCT FROM (tour.checked_out_at AT TIME ZONE 'UTC')
      OR (departure IS NOT NULL AND (arrival IS NULL OR departure<arrival)) THEN valid:=false; END IF;
    IF NOT valid THEN issue:='visit_records_review'; END IF;
    IF valid THEN
      ordinal:=0;
      FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(tour.attendance_history,'[]'::jsonb)) LOOP
        ordinal:=ordinal+1;
        INSERT INTO tour_visit_events(viewing_id,kind,event_key,actor_id,actor_role,source,actual_at,recorded_at,scheduled_at,appointment_revision,shared_explanation)
          VALUES(tour.id,CASE entry->>'action' WHEN 'check_in' THEN 'arrival' ELSE 'departure' END,
            'legacy-attendance:'||tour.id||':'||ordinal,pg_temp.tour_visit_actor(entry->'actorId'),
            CASE entry->>'source' WHEN 'visitor' THEN 'chef' ELSE 'manager' END,entry->>'source',
            pg_temp.tour_visit_instant(entry->'actualAt'),pg_temp.tour_visit_instant(entry->'recordedAt'),schedule,tour.appointment_revision,
            CASE WHEN entry->>'source'='manager_assisted' THEN entry->>'reason' END) ON CONFLICT(event_key) DO NOTHING;
      END LOOP;
    END IF;
    last_result_id:=NULL; last_result_value:=NULL; previous_recorded:=NULL; ordinal:=0;
    IF jsonb_typeof(COALESCE(tour.outcome_history,'[]'::jsonb))='array' THEN
      FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(tour.outcome_history,'[]'::jsonb)) LOOP
        ordinal:=ordinal+1;
        result_value:=CASE entry->>'to' WHEN 'completed' THEN 'completed' WHEN 'no_show' THEN 'visitor_absent'
          WHEN 'cancelled' THEN CASE WHEN entry->>'disruptionReason' IS NOT NULL THEN 'disrupted' END END;
        recorded:=pg_temp.tour_visit_instant(entry->'recordedAt');
        IF result_value IS NOT NULL AND recorded IS NOT NULL AND recorded<=CURRENT_TIMESTAMP THEN
          actor:=pg_temp.tour_visit_actor(entry->'actorId');
          IF actor IS NULL OR entry->>'actorRole' IS NULL OR entry->>'actorRole' NOT IN ('manager','admin')
            OR (previous_recorded IS NOT NULL AND recorded<previous_recorded) THEN valid:=false; issue:='visit_records_review'; END IF;
          INSERT INTO tour_visit_events(viewing_id,kind,event_key,supersedes_id,actor_id,actor_role,source,recorded_at,scheduled_at,appointment_revision,result,shared_explanation,internal_notes,data)
            VALUES(tour.id,'result','legacy-result:'||tour.id||':'||ordinal,last_result_id,actor,entry->>'actorRole','legacy_history',recorded,schedule,tour.appointment_revision,
              result_value,entry->>'sharedNotes',entry->>'notes',jsonb_build_object('legacy',entry)) ON CONFLICT(event_key) DO NOTHING RETURNING id INTO inserted_id;
          IF inserted_id IS NOT NULL THEN last_result_id:=inserted_id; last_result_value:=result_value; END IF;
          previous_recorded:=recorded;
        ELSIF result_value IS NOT NULL THEN valid:=false; issue:='visit_records_review'; END IF;
      END LOOP;
    ELSE valid:=false; issue:='visit_records_review';
    END IF;
    result_value:=CASE tour.status::text WHEN 'completed' THEN 'completed' WHEN 'no_show' THEN 'visitor_absent'
      WHEN 'cancelled' THEN CASE WHEN tour.disruption_reason IS NOT NULL THEN 'disrupted' END END;
    IF last_result_id IS NOT NULL AND last_result_value IS DISTINCT FROM result_value THEN valid:=false; issue:='visit_records_review'; END IF;
    IF result_value IS NOT NULL AND last_result_id IS NULL THEN
      recorded:=COALESCE(tour.completed_at,tour.no_show_at,tour.cancelled_at) AT TIME ZONE 'UTC';
      IF recorded IS NULL OR recorded>CURRENT_TIMESTAMP THEN valid:=false; issue:='visit_records_review'; END IF;
      INSERT INTO tour_visit_events(viewing_id,kind,event_key,actor_id,source,recorded_at,scheduled_at,appointment_revision,result,data)
        VALUES(tour.id,'result','legacy-result-snapshot:'||tour.id,tour.outcome_recorded_by,'legacy_snapshot',COALESCE(recorded,CURRENT_TIMESTAMP),schedule,tour.appointment_revision,result_value,
          jsonb_build_object('timestampUnknown',recorded IS NULL,'disruptionReason',tour.disruption_reason)) ON CONFLICT(event_key) DO NOTHING;
    END IF;
    IF result_value='visitor_absent' AND tour.no_show_reason IS DISTINCT FROM 'visitor_absent' THEN valid:=false; issue:='visit_records_review'; END IF;
    IF (result_value IS NOT NULL OR arrival IS NOT NULL OR departure IS NOT NULL) AND NOT confirmed THEN valid:=false; issue:='visit_confirmation_unknown'; END IF;
    UPDATE kitchen_viewings SET confirmation_verified=confirmed,visit_result=result_value,
      lifecycle_state=CASE WHEN result_value IS NOT NULL OR (tour.status::text='confirmed' AND schedule+tour.duration_minutes*interval '1 minute'<=CURRENT_TIMESTAMP) THEN 'ended'
        WHEN tour.status::text='confirmed' THEN 'confirmed' WHEN tour.status::text='cancelled' THEN 'closed' ELSE 'pending' END,
      visit_evidence_state=CASE WHEN valid THEN 'ready' ELSE 'review' END,visit_evidence_issue=issue,visit_evidence_migrated_at=CURRENT_TIMESTAMP WHERE id=tour.id;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION protect_tour_visit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM kitchen_viewings WHERE id=OLD.viewing_id) THEN RAISE EXCEPTION 'Tour visit events are immutable; append a correction'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS tour_visit_events_immutable ON tour_visit_events;
CREATE TRIGGER tour_visit_events_immutable BEFORE UPDATE OR DELETE ON tour_visit_events FOR EACH ROW EXECUTE FUNCTION protect_tour_visit_event();
CREATE OR REPLACE FUNCTION validate_tour_visit_successor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent record;
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO parent FROM tour_visit_events WHERE id=NEW.supersedes_id;
    IF parent.id IS NULL OR parent.viewing_id<>NEW.viewing_id OR parent.kind<>NEW.kind OR parent.id>=NEW.id THEN RAISE EXCEPTION 'A correction must supersede an earlier event of the same tour and kind'; END IF;
  END IF;
  IF NEW.kind IN ('arrival','departure') AND (NEW.actual_at IS NULL OR NEW.actual_at>NEW.recorded_at OR NEW.actor_id IS NULL OR NEW.actor_id<=0) THEN RAISE EXCEPTION 'A visit time requires an actor and actual time no later than recording'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tour_visit_events_successor ON tour_visit_events;
CREATE TRIGGER tour_visit_events_successor BEFORE INSERT ON tour_visit_events FOR EACH ROW EXECUTE FUNCTION validate_tour_visit_successor();
