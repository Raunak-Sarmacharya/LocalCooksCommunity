-- Approval pending: additive only. DO NOT APPLY from the local checkpoint.
-- A renewed access document waits in its own slot while the current approved document stays valid.
-- The application tolerates this table being absent (renewals are then treated as none).
CREATE TABLE IF NOT EXISTS chef_document_renewals (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES chef_kitchen_applications(id) ON DELETE CASCADE,
  document_key text NOT NULL,
  url text NOT NULL,
  expiry date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  rejection_reason text,
  submitted_at timestamp NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS chef_document_renewals_application_document_idx
  ON chef_document_renewals (application_id, document_key);

CREATE INDEX IF NOT EXISTS chef_document_renewals_pending_idx
  ON chef_document_renewals (application_id)
  WHERE status = 'pending';
