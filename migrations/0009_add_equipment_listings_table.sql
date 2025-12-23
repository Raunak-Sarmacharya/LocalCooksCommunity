-- Migration: Add equipment_listings table
-- Date: 2025-01-XX
-- Description: Creates equipment_listings table with categories, specifications, pricing models, and delivery options

-- Create enums first
DO $$ BEGIN
  CREATE TYPE equipment_category AS ENUM ('food-prep', 'cooking', 'refrigeration', 'cleaning', 'specialty');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE equipment_condition AS ENUM ('excellent', 'good', 'fair', 'needs-repair');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE equipment_pricing_model AS ENUM ('hourly', 'daily', 'weekly', 'monthly');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create equipment_listings table
CREATE TABLE IF NOT EXISTS "equipment_listings" (
  "id" serial PRIMARY KEY NOT NULL,
  "kitchen_id" integer NOT NULL,
  
  -- Category & type
  "category" equipment_category NOT NULL,
  "equipment_type" text NOT NULL,
  "brand" text,
  "model" text,
  
  -- Specifications
  "description" text,
  "condition" equipment_condition NOT NULL,
  "age" integer,
  "service_history" text,
  "dimensions" jsonb DEFAULT '{}'::jsonb,
  "power_requirements" text,
  
  -- Equipment-specific fields
  "specifications" jsonb DEFAULT '{}'::jsonb,
  "certifications" jsonb DEFAULT '[]'::jsonb,
  "safety_features" jsonb DEFAULT '[]'::jsonb,
  
  -- Pricing (all in cents)
  "pricing_model" equipment_pricing_model NOT NULL,
  "hourly_rate" numeric,
  "daily_rate" numeric,
  "weekly_rate" numeric,
  "monthly_rate" numeric,
  "minimum_rental_hours" integer DEFAULT 4 NOT NULL,
  "minimum_rental_days" integer,
  "currency" text DEFAULT 'CAD' NOT NULL,
  
  -- Delivery & setup (fees in cents)
  "delivery_available" boolean DEFAULT false NOT NULL,
  "delivery_fee" numeric DEFAULT 0 NOT NULL,
  "setup_fee" numeric DEFAULT 0 NOT NULL,
  "pickup_required" boolean DEFAULT true NOT NULL,
  
  -- Usage terms
  "usage_restrictions" jsonb DEFAULT '[]'::jsonb,
  "training_required" boolean DEFAULT false NOT NULL,
  "cleaning_responsibility" text,
  
  -- Status & moderation
  "status" listing_status DEFAULT 'draft' NOT NULL,
  "approved_by" integer,
  "approved_at" timestamp,
  "rejection_reason" text,
  
  -- Availability
  "is_active" boolean DEFAULT true NOT NULL,
  "availability_calendar" jsonb DEFAULT '{}'::jsonb,
  "prep_time_hours" integer DEFAULT 4 NOT NULL,
  
  -- Visuals & documentation
  "photos" jsonb DEFAULT '[]'::jsonb,
  "manuals" jsonb DEFAULT '[]'::jsonb,
  "maintenance_log" jsonb DEFAULT '[]'::jsonb,
  
  -- Damage & liability (deposits in cents)
  "damage_deposit" numeric DEFAULT 0 NOT NULL,
  "insurance_required" boolean DEFAULT false NOT NULL,
  
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraints
ALTER TABLE "equipment_listings" ADD CONSTRAINT "equipment_listings_kitchen_id_kitchens_id_fk" 
  FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "equipment_listings" ADD CONSTRAINT "equipment_listings_approved_by_users_id_fk" 
  FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS "equipment_listings_kitchen_id_idx" ON "equipment_listings"("kitchen_id");
CREATE INDEX IF NOT EXISTS "equipment_listings_status_idx" ON "equipment_listings"("status");
CREATE INDEX IF NOT EXISTS "equipment_listings_category_idx" ON "equipment_listings"("category");
CREATE INDEX IF NOT EXISTS "equipment_listings_is_active_idx" ON "equipment_listings"("is_active");

-- Add comments for documentation
COMMENT ON TABLE "equipment_listings" IS 'Equipment rental listings (commercial kitchen equipment)';
COMMENT ON COLUMN "equipment_listings"."hourly_rate" IS 'Hourly rate in cents (e.g., 5000 = $50.00/hour)';
COMMENT ON COLUMN "equipment_listings"."daily_rate" IS 'Daily rate in cents (e.g., 50000 = $500.00/day)';
COMMENT ON COLUMN "equipment_listings"."weekly_rate" IS 'Weekly rate in cents (e.g., 300000 = $3000.00/week)';
COMMENT ON COLUMN "equipment_listings"."monthly_rate" IS 'Monthly rate in cents (e.g., 1000000 = $10000.00/month)';
COMMENT ON COLUMN "equipment_listings"."delivery_fee" IS 'Delivery fee in cents';
COMMENT ON COLUMN "equipment_listings"."setup_fee" IS 'Setup fee in cents';
COMMENT ON COLUMN "equipment_listings"."damage_deposit" IS 'Refundable damage deposit in cents';

