// Database initialization script for serverless environment
import { getDbPool, query } from './db.js';

export async function initializeDatabase() {
  console.log('Initializing database tables...');
  
  try {
    // Create enum types
    await query(`
      DO $$ BEGIN
        CREATE TYPE kitchen_preference AS ENUM ('commercial', 'home', 'notSure');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await query(`
      DO $$ BEGIN
        CREATE TYPE certification_status AS ENUM ('yes', 'no', 'notSure');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await query(`
      DO $$ BEGIN
        CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('admin', 'applicant');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    // Create users table if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role user_role NOT NULL DEFAULT 'applicant',
        google_id TEXT UNIQUE,
        facebook_id TEXT UNIQUE
      );
    `);
    
    // Create applications table if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        food_safety_license certification_status NOT NULL,
        food_establishment_cert certification_status NOT NULL,
        kitchen_preference kitchen_preference NOT NULL,
        status application_status NOT NULL DEFAULT 'new',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    
    console.log('Database initialization completed successfully');
    return true;
  } catch (error) {
    console.error('Error initializing database:', error);
    return false;
  }
}