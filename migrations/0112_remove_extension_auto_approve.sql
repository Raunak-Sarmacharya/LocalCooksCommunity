-- A customer's request for more time always waits for the kitchen's approval; nothing is charged automatically
-- (owner, Oct 24). The kitchen's "approve automatically" choice and Local Cooks' per-kitchen override are removed.
ALTER TABLE kitchens DROP COLUMN IF EXISTS auto_approve_session_extensions;
ALTER TABLE kitchens DROP COLUMN IF EXISTS session_extensions_admin_override;
DELETE FROM platform_settings WHERE key LIKE 'session\_extensions\_override\_%';
