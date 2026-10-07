ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS reschedule_proposed_slots jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS reschedule_proposed_at timestamp;
