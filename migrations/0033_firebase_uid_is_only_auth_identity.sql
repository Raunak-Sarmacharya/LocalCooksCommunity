-- Firebase owns authentication providers and enforces phone uniqueness.
-- Local Cooks resolves every authenticated request exclusively by Firebase UID.
-- Keep the legacy column and index for one deployment window so an older app
-- instance can still roll back safely. No current code reads or writes it.
COMMENT ON COLUMN users.auth_phone_number IS
  'Deprecated identity mirror. Firebase Auth is authoritative; remove after the compatibility window.';

-- Application submissions are historical records, not profile-authoritative data.
-- Stop old application edits from silently changing a user's contact number.
DROP TRIGGER IF EXISTS applications_sync_user_phone ON applications;
DROP TRIGGER IF EXISTS chef_kitchen_applications_sync_user_phone ON chef_kitchen_applications;
DROP TRIGGER IF EXISTS portal_user_applications_sync_user_phone ON portal_user_applications;
DROP FUNCTION IF EXISTS sync_application_phone_to_user();
DROP FUNCTION IF EXISTS normalize_localcooks_phone(TEXT);
