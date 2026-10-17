-- Kitchen accepts a request without some equipment: the chef must approve the new total before anything is captured
-- (owner, Oct 17; Airbnb special offer / Peerspace invite model). The proposal, the chef's deadline and the answer live here.
-- Additive: one nullable JSONB column; existing rows stay NULL and keep today's behaviour.
BEGIN;
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS partial_acceptance jsonb;
COMMIT;
