#!/usr/bin/env node

/**
 * Script to apply storage listings migration
 * This creates the storage_listings table with all required fields
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
    console.log('🔄 Applying storage listings migration...');

    // Read the migration file
    const migrationPath = join(__dirname, '../migrations/0006_add_storage_listings_table.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Storage listings migration applied successfully!');
    console.log('   Created table: storage_listings');
    console.log('   Created enums: storage_type, storage_pricing_model, listing_status');
    
    // Verify the migration
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'storage_listings';
    `);
    
    if (result.rows.length === 1) {
      console.log('✅ Verification: storage_listings table exists');
      
      // Check column count
      const columnsResult = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'storage_listings'
        ORDER BY ordinal_position;
      `);
      
      console.log(`✅ Verification: Table has ${columnsResult.rows.length} columns`);
      console.log('   Key columns:');
      columnsResult.rows.slice(0, 10).forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type}`);
      });
      if (columnsResult.rows.length > 10) {
        console.log(`   ... and ${columnsResult.rows.length - 10} more columns`);
      }
    } else {
      console.warn('⚠️  Warning: storage_listings table not found');
    }
  } catch (error) {
    console.error('❌ Error applying migration:', error);
    
    // Check if table already exists (idempotent)
    if (error.message && (error.message.includes('already exists') || error.message.includes('duplicate'))) {
      console.log('ℹ️  Table or enums may already exist - checking current state...');
      
      try {
        const checkResult = await pool.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'storage_listings';
        `);
        
        if (checkResult.rows.length === 1) {
          console.log('✅ storage_listings table already exists - migration already applied');
        } else {
          console.log('⚠️  Table does not exist. Please check manually.');
        }
      } catch (checkError) {
        console.error('Error checking table:', checkError);
      }
    } else {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

applyMigration();

