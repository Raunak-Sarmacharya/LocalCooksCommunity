-- This ensures each application has its own document verification record

-- First, drop the existing foreign key constraint
ALTER TABLE document_verifications DROP CONSTRAINT IF EXISTS document_verification_user_id_users_id_fk;

-- Add application_id column
ALTER TABLE s ADD COLUMN IF NOT EXISTS application_id INTEGER;

-- Add foreign key constraint for application_id
ALTER TABLE document_verifications ADD CONSTRAINT document_verification_application_id_applications_id_fk 
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;

-- Migrate existing data (if any) from user_id to application_id
-- This finds the most recent application for each user and links it to their document verification
UPDATE document_verifications 
SET application_id = (
    SELECT a.id 
    FROM applications a 
    WHERE a.user_id = document_verifications.user_id 
    ORDER BY a.created_at DESC 
    LIMIT 1
)
WHERE application_id IS NULL AND user_id IS NOT NULL;

-- Remove user_id column as it's no longer needed

-- Note: Keeping user_id for now to avoid data loss, but it should be removed after verification 