const { Pool } = require('pg');

async function testRoleDetection() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('🧪 Testing role detection...');

    // Check users with different role configurations
    const testQueries = [
      {
        name: 'Users with NULL role (no role selected)',
        query: `SELECT id, username, role, "is_chef", "is_delivery_partner" FROM users WHERE role IS NULL LIMIT 5`
      },
      {
        name: 'Users with chef role only',
        query: `SELECT id, username, role, "is_chef", "is_delivery_partner" FROM users WHERE role = 'chef' AND "is_chef" = true AND "is_delivery_partner" = false LIMIT 5`
      },
      {
        name: 'Users with delivery_partner role only',
        query: `SELECT id, username, role, "is_chef", "is_delivery_partner" FROM users WHERE role = 'delivery_partner' AND "is_chef" = false AND "is_delivery_partner" = true LIMIT 5`
      },
      {
        name: 'Users with dual roles',
        query: `SELECT id, username, role, "is_chef", "is_delivery_partner" FROM users WHERE "is_chef" = true AND "is_delivery_partner" = true LIMIT 5`
      }
    ];

    for (const test of testQueries) {
      console.log(`\n📊 ${test.name}:`);
      const result = await pool.query(test.query);
      console.log(`   Found ${result.rows.length} users`);
      if (result.rows.length > 0) {
        console.log('   Sample:', result.rows[0]);
      }
    }

    // Test the specific user mentioned in the error
    const specificUser = await pool.query(`
      SELECT id, username, role, "is_chef", "is_delivery_partner" 
      FROM users 
      WHERE username = 'satyajitdebnath.debnath@gmail.com'
    `);

    if (specificUser.rows.length > 0) {
      console.log('\n🎯 Specific user status:');
      console.log(specificUser.rows[0]);
    }

  } catch (error) {
    console.error('❌ Error testing role detection:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the test
if (require.main === module) {
  testRoleDetection()
    .then(() => {
      console.log('\n✅ Role detection test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Role detection test failed:', error);
      process.exit(1);
    });
}

module.exports = { testRoleDetection };
