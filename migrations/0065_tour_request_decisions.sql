ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS confirmed_at timestamp;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS request_expired_at timestamp;

-- Only persisted first transitions into confirmation establish a historical fact.
UPDATE kitchen_viewings AS tour
SET confirmed_at = known.confirmed_at
FROM (
  SELECT viewing_id, MIN(created_at) AS confirmed_at
  FROM tour_delivery_events
  WHERE payload->'after'->>'status' = 'confirmed'
    AND payload->'before'->>'status' IN ('pending', 'pending_local_cooks')
    AND payload->>'kind' IN ('status', 'reschedule_proposal_accepted')
  GROUP BY viewing_id
) AS known
WHERE tour.id = known.viewing_id AND tour.confirmed_at IS NULL;
