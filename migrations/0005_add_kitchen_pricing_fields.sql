-- Migration: Add pricing fields to kitchens table
-- Date: 2025-01-XX
-- Description: Adds hourlyRate, currency, minimumBookingHours, and pricingModel fields to support kitchen hourly pricing

-- Add pricing fields to kitchens table
ALTER TABLE "kitchens" 
  ADD COLUMN IF NOT EXISTS "hourly_rate" numeric,
  ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'CAD' NOT NULL,
  ADD COLUMN IF NOT EXISTS "minimum_booking_hours" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "pricing_model" text DEFAULT 'hourly' NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN "kitchens"."hourly_rate" IS 'Base hourly rate in cents (e.g., 5000 = $50.00/hour)';
COMMENT ON COLUMN "kitchens"."currency" IS 'Currency code (ISO 4217), defaults to CAD';
COMMENT ON COLUMN "kitchens"."minimum_booking_hours" IS 'Minimum booking duration in hours';
COMMENT ON COLUMN "kitchens"."pricing_model" IS 'Pricing structure: hourly, daily, or weekly';

