// This script initializes the database for Vercel deployment
// Run this locally with: node scripts/vercel-db-init.js

import { Pool, neonConfig } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '../shared/schema.js';

// Load environment variables
dotenv.config();

// Configure Neon database
neonConfig.webSocketConstructor = ws;

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }
  
  console.log('Initializing database...');
  
  try {
    // Connect to the database
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool, { schema });
    
    // Create tables if they don't exist
    await db.execute(`
      -- Create enum types if they don't exist
      DO $$ BEGIN
        CREATE TYPE kitchen_preference AS ENUM ('commercial', 'home', 'notSure');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE certification_status AS ENUM ('yes', 'no', 'notSure');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE application_status AS ENUM ('inReview', 'approved', 'rejected', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('admin', 'applicant');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      -- Create users table if it doesn't exist
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role user_role NOT NULL DEFAULT 'applicant',
        google_id TEXT UNIQUE,
        facebook_id TEXT UNIQUE
      );
      
      -- Create applications table if it doesn't exist
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        food_safety_license certification_status NOT NULL,
        food_establishment_cert certification_status NOT NULL,
        kitchen_preference kitchen_preference NOT NULL,
        status application_status NOT NULL DEFAULT 'inReview',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    
    console.log('Database initialized successfully');
    
    // Create test admin user if it doesn't exist
    const adminExists = await db.execute(`
      SELECT * FROM users WHERE username = 'admin' LIMIT 1
    `);
    
    if (adminExists.rowCount === 0) {
      console.log('Creating admin user...');
      // We'll use a hardcoded password hash for the admin user
      // In production, you should generate this using proper password hashing
      const adminPasswordHash = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8.salt'; // password: 'password'
      
      await db.execute(`
        INSERT INTO users (username, password, role)
        VALUES ('admin', '${adminPasswordHash}', 'admin')
      `);
      
      console.log('Admin user created successfully');
    } else {
      console.log('Admin user already exists');
    }
    
    await pool.end();
    
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

initDatabase();