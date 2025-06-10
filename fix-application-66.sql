-- Fix for application ID 66: Update status from 'new' to 'inReview'
-- Run this in your production database

UPDATE applications 
SET status = 'inReview' 
WHERE id = 66 AND status = 'new';

-- Verify the update
SELECT id, full_name, email, status, created_at 
FROM applications 
WHERE id = 66; 