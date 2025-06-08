#!/usr/bin/env node

/**
 * Deploy Microlearning Tables to Neon Database
 * 
 * This script creates the missing microlearning_completions and video_progress tables
 * in your Neon database. Run this after setting your real DATABASE_URL.
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

async function deployMicrolearningTables() {
  console.log('🚀 Deploying microlearning tables to Neon database...');

  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.log('💡 Please set your Neon database URL in the .env file:');
    console.log('   DATABASE_URL=postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require');
    process.exit(1);
  }

  if (process.env.DATABASE_URL.includes('username:password@localhost')) {
    console.error('❌ DATABASE_URL is still set to the placeholder value');
    console.log('💡 Please update your .env file with the real Neon database URL');
    process.exit(1);
  }

  try {
    // Create database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    console.log('📊 Connected to Neon database');

    // Check if tables already exist
    const checkTablesQuery = sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('microlearning_completions', 'video_progress')
    `;

    const existingTables = await db.execute(checkTablesQuery);
    
    if (existingTables.rows.length > 0) {
      console.log('✅ Microlearning tables already exist:');
      existingTables.rows.forEach(row => console.log(`   - ${row.table_name}`));
      
      // Check row counts
      try {
        const progressCount = await db.execute(sql`SELECT COUNT(*) as count FROM video_progress`);
        const completionCount = await db.execute(sql`SELECT COUNT(*) as count FROM microlearning_completions`);
        
        console.log('📈 Current data:');
        console.log(`   - video_progress: ${progressCount.rows[0].count} rows`);
        console.log(`   - microlearning_completions: ${completionCount.rows[0].count} rows`);
      } catch (error) {
        console.log('⚠️ Could not check table contents (tables might be empty)');
      }
      
      return;
    }

    console.log('🔨 Creating microlearning_completions table...');
    await db.execute(sql`
      CREATE TABLE "microlearning_completions" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "completed_at" timestamp DEFAULT now() NOT NULL,
        "confirmed" boolean DEFAULT false NOT NULL,
        "certificate_generated" boolean DEFAULT false NOT NULL,
        "video_progress" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    console.log('🔨 Creating video_progress table...');
    await db.execute(sql`
      CREATE TABLE "video_progress" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "video_id" text NOT NULL,
        "progress" numeric(5,2) DEFAULT '0' NOT NULL,
        "completed" boolean DEFAULT false NOT NULL,
        "completed_at" timestamp,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        "watched_percentage" numeric(5,2) DEFAULT '0' NOT NULL,
        "is_rewatching" boolean DEFAULT false NOT NULL
      )
    `);

    console.log('🔗 Adding foreign key constraints...');
    await db.execute(sql`
      ALTER TABLE "microlearning_completions" 
      ADD CONSTRAINT "microlearning_completions_user_id_users_id_fk" 
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") 
      ON DELETE no action ON UPDATE no action
    `);

    await db.execute(sql`
      ALTER TABLE "video_progress" 
      ADD CONSTRAINT "video_progress_user_id_users_id_fk" 
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") 
      ON DELETE no action ON UPDATE no action
    `);

    console.log('📈 Adding performance indexes...');
    await db.execute(sql`CREATE INDEX "video_progress_user_id_idx" ON "video_progress" ("user_id")`);
    await db.execute(sql`CREATE INDEX "video_progress_user_video_idx" ON "video_progress" ("user_id", "video_id")`);
    await db.execute(sql`CREATE INDEX "microlearning_completions_user_id_idx" ON "microlearning_completions" ("user_id")`);

    console.log('✅ Successfully created microlearning tables!');
    console.log('🎉 Your database is now ready for microlearning and video progress tracking');

    await pool.end();

  } catch (error) {
    console.error('❌ Error deploying tables:', error.message);
    
    if (error.message.includes('connect ECONNREFUSED')) {
      console.log('💡 Connection refused - please check your DATABASE_URL');
    } else if (error.message.includes('relation') && error.message.includes('already exists')) {
      console.log('✅ Tables already exist - no action needed');
    } else {
      console.error('Full error:', error);
    }
    
    process.exit(1);
  }
}

// Run the deployment
deployMicrolearningTables().catch(console.error); 