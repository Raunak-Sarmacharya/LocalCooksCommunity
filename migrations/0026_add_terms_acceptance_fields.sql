-- Add terms acceptance columns to users table
ALTER TABLE users
ADD COLUMN terms_accepted BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN terms_accepted_at TIMESTAMP,
ADD COLUMN terms_version TEXT;
