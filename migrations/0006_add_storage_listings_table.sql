-- Migration: Add storage_listings table
-- Date: 2025-01-XX
-- Description: Creates storage_listings table with all specifications, pricing models, and compliance fields

-- Create enums first
DO $$ BEGIN
  CREATE TYPE storage_type AS ENUM ('dry', 'cold', 'freezer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE storage_pricing_model AS ENUM ('monthly-flat', 'per-cubic-foot', 'tiered', 'hourly');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('draft', 'pending', 'approved', 'rejected', 'active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create storage_listings table
CREATE TABLE IF NOT EXISTS "storage_listings" (
  "id" serial PRIMARY KEY NOT NULL,
  "kitchen_id" integer NOT NULL,
  "storage_type" storage_type NOT NULL,
  "name" text NOT NULL,
  "description" text,
  
  -- Physical specifications
  "dimensions_length" numeric,
  "dimensions_width" numeric,
  "dimensions_height" numeric,
  "total_volume" numeric,
  "shelf_count" integer,
  "shelf_material" text,
  "access_type" text,
  
  -- Features & amenities
  "features" jsonb DEFAULT '[]'::jsonb,
  "security_features" jsonb DEFAULT '[]'::jsonb,
  "climate_control" boolean DEFAULT false NOT NULL,
  "temperature_range" text,
  "humidity_control" boolean DEFAULT false NOT NULL,
  "power_outlets" integer DEFAULT 0 NOT NULL,
  
  -- Pricing (all in cents)
  "pricing_model" storage_pricing_model NOT NULL,
  "base_price" numeric NOT NULL,
  "price_per_cubic_foot" numeric,
  "tiered_pricing" jsonb,
  "minimum_booking_months" integer DEFAULT 1 NOT NULL,
  "currency" text DEFAULT 'CAD' NOT NULL,
  
  -- Status & moderation
  "status" listing_status DEFAULT 'draft' NOT NULL,
  "approved_by" integer,
  "approved_at" timestamp,
  "rejection_reason" text,
  
  -- Availability
  "is_active" boolean DEFAULT true NOT NULL,
  "availability_calendar" jsonb DEFAULT '{}'::jsonb,
  
  -- Compliance & documentation
  "certifications" jsonb DEFAULT '[]'::jsonb,
  "photos" jsonb DEFAULT '[]'::jsonb,
  "documents" jsonb DEFAULT '[]'::jsonb,
  
  -- Rules & restrictions
  "house_rules" jsonb DEFAULT '[]'::jsonb,
  "prohibited_items" jsonb DEFAULT '[]'::jsonb,
  "insurance_required" boolean DEFAULT false NOT NULL,
  
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraints
ALTER TABLE "storage_listings" ADD CONSTRAINT "storage_listings_kitchen_id_kitchens_id_fk" 
  FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "storage_listings" ADD CONSTRAINT "storage_listings_approved_by_users_id_fk" 
  FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS "storage_listings_kitchen_id_idx" ON "storage_listings"("kitchen_id");
CREATE INDEX IF NOT EXISTS "storage_listings_status_idx" ON "storage_listings"("status");
CREATE INDEX IF NOT EXISTS "storage_listings_storage_type_idx" ON "storage_listings"("storage_type");
CREATE INDEX IF NOT EXISTS "storage_listings_is_active_idx" ON "storage_listings"("is_active");

-- Add comments for documentation
COMMENT ON TABLE "storage_listings" IS 'Storage rental listings (dry, cold, freezer storage)';
COMMENT ON COLUMN "storage_listings"."base_price" IS 'Base price in cents (e.g., 15000 = $150.00/month)';
COMMENT ON COLUMN "storage_listings"."price_per_cubic_foot" IS 'Price per cubic foot in cents (for per-cubic-foot pricing model)';
COMMENT ON COLUMN "storage_listings"."tiered_pricing" IS 'Tiered pricing structure: [{months: "1-3", price: 15000}, ...] - prices in cents';


