-- Add address column to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS address TEXT;

-- Make address required for new records
ALTER TABLE applications ALTER COLUMN address SET NOT NULL;