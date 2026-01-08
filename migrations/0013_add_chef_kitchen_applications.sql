-- Migration: 0013_add_chef_kitchen_applications.sql
-- Purpose: Create chef_kitchen_applications table for direct kitchen applications
-- This replaces the "Share Profile" workflow with a full application form per kitchen
-- 
-- Key changes:
-- 1. Chefs can apply directly to kitchens without platform application
-- 2. Full application form with document upload per kitchen
-- 3. Manager reviews and approves each application
-- 4. Deprecates chef_location_profiles and chef_location_access tables

-- ============================================================================
-- CREATE NEW TABLE: chef_kitchen_applications
-- ============================================================================

CREATE TABLE IF NOT EXISTS "chef_kitchen_applications" (
  "id" SERIAL PRIMARY KEY,
  
  -- Foreign Keys
  "chef_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "location_id" INTEGER NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  
  -- Personal Information (collected per application)
  "full_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  
  -- Business Information
  "kitchen_preference" kitchen_preference NOT NULL,
  "business_description" TEXT,
  "cooking_experience" TEXT,
  
  -- Food Safety License Documentation
  "food_safety_license" certification_status NOT NULL,
  "food_safety_license_url" TEXT,
  "food_safety_license_status" document_verification_status DEFAULT 'pending',
  
  -- Food Establishment Certificate Documentation (optional)
  "food_establishment_cert" certification_status NOT NULL,
  "food_establishment_cert_url" TEXT,
  "food_establishment_cert_status" document_verification_status DEFAULT 'pending',
  
  -- Application Status
  "status" application_status NOT NULL DEFAULT 'inReview',
  "feedback" TEXT,
  
  -- Manager Review Information
  "reviewed_by" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" TIMESTAMP,
  
  -- Timestamps
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- CREATE INDEXES FOR QUERY PERFORMANCE
-- ============================================================================

-- Primary lookup: Get all applications for a chef
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_chef_id" 
  ON "chef_kitchen_applications"("chef_id");

-- Location-based lookup: Get all applications for a location (manager view)
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_location_id" 
  ON "chef_kitchen_applications"("location_id");

-- Status filtering: Get pending/approved/rejected applications
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_status" 
  ON "chef_kitchen_applications"("status");

-- Composite index for booking validation: Check if chef has approved application for location
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_booking_check" 
  ON "chef_kitchen_applications"("chef_id", "location_id", "status");

-- Manager review optimization
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_manager_review" 
  ON "chef_kitchen_applications"("reviewed_by");

-- ============================================================================
-- CREATE UNIQUE CONSTRAINT
-- ============================================================================

-- Ensure one active application per chef per location
-- Note: Using UNIQUE constraint allows upsert for re-applications after rejection
ALTER TABLE "chef_kitchen_applications" 
  ADD CONSTRAINT "chef_kitchen_apps_chef_location_unique" 
  UNIQUE ("chef_id", "location_id");

-- ============================================================================
-- ADD COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE "chef_kitchen_applications" IS 
  'Direct applications from chefs to specific kitchen locations. Replaces the share-profile workflow.';

COMMENT ON COLUMN "chef_kitchen_applications"."chef_id" IS 
  'The chef user submitting the application';

COMMENT ON COLUMN "chef_kitchen_applications"."location_id" IS 
  'The kitchen location being applied to';

COMMENT ON COLUMN "chef_kitchen_applications"."status" IS 
  'Application status: inReview (pending manager review), approved (can book), rejected (denied), cancelled (withdrawn)';

COMMENT ON COLUMN "chef_kitchen_applications"."food_safety_license" IS 
  'Whether chef has a food safety license: yes, no, notSure';

COMMENT ON COLUMN "chef_kitchen_applications"."food_safety_license_url" IS 
  'URL to uploaded food safety license document';

COMMENT ON COLUMN "chef_kitchen_applications"."food_safety_license_status" IS 
  'Manager verification status of the food safety license document';

-- ============================================================================
-- DEPRECATION NOTES (DO NOT RUN - Documentation Only)
-- ============================================================================

-- The following tables are now DEPRECATED but NOT REMOVED for backward compatibility:
-- 
-- 1. chef_location_profiles
--    - Was used for "Share Profile" feature
--    - Keep existing data for historical reference
--    - Stop writing new records
--    - Eventually migrate approved records to chef_kitchen_applications
--
-- 2. chef_location_access  
--    - Was used for admin-granted location access
--    - Keep existing data for historical reference
--    - Stop writing new records
--    - No longer checked in booking validation

-- To migrate existing approved profiles (OPTIONAL - run manually if needed):
-- 
-- INSERT INTO chef_kitchen_applications (chef_id, location_id, full_name, email, phone, 
--   kitchen_preference, food_safety_license, food_establishment_cert, status, created_at)
-- SELECT 
--   clp.chef_id,
--   clp.location_id,
--   COALESCE(a.full_name, u.username),
--   COALESCE(a.email, u.username),
--   COALESCE(a.phone, ''),
--   COALESCE(a.kitchen_preference, 'notSure'),
--   COALESCE(a.food_safety_license, 'notSure'),
--   COALESCE(a.food_establishment_cert, 'notSure'),
--   CASE WHEN clp.status = 'approved' THEN 'approved'::application_status 
--        WHEN clp.status = 'rejected' THEN 'rejected'::application_status
--        ELSE 'inReview'::application_status END,
--   clp.shared_at
-- FROM chef_location_profiles clp
-- LEFT JOIN users u ON clp.chef_id = u.id
-- LEFT JOIN applications a ON a.user_id = clp.chef_id
-- WHERE NOT EXISTS (
--   SELECT 1 FROM chef_kitchen_applications cka 
--   WHERE cka.chef_id = clp.chef_id AND cka.location_id = clp.location_id
-- );

