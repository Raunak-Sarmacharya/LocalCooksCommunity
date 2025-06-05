#!/usr/bin/env node

/**
 * Session Cleanup Script
 * 
 * This script cleans up expired sessions from the database.
 * Can be run manually or scheduled via cron.
 * 
 * Usage:
 *   node scripts/cleanup-sessions.js
 *   node scripts/cleanup-sessions.js --days 30
 *   node scripts/cleanup-sessions.js --dry-run
 */

import { Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';

// Load environment variables
config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1
});

async function getSessionStats() {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN expire > NOW() THEN 1 END) as active_sessions,
        COUNT(CASE WHEN expire <= NOW() THEN 1 END) as expired_sessions,
        MIN(expire) as oldest_session,
        MAX(expire) as newest_session,
        pg_size_pretty(pg_total_relation_size('session')) as table_size
      FROM session;
    `);

    return stats.rows[0];
  } catch (error) {
    console.error('Error getting session stats:', error);
    return null;
  }
}

async function cleanupExpiredSessions(dryRun = false) {
  try {
    const query = dryRun 
      ? `SELECT COUNT(*) as would_delete FROM session WHERE expire < NOW()`
      : `DELETE FROM session WHERE expire < NOW() RETURNING sid`;
    
    const result = await pool.query(query);
    
    if (dryRun) {
      return { wouldDelete: result.rows[0].would_delete };
    } else {
      return { deleted: result.rowCount };
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
    return { error: error.message };
  }
}

async function cleanupOldSessions(days, dryRun = false) {
  try {
    const query = dryRun 
      ? `SELECT COUNT(*) as would_delete FROM session WHERE expire < NOW() - INTERVAL '${days} days'`
      : `DELETE FROM session WHERE expire < NOW() - INTERVAL '${days} days' RETURNING sid`;
    
    const result = await pool.query(query);
    
    if (dryRun) {
      return { wouldDelete: result.rows[0].would_delete };
    } else {
      return { deleted: result.rowCount };
    }
  } catch (error) {
    console.error('Error during old session cleanup:', error);
    return { error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const daysIndex = args.indexOf('--days');
  const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : null;
  
  console.log('🧹 Session Cleanup Script');
  console.log('========================');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE CLEANUP'}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  try {
    // Get initial stats
    console.log('📊 Current Session Statistics:');
    const initialStats = await getSessionStats();
    if (initialStats) {
      console.log(`  Total Sessions: ${initialStats.total_sessions}`);
      console.log(`  Active Sessions: ${initialStats.active_sessions}`);
      console.log(`  Expired Sessions: ${initialStats.expired_sessions}`);
      console.log(`  Table Size: ${initialStats.table_size}`);
      console.log(`  Oldest Session: ${initialStats.oldest_session}`);
      console.log(`  Newest Session: ${initialStats.newest_session}`);
      console.log('');
    }

    // Perform cleanup
    if (days) {
      console.log(`🗑️  Cleaning up sessions older than ${days} days...`);
      const result = await cleanupOldSessions(days, dryRun);
      
      if (result.error) {
        console.error(`❌ Error: ${result.error}`);
      } else if (dryRun) {
        console.log(`🔍 Would delete ${result.wouldDelete} sessions older than ${days} days`);
      } else {
        console.log(`✅ Deleted ${result.deleted} sessions older than ${days} days`);
      }
    } else {
      console.log('🗑️  Cleaning up expired sessions...');
      const result = await cleanupExpiredSessions(dryRun);
      
      if (result.error) {
        console.error(`❌ Error: ${result.error}`);
      } else if (dryRun) {
        console.log(`🔍 Would delete ${result.wouldDelete} expired sessions`);
      } else {
        console.log(`✅ Deleted ${result.deleted} expired sessions`);
      }
    }

    // Get final stats if not dry run
    if (!dryRun) {
      console.log('');
      console.log('📊 Final Session Statistics:');
      const finalStats = await getSessionStats();
      if (finalStats) {
        console.log(`  Total Sessions: ${finalStats.total_sessions}`);
        console.log(`  Active Sessions: ${finalStats.active_sessions}`);
        console.log(`  Expired Sessions: ${finalStats.expired_sessions}`);
        console.log(`  Table Size: ${finalStats.table_size}`);
        
        const sessionsSaved = parseInt(initialStats.total_sessions) - parseInt(finalStats.total_sessions);
        console.log(`  Sessions Removed: ${sessionsSaved}`);
      }
    }

    console.log('');
    console.log('✅ Session cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
main().catch(console.error); 