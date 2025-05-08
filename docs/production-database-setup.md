# Production Database Connection Guide

This guide outlines how to set up and configure the PostgreSQL database connection for the Local Cooks application in a production environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Database Configuration](#database-configuration)
- [Environment Variables](#environment-variables)
- [Connection Pooling](#connection-pooling)
- [Security Considerations](#security-considerations)
- [Database Migrations](#database-migrations)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before setting up your production database connection, ensure you have:

1. A PostgreSQL database server (v13+) accessible from your application server
2. Necessary database credentials (username, password, host, port, database name)
3. Network access configured between your application and database servers
4. SSL certificate if using encrypted connections (recommended)

## Database Configuration

The Local Cooks application uses the Neon PostgreSQL serverless database by default, but any PostgreSQL-compatible database will work.

### Connection Setup

The database connection is configured in `server/db.ts`:

```typescript
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

### Provider-Specific Setup

#### Neon Database (Default)

For Neon Postgres:
1. Create a database in the [Neon Console](https://console.neon.tech/)
2. Get your connection string from the Neon dashboard
3. Add your connection string to your environment variables

#### Other PostgreSQL Providers

For other PostgreSQL providers (AWS RDS, Digital Ocean, etc.), the connection string format is:

```
postgresql://username:password@hostname:port/database
```

## Environment Variables

In production, you'll need to set the following environment variables:

```
DATABASE_URL=postgresql://username:password@hostname:port/database
SESSION_SECRET=your-strong-random-session-secret
NODE_ENV=production
```

### Setting Environment Variables

#### For Deployment Platforms

- **Vercel**: Add in the project settings under "Environment Variables"
- **Netlify**: Add in the site settings under "Build & deploy" → "Environment variables"
- **Heroku**: Use `heroku config:set DATABASE_URL=your-connection-string`
- **Railway**: Add in the project settings under "Variables"

#### Self-Hosted

For self-hosted solutions, add environment variables to your server configuration:

```bash
# Add to .env file (not in source control)
DATABASE_URL=postgresql://username:password@hostname:port/database
SESSION_SECRET=your-strong-random-session-secret
NODE_ENV=production

# Or export directly
export DATABASE_URL=postgresql://username:password@hostname:port/database
export SESSION_SECRET=your-strong-random-session-secret
export NODE_ENV=production
```

## Connection Pooling

The application uses connection pooling via PostgreSQL's built-in pooling mechanism:

```typescript
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

### Advanced Pool Configuration

For high-traffic production environments, consider customizing your pool configuration:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // How long to try to connect to the database before timing out
  ssl: process.env.NODE_ENV === 'production' // Enable SSL in production
});
```

## Security Considerations

### SSL Connections

For production, always enable SSL for database connections:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true, // Verify SSL certificate
    ca: fs.readFileSync('/path/to/server-certificates/root.crt').toString(),
  }
});
```

### Credentials Management

1. Never store database credentials in your codebase
2. Use environment variables or a secrets management service
3. Regularly rotate database passwords
4. Use a database user with limited permissions (not superuser)

### Minimum Required Permissions

Create a dedicated database user with only the necessary permissions:

```sql
CREATE USER localcooks_app WITH PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE localcooks TO localcooks_app;
GRANT USAGE ON SCHEMA public TO localcooks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO localcooks_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO localcooks_app;
```

## Database Migrations

### Initial Schema Setup

To set up the database schema in production:

```bash
# Run this command once to set up your schema
npm run db:push
```

### Creating an Admin User

To create an initial admin user:

```bash
# Run this script to create the admin user
npm run create-admin
```

The script will prompt for username and password for the admin account.

### Schema Updates

For schema updates, use the Drizzle migration system:

```bash
# Generate migrations based on schema changes
npm run drizzle:generate

# Push changes to production database
npm run db:push
```

## Monitoring and Maintenance

### Database Health Monitoring

Implement a health check endpoint to monitor database connectivity:

```typescript
app.get('/api/health/db', async (req, res) => {
  try {
    // Simple query to check database connection
    await db.execute(sql`SELECT 1`);
    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});
```

### Regular Maintenance

1. Schedule regular database backups
2. Implement monitoring for slow queries
3. Set up alerts for database connection failures
4. Periodically run VACUUM and analyze operations
5. Monitor disk space and connection limits

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check network access, firewall rules, and database server status
2. **Authentication Failed**: Verify credentials and user permissions
3. **SSL Required**: Ensure SSL is properly configured on both client and server
4. **Too Many Connections**: Increase max connections or optimize connection pooling
5. **Timeout Errors**: Check network latency and increase connection timeout settings

### Debugging Connection Issues

```typescript
// Add this to test database connectivity
async function testConnection() {
  try {
    await db.execute(sql`SELECT current_timestamp`);
    console.log('Database connection successful');
  } catch (error) {
    console.error('Database connection failed:', error);
  }
}

testConnection();
```

### Logging

Enable detailed logging for database operations in development:

```typescript
// Add to your db.ts file during troubleshooting
pool.on('connect', client => {
  console.log('New client connected to database');
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});
```

## Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [Neon PostgreSQL Documentation](https://neon.tech/docs/introduction)
- [Node Postgres Documentation](https://node-postgres.com/)