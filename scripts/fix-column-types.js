#!/usr/bin/env node

/**
 * Fix Column Types for Microlearning Tables
 * 
 * This script fixes column data types and adds missing columns
 * to match our application requirements exactly.
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

async function fixColumnTypes() {
  console.log('🔧 Fixing column types for microlearning tables...');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    return;
  }

  try {
    // Create database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    console.log('✅ Connected to database');

    // Check if certificate_generated column exists
    console.log('\n📊 Checking microlearning_completions table...');
    const mlColumns = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'microlearning_completions' AND table_schema = 'public'
    `);
    const existingMLColumns = mlColumns.rows.map(row => row.column_name);
    
    if (!existingMLColumns.includes('certificate_generated')) {
      console.log('   Adding certificate_generated column...');
      await db.execute(sql`
        ALTER TABLE microlearning_completions 
        ADD COLUMN certificate_generated boolean NOT NULL DEFAULT false
      `);
      console.log('   ✅ certificate_generated column added');
    } else {
      console.log('   ✅ certificate_generated column already exists');
    }

    // Fix progress column type in video_progress
    console.log('\n📹 Fixing video_progress table...');
    
    const vpColumns = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'video_progress' AND table_schema = 'public'
    `);
    
    const progressColumn = vpColumns.rows.find(col => col.column_name === 'progress');
    if (progressColumn && progressColumn.data_type === 'integer') {
      console.log('   Converting progress column from integer to numeric...');
      await db.execute(sql`
        ALTER TABLE video_progress 
        ALTER COLUMN progress TYPE numeric(5,2) USING progress::numeric(5,2)
      `);
      console.log('   ✅ progress column converted to numeric(5,2)');
    } else if (progressColumn && progressColumn.data_type === 'numeric') {
      console.log('   ✅ progress column is already numeric');
    } else {
      console.log('   ⚠️ progress column type:', progressColumn?.data_type || 'not found');
    }

    // Verify the changes
    console.log('\n🔍 Verifying final schema...');
    
    const finalMLColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'microlearning_completions' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    console.log('microlearning_completions:');
    finalMLColumns.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    const finalVPColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'video_progress' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    console.log('video_progress:');
    finalVPColumns.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    console.log('\n🎉 Column type fixes completed successfully!');

    await pool.end();

  } catch (error) {
    console.error('❌ Column type fix failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the fix
fixColumnTypes().catch(console.error); 