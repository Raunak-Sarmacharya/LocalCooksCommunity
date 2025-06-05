# Session Management Guide

## Overview

Your Local Cooks Community application uses PostgreSQL to store user sessions. Over time, these sessions can accumulate and impact database performance. This guide covers session cleanup strategies and monitoring.

## Current Session Configuration

- **Session Expiration**: 7 days (configurable in `api/index.js`)
- **Automatic Cleanup**: Every 15 minutes (configured in `pruneSessionInterval`)
- **Storage**: PostgreSQL `session` table
- **Startup Cleanup**: Runs on server start

## Session Statistics

### Check Current Stats
```bash
# View session statistics (admin only)
curl -X GET "https://your-app.vercel.app/api/admin/sessions/stats" \
  -H "X-User-ID: your-admin-user-id"

# Or via npm script (dry run)
npm run sessions:stats
```

### Example Response
```json
{
  "message": "Session statistics",
  "stats": {
    "total_sessions": "3247",
    "active_sessions": "891", 
    "expired_sessions": "2356",
    "oldest_session": "2023-11-15T10:30:00.000Z",
    "newest_session": "2023-12-15T15:45:00.000Z",
    "table_size": "1536 kB"
  },
  "recommendations": {
    "shouldCleanup": true,
    "cleanupRecommended": true,
    "criticalLevel": false
  }
}
```

## Cleanup Methods

### 1. Automatic Cleanup (Recommended)

**Built-in Automatic Cleanup:**
- Runs every 15 minutes
- Only removes expired sessions
- Configured in session store setup

### 2. Manual API Cleanup (Admin Only)

**Remove Expired Sessions:**
```bash
curl -X POST "https://your-app.vercel.app/api/admin/sessions/cleanup" \
  -H "X-User-ID: your-admin-user-id"
```

**Remove Old Sessions (30+ days):**
```bash
curl -X POST "https://your-app.vercel.app/api/admin/sessions/cleanup-old" \
  -H "Content-Type: application/json" \
  -H "X-User-ID: your-admin-user-id" \
  -d '{"days": 30}'
```

### 3. Script-Based Cleanup

**View what would be cleaned (safe):**
```bash
npm run sessions:stats
```

**Clean expired sessions:**
```bash
npm run sessions:cleanup
```

**Clean sessions older than 30 days:**
```bash
npm run sessions:cleanup-old
```

**Aggressive cleanup (7+ days):**
```bash
npm run sessions:cleanup-aggressive
```

**Custom cleanup:**
```bash
node scripts/cleanup-sessions.js --days 14
node scripts/cleanup-sessions.js --dry-run --days 7
```

## When to Clean Up

### Immediate Action Required (Critical)
- **5000+ total sessions**: Risk of performance degradation
- **Table size > 10MB**: Storage concerns
- **High expired ratio**: > 70% expired sessions

### Cleanup Recommended
- **1000+ total sessions**: Preventive maintenance
- **500+ expired sessions**: Regular housekeeping
- **Weekly maintenance**: Keep table lean

### Monitoring Metrics
- **Total sessions**: Overall count
- **Active vs expired ratio**: Health indicator  
- **Table size**: Storage impact
- **Oldest session**: Data retention check

## Best Practices

### Regular Maintenance
```bash
# Weekly cleanup (add to cron)
0 2 * * 0 cd /path/to/app && npm run sessions:cleanup-old

# Daily stats check
0 8 * * * cd /path/to/app && npm run sessions:stats
```

### Production Recommendations

1. **Monitor Regularly**: Check stats weekly
2. **Automated Cleanup**: Let built-in cleanup handle expired sessions
3. **Manual Cleanup**: Monthly cleanup of old sessions (30+ days)
4. **Critical Response**: Immediate cleanup if > 5000 sessions

### Emergency Cleanup

If your session table becomes critically large:

```bash
# 1. Check current state
npm run sessions:stats

# 2. Aggressive cleanup (removes sessions older than 3 days)
node scripts/cleanup-sessions.js --days 3

# 3. Verify results
npm run sessions:stats
```

## Session Table Schema

```sql
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX "IDX_session_expire" ON "session" ("expire");
```

## Troubleshooting

### High Session Count
- **Check for bot traffic**: Unusual session creation patterns
- **Review session expiration**: May need shorter sessions
- **Monitor user behavior**: Multiple tabs/devices per user

### Cleanup Failures
- **Database connection**: Verify DATABASE_URL
- **Permissions**: Ensure admin access for API endpoints
- **Table locks**: Retry during low-traffic periods

### Performance Issues
- **Index usage**: Ensure expire index exists
- **Cleanup frequency**: Consider more frequent automatic cleanup
- **Query optimization**: Monitor session-related queries

## Integration with Monitoring

### Health Check Endpoint
```bash
GET /api/health
```
Includes session statistics in response.

### Admin Dashboard
Session stats could be integrated into admin dashboard for easy monitoring.

### Alerts
Consider setting up alerts for:
- Session count > 5000
- Table size > 10MB  
- Cleanup failures

## API Reference

### GET /api/admin/sessions/stats
Returns session statistics and recommendations.

### POST /api/admin/sessions/cleanup  
Removes expired sessions only.

### POST /api/admin/sessions/cleanup-old
Removes sessions older than specified days.
Body: `{"days": 30}`

All endpoints require admin authentication via `X-User-ID` header. 