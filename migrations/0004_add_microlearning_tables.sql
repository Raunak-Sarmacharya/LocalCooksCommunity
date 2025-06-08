-- Add microlearning_completions table
CREATE TABLE "microlearning_completions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"certificate_generated" boolean DEFAULT false NOT NULL,
	"video_progress" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add video_progress table
CREATE TABLE "video_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"video_id" text NOT NULL,
	"progress" numeric(5,2) DEFAULT '0' NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"watched_percentage" numeric(5,2) DEFAULT '0' NOT NULL,
	"is_rewatching" boolean DEFAULT false NOT NULL
);

-- Add foreign key constraints
ALTER TABLE "microlearning_completions" ADD CONSTRAINT "microlearning_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- Add indexes for better performance
CREATE INDEX "video_progress_user_id_idx" ON "video_progress" ("user_id");
CREATE INDEX "video_progress_user_video_idx" ON "video_progress" ("user_id", "video_id");
CREATE INDEX "microlearning_completions_user_id_idx" ON "microlearning_completions" ("user_id"); 