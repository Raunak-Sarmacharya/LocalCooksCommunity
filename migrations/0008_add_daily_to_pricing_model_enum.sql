-- Migration: Add 'daily' value to storage_pricing_model enum
-- Date: 2025-01-XX
-- Description: Adds 'daily' as a valid value to the storage_pricing_model enum type

-- Add 'daily' to the enum if it doesn't exist
DO $$ 
BEGIN
  -- Check if 'daily' already exists in the enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'daily' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'storage_pricing_model')
  ) THEN
    ALTER TYPE storage_pricing_model ADD VALUE 'daily';
    RAISE NOTICE 'Added ''daily'' to storage_pricing_model enum';
  ELSE
    RAISE NOTICE '''daily'' already exists in storage_pricing_model enum';
  END IF;
END $$;
