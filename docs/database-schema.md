# 🗄️ Database Schema

Complete database schema documentation for the Local Cooks application using **PostgreSQL** with **Drizzle ORM**.

## 🎯 Overview

The database consists of two main tables:
- **`users`** - User accounts (applicants and admins)
- **`applications`** - Application submissions with document verification

The schema supports:
- **User Management** (local accounts + OAuth)
- **Application Lifecycle** (submission → review → approval)
- **Document Verification** (upload → admin review → status)
- **Role-Based Access** (applicant vs admin permissions)

---

## 📊 Database Diagram

```
┌─────────────────┐         ┌─────────────────────────────────┐
│     users       │         │         applications            │
├─────────────────┤         ├─────────────────────────────────┤
│ id (PK)         │◄────────┤ userId (FK)                     │
│ username        │         │ id (PK)                         │
│ password        │         │ fullName                        │
│ role            │         │ email                           │
│ googleId        │         │ phone                           │
│ facebookId      │         │ foodSafetyLicense               │
│ isVerified      │         │ foodEstablishmentCert           │
└─────────────────┘         │ kitchenPreference               │
                            │ feedback                        │
                            │ status                          │
                            │ foodSafetyLicenseUrl            │
                            │ foodEstablishmentCertUrl        │
                            │ foodSafetyLicenseStatus         │
                            │ foodEstablishmentCertStatus     │
                            │ documentsAdminFeedback          │
                            │ documentsReviewedBy (FK users)  │
                            │ documentsReviewedAt             │
                            │ createdAt                       │
                            └─────────────────────────────────┘
```

## 👥 Users Table

### Drizzle Schema

```typescript
export const userRoleEnum = pgEnum('user_role', ['admin', 'applicant']);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").default("applicant").notNull(),
  googleId: text("google_id").unique(),
  facebookId: text("facebook_id").unique(),
  isVerified: boolean("is_verified").default(false).notNull(),
});
```

### Field Descriptions

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | `SERIAL` | Primary key, auto-incrementing | `PRIMARY KEY` |
| `username` | `TEXT` | Email address used for login | `NOT NULL`, `UNIQUE` |
| `password` | `TEXT` | Hashed password (bcrypt) | `NOT NULL` |
| `role` | `user_role` | User permission level | `DEFAULT 'applicant'`, `NOT NULL` |
| `googleId` | `TEXT` | Google OAuth ID (if OAuth user) | `UNIQUE`, nullable |
| `facebookId` | `TEXT` | Facebook OAuth ID (if OAuth user) | `UNIQUE`, nullable |
| `isVerified` | `BOOLEAN` | Whether user account is verified | `DEFAULT false`, `NOT NULL` |

### User Roles
- **`applicant`** (default) - Can submit applications, view own applications
- **`admin`** - Can view all applications, approve/reject, verify documents

## 📝 Applications Table

### Drizzle Schema

```typescript
export const kitchenPreferenceEnum = pgEnum('kitchen_preference', ['commercial', 'home', 'notSure']);
export const certificationStatusEnum = pgEnum('certification_status', ['yes', 'no', 'notSure']);
export const applicationStatusEnum = pgEnum('application_status', ['new', 'inReview', 'approved', 'rejected', 'cancelled']);
export const documentVerificationStatusEnum = pgEnum('document_verification_status', ['pending', 'approved', 'rejected']);

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  foodSafetyLicense: certificationStatusEnum("food_safety_license").notNull(),
  foodEstablishmentCert: certificationStatusEnum("food_establishment_cert").notNull(),
  kitchenPreference: kitchenPreferenceEnum("kitchen_preference").notNull(),
  feedback: text("feedback"),
  status: applicationStatusEnum("status").default("new").notNull(),
  
  // Document verification fields
  foodSafetyLicenseUrl: text("food_safety_license_url"),
  foodEstablishmentCertUrl: text("food_establishment_cert_url"),
  foodSafetyLicenseStatus: documentVerificationStatusEnum("food_safety_license_status").default("pending"),
  foodEstablishmentCertStatus: documentVerificationStatusEnum("food_establishment_cert_status").default("pending"),
  documentsAdminFeedback: text("documents_admin_feedback"),
  documentsReviewedBy: integer("documents_reviewed_by").references(() => users.id),
  documentsReviewedAt: timestamp("documents_reviewed_at"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Key Fields

| Field | Description | Possible Values |
|-------|-------------|-----------------|
| `status` | Application status | `new`, `inReview`, `approved`, `rejected`, `cancelled` |
| `foodSafetyLicense` | Has food safety license? | `yes`, `no`, `notSure` |
| `foodEstablishmentCert` | Has establishment cert? | `yes`, `no`, `notSure` |
| `kitchenPreference` | Kitchen preference | `commercial`, `home`, `notSure` |
| `foodSafetyLicenseStatus` | Document verification status | `pending`, `approved`, `rejected` |
| `foodEstablishmentCertStatus` | Document verification status | `pending`, `approved`, `rejected` |

### Application Status Flow
1. **`new`** - Just submitted, needs initial review
2. **`inReview`** - Being reviewed by admin
3. **`approved`** - Application approved
4. **`rejected`** - Application rejected
5. **`cancelled`** - Cancelled by applicant

### Document Verification Status
- **`pending`** - Document uploaded, awaiting admin review
- **`approved`** - Document verified and approved
- **`rejected`** - Document rejected, needs resubmission

## 🔗 Relationships

### Foreign Key Constraints

```sql
-- Applications belong to users
applications.user_id → users.id

-- Document reviewer is a user (admin)
applications.documents_reviewed_by → users.id
```

### Relationship Types

1. **User → Applications** (One-to-Many)
   - One user can have multiple applications
   - Each application belongs to exactly one user

2. **Admin → Document Reviews** (One-to-Many)
   - One admin can review many applications' documents
   - Each document review is done by one admin

## 📋 Validation Rules

### Zod Schemas

```typescript
// Application insertion schema
export const insertApplicationSchema = createInsertSchema(applications, {
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().regex(/^\+?[0-9\s\(\)-]{10,15}$/, "Please enter a valid phone number"),
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
  feedback: z.string().optional(),
});

// User insertion schema
export const insertUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "applicant"]).default("applicant"),
  googleId: z.string().optional(),
  facebookId: z.string().optional(),
});
```

### Database Constraints

- **Unique usernames** - Prevents duplicate accounts
- **Unique OAuth IDs** - Prevents OAuth account conflicts
- **Required fields** - Essential data must be provided
- **Enum constraints** - Only valid enum values accepted
- **Foreign key constraints** - Referential integrity maintained

## 🔍 Common Queries

### User Management

```sql
-- Find user by username (login)
SELECT * FROM users WHERE username = 'user@example.com';

-- Find OAuth user
SELECT * FROM users WHERE google_id = '1234567890';

-- Get all admins
SELECT * FROM users WHERE role = 'admin';
```

### Application Management

```sql
-- Get user's applications
SELECT * FROM applications WHERE user_id = 123 ORDER BY created_at DESC;

-- Get pending applications for admin review
SELECT * FROM applications WHERE status = 'new' ORDER BY created_at ASC;

-- Get applications with pending document verification
SELECT * FROM applications 
WHERE food_safety_license_status = 'pending' 
   OR food_establishment_cert_status = 'pending';

-- Get application with user details
SELECT a.*, u.username, u.role 
FROM applications a 
JOIN users u ON a.user_id = u.id 
WHERE a.id = 123;
```

### Document Verification

```sql
-- Applications needing document review
SELECT a.*, u.username
FROM applications a
JOIN users u ON a.user_id = u.id
WHERE (a.food_safety_license_url IS NOT NULL AND a.food_safety_license_status = 'pending')
   OR (a.food_establishment_cert_url IS NOT NULL AND a.food_establishment_cert_status = 'pending');
```

## 🔧 Setup & Migrations

### Manual Schema Creation

```sql
-- Create enums
CREATE TYPE user_role AS ENUM ('admin', 'applicant');
CREATE TYPE kitchen_preference AS ENUM ('commercial', 'home', 'notSure');
CREATE TYPE certification_status AS ENUM ('yes', 'no', 'notSure');
CREATE TYPE application_status AS ENUM ('new', 'inReview', 'approved', 'rejected', 'cancelled');
CREATE TYPE document_verification_status AS ENUM ('pending', 'approved', 'rejected');

-- Create users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role user_role DEFAULT 'applicant' NOT NULL,
  google_id TEXT UNIQUE,
  facebook_id TEXT UNIQUE,
  is_verified BOOLEAN DEFAULT false NOT NULL
);

-- Create applications table
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
  
  food_safety_license_url TEXT,
  food_establishment_cert_url TEXT,
  food_safety_license_status document_verification_status DEFAULT 'pending',
  food_establishment_cert_status document_verification_status DEFAULT 'pending',
  documents_admin_feedback TEXT,
  documents_reviewed_by INTEGER REFERENCES users(id),
  documents_reviewed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create default admin user
INSERT INTO users (username, password, role, is_verified) VALUES 
('admin', '$2b$10$TwIWWWyGEHF9IJIO4xQ9X.qSTgb5M0wDL1OhnjWH2LhGPRDl/wbu2', 'admin', true);
```

## 🔒 Security Considerations

### Data Protection
- **Passwords**: Hashed with bcrypt (never stored in plain text)
- **Session Data**: Stored securely with express-session
- **File URLs**: Vercel Blob URLs are public but hard to guess
- **Admin Access**: Role-based access control

### Privacy Compliance
- **PII Fields**: `full_name`, `email`, `phone`, `feedback`
- **Data Retention**: Consider implementing data retention policies
- **GDPR Compliance**: Support for data export/deletion if required

### Access Patterns
- **Applicants** can only see their own applications
- **Admins** can see all applications and user data
- **Document access** restricted to admins only
- **OAuth data** kept minimal (just ID for linking)

## 📊 Performance & Indexing

### Recommended Indexes

```sql
-- Performance indexes (auto-created for primary/foreign keys)
CREATE INDEX idx_applications_user_id ON applications(user_id);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_created_at ON applications(created_at);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_facebook_id ON users(facebook_id);
```

### Query Performance
- **User lookup by username**: Very fast (indexed, unique)
- **OAuth user lookup**: Fast (indexed OAuth IDs)
- **Applications by user**: Fast (foreign key indexed)
- **Applications by status**: Fast (status indexed)
- **Recent applications**: Fast (created_at indexed)

---

This schema supports the complete Local Cooks application workflow from user registration through application submission to admin review and approval! 🎯 