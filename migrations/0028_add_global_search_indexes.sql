-- Portable across Supabase Postgres and Neon Postgres.
-- Full-text search itself uses core PostgreSQL; pg_trgm accelerates substring matches.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Safe to rerun while this migration is being promoted between environments.
DROP INDEX IF EXISTS locations_global_search_trgm_idx;
DROP INDEX IF EXISTS kitchens_global_search_trgm_idx;
DROP INDEX IF EXISTS storage_listings_global_search_trgm_idx;
DROP INDEX IF EXISTS equipment_listings_global_search_trgm_idx;

CREATE INDEX IF NOT EXISTS locations_global_search_trgm_idx
ON locations USING gin ((lower(coalesce(name, '') || ' ' || coalesce(address, '') || ' ' || coalesce(description, '') || ' ' ||
  coalesce(cancellation_policy_message, '') || ' ' || coalesce(overstay_policy_text, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS locations_global_search_fts_idx
ON locations USING gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(address, '') || ' ' || coalesce(description, '') || ' ' ||
  coalesce(cancellation_policy_message, '') || ' ' || coalesce(overstay_policy_text, '')));

CREATE INDEX IF NOT EXISTS kitchens_global_search_trgm_idx
ON kitchens USING gin ((lower(coalesce(name, '') || ' ' || coalesce(description, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS kitchens_global_search_fts_idx
ON kitchens USING gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '')));

CREATE INDEX IF NOT EXISTS storage_listings_global_search_trgm_idx
ON storage_listings USING gin ((lower(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(temperature_range, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS storage_listings_global_search_fts_idx
ON storage_listings USING gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(temperature_range, '')));

CREATE INDEX IF NOT EXISTS equipment_listings_global_search_trgm_idx
ON equipment_listings USING gin ((lower(coalesce(brand, '') || ' ' || coalesce(equipment_type, '') || ' ' || coalesce(description, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS equipment_listings_global_search_fts_idx
ON equipment_listings USING gin (to_tsvector('simple', coalesce(brand, '') || ' ' || coalesce(equipment_type, '') || ' ' || coalesce(description, '')));
