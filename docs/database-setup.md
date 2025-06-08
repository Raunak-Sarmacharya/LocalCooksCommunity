# Database Setup Guide

This guide will help you set up your Neon database connection and ensure all required tables are created.

## Prerequisites

- A Neon database (from your Vercel setup)
- Your Neon connection string

## Setup Steps

### 1. Update Database Connection

Update your `.env` file with your real Neon database URL:

```bash
# Replace the placeholder with your actual Neon URL
DATABASE_URL=postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require
```

### 2. Verify Database Connection

Check if your database connection is working:

```bash
npm run check-database
```

This will:
- ✅ Test connection to Neon database
- 📊 List all existing tables
- 🔍 Check for missing tables
- 📈 Show row counts for each table

### 3. Deploy Missing Tables

If the microlearning tables are missing, deploy them:

```bash
npm run deploy-microlearning-tables
```

This will create:
- `microlearning_completions` table
- `video_progress` table
- All necessary indexes and foreign keys

## Required Tables

Your database should have these tables:

| Table | Purpose | Status |
|-------|---------|--------|
| `users` | User accounts | ✅ Should exist |
| `applications` | User applications | ✅ Should exist |
| `microlearning_completions` | Training completions | ❓ May need creation |
| `video_progress` | Video watch progress | ❓ May need creation |

## Storage Configuration

The app automatically detects your database:

- **With DATABASE_URL**: Uses Neon database storage
- **Without DATABASE_URL**: Falls back to in-memory storage

## Troubleshooting

### Connection Issues

If you get connection errors:

1. **Check DATABASE_URL**: Ensure it's not the placeholder value
2. **Verify Credentials**: Confirm username/password are correct
3. **Check Network**: Ensure you can reach Neon from your location

### Table Issues

If tables are missing:

1. **Run deployment**: `npm run deploy-microlearning-tables`
2. **Check permissions**: Ensure your user can create tables
3. **Verify schema**: Tables should be in the `public` schema

### Data Issues

If microlearning data appears empty:

1. **Check table creation**: Run `npm run check-database`
2. **Verify storage mode**: Ensure app is using database storage
3. **Test functionality**: Try creating some video progress

## Commands Reference

```bash
# Check database status
npm run check-database

# Deploy microlearning tables
npm run deploy-microlearning-tables

# Start development server (will use database if URL is set)
npm run dev

# Check microlearning routes
npm run fix-microlearning
```

## Database Schema

### microlearning_completions

```sql
CREATE TABLE "microlearning_completions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES users(id),
  "completed_at" timestamp DEFAULT now() NOT NULL,
  "confirmed" boolean DEFAULT false NOT NULL,
  "certificate_generated" boolean DEFAULT false NOT NULL,
  "video_progress" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
```

### video_progress

```sql
CREATE TABLE "video_progress" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES users(id),
  "video_id" text NOT NULL,
  "progress" numeric(5,2) DEFAULT '0' NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "completed_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "watched_percentage" numeric(5,2) DEFAULT '0' NOT NULL,
  "is_rewatching" boolean DEFAULT false NOT NULL
);
``` 