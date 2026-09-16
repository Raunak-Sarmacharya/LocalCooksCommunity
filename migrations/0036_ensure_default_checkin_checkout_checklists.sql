-- Every location should own an explicit check-in/check-out checklist row.
-- Missing rows left toggles ambiguous: left-joins returned null and several
-- chef/booking callers treated "not false" as enabled. Schema defaults are
-- all sections OFF with empty item arrays — insert those for any location
-- that never got a row (managers who never opened the settings page).
INSERT INTO checkin_checkout_checklists (
  location_id,
  checkin_enabled,
  checkin_items,
  checkin_photo_requirements,
  checkout_enabled,
  checkout_items,
  checkout_photo_requirements,
  storage_checkout_enabled,
  storage_checkout_items,
  storage_checkout_photo_requirements,
  storage_checkin_enabled,
  storage_checkin_items,
  storage_checkin_photo_requirements
)
SELECT
  l.id,
  false,
  '[]'::jsonb,
  '[]'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb
FROM locations l
WHERE NOT EXISTS (
  SELECT 1
  FROM checkin_checkout_checklists c
  WHERE c.location_id = l.id
);
