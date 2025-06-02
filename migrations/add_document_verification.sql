-- Add verified status to users table
ALTER TABLE "users" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;

-- Create enum for document verification status
CREATE TYPE "public"."document_verification_status" AS ENUM('pending', 'approved', 'rejected');

-- Create document verification table
CREATE TABLE "document_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"food_safety_license_url" text,
	"food_establishment_cert_url" text,
	"food_safety_license_status" "document_verification_status" DEFAULT 'pending',
	"food_establishment_cert_status" "document_verification_status" DEFAULT 'pending',
	"admin_feedback" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraints
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; 