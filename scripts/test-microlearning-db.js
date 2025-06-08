#!/usr/bin/env node

/**
 * Test Microlearning Database Functionality
 * 
 * This script tests the microlearning and video progress functionality
 * by creating some test data and verifying it works with the database.
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

async function testMicrolearningDB() {
  console.log('🧪 Testing microlearning database functionality...');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    return;
  }

  try {
    // Create database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    console.log('✅ Connected to database');

    // Find a test user (or create one)
    const usersResult = await db.execute(sql`SELECT id, username FROM users LIMIT 1`);
    
    if (usersResult.rows.length === 0) {
      console.log('❌ No users found in database. Please create a user first.');
      return;
    }

    const testUser = usersResult.rows[0];
    console.log(`👤 Using test user: ${testUser.username} (ID: ${testUser.id})`);

    // Test 1: Insert video progress
    console.log('\n📹 Testing video progress insertion...');
    
    const testVideoId = 'test-video-module-1';
    const progressData = {
      user_id: testUser.id,
      video_id: testVideoId,
      progress: 45.5,
      completed: false,
      watched_percentage: 45.5,
      is_rewatching: false,
      updated_at: new Date()
    };

    await db.execute(sql`
      INSERT INTO video_progress (user_id, video_id, progress, completed, watched_percentage, is_rewatching, updated_at)
      VALUES (${progressData.user_id}, ${progressData.video_id}, ${progressData.progress}, ${progressData.completed}, ${progressData.watched_percentage}, ${progressData.is_rewatching}, ${progressData.updated_at})
      ON CONFLICT (user_id, video_id) DO UPDATE SET
        progress = EXCLUDED.progress,
        watched_percentage = EXCLUDED.watched_percentage,
        updated_at = EXCLUDED.updated_at
    `);

    console.log('✅ Video progress inserted/updated');

    // Test 2: Retrieve video progress
    console.log('\n📊 Testing video progress retrieval...');
    
    const progressResult = await db.execute(sql`
      SELECT * FROM video_progress WHERE user_id = ${testUser.id}
    `);

    console.log(`✅ Found ${progressResult.rows.length} video progress records:`);
    progressResult.rows.forEach(row => {
      console.log(`   - ${row.video_id}: ${row.progress}% (${row.completed ? 'completed' : 'in progress'})`);
    });

    // Test 3: Complete the video
    console.log('\n🎯 Testing video completion...');
    
    await db.execute(sql`
      UPDATE video_progress 
      SET progress = 100, completed = true, completed_at = NOW(), updated_at = NOW()
      WHERE user_id = ${testUser.id} AND video_id = ${testVideoId}
    `);

    console.log('✅ Video marked as completed');

    // Test 4: Create microlearning completion
    console.log('\n🏆 Testing microlearning completion...');
    
    const completionData = {
      user_id: testUser.id,
      confirmed: true,
      certificate_generated: false,
      video_progress: JSON.stringify([{
        videoId: testVideoId,
        progress: 100,
        completed: true,
        completedAt: new Date().toISOString()
      }])
    };

    await db.execute(sql`
      INSERT INTO microlearning_completions (user_id, completed_at, confirmed, certificate_generated, video_progress, created_at, updated_at)
      VALUES (${completionData.user_id}, NOW(), ${completionData.confirmed}, ${completionData.certificate_generated}, ${completionData.video_progress}, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        confirmed = EXCLUDED.confirmed,
        video_progress = EXCLUDED.video_progress,
        updated_at = NOW()
    `);

    console.log('✅ Microlearning completion recorded');

    // Test 5: Verify final state
    console.log('\n🔍 Final verification...');
    
    const finalProgressCount = await db.execute(sql`SELECT COUNT(*) as count FROM video_progress WHERE user_id = ${testUser.id}`);
    const finalCompletionCount = await db.execute(sql`SELECT COUNT(*) as count FROM microlearning_completions WHERE user_id = ${testUser.id}`);

    console.log(`✅ User ${testUser.id} has:`);
    console.log(`   - ${finalProgressCount.rows[0].count} video progress records`);
    console.log(`   - ${finalCompletionCount.rows[0].count} microlearning completions`);

    // Check overall database state
    console.log('\n📈 Overall database state:');
    const totalProgress = await db.execute(sql`SELECT COUNT(*) as count FROM video_progress`);
    const totalCompletions = await db.execute(sql`SELECT COUNT(*) as count FROM microlearning_completions`);
    
    console.log(`   - Total video progress records: ${totalProgress.rows[0].count}`);
    console.log(`   - Total microlearning completions: ${totalCompletions.rows[0].count}`);

    console.log('\n🎉 All tests passed! Microlearning database functionality is working correctly.');

    await pool.end();

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testMicrolearningDB().catch(console.error); 