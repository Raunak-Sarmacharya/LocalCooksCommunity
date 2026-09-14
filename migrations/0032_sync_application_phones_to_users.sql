-- Canonical user contact phone. Authentication remains gated by auth_phone_number,
-- which is populated only from a verified Firebase phone_number token claim.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Normalize the North American numbers accepted by the application forms.
CREATE OR REPLACE FUNCTION normalize_localcooks_phone(raw_phone TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT CASE
    WHEN length(regexp_replace(raw_phone, '[^0-9]', '', 'g')) = 10
      THEN '+1' || regexp_replace(raw_phone, '[^0-9]', '', 'g')
    WHEN length(regexp_replace(raw_phone, '[^0-9]', '', 'g')) = 11
      AND regexp_replace(raw_phone, '[^0-9]', '', 'g') LIKE '1%'
      THEN '+' || regexp_replace(raw_phone, '[^0-9]', '', 'g')
    ELSE NULL
  END;
$$;

-- Backfill from the most recently submitted application across every user-facing
-- application workflow. A verified Firebase number takes precedence when present.
WITH phone_candidates AS (
  SELECT user_id, phone, created_at AS occurred_at FROM applications WHERE user_id IS NOT NULL
  UNION ALL
  SELECT chef_id AS user_id, phone, updated_at AS occurred_at FROM chef_kitchen_applications
  UNION ALL
  SELECT user_id, phone, created_at AS occurred_at FROM portal_user_applications
), latest_phone AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    normalize_localcooks_phone(phone) AS phone_number
  FROM phone_candidates
  WHERE normalize_localcooks_phone(phone) IS NOT NULL
  ORDER BY user_id, occurred_at DESC NULLS LAST
)
UPDATE users AS u
SET phone_number = COALESCE(u.auth_phone_number, latest_phone.phone_number)
FROM latest_phone
WHERE u.id = latest_phone.user_id
  AND u.phone_number IS NULL;

UPDATE users
SET phone_number = auth_phone_number
WHERE phone_number IS NULL
  AND auth_phone_number IS NOT NULL;

-- Keep the canonical contact current regardless of which application service wrote
-- the row. auth_phone_number is deliberately untouched until OTP verification.
CREATE OR REPLACE FUNCTION sync_application_phone_to_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_user_id INTEGER;
  normalized_phone TEXT;
BEGIN
  target_user_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::INTEGER;
  normalized_phone := normalize_localcooks_phone(NEW.phone);

  IF target_user_id IS NOT NULL AND normalized_phone IS NOT NULL THEN
    UPDATE users
    SET phone_number = normalized_phone,
        updated_at = NOW()
    WHERE id = target_user_id
      AND phone_number IS DISTINCT FROM normalized_phone;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_sync_user_phone ON applications;
CREATE TRIGGER applications_sync_user_phone
AFTER INSERT OR UPDATE OF phone, user_id ON applications
FOR EACH ROW EXECUTE FUNCTION sync_application_phone_to_user('user_id');

DROP TRIGGER IF EXISTS chef_kitchen_applications_sync_user_phone ON chef_kitchen_applications;
CREATE TRIGGER chef_kitchen_applications_sync_user_phone
AFTER INSERT OR UPDATE OF phone, chef_id ON chef_kitchen_applications
FOR EACH ROW EXECUTE FUNCTION sync_application_phone_to_user('chef_id');

DROP TRIGGER IF EXISTS portal_user_applications_sync_user_phone ON portal_user_applications;
CREATE TRIGGER portal_user_applications_sync_user_phone
AFTER INSERT OR UPDATE OF phone, user_id ON portal_user_applications
FOR EACH ROW EXECUTE FUNCTION sync_application_phone_to_user('user_id');
