ALTER TABLE "kitchens"
  ADD COLUMN IF NOT EXISTS "daily_rate" numeric;

COMMENT ON COLUMN "kitchens"."daily_rate" IS 'Base daily rate in cents; may be set alongside hourly_rate';
