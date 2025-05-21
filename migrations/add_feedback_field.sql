-- Add feedback field to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS feedback TEXT;
