# Environment Variables Reference

This file documents all environment variables used in Local Cooks Community for both development and production.

## Core Variables
| Name | Description | Example |
|------|-------------|---------|
| DATABASE_URL | Postgres/Neon connection string | postgresql://user:pass@host/db?sslmode=require |
| SESSION_SECRET | Secret for session encryption | my-super-secret-key |
| NODE_ENV | Environment (development/production) | development |
| VERCEL_ENV | Vercel environment | production |

## File Upload (Vercel Blob)
| Name | Description | Example |
|------|-------------|---------|
| BLOB_READ_WRITE_TOKEN | Vercel Blob RW token | vercel_blob_rw_xxx |

## Email (Optional)
| Name | Description | Example |
|------|-------------|---------|
| EMAIL_HOST | SMTP host | smtp.hostinger.com |
| EMAIL_PORT | SMTP port | 587 |
| EMAIL_USER | SMTP user | your@email.com |
| EMAIL_PASS | SMTP password | password |
| EMAIL_FROM | From address | Local Cooks <your@email.com> |

## OAuth (Optional)
| Name | Description | Example |
|------|-------------|---------|
| GOOGLE_CLIENT_ID | Google OAuth client ID | ... |
| GOOGLE_CLIENT_SECRET | Google OAuth secret | ... |
| FACEBOOK_CLIENT_ID | Facebook OAuth client ID | ... |
| FACEBOOK_CLIENT_SECRET | Facebook OAuth secret | ... |

See `.env.example` for a template. 