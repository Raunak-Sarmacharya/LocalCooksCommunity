ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS requested_reschedule_at timestamp;
ALTER TABLE kitchen_viewings ADD COLUMN IF NOT EXISTS reschedule_requested_at timestamp;
