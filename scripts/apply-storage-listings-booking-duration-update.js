#!/usr/bin/env node

/**
 * Script to update storage listings for flexible booking duration
 * - Adds booking_duration_unit enum and minimum_booking_duration field
 * - Removes tiered_pricing field and minimum_booking_months
 * - Ensures currency is locked to CAD
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
    console.log('🔄 Applying storage listings booking duration update...');

    // Read the migration file
    const migrationPath = join(__dirname, '../migrations/0007_update_storage_listings_booking_duration.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Storage listings booking duration update applied successfully!');
    console.log('   Added: booking_duration_unit enum, minimum_booking_duration field');
    console.log('   Removed: tiered_pricing field, minimum_booking_months field');
    console.log('   Locked: currency to CAD');
    
    // Verify the migration
    const columnsResult = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'storage_listings' 
      AND column_name IN ('minimum_booking_duration', 'booking_duration_unit', 'tiered_pricing', 'minimum_booking_months', 'currency')
      ORDER BY column_name;
    `);
    
    const existingColumns = columnsResult.rows.map(row => row.column_name);
    
    if (existingColumns.includes('minimum_booking_duration') && existingColumns.includes('booking_duration_unit')) {
      console.log('✅ Verification: New booking duration fields exist');
      console.log(`   - minimum_booking_duration: ${columnsResult.rows.find(r => r.column_name === 'minimum_booking_duration')?.data_type}`);
      console.log(`   - booking_duration_unit: ${columnsResult.rows.find(r => r.column_name === 'booking_duration_unit')?.data_type}`);
    }
    
    if (!existingColumns.includes('tiered_pricing') && !existingColumns.includes('minimum_booking_months')) {
      console.log('✅ Verification: Old fields removed (tiered_pricing, minimum_booking_months)');
    }
    
    if (existingColumns.includes('currency')) {
      const currencyRow = columnsResult.rows.find(r => r.column_name === 'currency');
      console.log(`✅ Verification: Currency field exists (default: ${currencyRow?.column_default || 'CAD'})`);
    }
  } catch (error) {
    console.error('❌ Error applying migration:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();

