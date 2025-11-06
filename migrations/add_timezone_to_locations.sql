-- Add timezone column to locations table
-- This migration adds timezone support for location-based booking time validation
-- Default timezone: America/St_Johns (Newfoundland, Canada)

-- Add timezone column if it doesn't exist
ALTER TABLE IF EXISTS locations 
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/St_Johns';

-- Update existing rows to have the default timezone if they're NULL (safety check)
UPDATE locations 
SET timezone = 'America/St_Johns' 
WHERE timezone IS NULL;

-- Add comment to document the column
COMMENT ON COLUMN locations.timezone IS 'IANA timezone identifier for this location (e.g., America/St_Johns). Used for timezone-aware booking time validation and display.';

