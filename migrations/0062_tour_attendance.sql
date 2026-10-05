-- Additive only. Apply after target catalog/migration review; no historical backfill.
ALTER TABLE kitchen_viewings
  ADD COLUMN checked_in_at timestamp,
  ADD COLUMN checked_out_at timestamp,
  ADD COLUMN attendance_history jsonb DEFAULT '[]'::jsonb;
