-- Unapplied: private manager notes about a customer at one location (WP-CU).
-- Additive only. Notes belong to the location, are visible to its manager and Local Cooks support, and are never
-- returned by any customer-facing API. Deleting a note sets deleted_at; the row is kept.
CREATE TABLE customer_notes (
  id serial PRIMARY KEY,
  location_id integer NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  chef_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id integer REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX customer_notes_customer_idx ON customer_notes(location_id, chef_id, created_at DESC)
  WHERE deleted_at IS NULL;
