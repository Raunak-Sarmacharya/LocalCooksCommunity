-- Private, immutable booking feedback. Apply separately after 0077; no historical prompts.
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS feedback_requested_at timestamptz;
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS feedback_reminded_at timestamptz;
CREATE INDEX IF NOT EXISTS kitchen_bookings_feedback_due_idx
  ON kitchen_bookings (feedback_requested_at, id)
  WHERE status = 'completed' AND feedback_requested_at IS NOT NULL AND feedback_reminded_at IS NULL;

CREATE TABLE IF NOT EXISTS booking_feedback_responses (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id),
  respondent_id integer NOT NULL,
  respondent_role text NOT NULL CHECK (respondent_role IN ('chef', 'manager')),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  comment text CHECK (comment IS NULL OR length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_feedback_role_unique UNIQUE (booking_id, respondent_role),
  CONSTRAINT booking_feedback_tags_check CHECK (cardinality(tags) <= 8 AND array_position(tags, NULL) IS NULL AND
    ((respondent_role = 'chef' AND tags <@ ARRAY['clean_ready','equipment_as_described','easy_access','helpful_staff','not_clean','equipment_missing_broken','trouble_getting_in','listing_mismatch']::text[])
    OR (respondent_role = 'manager' AND tags <@ ARRAY['left_clean','on_time','followed_rules','easy_to_work_with','left_mess','late_overstayed','rules_not_followed','damaged_something']::text[])))
);
CREATE OR REPLACE FUNCTION protect_booking_feedback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Booking feedback is immutable';
END $$;
DROP TRIGGER IF EXISTS booking_feedback_immutable ON booking_feedback_responses;
CREATE TRIGGER booking_feedback_immutable BEFORE UPDATE OR DELETE ON booking_feedback_responses
  FOR EACH ROW EXECUTE FUNCTION protect_booking_feedback();
ALTER TABLE booking_feedback_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE booking_feedback_responses FROM PUBLIC;
REVOKE ALL ON SEQUENCE booking_feedback_responses_id_seq FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE booking_feedback_responses FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE booking_feedback_responses_id_seq FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
