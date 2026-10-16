-- Unapplied: simpler storage listing form (owner-approved Oct 16). Additive only; the running app ignores the column until deployed.
ALTER TABLE storage_listings ADD COLUMN size_label text;
