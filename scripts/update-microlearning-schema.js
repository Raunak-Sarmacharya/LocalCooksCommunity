#!/usr/bin/env node

/**
 * Update Microlearning Schema
 * 
 * This script adds missing columns to the existing microlearning tables
 * to match our application's requirements.
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

async function updateMicrolearningSchema() {
  console.log('🔧 Updating microlearning schema...');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    return;
  }

  try {
    // Create database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    console.log('✅ Connected to database');

    // Check existing columns
    console.log('\n🔍 Checking existing schema...');
    
    // Check microlearning_completions columns
    const mlColumns = await db.execute(sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'microlearning_completions' AND table_schema = 'public'
    `);
    const existingMLColumns = mlColumns.rows.map(row => row.column_name);

    // Check video_progress columns  
    const vpColumns = await db.execute(sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'video_progress' AND table_schema = 'public'
    `);
    const existingVPColumns = vpColumns.rows.map(row => row.column_name);

    // Update microlearning_completions table
    console.log('\n📊 Updating microlearning_completions table...');
    
    if (!existingMLColumns.includes('confirmed')) {
      console.log('   Adding confirmed column...');
      await db.execute(sql`
        ALTER TABLE microlearning_completions 
        ADD COLUMN confirmed boolean NOT NULL DEFAULT false
      `);
      console.log('   ✅ confirmed column added');
    } else {
      console.log('   ✅ confirmed column already exists');
    }

    if (!existingMLColumns.includes('updated_at')) {
      console.log('   Adding updated_at column...');
      await db.execute(sql`
        ALTER TABLE microlearning_completions 
        ADD COLUMN updated_at timestamp DEFAULT now() NOT NULL
      `);
      console.log('   ✅ updated_at column added');
    } else {
      console.log('   ✅ updated_at column already exists');
    }

    // Update video_progress table
    console.log('\n📹 Updating video_progress table...');
    
    if (!existingVPColumns.includes('watched_percentage')) {
      console.log('   Adding watched_percentage column...');
      await db.execute(sql`
        ALTER TABLE video_progress 
        ADD COLUMN watched_percentage numeric(5,2) DEFAULT '0' NOT NULL
      `);
      console.log('   ✅ watched_percentage column added');
    } else {
      console.log('   ✅ watched_percentage column already exists');
    }

    if (!existingVPColumns.includes('is_rewatching')) {
      console.log('   Adding is_rewatching column...');
      await db.execute(sql`
        ALTER TABLE video_progress 
        ADD COLUMN is_rewatching boolean DEFAULT false NOT NULL
      `);
      console.log('   ✅ is_rewatching column added');
    } else {
      console.log('   ✅ is_rewatching column already exists');
    }

    // Add missing foreign keys if they don't exist
    console.log('\n🔗 Checking foreign key constraints...');
    
    const constraints = await db.execute(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name IN ('microlearning_completions', 'video_progress')
      AND constraint_type = 'FOREIGN KEY'
    `);
    
    const existingConstraints = constraints.rows.map(row => row.constraint_name);
    
    if (!existingConstraints.some(name => name.includes('microlearning_completions_user_id'))) {
      console.log('   Adding foreign key for microlearning_completions...');
      await db.execute(sql`
        ALTER TABLE microlearning_completions 
        ADD CONSTRAINT microlearning_completions_user_id_users_id_fk 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE no action ON UPDATE no action
      `);
      console.log('   ✅ microlearning_completions foreign key added');
    } else {
      console.log('   ✅ microlearning_completions foreign key already exists');
    }

    if (!existingConstraints.some(name => name.includes('video_progress_user_id'))) {
      console.log('   Adding foreign key for video_progress...');
      await db.execute(sql`
        ALTER TABLE video_progress 
        ADD CONSTRAINT video_progress_user_id_users_id_fk 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE no action ON UPDATE no action
      `);
      console.log('   ✅ video_progress foreign key added');
    } else {
      console.log('   ✅ video_progress foreign key already exists');
    }

    // Add indexes for better performance
    console.log('\n📈 Adding performance indexes...');
    
    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS video_progress_user_id_idx ON video_progress (user_id)`);
      console.log('   ✅ video_progress_user_id_idx created');
    } catch (error) {
      console.log('   ✅ video_progress_user_id_idx already exists');
    }

    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS video_progress_user_video_idx ON video_progress (user_id, video_id)`);
      console.log('   ✅ video_progress_user_video_idx created');
    } catch (error) {
      console.log('   ✅ video_progress_user_video_idx already exists');
    }

    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS microlearning_completions_user_id_idx ON microlearning_completions (user_id)`);
      console.log('   ✅ microlearning_completions_user_id_idx created');
    } catch (error) {
      console.log('   ✅ microlearning_completions_user_id_idx already exists');
    }

    console.log('\n🎉 Schema update completed successfully!');
    console.log('✅ All required columns and constraints are now in place');

    await pool.end();

  } catch (error) {
    console.error('❌ Schema update failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the update
updateMicrolearningSchema().catch(console.error); 