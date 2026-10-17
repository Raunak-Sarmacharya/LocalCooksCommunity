-- Applied to dev Oct 17 (prod pending owner go-ahead): simpler storage listing form (owner-approved Oct 16). Additive only.
ALTER TABLE storage_listings ADD COLUMN size_label text;
