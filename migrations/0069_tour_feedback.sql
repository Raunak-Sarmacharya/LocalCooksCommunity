ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS feedback_requested_at timestamp;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS feedback_escalated_at timestamp;

CREATE TABLE IF NOT EXISTS tour_feedback_responses (
  id serial PRIMARY KEY,
  viewing_id integer NOT NULL REFERENCES kitchen_viewings(id) ON DELETE RESTRICT,
  respondent_id integer NOT NULL CHECK (respondent_id > 0),
  respondent_role text NOT NULL CHECK (respondent_role IN ('chef', 'manager')),
  scheduled_at timestamptz NOT NULL,
  appointment_revision integer NOT NULL CHECK (appointment_revision > 0),
  happened boolean NOT NULL,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  comments text CHECK (length(comments) <= 2000),
  suggestions text CHECK (length(suggestions) <= 2000),
  reason text CHECK (length(reason) <= 2000),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (happened OR (rating IS NULL AND reason IS NOT NULL AND length(btrim(reason)) >= 10)),
  UNIQUE (viewing_id, appointment_revision, respondent_role, respondent_id)
);
CREATE INDEX IF NOT EXISTS tour_feedback_appointment_idx
  ON tour_feedback_responses(viewing_id, appointment_revision, scheduled_at);

COMMENT ON TABLE tour_feedback_responses IS
  'Immutable private chef/current-manager feedback. Former-manager replies remain evidence; only current respondents count toward current feedback coverage. Admin alone records the final result.';
COMMENT ON COLUMN chef_kitchen_applications.source_tour_id IS
  'Latest qualifying completed or elapsed confirmed tour association at first application creation, independent of entry point; provisional association counts in the funnel only after admin confirms completion. Preserved on resubmission; historical unknown origin remains NULL.';
