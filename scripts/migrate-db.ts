import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function migrateDatabase() {
  try {
    console.log("Starting database migration...");
    
    // Create user role enum type
    console.log("Creating user_role enum type...");
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          CREATE TYPE user_role AS ENUM ('admin', 'applicant');
        END IF;
      END$$;
    `);
    
    // Add role column to users table using the enum type
    console.log("Adding role column to users table...");
    await db.execute(sql`
      ALTER TABLE IF EXISTS users 
      DROP COLUMN IF EXISTS role;
    `);
    
    await db.execute(sql`
      ALTER TABLE IF EXISTS users 
      ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'applicant';
    `);
    
    // Add userId column to applications table
    console.log("Adding userId column to applications table...");
    await db.execute(sql`
      ALTER TABLE IF EXISTS applications 
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
    `);
    
    console.log("Database migration completed successfully!");
  } catch (error) {
    console.error("Error migrating database:", error);
  } finally {
    process.exit(0);
  }
}

// Run the migration
migrateDatabase();