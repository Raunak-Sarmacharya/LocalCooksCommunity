const { Pool } = require('pg');

async function testRoleUpdate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('🧪 Testing role update functionality...');

    // Check current user state
    const currentUser = await pool.query(`
      SELECT id, username, role, "is_chef", "is_delivery_partner" 
      FROM users 
      WHERE username = 'satyajitdebnath.debnath@gmail.com'
    `);

    if (currentUser.rows.length === 0) {
      console.log('❌ User not found');
      return;
    }

    console.log('📊 Current user state:', currentUser.rows[0]);

    // Test updating roles
    const testRoles = {
      isChef: true,
      isDeliveryPartner: false
    };

    console.log('🔄 Testing role update with:', testRoles);

    // Simulate the role update logic
    let mainRole = 'chef'; // default
    if (testRoles.isDeliveryPartner && !testRoles.isChef) {
      mainRole = 'delivery_partner';
    } else if (testRoles.isChef && testRoles.isDeliveryPartner) {
      mainRole = 'chef'; // For dual roles, default to chef
    } else if (testRoles.isChef) {
      mainRole = 'chef';
    }

    console.log('🎯 Calculated main role:', mainRole);

    // Update the user roles
    const updateResult = await pool.query(`
      UPDATE users 
      SET "is_chef" = $1, "is_delivery_partner" = $2, role = $3
      WHERE username = 'satyajitdebnath.debnath@gmail.com'
      RETURNING id, username, role, "is_chef", "is_delivery_partner"
    `, [testRoles.isChef, testRoles.isDeliveryPartner, mainRole]);

    console.log('✅ Role update result:', updateResult.rows[0]);

    // Verify the update
    const verifyUser = await pool.query(`
      SELECT id, username, role, "is_chef", "is_delivery_partner" 
      FROM users 
      WHERE username = 'satyajitdebnath.debnath@gmail.com'
    `);

    console.log('📊 User state after update:', verifyUser.rows[0]);

    // Test dual role scenario
    console.log('\n🔄 Testing dual role scenario...');
    const dualRoles = {
      isChef: true,
      isDeliveryPartner: true
    };

    let dualMainRole = 'chef'; // For dual roles, default to chef
    if (dualRoles.isDeliveryPartner && !dualRoles.isChef) {
      dualMainRole = 'delivery_partner';
    } else if (dualRoles.isChef && dualRoles.isDeliveryPartner) {
      dualMainRole = 'chef'; // For dual roles, default to chef
    } else if (dualRoles.isChef) {
      dualMainRole = 'chef';
    }

    console.log('🎯 Calculated dual main role:', dualMainRole);

    const dualUpdateResult = await pool.query(`
      UPDATE users 
      SET "is_chef" = $1, "is_delivery_partner" = $2, role = $3
      WHERE username = 'satyajitdebnath.debnath@gmail.com'
      RETURNING id, username, role, "is_chef", "is_delivery_partner"
    `, [dualRoles.isChef, dualRoles.isDeliveryPartner, dualMainRole]);

    console.log('✅ Dual role update result:', dualUpdateResult.rows[0]);

    // Reset to original state (no roles)
    console.log('\n🔄 Resetting to original state...');
    const resetResult = await pool.query(`
      UPDATE users 
      SET "is_chef" = false, "is_delivery_partner" = false, role = NULL
      WHERE username = 'satyajitdebnath.debnath@gmail.com'
      RETURNING id, username, role, "is_chef", "is_delivery_partner"
    `);

    console.log('✅ Reset result:', resetResult.rows[0]);

  } catch (error) {
    console.error('❌ Error testing role update:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the test
if (require.main === module) {
  testRoleUpdate()
    .then(() => {
      console.log('\n✅ Role update test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Role update test failed:', error);
      process.exit(1);
    });
}

module.exports = { testRoleUpdate };
