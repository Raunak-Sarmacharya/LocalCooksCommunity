-- Migration: Remove 25 unused columns from equipment_listings table
-- These columns were identified as having no data and not being used in the UI
-- Date: 2026-01-26

-- Drop unused columns from equipment_listings table
ALTER TABLE equipment_listings
  DROP COLUMN IF EXISTS model,
  DROP COLUMN IF EXISTS age,
  DROP COLUMN IF EXISTS service_history,
  DROP COLUMN IF EXISTS dimensions,
  DROP COLUMN IF EXISTS power_requirements,
  DROP COLUMN IF EXISTS specifications,
  DROP COLUMN IF EXISTS certifications,
  DROP COLUMN IF EXISTS safety_features,
  DROP COLUMN IF EXISTS pricing_model,
  DROP COLUMN IF EXISTS hourly_rate,
  DROP COLUMN IF EXISTS daily_rate,
  DROP COLUMN IF EXISTS weekly_rate,
  DROP COLUMN IF EXISTS monthly_rate,
  DROP COLUMN IF EXISTS minimum_rental_hours,
  DROP COLUMN IF EXISTS minimum_rental_days,
  DROP COLUMN IF EXISTS usage_restrictions,
  DROP COLUMN IF EXISTS training_required,
  DROP COLUMN IF EXISTS cleaning_responsibility,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS availability_calendar,
  DROP COLUMN IF EXISTS prep_time_hours,
  DROP COLUMN IF EXISTS photos,
  DROP COLUMN IF EXISTS manuals,
  DROP COLUMN IF EXISTS maintenance_log,
  DROP COLUMN IF EXISTS insurance_required;

-- Note: The following columns are KEPT as they are actively used:
-- id, kitchen_id, category, equipment_type, brand, description, condition,
-- availability_type, session_rate, damage_deposit, is_active, currency,
-- status, created_at, updated_at
