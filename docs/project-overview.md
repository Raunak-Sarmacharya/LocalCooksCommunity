# Project Overview

Local Cooks Community is a platform for home cooks and food entrepreneurs to apply, get verified, and participate in a trusted food marketplace. The project features a modern React frontend, Express backend, and leverages Neon for the database and Vercel Blob for scalable file storage.

## Main Features
- User registration and authentication (local, Google, Facebook)
- Application form for cooks (with document upload)
- Admin dashboard for application review and document verification
- Dual file upload system (local in dev, Vercel Blob in prod)
- Email notifications for status changes
- Secure, scalable, and cloud-native architecture

## Architecture Overview
- **Frontend**: React (Vite), Tailwind CSS
- **Backend**: Express.js, TypeScript
- **Database**: Neon (PostgreSQL)
- **File Storage**: Vercel Blob (production), local disk (development)
- **Deployment**: Vercel (serverless)

See [production-deployment.md](./production-deployment.md) for a full deployment diagram. 