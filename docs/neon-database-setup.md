# Neon Database Setup Guide for Local Cooks

This guide will walk you through setting up the database tables in Neon.tech for the Local Cooks application.

## Option 1: Manual Table Creation with SQL

1. Log in to your Neon.tech dashboard
2. Select your project
3. Click on "SQL Editor" in the left sidebar
4. Copy and paste the following SQL code:

```sql
-- Create enum types (if they don't exist)
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
  CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');
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
  status application_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create session table for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Optional: Create a test admin user
INSERT INTO users (username, password, role)
VALUES ('admin', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8.salt', 'admin')
ON CONFLICT (username) DO NOTHING;
```

5. Click "Run" to execute the SQL statements

## Option 2: Using Drizzle Kit Migration (Local Development)

If you're working with the codebase locally and have the project set up:

1. Make sure your `.env` file has the `DATABASE_URL` set correctly to your Neon database
2. Run the Drizzle migration command:

```bash
npm run db:push
```

## Verifying Your Setup

After setting up the tables, you can verify they were created correctly:

1. In the Neon dashboard, go to the "Tables" section
2. You should see the following tables:
   - `users`
   - `applications`
   - `session` (for session management)

3. Test user registration through the application to ensure users can be created
4. If using the test admin account, you can log in with:
   - Username: `admin`
   - Password: `password`

## Troubleshooting

### Error: Relation Does Not Exist

If you see errors about relations not existing:
- Make sure all tables have been created
- Check that you're connected to the correct database
- Verify that your `DATABASE_URL` environment variable is correct

### Connection Issues

If the application can't connect to the database:
- Ensure your IP address is allowed in Neon.tech's access settings
- Check that your connection string is in the correct format
- Verify that your database user has the proper permissions

### Schema Sync Issues

If your application's code schema doesn't match the database schema:
- Run the SQL statements again to ensure all columns exist
- Consider dropping and recreating the tables if you're still in development
- Make sure your Drizzle schema in `shared/schema.ts` matches the database structure