-- Additive only. Existing renters keep their units; only new allocation is blocked.
ALTER TABLE storage_listings ADD COLUMN IF NOT EXISTS out_of_service_units jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE storage_listings ADD COLUMN IF NOT EXISTS unit_service_history jsonb NOT NULL DEFAULT '[]'::jsonb;
