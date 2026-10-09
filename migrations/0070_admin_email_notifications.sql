-- Preserve existing recipients when this migration is later applied to production.
-- New admins opt in explicitly. Staging's recipient selection is a separate step.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'admin_email_notifications') THEN
    ALTER TABLE users ADD COLUMN admin_email_notifications boolean NOT NULL DEFAULT false;
    UPDATE users SET admin_email_notifications = true WHERE role = 'admin';
  END IF;
END $$;
ALTER TABLE users ALTER COLUMN admin_email_notifications SET DEFAULT false;
