// Reset admin account script
const { Pool } = require('pg');
const crypto = require('crypto');

// Create a connection pool
const pool = process.env.DATABASE_URL 
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

// Fallback in-memory storage if no database
const users = new Map();

// Hash password function
async function hashPassword(password) {
  // Generate a random salt
  const salt = crypto.randomBytes(16).toString('hex');
  
  // Hash the password with the salt
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      // Store both the hash and the salt, separated by a dot
      resolve(derivedKey.toString('hex') + '.' + salt);
    });
  });
}

async function resetAdmin() {
  console.log('Starting admin account reset...');
  
  try {
    // Set admin credentials
    const adminUsername = 'admin';
    const adminPassword = 'admin123'; // Simple password for testing
    
    // Hash the password
    const hashedPassword = await hashPassword(adminPassword);
    console.log('Password hashed successfully');
    
    if (pool) {
      console.log('Using database storage');
      
      // Check if users table exists
      const tableCheck = await pool.query(`
        SELECT to_regclass('public.users') as table_exists;
      `);
      
      if (!tableCheck.rows[0].table_exists) {
        console.log('Creating users table...');
        
        // Create role enum if it doesn't exist
        await pool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
              CREATE TYPE user_role AS ENUM ('admin', 'applicant');
            END IF;
          END$$;
        `);
        
        // Create users table
        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role user_role NOT NULL DEFAULT 'admin',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        
        console.log('Users table created');
      }
      
      // Check if admin user exists
      const adminCheck = await pool.query(`
        SELECT * FROM users WHERE username = $1
      `, [adminUsername]);
      
      if (adminCheck.rows.length > 0) {
        // Update existing admin
        console.log('Admin user exists, updating password...');
        await pool.query(`
          UPDATE users 
          SET password = $1 
          WHERE username = $2
        `, [hashedPassword, adminUsername]);
        
        console.log('Admin password updated successfully');
      } else {
        // Create new admin
        console.log('Admin user does not exist, creating...');
        await pool.query(`
          INSERT INTO users (username, password, role)
          VALUES ($1, $2, 'admin')
        `, [adminUsername, hashedPassword]);
        
        console.log('Admin user created successfully');
      }
      
      // Verify admin exists
      const verifyAdmin = await pool.query(`
        SELECT id, username, role FROM users WHERE username = $1
      `, [adminUsername]);
      
      if (verifyAdmin.rows.length > 0) {
        console.log('Admin account verified:', verifyAdmin.rows[0]);
        console.log(`\nAdmin credentials:\nUsername: ${adminUsername}\nPassword: ${adminPassword}\n`);
      } else {
        console.log('Failed to verify admin account');
      }
    } else {
      console.log('Using in-memory storage');
      
      // Create or update admin in memory
      users.set(1, {
        id: 1,
        username: adminUsername,
        password: hashedPassword,
        role: 'admin'
      });
      
      console.log('Admin account created in memory');
      console.log(`\nAdmin credentials:\nUsername: ${adminUsername}\nPassword: ${adminPassword}\n`);
    }
    
    console.log('Admin account reset completed successfully');
  } catch (error) {
    console.error('Error resetting admin account:', error);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run the reset function
resetAdmin().catch(console.error);
