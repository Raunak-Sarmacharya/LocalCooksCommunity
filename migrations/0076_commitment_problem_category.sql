-- Applied to dev Supabase 2026-10-13 (owner approved). Additive only.
-- Optional category chosen when a participant reports a problem (safety is shown first in the app).
-- The application tolerates null (all pre-existing rows) and never requires this column to be backfilled.
ALTER TABLE commitment_problems ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commitment_problems_category_check') THEN
    ALTER TABLE commitment_problems ADD CONSTRAINT commitment_problems_category_check
      CHECK (category IS NULL OR category IN ('safety', 'access', 'equipment', 'cleanliness', 'other'));
  END IF;
END $$;
