#!/usr/bin/env node

/**
 * Script to apply kitchen pricing migration
 * This adds pricing fields to the kitchens table
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
    console.log('🔄 Applying kitchen pricing migration...');

    // Read the migration file
    const migrationPath = join(__dirname, '../migrations/0005_add_kitchen_pricing_fields.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Kitchen pricing migration applied successfully!');
    console.log('   Added fields: hourly_rate, currency, minimum_booking_hours, pricing_model');
    
    // Verify the migration
    const result = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'kitchens' 
      AND column_name IN ('hourly_rate', 'currency', 'minimum_booking_hours', 'pricing_model')
      ORDER BY column_name;
    `);
    
    if (result.rows.length === 4) {
      console.log('✅ Verification: All pricing columns exist');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type} (default: ${row.column_default || 'none'})`);
      });
    } else {
      console.warn('⚠️  Warning: Expected 4 columns but found', result.rows.length);
    }
  } catch (error) {
    console.error('❌ Error applying migration:', error);
    
    // Check if columns already exist (idempotent)
    if (error.message && (error.message.includes('already exists') || error.message.includes('duplicate'))) {
      console.log('ℹ️  Columns may already exist - checking current state...');
      
      try {
        const checkResult = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'kitchens' 
          AND column_name IN ('hourly_rate', 'currency', 'minimum_booking_hours', 'pricing_model');
        `);
        
        if (checkResult.rows.length === 4) {
          console.log('✅ All pricing columns already exist - migration already applied');
        } else {
          console.log(`⚠️  Only ${checkResult.rows.length} of 4 columns exist. Please check manually.`);
        }
      } catch (checkError) {
        console.error('Error checking columns:', checkError);
      }
    } else {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

applyMigration();


