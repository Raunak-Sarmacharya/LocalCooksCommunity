-- Kitchen-level overrides for arrival/departure guidance and kitchen terms.
-- One scope pattern: the location sets defaults, each kitchen may override.
-- Additive only. A NULL field means "use the location default"; a missing row means
-- the kitchen inherits everything. The location table (checkin_checkout_checklists,
-- unique on location_id) is untouched, so already-deployed code keeps working.

CREATE TABLE IF NOT EXISTS kitchen_checkin_checkout_overrides (
  id serial PRIMARY KEY,
  kitchen_id integer NOT NULL UNIQUE REFERENCES kitchens(id) ON DELETE CASCADE,
  location_id integer NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  checkin_instructions text,
  checkout_instructions text,
  checkin_items jsonb,
  checkin_photo_requirements jsonb,
  checkout_items jsonb,
  checkout_photo_requirements jsonb,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kitchen_checkin_checkout_overrides_location_idx
  ON kitchen_checkin_checkout_overrides (location_id);

-- Optional kitchen-specific terms document; NULL means the location's terms apply.
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS kitchen_terms_url text;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS kitchen_terms_uploaded_at timestamp;
