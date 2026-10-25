-- Signed-out tour request (owner, Oct 25): a brand-new account's tour request is held here until its email is verified,
-- then sent through the normal tour route (POST /api/viewings/book with fromDraft) and deleted in the same transaction.
CREATE TABLE IF NOT EXISTS kitchen_tour_drafts (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kitchen_id integer NOT NULL REFERENCES kitchens(id) ON DELETE CASCADE,
  location_id integer NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  intake jsonb NOT NULL,
  chef_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kitchen_id)
);
ALTER TABLE kitchen_tour_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE kitchen_tour_drafts FROM PUBLIC;
