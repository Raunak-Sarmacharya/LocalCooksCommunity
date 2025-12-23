-- Migration: Make pricing_model nullable for included equipment
-- Date: 2025-01-XX
-- Description: Makes pricing_model nullable in equipment_listings table to support included (free) equipment

-- Make pricing_model nullable (for included equipment that doesn't need pricing)
ALTER TABLE "equipment_listings" 
  ALTER COLUMN "pricing_model" DROP NOT NULL;

-- Add comment explaining the nullable constraint
COMMENT ON COLUMN "equipment_listings"."pricing_model" IS 'Pricing model for rental equipment. NULL for included (free) equipment.';

