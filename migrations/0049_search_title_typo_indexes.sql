-- Title-only trigram indexes support close matches without scanning long descriptions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS locations_search_title_trgm_idx
  ON locations USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS kitchens_search_title_trgm_idx
  ON kitchens USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS storage_listings_search_title_trgm_idx
  ON storage_listings USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS equipment_listings_search_title_trgm_idx
  ON equipment_listings USING gin (lower(btrim(coalesce(brand, '') || ' ' || coalesce(equipment_type, ''))) gin_trgm_ops);
