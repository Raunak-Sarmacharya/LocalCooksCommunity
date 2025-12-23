-- Migration: Add pricing fields to kitchen_bookings table
-- Date: 2025-01-XX
-- Description: Adds pricing and payment fields to kitchen_bookings table for payment integration

-- Create payment_status enum first
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'refunded', 'failed', 'partially_refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add pricing fields to kitchen_bookings table
ALTER TABLE "kitchen_bookings"
  ADD COLUMN IF NOT EXISTS "total_price" numeric,
  ADD COLUMN IF NOT EXISTS "hourly_rate" numeric,
  ADD COLUMN IF NOT EXISTS "duration_hours" numeric,
  ADD COLUMN IF NOT EXISTS "storage_items" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "equipment_items" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "payment_status" payment_status DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "payment_intent_id" text,
  ADD COLUMN IF NOT EXISTS "damage_deposit" numeric DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "service_fee" numeric DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'CAD' NOT NULL;

-- Create unique index on payment_intent_id (nullable but unique when set)
CREATE UNIQUE INDEX IF NOT EXISTS "kitchen_bookings_payment_intent_id_unique" 
  ON "kitchen_bookings" ("payment_intent_id") 
  WHERE "payment_intent_id" IS NOT NULL;

-- Add index on payment_status for faster queries
CREATE INDEX IF NOT EXISTS "kitchen_bookings_payment_status_idx" 
  ON "kitchen_bookings" ("payment_status");

