import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function addNotificationPhoneColumn() {
  try {
    console.log("Starting database migration to add notification_phone column...");

    // Check if DATABASE_URL is available
    if (!process.env.DATABASE_URL) {
      console.log("No DATABASE_URL found. Using in-memory mode or local database.");
      console.log("Migration completed (no actual changes made in in-memory mode).");
      return;
    }

    // Create a connection pool
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    // Add notification_phone column to locations table
    console.log("Adding notification_phone column to locations table...");
    await db.execute(sql`
      ALTER TABLE IF EXISTS locations
      ADD COLUMN IF NOT EXISTS notification_phone TEXT;
    `);

    // Close the pool
    await pool.end();

    console.log("✅ Database migration completed successfully!");
  } catch (error) {
    console.error("❌ Error migrating database:", error);
  } finally {
    process.exit(0);
  }
}

// Run the migration
addNotificationPhoneColumn();

