-- Owner-managed additive release artifact. Apply only to an authorized target.
-- No live backfill or historical price/payment mutation.
CREATE TABLE IF NOT EXISTS kitchen_booking_changes (
  id text PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id),
  request_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('move','extend')),
  state text NOT NULL CHECK (state IN ('requested','awaiting_consent','awaiting_payment','payment_pending','authorized','capture_pending','refund_pending','release_pending','recovery_required','applied','declined','withdrawn','expired')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  original jsonb NOT NULL, destination jsonb NOT NULL, quote jsonb NOT NULL, linked_items jsonb NOT NULL DEFAULT '[]', policy jsonb NOT NULL,
  booking_version timestamp NOT NULL, decision_by timestamp NOT NULL, payment_by timestamp,
  manager_id integer NOT NULL REFERENCES users(id), hold_id text,
  session_id text UNIQUE, intent_id text UNIQUE, release_outcome text, refund_plan jsonb, refund_id text,
  history jsonb NOT NULL DEFAULT '[]', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (booking_id, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_booking_changes_one_open ON kitchen_booking_changes(booking_id)
  WHERE state IN ('requested','awaiting_consent','awaiting_payment','payment_pending','authorized','capture_pending','refund_pending','release_pending','recovery_required');
CREATE INDEX IF NOT EXISTS kitchen_booking_changes_deadlines ON kitchen_booking_changes(state, decision_by, payment_by);
-- Supabase grants new public tables to browser roles by default. Changes use
-- authenticated server routes only; no direct browser policies are intended.
ALTER TABLE kitchen_booking_changes ENABLE ROW LEVEL SECURITY;
-- kitchen_change_policy deliberately has NO default. Configure the selected v2
-- policy only after coordinating review and completion of the release gates.
-- Earlier cheaper-move-floor / approval-before-payment policies are superseded.
