-- Applied to dev Supabase 2026-10-13 (owner approved). Additive only.
-- One arrival challenge per arrival target (split-visit row, else the booking itself).
-- The visit code is never stored: it is derived on demand as HMAC(secret[key_version], target_key|revision|nonce).
-- The application tolerates this table being absent (bookings then keep tap-to-arrive behaviour).
CREATE TABLE IF NOT EXISTS kitchen_visit_arrival_challenges (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES kitchen_bookings(id) ON DELETE CASCADE,
  visit_id integer REFERENCES kitchen_booking_visits(id) ON DELETE CASCADE,
  target_key text NOT NULL,
  mode text NOT NULL DEFAULT 'staffed',
  revision integer NOT NULL DEFAULT 1,
  key_version integer NOT NULL,
  nonce text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  issued_by_user_id integer,
  issued_at timestamptz NOT NULL DEFAULT now(),
  mode_changed_by_user_id integer,
  mode_changed_at timestamptz,
  mode_reason text,
  consumed_at timestamptz,
  consumed_method text,
  consumed_by_user_id integer,
  consumed_request_key text,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kitchen_visit_arrival_challenges_target_key_unique UNIQUE (target_key),
  CONSTRAINT kitchen_visit_arrival_challenges_mode_check CHECK (mode IN ('staffed', 'self')),
  CONSTRAINT kitchen_visit_arrival_challenges_method_check
    CHECK (consumed_method IS NULL OR consumed_method IN ('code', 'self', 'assisted')),
  CONSTRAINT kitchen_visit_arrival_challenges_revision_positive CHECK (revision >= 1),
  CONSTRAINT kitchen_visit_arrival_challenges_attempts_nonnegative CHECK (failed_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS kitchen_visit_arrival_challenges_booking_idx
  ON kitchen_visit_arrival_challenges (booking_id);

-- Server-only table: browser API roles must not read challenge nonces or attempt state.
ALTER TABLE kitchen_visit_arrival_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE kitchen_visit_arrival_challenges FROM PUBLIC;
REVOKE ALL ON SEQUENCE kitchen_visit_arrival_challenges_id_seq FROM PUBLIC;
-- Same protection for the 0074 renewal table, which shipped without it.
ALTER TABLE chef_document_renewals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE chef_document_renewals FROM PUBLIC;
