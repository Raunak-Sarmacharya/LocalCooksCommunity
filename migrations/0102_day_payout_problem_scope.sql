BEGIN;
-- NULL preserves existing booking-wide holds; a scoped report only holds its visit.
ALTER TABLE commitment_problems ADD COLUMN IF NOT EXISTS visit_id integer REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT;
ALTER TABLE booking_flags ADD COLUMN IF NOT EXISTS visit_id integer REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS commitment_problem_visit ON commitment_problems(booking_id, visit_id) WHERE status <> 'resolved';
COMMIT;
