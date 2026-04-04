import 'dotenv/config';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runMigration() {
  try {
    console.log("Running database migrations...");
    
    // Add columns to applications table
    await pool.query(`
      ALTER TABLE applications 
      ADD COLUMN IF NOT EXISTS shop_name text NOT NULL DEFAULT 'Shop Not Named',
      ADD COLUMN IF NOT EXISTS shop_address text NOT NULL DEFAULT 'Address Not Provided',
      ADD COLUMN IF NOT EXISTS php_shop_created boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS verification_email_sent_at timestamp;
    `);
    console.log("✅ applications table updated.");

    // Add columns to users table (from earlier changes)
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;
    `);
    console.log("✅ users table updated.");

    console.log("Migration successful.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigration();
