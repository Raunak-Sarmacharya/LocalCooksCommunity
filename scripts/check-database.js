#!/usr/bin/env node

/**
 * Database Connection and Table Verification Script
 * 
 * This script checks your Neon database connection and verifies that all
 * required tables exist, including the microlearning tables.
 */

import { neonConfig, Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

// Load environment variables from .env file
config();

// Configure WebSocket for Neon
neonConfig.webSocketConstructor = ws;

async function checkDatabase() {
  console.log('🔍 Checking database connection and tables...');

  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.log('💡 Please set your Neon database URL in the .env file');
    return false;
  }

  if (process.env.DATABASE_URL.includes('username:password@localhost')) {
    console.error('❌ DATABASE_URL is set to placeholder value');
    console.log('💡 Please update your .env file with the real Neon database URL');
    return false;
  }

  try {
    // Create database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    console.log('✅ Connected to Neon database successfully');

    // Check all required tables
    const requiredTables = ['users', 'applications', 'microlearning_completions', 'video_progress'];
    
    const tablesQuery = sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `;

    const result = await db.execute(tablesQuery);
    const existingTables = result.rows.map(row => row.table_name);

    console.log('\n📊 Database Tables Status:');
    
    let allTablesExist = true;
    for (const table of requiredTables) {
      if (existingTables.includes(table)) {
        console.log(`✅ ${table} - EXISTS`);
        
        // Check row count for each table
        try {
          const countResult = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM "${table}"`));
          const count = countResult.rows[0].count;
          console.log(`   └── ${count} rows`);
        } catch (error) {
          console.log(`   └── Could not count rows: ${error.message}`);
        }
      } else {
        console.log(`❌ ${table} - MISSING`);
        allTablesExist = false;
      }
    }

    // List any extra tables
    const extraTables = existingTables.filter(table => !requiredTables.includes(table));
    if (extraTables.length > 0) {
      console.log('\n📋 Additional tables found:');
      extraTables.forEach(table => console.log(`   - ${table}`));
    }

    console.log('\n🏁 Summary:');
    if (allTablesExist) {
      console.log('✅ All required tables exist');
      console.log('🎉 Your database is properly configured for microlearning!');
    } else {
      console.log('❌ Some required tables are missing');
      console.log('💡 Run: npm run deploy-microlearning-tables');
    }

    await pool.end();
    return allTablesExist;

  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    
    if (error.message.includes('connect ECONNREFUSED')) {
      console.log('💡 Connection refused - please check your DATABASE_URL');
    } else if (error.message.includes('authentication failed')) {
      console.log('💡 Authentication failed - please check your credentials');
    } else if (error.message.includes('does not exist')) {
      console.log('💡 Database does not exist - please check your database name');
    }
    
    return false;
  }
}

// Run the check
checkDatabase().catch(console.error); 