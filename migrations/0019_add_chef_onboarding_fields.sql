-- Add chef onboarding fields to users table
-- These fields track the informative onboarding for chefs (no restrictions, just guidance)

ALTER TABLE users ADD COLUMN IF NOT EXISTS chef_onboarding_completed BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chef_onboarding_paths JSONB DEFAULT '[]'::jsonb NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.chef_onboarding_completed IS 'Whether chef completed the informative onboarding flow';
COMMENT ON COLUMN users.chef_onboarding_paths IS 'Selected paths during onboarding: localcooks, kitchen, or both';
