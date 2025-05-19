-- Create new enum types

CREATE TYPE "public"."order_fulfillment" AS ENUM('preOrder', 'onDemand', 'both');

-- Add new columns to applications table

ALTER TABLE "applications" ADD COLUMN "order_fulfillment_method" "order_fulfillment" NOT NULL DEFAULT 'preOrder';
ALTER TABLE "applications" ADD COLUMN "questions" text;