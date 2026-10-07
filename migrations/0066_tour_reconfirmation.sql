ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS appointment_revision integer NOT NULL DEFAULT 1;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS appointment_confirmed_at timestamp;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS reconfirmation_reply text;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS reconfirmation_replied_at timestamp;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS reconfirmation_reply_revision text;

-- Recover the current appointment's acceptance only from recorded evidence.
-- The original confirmed_at remains untouched; unknown legacy facts stay null.
UPDATE kitchen_viewings v SET appointment_confirmed_at = accepted.recorded_at
FROM (
  SELECT e.viewing_id, max(e.created_at) AS recorded_at
  FROM tour_delivery_events e JOIN kitchen_viewings current_tour ON current_tour.id = e.viewing_id
  WHERE e.payload->>'kind' IN ('reschedule_accepted', 'reschedule_proposal_accepted')
    AND (e.payload->'after'->>'scheduledAt')::timestamptz = current_tour.scheduled_at AT TIME ZONE 'UTC'
  GROUP BY e.viewing_id
) accepted
WHERE v.id = accepted.viewing_id AND v.appointment_confirmed_at IS NULL;
