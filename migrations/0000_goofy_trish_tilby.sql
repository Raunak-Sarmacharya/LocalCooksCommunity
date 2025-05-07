CREATE TYPE "public"."application_status" AS ENUM('new', 'inReview', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."certification_status" AS ENUM('yes', 'no', 'notSure');--> statement-breakpoint
CREATE TYPE "public"."kitchen_preference" AS ENUM('commercial', 'home', 'notSure');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"food_safety_license" "certification_status" NOT NULL,
	"food_establishment_cert" "certification_status" NOT NULL,
	"kitchen_preference" "kitchen_preference" NOT NULL,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
