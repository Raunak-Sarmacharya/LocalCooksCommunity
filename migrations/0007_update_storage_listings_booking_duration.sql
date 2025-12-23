-- Migration: Update storage_listings for flexible booking duration and remove tiered pricing
-- Date: 2025-01-XX
-- Description: 
--   - Adds booking_duration_unit enum and minimum_booking_duration field
--   - Removes tiered_pricing field
--   - Updates pricing_model enum to remove 'tiered' option
--   - Locks currency to CAD (already default, but ensures consistency)

-- Create booking_duration_unit enum
DO $$ BEGIN
  CREATE TYPE booking_duration_unit AS ENUM ('hourly', 'daily', 'monthly');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Update pricing_model enum to add 'daily' value
-- Note: PostgreSQL doesn't support removing enum values directly, so 'tiered' will remain
-- but won't be used in the application. We'll add 'daily' using ALTER TYPE.
DO $$ 
BEGIN
  -- Add 'daily' to the enum if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'daily' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'storage_pricing_model')
  ) THEN
    ALTER TYPE storage_pricing_model ADD VALUE 'daily';
  END IF;
END $$;

-- Add new booking duration fields
ALTER TABLE "storage_listings" 
  ADD COLUMN IF NOT EXISTS "minimum_booking_duration" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "booking_duration_unit" booking_duration_unit DEFAULT 'monthly' NOT NULL;

-- Migrate existing data: convert minimum_booking_months to minimum_booking_duration (if column exists)
-- Existing records with minimum_booking_months will be converted to monthly duration
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'storage_listings' 
    AND column_name = 'minimum_booking_months'
  ) THEN
    UPDATE "storage_listings" 
    SET 
      "minimum_booking_duration" = COALESCE("minimum_booking_months", 1),
      "booking_duration_unit" = 'monthly'
    WHERE "minimum_booking_duration" IS NULL OR "booking_duration_unit" IS NULL;
  END IF;
END $$;

-- Drop the old minimum_booking_months column (after migration)
ALTER TABLE "storage_listings" 
  DROP COLUMN IF EXISTS "minimum_booking_months";

-- Drop tiered_pricing column
ALTER TABLE "storage_listings" 
  DROP COLUMN IF EXISTS "tiered_pricing";

-- Update currency to ensure it's always CAD (remove any non-CAD values if they exist)
UPDATE "storage_listings" 
SET "currency" = 'CAD' 
WHERE "currency" != 'CAD' OR "currency" IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN "storage_listings"."minimum_booking_duration" IS 'Minimum booking duration (number) - works with booking_duration_unit';
COMMENT ON COLUMN "storage_listings"."booking_duration_unit" IS 'Unit for minimum booking duration: hourly, daily, or monthly';
COMMENT ON COLUMN "storage_listings"."currency" IS 'Currency code - locked to CAD';
