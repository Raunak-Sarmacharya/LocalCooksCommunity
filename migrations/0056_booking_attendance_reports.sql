-- Append-only attendance history. No backfill and no reservation/financial changes.
CREATE TABLE IF NOT EXISTS kitchen_booking_attendance_events (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id),
  visit_id integer REFERENCES kitchen_booking_visits(id),
  actor_id integer NOT NULL REFERENCES users(id),
  actor_role text NOT NULL CHECK (actor_role IN ('manager', 'admin')),
  action text NOT NULL CHECK (action IN ('report_no_show', 'report_attended', 'withdraw_attendance')),
  previous_status text,
  shared_message text,
  internal_notes text,
  evidence_snapshot jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_booking_attendance_events_booking_idx
  ON kitchen_booking_attendance_events (booking_id, id);
ALTER TABLE kitchen_booking_attendance_events ENABLE ROW LEVEL SECURITY;
-- Access is through the authenticated server only; no direct client policies.
