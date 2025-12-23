#!/usr/bin/env node

/**
 * Script to add 'daily' value to storage_pricing_model enum
 */

import { neonConfig, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';
import ws from 'ws';

// Load environment variables
config();

// Configure WebSocket for Neon
neonConfig.webSocketConstructor = ws;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyMigration() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.log('💡 Please set your Neon database URL in the .env file');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔄 Adding "daily" to storage_pricing_model enum...');

    // Read the migration file
    const migrationPath = join(__dirname, '../migrations/0008_add_daily_to_pricing_model_enum.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Successfully added "daily" to storage_pricing_model enum!');
    
    // Verify the migration
    const enumResult = await pool.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'storage_pricing_model')
      ORDER BY enumsortorder;
    `);
    
    const enumValues = enumResult.rows.map(row => row.enumlabel);
    console.log(`✅ Current enum values: ${enumValues.join(', ')}`);
    
    if (enumValues.includes('daily')) {
      console.log('✅ Verification: "daily" is now a valid enum value');
    } else {
      console.log('⚠️  Warning: "daily" was not found in enum values');
    }
  } catch (error) {
    console.error('❌ Error applying migration:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();
