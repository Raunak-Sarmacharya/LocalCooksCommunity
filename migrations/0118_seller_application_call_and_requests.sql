-- Seller application revamp (owner, Oct 27): the first step after applying is a call, so the chef says how and when to
-- reach them; they say which commercial kitchen and what they plan to sell (never blocking). Admin asks for documents
-- after the call: which ones ('foodSafety', 'kitchen'), an optional note and when.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contact_method text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contact_time text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS commercial_kitchen text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS food_types text[] NOT NULL DEFAULT '{}';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS documents_requested text[] NOT NULL DEFAULT '{}';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS documents_request_note text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS documents_requested_at timestamp;
