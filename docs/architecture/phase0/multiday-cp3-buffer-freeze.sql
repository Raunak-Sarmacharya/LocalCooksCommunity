-- CP3 data migration: freeze the currently effective booking buffer (0 or 60 minutes) on existing live bookings,
-- active checkout holds and open invitations that have no snapshot yet.
--
-- WRITTEN FOR LEAD REVIEW ONLY. Not applied by CP3, not numbered, not picked up by any migration runner.
-- Run it once per environment, in its own transaction, BEFORE kitchens can edit the new Off / 1 h / 2 h control
-- (owner-approved baseline, build plan §1 "Freeze"). It records today's effective setting; it does not reconstruct
-- historical original terms. Re-running is a no-op (only NULL snapshots are written).
--
-- Effective buffer, same order as shared/kitchen-booking-policies.ts effectiveBookingBufferMinutes():
--   kitchen numeric -> kitchen legacy boolean (true = 60, false = 0) -> location numeric -> location legacy boolean -> 0.
-- Numeric values are already constrained to 0/60/120 by 0099's CHECKs.
--
-- Prerequisites: 0099 applied (buffer_minutes_snapshot on kitchen_bookings, kitchen_checkout_holds, kitchen_invitations).

BEGIN;

-- Serialize with every booking writer and schedule edit: the same per-kitchen advisory lock (kitchen_id, 0) the app takes
-- first. Sorted by id, matching the app's lock order, so this cannot deadlock with a single-kitchen writer.
SELECT pg_advisory_xact_lock(k.id, 0) FROM (SELECT id FROM kitchens ORDER BY id) AS k;

CREATE TEMP TABLE cp3_effective_buffer ON COMMIT DROP AS
SELECT k.id AS kitchen_id,
       COALESCE(
         k.booking_buffer_minutes,
         CASE WHEN k.turnover_buffer_enabled IS NULL THEN NULL WHEN k.turnover_buffer_enabled THEN 60 ELSE 0 END,
         l.booking_buffer_minutes,
         CASE WHEN l.turnover_buffer_enabled IS NULL THEN NULL WHEN l.turnover_buffer_enabled THEN 60 ELSE 0 END,
         0
       ) AS minutes
FROM kitchens k
JOIN locations l ON l.id = k.location_id;

-- Live bookings (any day still pending, confirmed or being cancelled). Past/completed/cancelled rows are left alone:
-- they no longer take part in spacing decisions.
UPDATE kitchen_bookings b
SET buffer_minutes_snapshot = e.minutes
FROM cp3_effective_buffer e
WHERE b.kitchen_id = e.kitchen_id
  AND b.buffer_minutes_snapshot IS NULL
  AND b.status IN ('pending', 'confirmed', 'cancellation_requested');

-- Active checkout, change and added-time holds (retained change/extension holds included).
UPDATE kitchen_checkout_holds h
SET buffer_minutes_snapshot = e.minutes
FROM cp3_effective_buffer e
WHERE h.kitchen_id = e.kitchen_id
  AND h.buffer_minutes_snapshot IS NULL
  AND h.expires_at > now();

-- Invitations still open to the chef or mid-checkout.
UPDATE kitchen_invitations i
SET buffer_minutes_snapshot = e.minutes
FROM cp3_effective_buffer e
WHERE i.kitchen_id = e.kitchen_id
  AND i.buffer_minutes_snapshot IS NULL
  AND i.status IN ('sent', 'accepted_pending_payment');

-- Review before COMMIT: every count below should be 0.
SELECT 'bookings without snapshot' AS check, count(*) FROM kitchen_bookings
  WHERE buffer_minutes_snapshot IS NULL AND status IN ('pending', 'confirmed', 'cancellation_requested')
UNION ALL
SELECT 'active holds without snapshot', count(*) FROM kitchen_checkout_holds
  WHERE buffer_minutes_snapshot IS NULL AND expires_at > now()
UNION ALL
SELECT 'open invitations without snapshot', count(*) FROM kitchen_invitations
  WHERE buffer_minutes_snapshot IS NULL AND status IN ('sent', 'accepted_pending_payment');

-- Spot check: distribution per effective value (expect only 0 and 60 before any kitchen chooses 2 h).
SELECT buffer_minutes_snapshot, count(*) FROM kitchen_bookings
  WHERE status IN ('pending', 'confirmed', 'cancellation_requested') GROUP BY 1 ORDER BY 1;

COMMIT;
