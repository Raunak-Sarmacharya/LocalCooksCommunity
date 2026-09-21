-- Migration: give kitchens a manager-controlled publish state
--
-- Kitchens had NO publish state. `kitchens.is_active` is the ADMIN's Hide/Show switch — it is exposed
-- in AdminManageLocations as "Hide"/"Show" and backed by PATCH /admin/kitchens/:id/toggle-visibility.
-- It defaults to true and no manager route can set it, so a kitchen a manager created became visible to
-- chefs immediately, whatever state it was in: no rate, no opening hours, no photo. That is why the
-- chef-side discovery needed a "Coming Soon" badge — a band-aid over a missing gate.
--
-- This column is the MANAGER's switch, and it is per KITCHEN, so a location with three kitchens gives
-- each one its own go-live / take-off-listing control.
--
-- Two flags, two owners, neither able to override the other:
--   listing_status — the manager: "have I published this listing?"
--   is_active      — the admin:    "has the platform hidden this?"
-- A kitchen is visible to chefs only when BOTH allow it.
--
-- Reuses the existing `listing_status` enum type (already used by storage_listings and equipment_listings)
-- so no new type is created.

-- The guard is deliberate. `ADD COLUMN ... DEFAULT 'draft'` puts every existing row into draft, and the
-- backfill then publishes them. Running that backfill a second time — after real draft kitchens exist —
-- would silently publish listings a manager had deliberately not published yet. So the backfill is tied
-- to the column actually being created, and a re-run is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'kitchens'
       AND column_name = 'listing_status'
  ) THEN
    ALTER TABLE "kitchens"
      ADD COLUMN "listing_status" listing_status DEFAULT 'draft' NOT NULL;

    COMMENT ON COLUMN "kitchens"."listing_status" IS
      'Manager-controlled publish state. draft = not visible to chefs, active = published. Distinct from is_active, which is the admin Hide/Show override.';

    -- Every kitchen that exists today is already visible to chefs, so publishing them all preserves
    -- current behaviour exactly. Without this, the chef-side filter would take every live kitchen off
    -- the marketplace the moment it deployed.
    UPDATE "kitchens" SET "listing_status" = 'active';
  END IF;
END $$;
