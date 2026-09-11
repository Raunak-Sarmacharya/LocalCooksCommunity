-- Kitchen tours are requested for a specific kitchen, so their settings,
-- weekly availability, and blackout periods must use the same scope.

CREATE TABLE IF NOT EXISTS "kitchen_viewing_settings" (
  "id" serial PRIMARY KEY,
  "kitchen_id" integer NOT NULL UNIQUE REFERENCES "kitchens"("id") ON DELETE CASCADE,
  "is_active" boolean NOT NULL DEFAULT false,
  "default_duration_minutes" integer NOT NULL DEFAULT 30,
  "buffer_before_minutes" integer NOT NULL DEFAULT 0,
  "buffer_after_minutes" integer NOT NULL DEFAULT 15,
  "advance_notice_hours" integer NOT NULL DEFAULT 24,
  "max_advance_booking_days" integer NOT NULL DEFAULT 30,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "kitchen_viewing_availability" (
  "id" serial PRIMARY KEY,
  "kitchen_id" integer NOT NULL REFERENCES "kitchens"("id") ON DELETE CASCADE,
  "day_of_week" integer NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "is_available" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "kitchen_viewing_blackouts" (
  "id" serial PRIMARY KEY,
  "kitchen_id" integer NOT NULL REFERENCES "kitchens"("id") ON DELETE CASCADE,
  "start_date" timestamp NOT NULL,
  "end_date" timestamp NOT NULL,
  "reason" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "kitchen_viewing_availability_kitchen_day_idx"
  ON "kitchen_viewing_availability" ("kitchen_id", "day_of_week");

CREATE INDEX IF NOT EXISTS "kitchen_viewing_blackouts_kitchen_dates_idx"
  ON "kitchen_viewing_blackouts" ("kitchen_id", "start_date", "end_date");

-- Preserve existing location schedules by copying them to every kitchen at that
-- location. Managers can then adjust each kitchen independently.
DO $$
BEGIN
  IF to_regclass('public.location_viewing_settings') IS NOT NULL THEN
    INSERT INTO "kitchen_viewing_settings" (
      "kitchen_id", "is_active", "default_duration_minutes",
      "buffer_before_minutes", "buffer_after_minutes", "advance_notice_hours",
      "max_advance_booking_days", "version", "created_at", "updated_at"
    )
    SELECT
      k."id", s."is_active", s."default_duration_minutes",
      s."buffer_before_minutes", s."buffer_after_minutes", s."advance_notice_hours",
      s."max_advance_booking_days", s."version", s."created_at", s."updated_at"
    FROM "location_viewing_settings" s
    JOIN "kitchens" k ON k."location_id" = s."location_id"
    ON CONFLICT ("kitchen_id") DO NOTHING;
  END IF;

  IF to_regclass('public.location_viewing_availability') IS NOT NULL THEN
    INSERT INTO "kitchen_viewing_availability" (
      "kitchen_id", "day_of_week", "start_time", "end_time", "is_available"
    )
    SELECT
      k."id", a."day_of_week", a."start_time", a."end_time", a."is_available"
    FROM "location_viewing_availability" a
    JOIN "kitchens" k ON k."location_id" = a."location_id";
  END IF;

  IF to_regclass('public.location_viewing_blackouts') IS NOT NULL THEN
    INSERT INTO "kitchen_viewing_blackouts" (
      "kitchen_id", "start_date", "end_date", "reason", "created_at"
    )
    SELECT
      k."id", b."start_date", b."end_date", b."reason", b."created_at"
    FROM "location_viewing_blackouts" b
    JOIN "kitchens" k ON k."location_id" = b."location_id";
  END IF;
END $$;
