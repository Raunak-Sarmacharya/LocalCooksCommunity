# Local Cooks Community Platform

<div align="center">

![Local Cooks Logo](./attached_assets/Logo_LocalCooks.png)

**A Professional Platform Connecting Local Cooks with Customers**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)

[Live Demo](#) | [Documentation](#documentation) | [API Reference](#api-reference) | [Contributing](#contributing)

</div>

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Document Verification System](#document-verification-system)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [Authentication](#authentication)
- [Deployment](#deployment)
- [Production Database Setup](#production-database-setup)
- [Neon Database Setup](#neon-database-setup)
- [Vercel Deployment Guide](#vercel-deployment-guide)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Performance Optimization](#performance-optimization)
- [Contributing](#contributing)
- [License](#license)

---

## 📖 Overview

The **Local Cooks Community Platform** is a comprehensive web application that bridges the gap between talented home chefs and food enthusiasts. Our platform provides a secure, user-friendly environment where local cooks can showcase their culinary skills, manage applications, and connect with potential customers.

### 🎯 Mission
To create a trusted community where passionate home cooks can turn their culinary talents into sustainable opportunities while providing customers with authentic, local dining experiences.

### 🏆 Key Benefits
- **For Cooks**: Streamlined application process, document verification, and professional profile management
- **For Administrators**: Comprehensive application review system with document verification workflow
- **For Customers**: Access to verified, trusted local cooks in their community

---

## ✨ Features

### 🏠 **User Experience**
- **Responsive Design**: Optimized for all devices and screen sizes
- **Modern Interface**: Clean, intuitive UI with smooth animations
- **Interactive Homepage**: Engaging sections with call-to-action elements
- **Real-time Updates**: Live status tracking and notifications

### 📝 **Application Management**
- **Multi-step Application Process**: Guided three-step form with smart validation
- **Document Verification System**: Secure upload and admin review workflow
- **Status Tracking**: Real-time application and verification status updates
- **Automated Notifications**: Email updates for status changes

### 👨‍💼 **Admin Dashboard**
- **Application Review**: Comprehensive tools for reviewing cook applications
- **Document Verification**: Streamlined process for verifying uploaded documents
- **User Management**: Complete user and application lifecycle management
- **Analytics Dashboard**: Application metrics and status summaries

### 🔐 **Security & Authentication**
- **Secure Authentication**: Session-based authentication with Passport.js
- **Role-based Access Control**: Separate interfaces for applicants and administrators
- **Document Security**: Secure file upload and access control
- **Data Protection**: GDPR-compliant data handling practices

### 📋 **Document Verification Features**
- **File Upload Support**: Direct file upload with format validation (PDF, JPG, PNG, WebP)
- **URL-Based Documents**: Option to provide external document links
- **Real-time Status Updates**: Live tracking of document review progress
- **Admin Review Interface**: Comprehensive tools for document verification
- **Document Management**: Users can update/replace documents anytime
- **Verification Workflow**: Automatic user verification upon document approval

---

## 🛠️ Technology Stack

### **Frontend**
| Technology | Purpose | Version |
|------------|---------|---------|
| **React** | UI Framework | ^18.0.0 |
| **TypeScript** | Type Safety | ^5.0.0 |
| **TailwindCSS** | Styling Framework | ^3.3.0 |
| **shadcn/ui** | Component Library | Latest |
| **Framer Motion** | Animations | ^10.0.0 |
| **React Hook Form** | Form Management | ^7.45.0 |
| **TanStack Query** | Data Fetching | ^4.29.0 |
| **Zod** | Schema Validation | ^3.21.0 |
| **Wouter** | Client-side Routing | ^2.12.0 |

### **Backend**
| Technology | Purpose | Version |
|------------|---------|---------|
| **Express.js** | Web Framework | ^4.18.0 |
| **TypeScript** | Type Safety | ^5.0.0 |
| **Drizzle ORM** | Database ORM | ^0.28.0 |
| **PostgreSQL** | Primary Database | ^14.0 |
| **Passport.js** | Authentication | ^0.6.0 |
| **Express Session** | Session Management | ^1.17.0 |
| **Multer** | File Upload | ^1.4.5 |

### **Development & Deployment**
| Technology | Purpose |
|------------|---------|
| **Vite** | Build Tool |
| **Vercel** | Deployment Platform |
| **Neon** | Serverless PostgreSQL |
| **ESLint** | Code Linting |
| **Prettier** | Code Formatting |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** (v18.0.0 or higher)
- **npm** (v8.0.0 or higher)
- **PostgreSQL** (v14.0 or higher) - Optional for development

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/local-cooks-community.git
   cd local-cooks-community
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment setup**
   ```bash
   cp .env.example .env
   ```
   
4. **Configure environment variables** (see [Configuration](#configuration))

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Access the application**
   - Frontend: `http://localhost:5000`
   - Admin Dashboard: `http://localhost:5000/admin-login`

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Database Configuration
DATABASE_URL=postgresql://username:password@hostname:port/database

# Session Management
SESSION_SECRET=your-super-secure-session-secret-here

# Environment
NODE_ENV=development

# Email Configuration (Optional)
EMAIL_HOST=smtp.your-provider.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@domain.com
EMAIL_PASS=your-email-password
EMAIL_FROM=Local Cooks <support@localcooks.com>

# OAuth Configuration (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

FACEBOOK_CLIENT_ID=your-facebook-client-id
FACEBOOK_CLIENT_SECRET=your-facebook-client-secret
FACEBOOK_CALLBACK_URL=http://localhost:5000/api/auth/facebook/callback
```

### Database Setup

#### Option 1: PostgreSQL (Production)
1. Install PostgreSQL
2. Create database: `createdb localcooks`
3. Set `DATABASE_URL` in `.env`
4. Run migrations: `npm run db:push`
5. Create admin user: `npm run create-admin`

#### Option 2: In-Memory (Development)
- Uses in-memory storage automatically when `DATABASE_URL` points to dummy data
- Perfect for development and testing
- No additional setup required

---

## 📚 Usage

### 🧑‍🍳 For Applicants

1. **Registration**: Create account at `/register`
2. **Application**: Submit application at `/apply`
3. **Dashboard**: Track status at `/dashboard`
4. **Documents**: Upload verification documents at `/document-verification`

### 👨‍💼 For Administrators

1. **Login**: Access admin panel at `/admin-login`
   - Username: `admin`
   - Password: `localcooks`
2. **Review**: Manage applications in admin dashboard
3. **Verify**: Review and approve/reject documents
4. **Monitor**: Track application metrics and trends

### 🔄 Application Workflow

```mermaid
graph TD
    A[User Registration] --> B[Submit Application]
    B --> C[Admin Review]
    C --> D{Application Status}
    D -->|Approved| E[Document Upload]
    D -->|Rejected| F[End]
    D -->|In Review| C
    E --> G[Admin Document Review]
    G --> H{Document Status}
    H -->|Approved| I[Fully Verified Cook]
    H -->|Rejected| E
    I --> J[Ready for Business]
```

---

## 📋 Document Verification System

### Overview

The document verification system allows approved applicants to upload verification documents and admins to review and approve them. This ensures all cooks on the platform are properly certified and trustworthy.

### System Features

#### For Applicants
- **Document Upload**: Upload Food Safety License (required) and Food Establishment Certificate (optional)
- **Multiple Formats**: Support for PDF, JPG, PNG, WebP files (max 10MB)
- **URL Support**: Option to provide external document links
- **Status Tracking**: Real-time verification status with detailed feedback
- **Document Updates**: Replace or update documents anytime
- **Fully Verified Status**: Special interface when all documents are approved

#### For Admins
- **Review Interface**: Comprehensive document review dashboard
- **Status Management**: Approve, reject, or request changes for documents
- **Feedback System**: Provide detailed feedback to applicants
- **User Verification**: Automatic user verification status updates

### User Flow

#### Applicant Journey
1. **Application Approval**: User receives application approval notification
2. **Document Upload**: Access document verification page from dashboard
3. **Submit Documents**: Upload required Food Safety License and optional certificates
4. **Status Monitoring**: Track verification progress with real-time updates
5. **Fully Verified**: Receive verified status when all documents are approved

#### Admin Workflow
1. **Review Queue**: Access documents tab in admin dashboard
2. **Document Review**: Review submitted documents via links or downloads
3. **Status Update**: Approve, reject, or request changes
4. **Feedback**: Provide detailed feedback to guide applicants
5. **User Verification**: System automatically updates user verification status

### Technical Implementation

#### Database Schema
```sql
-- Document verification fields in applications table
food_safety_license_url TEXT,
food_establishment_cert_url TEXT,
food_safety_license_status document_verification_status DEFAULT 'pending',
food_establishment_cert_status document_verification_status DEFAULT 'pending',
documents_admin_feedback TEXT,
documents_reviewed_by INTEGER REFERENCES users(id),
documents_reviewed_at TIMESTAMP
```

#### API Endpoints
- `PATCH /api/applications/:id/documents` - Upload/update documents
- `PATCH /api/applications/:id/document-verification` - Update verification status (admin)
- `GET /api/files/documents/:filename` - Access document files

#### Security Features
- **Authentication Required**: All document operations require authentication
- **Role-based Access**: Users can only access their own documents
- **File Validation**: Comprehensive file type and size validation
- **Secure File Storage**: Protected file access with user ownership verification

---

## 📡 API Reference

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/api/register` | Register new user | No |
| `POST` | `/api/login` | User login | No |
| `POST` | `/api/admin-login` | Admin login | No |
| `POST` | `/api/logout` | Logout current user | Yes |
| `GET` | `/api/user` | Get current user | Yes |

### Application Endpoints

| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| `POST` | `/api/applications` | Submit application | Yes | Applicant |
| `GET` | `/api/applications` | Get all applications | Yes | Admin |
| `GET` | `/api/applications/my-applications` | Get user's applications | Yes | Applicant |
| `GET` | `/api/applications/:id` | Get specific application | Yes | Any |
| `PATCH` | `/api/applications/:id/status` | Update application status | Yes | Admin |
| `PATCH` | `/api/applications/:id/cancel` | Cancel application | Yes | Applicant |

### Document Verification Endpoints

| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| `PATCH` | `/api/applications/:id/documents` | Upload/update documents | Yes | Applicant |
| `PATCH` | `/api/applications/:id/document-verification` | Update verification status | Yes | Admin |
| `GET` | `/api/files/documents/:filename` | Access document files | Yes | Owner/Admin |

### Utility Endpoints

| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| `GET` | `/api/health` | Health check and database status | No | - |
| `POST` | `/api/test-status-email` | Send test status email | Yes | Admin |

### Response Format

```typescript
// Success Response
{
  "success": true,
  "data": T,
  "message": "Operation completed successfully"
}

// Error Response
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information"
}
```

---

## 🏗️ Architecture

### Project Structure

```
local-cooks-community/
├── 📁 client/                    # Frontend React application
│   ├── 📁 src/
│   │   ├── 📁 components/        # Reusable UI components
│   │   │   ├── 📁 application/   # Application-specific components
│   │   │   ├── 📁 auth/          # Authentication components
│   │   │   ├── 📁 document-verification/ # Document upload/management
│   │   │   ├── 📁 home/          # Homepage sections
│   │   │   ├── 📁 layout/        # Layout components
│   │   │   └── 📁 ui/            # Base UI components
│   │   ├── 📁 hooks/             # Custom React hooks
│   │   ├── 📁 lib/               # Utility functions and configurations
│   │   ├── 📁 pages/             # Page components
│   │   └── 📁 assets/            # Static assets
│   └── 📄 index.html             # HTML template
├── 📁 server/                    # Backend Express application
│   ├── 📄 index.ts               # Server entry point
│   ├── 📄 routes.ts              # API route definitions
│   ├── 📄 storage.ts             # Data access layer
│   ├── 📄 auth.ts                # Authentication configuration
│   ├── 📄 db.ts                  # Database connection
│   ├── 📄 email.ts               # Email service
│   └── 📄 fileUpload.ts          # File upload handling
├── 📁 shared/                    # Shared types and schemas
│   └── 📄 schema.ts              # Database schemas and types
├── 📁 migrations/                # Database migration files
├── 📁 scripts/                   # Utility scripts
├── 📁 uploads/                   # File upload directory
├── 📁 docs/                      # Documentation files
└── 📄 package.json               # Project configuration
```

### Data Flow Architecture

```mermaid
graph TB
    subgraph "Frontend (React)"
        A[Pages] --> B[Components]
        B --> C[Hooks]
        C --> D[API Client]
    end
    
    subgraph "Backend (Express)"
        E[Routes] --> F[Storage Layer]
        F --> G[Database]
        E --> H[Auth Middleware]
        E --> I[File Upload]
    end
    
    D --> E
    I --> J[File System]
    
    subgraph "External Services"
        K[Email Service]
        L[OAuth Providers]
        M[Neon Database]
    end
    
    E --> K
    H --> L
    G --> M
```

---

## 🗄️ Database Schema

### Core Tables

#### Users Table
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role user_role DEFAULT 'applicant' NOT NULL,
    google_id TEXT,
    facebook_id TEXT,
    is_verified BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

#### Applications Table
```sql
CREATE TABLE applications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    food_safety_license certification_status NOT NULL,
    food_establishment_cert certification_status NOT NULL,
    kitchen_preference kitchen_preference NOT NULL,
    feedback TEXT,
    status application_status DEFAULT 'new' NOT NULL,
    
    -- Document verification fields
    food_safety_license_url TEXT,
    food_establishment_cert_url TEXT,
    food_safety_license_status document_verification_status DEFAULT 'pending',
    food_establishment_cert_status document_verification_status DEFAULT 'pending',
    documents_admin_feedback TEXT,
    documents_reviewed_by INTEGER REFERENCES users(id),
    documents_reviewed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### Enums
```sql
-- User roles
CREATE TYPE user_role AS ENUM ('admin', 'applicant');

-- Application status
CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');

-- Certification status
CREATE TYPE certification_status AS ENUM ('have', 'will_obtain', 'need_assistance');

-- Kitchen preference
CREATE TYPE kitchen_preference AS ENUM ('own', 'shared', 'commercial', 'any');

-- Document verification status
CREATE TYPE document_verification_status AS ENUM ('pending', 'approved', 'rejected');
```

---

## 🔐 Authentication

### Authentication Flow

1. **Session-based Authentication**: Uses Express sessions with secure cookies
2. **Password Security**: Bcrypt hashing with salt rounds
3. **OAuth Integration**: Google and Facebook OAuth support
4. **Role-based Access**: Separate access levels for applicants and admins

### Security Features

- **CSRF Protection**: Cross-site request forgery prevention
- **Session Security**: Secure session configuration
- **Input Validation**: Comprehensive input sanitization
- **File Upload Security**: Secure file handling and validation

### Default Credentials

| Role | Username | Password | Purpose |
|------|----------|----------|---------|
| Admin | `admin` | `localcooks` | Administrative access |
| Demo User | `rsarmacharya` | `password` | Testing applicant flow |

---

## 🚀 Deployment

### Vercel Deployment (Recommended)

1. **Prepare for deployment**
   ```bash
   npm run build
   ```

2. **Deploy to Vercel**
   ```bash
   npx vercel --prod
   ```

3. **Configure environment variables** in Vercel dashboard

4. **Set up database** (Neon, Supabase, or your preferred PostgreSQL provider)

### Manual Deployment

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Set up production database**
   ```bash
   npm run db:push
   npm run create-admin
   ```

3. **Start production server**
   ```bash
   npm start
   ```

### Environment-specific Configurations

#### Development
- Uses in-memory storage by default
- Hot reloading enabled
- Detailed error messages

#### Production
- PostgreSQL database required
- Optimized builds
- Error logging and monitoring
- Security headers enabled

---

## 🗄️ Production Database Setup

### Prerequisites

Before setting up your production database connection, ensure you have:

1. A PostgreSQL database server (v13+) accessible from your application server
2. Necessary database credentials (username, password, host, port, database name)
3. Network access configured between your application and database servers
4. SSL certificate if using encrypted connections (recommended)

### Database Connection Configuration

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

### Security Considerations

#### SSL Connections
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

#### Minimum Required Permissions
Create a dedicated database user with only the necessary permissions:

```sql
CREATE USER localcooks_app WITH PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE localcooks TO localcooks_app;
GRANT USAGE ON SCHEMA public TO localcooks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO localcooks_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO localcooks_app;
```

---

## 🔧 Neon Database Setup

### Quick Setup SQL Script

Run the following SQL in your Neon SQL Editor to create all necessary tables:

```sql
-- Create enum types
CREATE TYPE user_role AS ENUM ('admin', 'applicant');
CREATE TYPE kitchen_preference AS ENUM ('own', 'shared', 'commercial', 'any');
CREATE TYPE certification_status AS ENUM ('have', 'will_obtain', 'need_assistance');
CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');
CREATE TYPE document_verification_status AS ENUM ('pending', 'approved', 'rejected');

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'applicant',
  google_id TEXT,
  facebook_id TEXT,
  is_verified BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
  
  -- Additional feedback
  feedback TEXT,
  
  -- Document verification fields
  food_safety_license_url TEXT,
  food_establishment_cert_url TEXT,
  food_safety_license_status document_verification_status DEFAULT 'pending',
  food_establishment_cert_status document_verification_status DEFAULT 'pending',
  documents_admin_feedback TEXT,
  documents_reviewed_by INTEGER REFERENCES users(id),
  documents_reviewed_at TIMESTAMP,
  
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

-- Create demo applicant user (username: rsarmacharya, password: password)
INSERT INTO users (username, password, role)
VALUES (
  'rsarmacharya',
  'hashed_password_for_demo_user',
  'applicant'
) ON CONFLICT (username) DO NOTHING;
```

### Verification Script

Run this SQL to verify that your tables were created correctly:

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('users', 'applications')
ORDER BY table_name, ordinal_position;
```

---

## 📦 Vercel Deployment Guide

### Pre-Deployment Checklist

Before deploying to Vercel, ensure:

1. You have a Neon PostgreSQL database set up
2. All necessary database tables are created using the SQL script above
3. All code changes are committed to your GitHub repository
4. You have Vercel account with access to deploy the application

### Environment Variables for Vercel

Set these environment variables in your Vercel project settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Your Neon database connection string | `postgresql://user:password@host/database` |
| `SESSION_SECRET` | A strong random string used to secure sessions | `random-string-at-least-32-characters` |
| `NODE_ENV` | The application environment | `production` |

### Deployment Steps

1. **Connect Your Repository**
   - Go to Vercel dashboard and click "New Project"
   - Import your GitHub repository
   - Configure project settings

2. **Configure Build Settings**
   - Framework Preset: Other
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

3. **Add Environment Variables**
   - Add the variables listed above in the Environment Variables section
   - You can set different values for Production, Preview, and Development environments

4. **Deploy**
   - Click "Deploy" to start the deployment process
   - Vercel will build and deploy your application

### Post-Deployment Verification

After successful deployment:

1. **Verify API Endpoints**
   - Test `/api/health` to verify database connectivity
   - Test `/api/user` to verify authentication system

2. **Monitor Logs**
   - Check Vercel logs for any errors
   - Pay attention to serverless function logs for API issues

3. **Test Application Features**
   - Login with admin credentials
   - Test application submission flow
   - Verify document verification system

---

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Structure

```
tests/
├── 📁 unit/                      # Unit tests
│   ├── 📁 components/            # Component tests
│   ├── 📁 hooks/                 # Hook tests
│   └── 📁 utils/                 # Utility function tests
├── 📁 integration/               # Integration tests
│   ├── 📁 api/                   # API endpoint tests
│   └── 📁 auth/                  # Authentication flow tests
└── 📁 e2e/                       # End-to-end tests
    ├── 📄 application-flow.spec.ts
    └── 📄 admin-workflow.spec.ts
```

### Test Coverage Goals

- **Unit Tests**: >90% coverage
- **Integration Tests**: All API endpoints
- **E2E Tests**: Critical user journeys

---

## 🔧 Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Check database connection
npm run db:check

# Reset database
npm run db:reset
```

#### Authentication Problems
- Clear browser cookies and local storage
- Verify session secret configuration
- Check user credentials in database

#### File Upload Issues
- Verify upload directory permissions
- Check file size limits (10MB default)
- Ensure proper file type validation

### Vercel-Specific Troubleshooting

#### FUNCTION_INVOCATION_FAILED Error

This error occurs when your serverless function fails to execute properly. Common causes:

1. **Database Connection Issues**
   - Check if your DATABASE_URL is correctly set in Vercel environment variables
   - Make sure your Neon database is active and not in "paused" state
   - Test database connectivity using the `/api/health` endpoint

2. **Missing Environment Variables**
   - Make sure you've set `SESSION_SECRET` in your Vercel environment variables
   - Setting `NODE_ENV=production` can help with certain configurations

3. **Function Timeout**
   - If your function takes too long to execute, it might time out
   - Reduce the complexity of your API endpoints
   - Keep database queries efficient

4. **Memory Limitations**
   - Vercel has memory limits for serverless functions
   - Reduce the memory footprint of your functions
   - Consider using edge functions for memory-intensive operations

#### Debugging Steps

1. **Check Function Logs**
   - In Vercel dashboard, navigate to your deployment
   - Click on "Functions" to see function logs
   - Look for error messages or timeouts

2. **Test API Endpoints Individually**
   - Try accessing each API endpoint separately to identify which one is failing
   - Use `/api/health` to check database connection status and environment variables

3. **Simplify Problematic Functions**
   - Temporarily comment out complex operations
   - Add more error handling and logging
   - Implement retries for unreliable operations

#### Document Verification Status Not Updating

If document verification status changes aren't reflected on the applicant side:

1. **Check Server Logs**
   ```
   Document verification updated for application [ID]: { foodSafetyLicenseStatus: 'approved', ... }
   User [ID] has been fully verified
   ```

2. **Verify Storage Configuration**
   - Development: Uses `MemStorage` (in-memory, data lost on restart)
   - Production: Uses `DatabaseStorage` (persistent)

3. **Manual Refresh**
   - Use the "Refresh Status" button in the document verification interface

4. **Automatic Polling**
   - System polls for updates every 30 seconds automatically

5. **Cache Invalidation**
   - Admin actions trigger cache invalidation for both views

---

## ⚡ Performance Optimization

### Frontend Optimization

#### Code Splitting
- Implement React.lazy for route-based code splitting
- Use dynamic imports for heavy components
- Optimize bundle size with webpack analyzer

#### Image and Asset Optimization
- Use modern image formats (WebP, AVIF)
- Implement lazy loading for images
- Compress assets during build process

#### React Performance
- Use React.memo for expensive components
- Implement virtual scrolling for large lists
- Optimize re-renders with useCallback and useMemo

### Backend Optimization

#### Database Performance
- Implement proper indexing on frequently queried fields
- Use connection pooling for database connections
- Optimize queries to reduce N+1 problems

#### Caching Strategies
- Implement Redis caching for frequently accessed data
- Use CDN for static asset delivery
- Cache database query results appropriately

#### API Performance
- Implement request rate limiting
- Use compression middleware for responses
- Monitor API response times and bottlenecks

### Vercel-Specific Optimizations

#### Cold Start Optimization
- Minimize function bundle sizes
- Reduce external dependencies
- Use edge functions for simple operations

#### Database Connection Optimization
```typescript
// Optimize for serverless environment
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // Small pool for serverless
  idleTimeoutMillis: 0, // No idle timeout
  connectionTimeoutMillis: 5000 // Quick timeout
});
```

#### Session Management
- Store sessions in database instead of memory
- Use short session expiration times
- Consider stateless authentication with JWTs for scalability

### Monitoring and Analytics

#### Application Monitoring
- Implement error tracking with Sentry
- Monitor performance metrics with Vercel Analytics
- Set up alerts for critical errors

#### Logging Strategy
```typescript
// Production logging configuration
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    // Add external logging service in production
  ]
});
```

---

## 🤝 Contributing

We welcome contributions from the community! Please follow these guidelines:

### Development Workflow

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
4. **Write tests** for new functionality
5. **Run the test suite**
   ```bash
   npm test
   ```
6. **Commit your changes**
   ```bash
   git commit -m "feat: add amazing feature"
   ```
7. **Push to your branch**
   ```bash
   git push origin feature/amazing-feature
   ```
8. **Open a Pull Request**

### Code Standards

#### TypeScript
- Use strict TypeScript configuration
- Implement proper type definitions
- Avoid `any` types unless absolutely necessary

#### React
- Use functional components with hooks
- Implement proper error boundaries
- Follow React best practices

#### Styling
- Use TailwindCSS utility classes
- Follow consistent naming conventions
- Implement responsive design patterns

#### Database
- Write proper migrations
- Use TypeScript schema definitions
- Implement proper indexing

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting changes
refactor: code refactoring
test: adding tests
chore: maintenance tasks
```

### Pull Request Guidelines

- Provide clear description of changes
- Include screenshots for UI changes
- Add tests for new functionality
- Update documentation as needed
- Ensure all checks pass

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
Copyright (c) 2024 Local Cooks Community

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

## 🙏 Acknowledgements

We extend our gratitude to the amazing open-source community and the following projects:

### Core Technologies
- **[React](https://reactjs.org/)** - UI Library
- **[Express.js](https://expressjs.com/)** - Web Framework
- **[TypeScript](https://www.typescriptlang.org/)** - Type Safety
- **[PostgreSQL](https://www.postgresql.org/)** - Database
- **[TailwindCSS](https://tailwindcss.com/)** - CSS Framework

### UI & Components
- **[shadcn/ui](https://ui.shadcn.com/)** - Component Library
- **[Radix UI](https://www.radix-ui.com/)** - Primitive Components
- **[Lucide React](https://lucide.dev/)** - Icon Library
- **[Framer Motion](https://www.framer.com/motion/)** - Animation Library

### Development Tools
- **[Vite](https://vitejs.dev/)** - Build Tool
- **[Drizzle ORM](https://orm.drizzle.team/)** - Database ORM
- **[React Hook Form](https://react-hook-form.com/)** - Form Library
- **[TanStack Query](https://tanstack.com/query)** - Data Fetching
- **[Zod](https://zod.dev/)** - Schema Validation

### Deployment & Infrastructure
- **[Vercel](https://vercel.com/)** - Deployment Platform
- **[Neon](https://neon.tech/)** - Serverless PostgreSQL

---

<div align="center">

**Made with ❤️ by the Local Cooks Community Team**

[Website](#) | [Documentation](#) | [Support](#) | [Community](#)

**⭐ Star us on GitHub if this project helped you! ⭐**

</div>