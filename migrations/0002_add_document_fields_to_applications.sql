-- Add document verification fields to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS food_safety_license_url TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS food_establishment_cert_url TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS food_safety_license_status document_verification_status DEFAULT 'pending';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS food_establishment_cert_status document_verification_status DEFAULT 'pending';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS documents_admin_feedback TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS documents_reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS documents_reviewed_at TIMESTAMP; 