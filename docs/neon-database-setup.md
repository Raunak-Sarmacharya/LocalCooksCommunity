# Neon Database Setup Guide

This guide will help you set up your Neon PostgreSQL database for the Local Cooks application.

## Create Database Tables

Run the following SQL in your Neon SQL Editor to create all necessary tables:

```sql
-- Create enum types
CREATE TYPE user_role AS ENUM ('admin', 'applicant');
CREATE TYPE kitchen_preference AS ENUM ('commercial', 'home', 'notSure');
CREATE TYPE certification_status AS ENUM ('yes', 'no', 'notSure');
CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'applicant',
  google_id TEXT,
  facebook_id TEXT
);

-- Create applications table
CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status application_status NOT NULL DEFAULT 'new',
  
  -- Personal information
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  
  -- Certifications
  food_safety_license certification_status NOT NULL,
  food_establishment_cert certification_status NOT NULL,
  
  -- Kitchen preference
  kitchen_preference kitchen_preference NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create an admin user (username: admin, password: localcooks)
INSERT INTO users (username, password, role)
VALUES (
  'admin',
  'fcf0872ea0a0c91f3d8e64dc5005c9b6a36371eddc6c1127a3c0b45c71db5b72f85c5e93b80993ec37c6aff8b08d07b68e9c58f28e3bd20d9d2a4eb38992aad0.ef32a41b7d478668',
  'admin'
) ON CONFLICT (username) DO NOTHING;
```

## Environment Variables

Make sure to set these environment variables in your Vercel project:

```
DATABASE_URL=your-neon-database-connection-string
SESSION_SECRET=your-secure-random-string
```

## Verify Database Connection

You can run this SQL to verify that your tables were created correctly:

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('users', 'applications')
ORDER BY table_name, ordinal_position;
```

## Database Connection Troubleshooting

If you're having trouble connecting to your Neon database from Vercel:

1. Make sure your DATABASE_URL includes the correct connection parameters
2. Verify that you've enabled the "Serverless Driver" option in your Neon project settings
3. Check that your Vercel region is compatible with your Neon region
4. Add the "ws" package to your dependencies if connecting with WebSockets

## Setting Up Development Environment

For local development:

1. Copy the DATABASE_URL from your Neon dashboard
2. Create a `.env.local` file in your project root
3. Add `DATABASE_URL=your-connection-string` to this file
4. Add `SESSION_SECRET=your-dev-secret` to this file