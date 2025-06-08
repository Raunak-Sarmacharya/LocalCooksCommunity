#!/usr/bin/env node

/**
 * Check Table Structure
 * 
 * This script checks the actual column structure of existing tables
 * to understand what needs to be updated.
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

async function checkTableStructure() {
  console.log('🔍 Checking table structures...');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    return;
  }

  try {
    // Create database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    console.log('✅ Connected to database');

    // Check structure of microlearning_completions table
    console.log('\n📊 microlearning_completions table structure:');
    const mlCompletionsColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'microlearning_completions' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    mlCompletionsColumns.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
    });

    // Check structure of video_progress table
    console.log('\n📹 video_progress table structure:');
    const videoProgressColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'video_progress' 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    videoProgressColumns.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
    });

    // Check what columns are missing
    console.log('\n🔧 Required columns for our schema:');
    
    const requiredMLColumns = ['id', 'user_id', 'completed_at', 'confirmed', 'certificate_generated', 'video_progress', 'created_at', 'updated_at'];
    const existingMLColumns = mlCompletionsColumns.rows.map(col => col.column_name);
    
    console.log('microlearning_completions:');
    requiredMLColumns.forEach(col => {
      const exists = existingMLColumns.includes(col);
      console.log(`   ${exists ? '✅' : '❌'} ${col}`);
    });

    const requiredVPColumns = ['id', 'user_id', 'video_id', 'progress', 'completed', 'completed_at', 'updated_at', 'watched_percentage', 'is_rewatching'];
    const existingVPColumns = videoProgressColumns.rows.map(col => col.column_name);
    
    console.log('video_progress:');
    requiredVPColumns.forEach(col => {
      const exists = existingVPColumns.includes(col);
      console.log(`   ${exists ? '✅' : '❌'} ${col}`);
    });

    // Check foreign key constraints
    console.log('\n🔗 Foreign key constraints:');
    const constraints = await db.execute(sql`
      SELECT 
        tc.constraint_name, 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_name IN ('microlearning_completions', 'video_progress')
    `);

    constraints.rows.forEach(constraint => {
      console.log(`   ${constraint.table_name}.${constraint.column_name} -> ${constraint.foreign_table_name}.${constraint.foreign_column_name}`);
    });

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the check
checkTableStructure().catch(console.error); 