-- Keep existing public URLs and give older locations a stable, readable preview URL.
UPDATE locations
SET slug = coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'location') || '-' || id
WHERE slug IS NULL OR slug = '';
