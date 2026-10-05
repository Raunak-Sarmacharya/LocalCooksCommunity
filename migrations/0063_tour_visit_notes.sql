-- Kitchen-specific tour guidance. Existing tours/settings remain valid without notes.
ALTER TABLE kitchen_viewing_settings
  ADD COLUMN IF NOT EXISTS arrival_notes text,
  ADD COLUMN IF NOT EXISTS departure_notes text;
