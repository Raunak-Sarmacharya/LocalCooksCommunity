-- One-page request to cook (owner, Oct 23): a brand-new account's request is held here until its email is verified,
-- then sent through the normal request route (POST /firebase/chef/kitchen-applications with fromDraft=1) and deleted.
-- fields: the request's text fields as the form sent them; food_safety_license_url: its certificate, uploaded on save.
CREATE TABLE IF NOT EXISTS kitchen_request_drafts (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id integer NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  fields jsonb NOT NULL,
  food_safety_license_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);
ALTER TABLE kitchen_request_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE kitchen_request_drafts FROM PUBLIC;
