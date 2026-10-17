-- Location-level HST % and cancellation defaults (additive). Do not change the BEFORE INSERT
-- booking policy snapshot trigger or the frozen booking cancellation snapshot guarantee (see 0048 / 0098).
BEGIN;

-- Tax: location owns the rate; kitchens keep their column so existing checkout readers stay unchanged.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS tax_rate_percent numeric;

-- When every kitchen at a location shares the same non-null rate, copy it up. If any kitchen
-- differs (or any is null while another is set), leave the location NULL and keep kitchen values.
UPDATE locations loc
SET tax_rate_percent = agreed.rate
FROM (
  SELECT k.location_id AS location_id, MIN(k.tax_rate_percent) AS rate
  FROM kitchens k
  GROUP BY k.location_id
  HAVING COUNT(*) FILTER (WHERE k.tax_rate_percent IS NOT NULL) = COUNT(*)
     AND COUNT(DISTINCT k.tax_rate_percent) = 1
) agreed
WHERE loc.id = agreed.location_id
  AND loc.tax_rate_percent IS NULL;

-- Versioned cancellation default at the location (notice + late charge). Chefs still freeze the
-- kitchen's published policy onto each booking.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS cancellation_notice_hours integer
  CHECK (cancellation_notice_hours IS NULL OR cancellation_notice_hours IN (24, 48, 72));
ALTER TABLE locations ADD COLUMN IF NOT EXISTS cancellation_late_charge_percent integer
  CHECK (cancellation_late_charge_percent IS NULL OR cancellation_late_charge_percent IN (50, 100));

-- Kitchen follows the location default until it publishes its own override (or admin overrides).
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS cancellation_follows_location boolean NOT NULL DEFAULT true;

-- Backfill location cancellation default when all kitchens' latest published policies agree.
WITH latest AS (
  SELECT DISTINCT ON (p.kitchen_id)
    p.kitchen_id, k.location_id, p.notice_hours, p.late_charge_percent
  FROM kitchen_cancellation_policies p
  JOIN kitchens k ON k.id = p.kitchen_id
  WHERE p.status = 'published'
  ORDER BY p.kitchen_id, p.version DESC
),
agreed AS (
  SELECT location_id, MIN(notice_hours) AS notice_hours, MIN(late_charge_percent) AS late_charge_percent
  FROM latest
  GROUP BY location_id
  HAVING COUNT(*) = COUNT(*) FILTER (WHERE notice_hours IS NOT NULL)
     AND COUNT(DISTINCT notice_hours) = 1
     AND COUNT(DISTINCT late_charge_percent) = 1
)
UPDATE locations loc
SET cancellation_notice_hours = agreed.notice_hours,
    cancellation_late_charge_percent = agreed.late_charge_percent
FROM agreed
WHERE loc.id = agreed.location_id
  AND loc.cancellation_notice_hours IS NULL
  AND loc.cancellation_late_charge_percent IS NULL;

-- Locations with no agreed kitchen policy get the platform default (24 h / 100%).
UPDATE locations
SET cancellation_notice_hours = 24,
    cancellation_late_charge_percent = 100
WHERE cancellation_notice_hours IS NULL
   OR cancellation_late_charge_percent IS NULL;

-- Kitchens whose published policy differs from the location default stop following.
UPDATE kitchens k
SET cancellation_follows_location = false
FROM (
  SELECT DISTINCT ON (p.kitchen_id)
    p.kitchen_id, p.notice_hours, p.late_charge_percent
  FROM kitchen_cancellation_policies p
  WHERE p.status = 'published'
  ORDER BY p.kitchen_id, p.version DESC
) latest
JOIN locations loc ON loc.id = k.location_id
WHERE latest.kitchen_id = k.id
  AND (latest.notice_hours IS DISTINCT FROM loc.cancellation_notice_hours
    OR latest.late_charge_percent IS DISTINCT FROM loc.cancellation_late_charge_percent);

ALTER TABLE locations ALTER COLUMN cancellation_notice_hours SET DEFAULT 24;
ALTER TABLE locations ALTER COLUMN cancellation_late_charge_percent SET DEFAULT 100;
ALTER TABLE locations ALTER COLUMN cancellation_notice_hours SET NOT NULL;
ALTER TABLE locations ALTER COLUMN cancellation_late_charge_percent SET NOT NULL;

COMMIT;
