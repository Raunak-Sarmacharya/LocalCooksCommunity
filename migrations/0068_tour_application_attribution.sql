-- Record the canonical completed-tour journey origin for new applications. Historical origin stays unknown.
ALTER TABLE chef_kitchen_applications
  ADD COLUMN IF NOT EXISTS source_tour_id integer REFERENCES kitchen_viewings(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS chef_kitchen_applications_source_tour_idx
  ON chef_kitchen_applications(source_tour_id) WHERE source_tour_id IS NOT NULL;

COMMENT ON COLUMN chef_kitchen_applications.source_tour_id IS
  'Latest qualifying completed tour for the same chef/location at first application creation, independent of entry point; preserved on resubmission. NULL means unattributed.';
