-- WP-R: immutable booking money documents (receipts, refund receipts, kitchen remittances, final statements).
-- NOT APPLIED. Until it is, the documents API answers 503 and the booking page keeps the legacy download.
CREATE SEQUENCE IF NOT EXISTS booking_document_number_seq START 1;

CREATE TABLE IF NOT EXISTS booking_documents (
  id serial PRIMARY KEY,
  number text NOT NULL,
  booking_id integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment', 'refund', 'statement', 'remittance')),
  audience text NOT NULL CHECK (audience IN ('chef', 'manager')),
  source_key text NOT NULL,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_refund_id text,
  stripe_transfer_id text,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'CAD',
  lines jsonb NOT NULL,
  references_document_id integer REFERENCES booking_documents(id),
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_documents_number_key ON booking_documents (number);
CREATE UNIQUE INDEX IF NOT EXISTS booking_documents_source_key ON booking_documents (source_key);
CREATE INDEX IF NOT EXISTS booking_documents_booking_idx ON booking_documents (booking_id, audience, id);

-- Issued documents are final: corrections are new documents (refund receipts, adjustments), never edits.
CREATE OR REPLACE FUNCTION booking_documents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking_documents rows are immutable (id %)', OLD.id;
END $$;
DROP TRIGGER IF EXISTS booking_documents_no_update ON booking_documents;
CREATE TRIGGER booking_documents_no_update BEFORE UPDATE OR DELETE ON booking_documents
  FOR EACH ROW EXECUTE FUNCTION booking_documents_immutable();

-- GST/HST registration number printed on documents. Left EMPTY on purpose: it is rendered only once the owner
-- sets a real number (never invent one). LOCAL_COOKS_GST_HST_NUMBER in the environment overrides it.
INSERT INTO platform_settings (key, value, description)
VALUES ('local_cooks_gst_hst_number', '', 'GST/HST registration number shown on receipts and statements (empty = not shown)')
ON CONFLICT (key) DO NOTHING;
