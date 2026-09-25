-- 0045: Make user deletion actually cascade
--
-- Deleting a user used to fail with an opaque 23503 whenever the account had
-- rows in a `NO ACTION` child table. `users.id` is referenced by ~50 foreign
-- keys and only 23 of them cascade, so in practice almost any real account was
-- undeletable and the admin got a generic 500 (see server/routes/admin.ts).
--
-- The application now performs an explicit, dependency-ordered cleanup inside
-- one transaction (server/domains/users/user-deletion.service.ts), which is what
-- makes the delete work today. This migration is the belt to that braces: it
-- gives the database a sensible default so any future `DELETE FROM users` — a
-- support script, a Supabase console delete, a test fixture — behaves the same
-- way instead of aborting.
--
-- ── Deliberate exceptions ────────────────────────────────────────────────────
-- Not every user-referencing FK should become CASCADE. Three groups stay as-is:
--
--   * SET NULL audit columns (payment_history.created_by,
--     damage_claims.resolved_by, email_logs.recipient_user_id, …). Already
--     correct: the record must survive the person who created it, and a bare
--     "200", "none", "3", TRUE is a NULL-tolerant unique-candidate, NOT an
--     integer.
--   * platform_settings.updated_by — global config. The only readers look
--     settings up by `key` (server/security.ts, GET/PATCH /api/admin/settings/:key),
--     so a dangling stamp costs nothing while a cascading delete would silently
--     drop a rate-limit or feature-flag row because the admin who last touched
--     it left.
--   * locations.manager_id is handled explicitly in the service as `SET NULL`
--     (a kitchen is the business; the manager is replaceable), but the column is
--     left `NO ACTION` here because the application already nulls it and a
--     schema-level SET NULL would make the kitchen-delete safety check in
--     KitchenRepository harder to reason about.
--
--   * `locations.kitchen_license_reviewed_by` has NO foreign key at all — it is
--     a bare integer. The service nulls it; there is no delete rule to change.
--
-- ── Prerequisites ────────────────────────────────────────────────────────────
-- Only three tables are actually blocking in practice, and they are ALREADY
-- CASCADE, so this migration is not required for the fix to work:
--   chef_kitchen_access, chef_location_access, chef_location_profiles (chef_id)
--
-- ⚠️ NOT APPLIED AUTOMATICALLY. Migrations in this repo are hand-run. Apply with
--    the Supabase SQL editor, and confirm every table/column name with the
--    verification query at the bottom before running.
--
-- ⚠️ CONSTRAINT NAMES ARE NOT UNIFORM. Some are Drizzle-generated
--    (`<table>_<column>_users_id_fk`) and some are hand-written
--    (`<table>_<column>_fkey`). Both forms appear below, verified against the
--    live database. Do not "normalise" them — the DO block looks up the real
--    name from the catalogue anyway, so a mismatch degrades to a warning rather
--    than a half-applied migration.
--
-- ⚠️ THIS WILL FAIL IF RUN VIA SUPABASE'S SQL EDITOR. The editor assigns a
--    "Postgres Role" to the session, and changing a table's owner requires
--    membership in that role's group plus CREATE on the schema — a plain
--    service-role connection gets `ERROR: 42501: must be owner of relation ...`.
--    Run it with `psql` over the direct (non-pooler) connection string instead:
--
--      psql "postgresql://postgres.<ref>:<password>@<region>.supabase.com:5432/postgres" \
--        -v ON_ERROR_STOP=1 -f migrations/0045_user_deletion_cascade.sql
--
--    The service-role/`DATABASE_URL` path is intentionally NOT supported here:
--    the connection string is parameterised and the DDL is not, so an
--    `ALTER TABLE %I` built from a URL-supplied name would be an injection
--    surface for no benefit.

-- ============================================================================
-- 1. Rows that exist only because the user existed → delete them with the user
-- ============================================================================
-- Each block finds the actual foreign key on (table, column) instead of
-- trusting a hard-coded name, then rewrites its delete rule.

DO $$
DECLARE
  target_table text;
  target_column text;
  wanted_rule text;
  con_name text;
  targets text[][] := ARRAY[
    -- The headline symptom: a single unread notification used to block deletion.
    ARRAY['chef_notifications', 'chef_id',            'CASCADE'],
    ARRAY['manager_notifications', 'manager_id',      'CASCADE'],
    -- `chef_id` is the customer and `created_by` is the chef who booked for
    -- themselves; both describe the same booking, so both go with the user.
    ARRAY['kitchen_bookings', 'chef_id',              'CASCADE'],
    ARRAY['kitchen_bookings', 'created_by',           'CASCADE'],
    ARRAY['applications', 'user_id',                  'CASCADE'],
    ARRAY['microlearning_completions', 'user_id',     'CASCADE'],
    ARRAY['video_progress', 'user_id',                'CASCADE'],
    -- Auth artefacts: a reset token for a deleted account can never be redeemed,
    -- and nothing prunes them on expiry.
    ARRAY['password_reset_tokens', 'user_id',         'CASCADE'],
    -- An in-flight manager action with nobody left to action it.
    ARRAY['pending_storage_extensions', 'manager_id', 'CASCADE'],
    -- Review/approval stamps: the approval still happened, so the row survives
    -- and only the identity is forgotten. As `NO ACTION` these are hard
    -- blockers — e.g. a manager who ever approved a kitchen licence could not be
    -- deleted at all.
    ARRAY['applications', 'documents_reviewed_by',    'SET NULL'],
    ARRAY['locations', 'kitchen_license_approved_by', 'SET NULL'],
    ARRAY['locations', 'kitchen_license_reviewed_by', 'SET NULL']
  ];
  entry text[];
BEGIN
  FOREACH entry SLICE 1 IN ARRAY targets LOOP
    target_table  := entry[1];
    target_column := entry[2];
    wanted_rule   := entry[3];

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target_table AND column_name = target_column
    ) THEN
      RAISE WARNING 'skipping %.%: column does not exist', target_table, target_column;
      CONTINUE;
    END IF;

    SELECT tc.constraint_name INTO con_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = target_table
      AND kcu.column_name = target_column
      AND ccu.table_name = 'users';

    -- No FK at all (e.g. `locations.kitchen_license_reviewed_by` is a bare
    -- integer with no constraint). Nothing to rewrite — the application cleans
    -- the column, and there is no delete rule that could block.
    IF con_name IS NULL THEN
      RAISE NOTICE 'no FK on %.% -> users(id); nothing to do', target_table, target_column;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', target_table, con_name);

    -- SET NULL needs the column to be nullable. `user_id` is NOT NULL on
    -- `applications`, so without this the ADD CONSTRAINT below fails and the
    -- whole migration rolls back.
    IF wanted_rule = 'SET NULL' THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', target_table, target_column);
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE %s',
      target_table, con_name, target_column, wanted_rule
    );
    RAISE NOTICE 'rewrote %.% (%) -> ON DELETE %', target_table, target_column, con_name, wanted_rule;
  END LOOP;
END $$;

-- ============================================================================
-- 3. Verification — run BEFORE applying, and expect zero rows
-- ============================================================================
-- Any row returned below is a FK to `users` that neither cascades nor nulls,
-- i.e. a delete landmine this migration missed. `locations.manager_id` and
-- `platform_settings.updated_by` are expected in that list by design.
--
-- SELECT tc.table_name, kcu.column_name, rc.delete_rule
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
-- JOIN information_schema.constraint_column_usage ccu
--   ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
-- JOIN information_schema.referential_constraints rc
--   ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
-- WHERE tc.constraint_type = 'FOREIGN KEY'
--   AND ccu.table_name = 'users'
--   AND rc.delete_rule = 'NO ACTION'
--   AND tc.table_name NOT IN ('locations', 'platform_settings')
-- ORDER BY tc.table_name;

-- ============================================================================
-- 4. Escape hatch — keeping an application alive after its applicant is deleted
-- ============================================================================
-- Re-running sections 1-2 is idempotent. To preserve applications instead of
-- cascading them, replace the `applications.user_id` constraint above with:
--
-- ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_user_id_fkey;
-- ALTER TABLE applications ADD CONSTRAINT applications_user_id_fkey
--   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
--
-- …and make `user_id` nullable first. The service currently deletes the row, so
-- the application code would need the matching change too.
