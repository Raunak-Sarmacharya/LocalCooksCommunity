-- Production Database Setup for Local Cooks Community
-- Run this in your Neon database console

-- Add email_verified column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- Create password_reset_tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create email_verification_tokens table  
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add missing unique constraints required by ON CONFLICT clauses
ALTER TABLE password_reset_tokens ADD CONSTRAINT IF NOT EXISTS password_reset_tokens_user_id_unique UNIQUE (user_id);
ALTER TABLE email_verification_tokens ADD CONSTRAINT IF NOT EXISTS email_verification_tokens_email_unique UNIQUE (email);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_email ON email_verification_tokens(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);

-- Clean up any expired tokens (optional)
DELETE FROM password_reset_tokens WHERE expires_at < NOW();
DELETE FROM email_verification_tokens WHERE expires_at < NOW();

-- Verify tables were created
\dt password_reset_tokens
\dt email_verification_tokens

-- Show table structures
\d password_reset_tokens
\d email_verification_tokens

SELECT 'Production database setup completed successfully!' as status; 