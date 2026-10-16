-- Applied to dev Supabase 2026-10-16. Additive only (widens a CHECK constraint).
-- "I was there": a chef disputing a no-show / missing check-in reports with the 'attendance' category, so the kitchen and
-- Local Cooks read "{chef} says they were there" instead of a generic "Other problem". Existing rows are unaffected.
-- Production: apply before deploying the code that sends category 'attendance' (it would otherwise be refused).
ALTER TABLE commitment_problems DROP CONSTRAINT IF EXISTS commitment_problems_category_check;
ALTER TABLE commitment_problems ADD CONSTRAINT commitment_problems_category_check
  CHECK (category IS NULL OR category IN ('safety', 'access', 'equipment', 'cleanliness', 'other', 'attendance'));
