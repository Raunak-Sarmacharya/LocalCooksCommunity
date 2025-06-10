#!/usr/bin/env node

/**
 * Migration script to update any applications with 'new' status to 'inReview'
 * This ensures all existing data aligns with the updated status enum
 */

const { createConnection } = require('@vercel/postgres');

async function migrateNewToInReview() {
  console.log('🔄 Starting migration: "new" → "inReview"');
  
  let client;
  
  try {
    // Create database connection
    client = createConnection({
      connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL
    });
    
    await client.connect();
    console.log('✅ Connected to database');
    
    // Check for any applications with 'new' status
    const checkResult = await client.query(`
      SELECT id, full_name, email, status, created_at 
      FROM applications 
      WHERE status = 'new'
      ORDER BY created_at DESC
    `);
    
    console.log(`📊 Found ${checkResult.rows.length} applications with 'new' status`);
    
    if (checkResult.rows.length === 0) {
      console.log('✅ No migration needed - no applications with "new" status found');
      return;
    }
    
    // Log the applications that will be updated
    console.log('📋 Applications to be updated:');
    checkResult.rows.forEach(app => {
      console.log(`  - ID: ${app.id}, Name: ${app.full_name}, Email: ${app.email}, Date: ${app.created_at}`);
    });
    
    // Update all 'new' status to 'inReview'
    const updateResult = await client.query(`
      UPDATE applications 
      SET status = 'inReview' 
      WHERE status = 'new'
    `);
    
    console.log(`✅ Successfully updated ${updateResult.rowCount} applications from 'new' to 'inReview'`);
    
    // Verify the update
    const verifyResult = await client.query(`
      SELECT COUNT(*) as count 
      FROM applications 
      WHERE status = 'new'
    `);
    
    const remainingNewCount = parseInt(verifyResult.rows[0].count);
    
    if (remainingNewCount === 0) {
      console.log('✅ Migration completed successfully - no more "new" status applications');
    } else {
      console.log(`⚠️  Warning: ${remainingNewCount} applications still have "new" status`);
    }
    
    // Show current status distribution
    const statusDistribution = await client.query(`
      SELECT status, COUNT(*) as count 
      FROM applications 
      GROUP BY status 
      ORDER BY count DESC
    `);
    
    console.log('📊 Current application status distribution:');
    statusDistribution.rows.forEach(row => {
      console.log(`  - ${row.status}: ${row.count}`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateNewToInReview()
    .then(() => {
      console.log('🎉 Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateNewToInReview }; 