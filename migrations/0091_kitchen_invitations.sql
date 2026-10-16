CREATE TABLE "kitchen_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "worker_id" serial NOT NULL UNIQUE,
  "request_key" text NOT NULL UNIQUE,
  "kitchen_id" integer NOT NULL REFERENCES "kitchens"("id") ON DELETE RESTRICT,
  "location_id" integer NOT NULL REFERENCES "locations"("id") ON DELETE RESTRICT,
  "manager_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "chef_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "status" text DEFAULT 'sent' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "replaces_id" text REFERENCES "kitchen_invitations"("id") ON DELETE RESTRICT,
  "date" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "operating_window_start_time" text NOT NULL,
  "timezone" text NOT NULL,
  "pricing_mode" text NOT NULL,
  "selected_slots" jsonb NOT NULL,
  "list_subtotal_cents" integer NOT NULL,
  "offered_subtotal_cents" integer NOT NULL,
  "discount_type" text,
  "discount_value" integer,
  "tax_cents" integer NOT NULL,
  "service_fee_cents" integer NOT NULL,
  "total_cents" integer NOT NULL,
  "manager_estimated_payout_cents" integer NOT NULL,
  "cancellation_policy_hours" integer NOT NULL,
  "cancellation_charge_percent" integer NOT NULL,
  "note" text,
  "expires_in_hours" integer NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "reminder_sent_at" timestamptz,
  "expiry_notified_at" timestamptz,
  "hold_id" text,
  "stripe_session_id" text UNIQUE,
  "booking_id" integer,
  "unavailable_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "kitchen_invitation_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "invitation_id" text NOT NULL REFERENCES "kitchen_invitations"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "version" integer NOT NULL,
  "actor_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_role" text,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notice_key" text UNIQUE,
  "delivered_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "kitchen_bookings"
  ADD COLUMN "invitation_id" text REFERENCES "kitchen_invitations"("id") ON DELETE SET NULL;

ALTER TABLE "kitchen_invitations"
  ADD CONSTRAINT "kitchen_invitations_booking_id_kitchen_bookings_id_fk"
  FOREIGN KEY ("booking_id") REFERENCES "kitchen_bookings"("id") ON DELETE SET NULL;

CREATE INDEX "kitchen_invitations_manager_idx" ON "kitchen_invitations" ("manager_id", "created_at");
CREATE INDEX "kitchen_invitations_chef_idx" ON "kitchen_invitations" ("chef_id", "created_at");
CREATE INDEX "kitchen_invitations_expiry_idx" ON "kitchen_invitations" ("expires_at", "id");
CREATE INDEX "kitchen_invitation_events_invitation_idx" ON "kitchen_invitation_events" ("invitation_id", "id");
