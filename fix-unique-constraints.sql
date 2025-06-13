-- Fix Missing Unique Constraints for Local Cooks Community
-- Run this in your Neon database console to fix the ON CONFLICT error

-- Add unique constraints required by ON CONFLICT clauses
-- These allow only one password reset token per user and one email verification token per email

-- For password_reset_tokens table - allow only one reset token per user
DO $$
BEGIN
    -- First, clean up any duplicate user_id entries by keeping only the most recent
    DELETE FROM password_reset_tokens p1 
    USING password_reset_tokens p2 
    WHERE p1.id < p2.id AND p1.user_id = p2.user_id;
    
    -- Add unique constraint on user_id
    ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_unique UNIQUE (user_id);
    
    RAISE NOTICE 'Added unique constraint on password_reset_tokens.user_id';
EXCEPTION
    WHEN duplicate_table THEN
        RAISE NOTICE 'Unique constraint on password_reset_tokens.user_id already exists';
    WHEN others THEN
        RAISE NOTICE 'Error adding constraint on password_reset_tokens: %', SQLERRM;
END $$;

-- For email_verification_tokens table - allow only one verification token per email
DO $$
BEGIN
    -- First, clean up any duplicate email entries by keeping only the most recent
    DELETE FROM email_verification_tokens e1 
    USING email_verification_tokens e2 
    WHERE e1.id < e2.id AND e1.email = e2.email;
    
    -- Add unique constraint on email
    ALTER TABLE email_verification_tokens ADD CONSTRAINT email_verification_tokens_email_unique UNIQUE (email);
    
    RAISE NOTICE 'Added unique constraint on email_verification_tokens.email';
EXCEPTION
    WHEN duplicate_table THEN
        RAISE NOTICE 'Unique constraint on email_verification_tokens.email already exists';
    WHEN others THEN
        RAISE NOTICE 'Error adding constraint on email_verification_tokens: %', SQLERRM;
END $$;

-- Verify the constraints were added
SELECT 
    conname as constraint_name,
    conrelid::regclass as table_name,
    contype as constraint_type
FROM pg_constraint 
WHERE conname IN ('password_reset_tokens_user_id_unique', 'email_verification_tokens_email_unique');

SELECT 'Unique constraints fix completed successfully!' as status; 