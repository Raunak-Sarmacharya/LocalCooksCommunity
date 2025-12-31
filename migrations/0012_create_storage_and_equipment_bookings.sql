-- Migration: Create storage_bookings and equipment_bookings tables
-- These tables allow storage and equipment to be booked as add-ons to kitchen bookings
-- CRITICAL: Both can ONLY be booked as part of a kitchen booking (not standalone)

-- ============================================================================
-- STORAGE BOOKINGS TABLE
-- ============================================================================
-- Foreign key: kitchen_booking_id is NOT NULL to enforce that storage
-- can only be booked as part of a kitchen booking (no standalone storage bookings)

CREATE TABLE IF NOT EXISTS "storage_bookings" (
  "id" SERIAL PRIMARY KEY,
  "storage_listing_id" INTEGER NOT NULL REFERENCES "storage_listings"("id") ON DELETE CASCADE,
  "kitchen_booking_id" INTEGER NOT NULL REFERENCES "kitchen_bookings"("id") ON DELETE CASCADE,
  "chef_id" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "start_date" TIMESTAMP NOT NULL,
  "end_date" TIMESTAMP NOT NULL,
  "status" "booking_status" NOT NULL DEFAULT 'pending',
  "total_price" NUMERIC NOT NULL,
  "pricing_model" "storage_pricing_model" NOT NULL,
  "payment_status" "payment_status" DEFAULT 'pending',
  "payment_intent_id" TEXT,
  "service_fee" NUMERIC DEFAULT '0',
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for storage_bookings
CREATE INDEX IF NOT EXISTS "storage_bookings_storage_listing_id_idx" ON "storage_bookings" ("storage_listing_id");
CREATE INDEX IF NOT EXISTS "storage_bookings_kitchen_booking_id_idx" ON "storage_bookings" ("kitchen_booking_id");
CREATE INDEX IF NOT EXISTS "storage_bookings_chef_id_idx" ON "storage_bookings" ("chef_id");
CREATE INDEX IF NOT EXISTS "storage_bookings_status_idx" ON "storage_bookings" ("status");
CREATE INDEX IF NOT EXISTS "storage_bookings_payment_status_idx" ON "storage_bookings" ("payment_status");
CREATE UNIQUE INDEX IF NOT EXISTS "storage_bookings_payment_intent_id_unique" ON "storage_bookings" ("payment_intent_id") WHERE ("payment_intent_id" IS NOT NULL);

-- ============================================================================
-- EQUIPMENT BOOKINGS TABLE
-- ============================================================================
-- Foreign key: kitchen_booking_id is NOT NULL to enforce that equipment
-- can only be booked as part of a kitchen booking (no standalone equipment bookings)
-- Only rental equipment (availability_type='rental') should be booked - included equipment is free

CREATE TABLE IF NOT EXISTS "equipment_bookings" (
  "id" SERIAL PRIMARY KEY,
  "equipment_listing_id" INTEGER NOT NULL REFERENCES "equipment_listings"("id") ON DELETE CASCADE,
  "kitchen_booking_id" INTEGER NOT NULL REFERENCES "kitchen_bookings"("id") ON DELETE CASCADE,
  "chef_id" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "start_date" TIMESTAMP NOT NULL,
  "end_date" TIMESTAMP NOT NULL,
  "status" "booking_status" NOT NULL DEFAULT 'pending',
  "total_price" NUMERIC NOT NULL,
  "pricing_model" "equipment_pricing_model" NOT NULL,
  "damage_deposit" NUMERIC DEFAULT '0',
  "payment_status" "payment_status" DEFAULT 'pending',
  "payment_intent_id" TEXT,
  "service_fee" NUMERIC DEFAULT '0',
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for equipment_bookings
CREATE INDEX IF NOT EXISTS "equipment_bookings_equipment_listing_id_idx" ON "equipment_bookings" ("equipment_listing_id");
CREATE INDEX IF NOT EXISTS "equipment_bookings_kitchen_booking_id_idx" ON "equipment_bookings" ("kitchen_booking_id");
CREATE INDEX IF NOT EXISTS "equipment_bookings_chef_id_idx" ON "equipment_bookings" ("chef_id");
CREATE INDEX IF NOT EXISTS "equipment_bookings_status_idx" ON "equipment_bookings" ("status");
CREATE INDEX IF NOT EXISTS "equipment_bookings_payment_status_idx" ON "equipment_bookings" ("payment_status");
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_bookings_payment_intent_id_unique" ON "equipment_bookings" ("payment_intent_id") WHERE ("payment_intent_id" IS NOT NULL);

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE "storage_bookings" IS 'Storage bookings - always linked to a kitchen booking. CASCADE delete from parent tables.';
COMMENT ON COLUMN "storage_bookings"."kitchen_booking_id" IS 'REQUIRED: Storage can only be booked as part of a kitchen booking';
COMMENT ON COLUMN "storage_bookings"."total_price" IS 'Total price in cents (e.g., 15000 = $150.00)';
COMMENT ON COLUMN "storage_bookings"."service_fee" IS 'Platform commission in cents';

COMMENT ON TABLE "equipment_bookings" IS 'Equipment bookings - always linked to a kitchen booking. Only for rental equipment.';
COMMENT ON COLUMN "equipment_bookings"."kitchen_booking_id" IS 'REQUIRED: Equipment can only be booked as part of a kitchen booking';
COMMENT ON COLUMN "equipment_bookings"."total_price" IS 'Total price in cents (e.g., 5000 = $50.00)';
COMMENT ON COLUMN "equipment_bookings"."damage_deposit" IS 'Refundable damage deposit in cents';
COMMENT ON COLUMN "equipment_bookings"."service_fee" IS 'Platform commission in cents';

