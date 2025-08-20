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
│ isChef          │         │ kitchenPreference               │
│ isDeliveryPartner│        │ feedback                        │
└─────────────────┘         │ status                          │
                            │ foodSafetyLicenseUrl            │
                            │ foodEstablishmentCertUrl        │
                            │ foodSafetyLicenseStatus         │
                            │ foodEstablishmentCertStatus     │
                            │ documentsAdminFeedback          │
                            │ documentsReviewedBy (FK users)  │
                            │ documentsReviewedAt             │
                            │ createdAt                       │
                            └─────────────────────────────────┘

┌─────────────────┐         ┌─────────────────────────────────┐
│     users       │         │ delivery_partner_applications   │
├─────────────────┤         ├─────────────────────────────────┤
│ id (PK)         │◄────────┤ userId (FK)                     │
│ username        │         │ id (PK)                         │
│ password        │         │ fullName                        │
│ role            │         │ email                           │
│ googleId        │         │ phone                           │
│ facebookId      │         │ address                         │
│ isVerified      │         │ city                            │
│ isChef          │         │ province                        │
│ isDeliveryPartner│        │ postalCode                      │
└─────────────────┘         │ vehicleType                     │
                            │ vehicleMake                     │
                            │ vehicleModel                    │
                            │ vehicleYear                     │
                            │ licensePlate                    │
                            │ driversLicenseUrl               │
                            │ vehicleRegistrationUrl          │
                            │ insuranceUrl                    │
                            │ driversLicenseStatus            │
                            │ vehicleRegistrationStatus       │
                            │ insuranceStatus                 │
                            │ documentsAdminFeedback          │
                            │ documentsReviewedBy (FK users)  │
                            │ documentsReviewedAt             │
                            │ feedback                        │
                            │ status                          │
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
| `isChef` | `BOOLEAN` | Whether user has chef role | `DEFAULT false`, `NOT NULL` |
| `isDeliveryPartner` | `BOOLEAN` | Whether user has delivery partner role | `DEFAULT false`, `NOT NULL` |

### User Roles
- **`applicant`** (default) - Can submit applications, view own applications
- **`admin`** - Can view all applications, approve/reject, verify documents

### Role-Based Access
- **`isChef: true`** - User can access chef features and training
- **`isDeliveryPartner: true`** - User can access delivery partner features
- **Dual Role** - Users can have both roles for comprehensive access

## 📝 Applications Table

### Drizzle Schema

```typescript
export const kitchenPreferenceEnum = pgEnum('kitchen_preference', ['commercial', 'home', 'notSure']);
export const certificationStatusEnum = pgEnum('certification_status', ['yes', 'no', 'notSure']);
export const applicationStatusEnum = pgEnum('application_status', ['inReview', 'approved', 'rejected', 'cancelled']);
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
  status: applicationStatusEnum("status").default("inReview").notNull(),
  
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
| `status` | Application status | `inReview`, `approved`, `rejected`, `cancelled` |
| `foodSafetyLicense` | Has food safety license? | `yes`, `no`, `notSure` |
| `foodEstablishmentCert` | Has establishment cert? | `yes`, `no`, `notSure` |
| `kitchenPreference` | Kitchen preference | `commercial`, `home`, `notSure` |
| `foodSafetyLicenseStatus` | Document verification status | `pending`, `approved`, `rejected` |
| `foodEstablishmentCertStatus` | Document verification status | `pending`, `approved`, `rejected` |

### Application Status Flow
1. **`inReview`** - Being reviewed by admin
2. **`approved`** - Application approved
3. **`rejected`** - Application rejected
4. **`cancelled`** - Cancelled by applicant

### Document Verification Status
- **`pending`** - Document uploaded, awaiting admin review
- **`approved`** - Document verified and approved
- **`rejected`** - Document rejected, needs resubmission

## 🚚 Delivery Partner Applications Table

### Drizzle Schema

```typescript
export const vehicleTypeEnum = pgEnum('vehicle_type', ['car', 'motorcycle', 'van', 'truck']);
export const deliveryApplicationStatusEnum = pgEnum('delivery_application_status', ['inReview', 'approved', 'rejected', 'cancelled']);

export const deliveryPartnerApplications = pgTable("delivery_partner_applications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  province: text("province").notNull(),
  postalCode: text("postal_code").notNull(),
  vehicleType: vehicleTypeEnum("vehicle_type").notNull(),
  vehicleMake: text("vehicle_make").notNull(),
  vehicleModel: text("vehicle_model").notNull(),
  vehicleYear: integer("vehicle_year").notNull(),
  licensePlate: text("license_plate").notNull(),
  
  // Document URLs
  driversLicenseUrl: text("drivers_license_url"),
  vehicleRegistrationUrl: text("vehicle_registration_url"),
  insuranceUrl: text("insurance_url"),
  
  // Document verification status
  driversLicenseStatus: documentVerificationStatusEnum("drivers_license_status").default("pending"),
  vehicleRegistrationStatus: documentVerificationStatusEnum("vehicle_registration_status").default("pending"),
  insuranceStatus: documentVerificationStatusEnum("insurance_status").default("pending"),
  
  // Admin review fields
  documentsAdminFeedback: text("documents_admin_feedback"),
  documentsReviewedBy: integer("documents_reviewed_by").references(() => users.id),
  documentsReviewedAt: timestamp("documents_reviewed_at"),
  
  feedback: text("feedback"),
  status: deliveryApplicationStatusEnum("status").default("inReview").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Field Descriptions

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | `SERIAL` | Primary key, auto-incrementing | `PRIMARY KEY` |
| `userId` | `INTEGER` | Foreign key to users table | `REFERENCES users(id)` |
| `fullName` | `TEXT` | Applicant's full name | `NOT NULL` |
| `email` | `TEXT` | Contact email address | `NOT NULL` |
| `phone` | `TEXT` | Contact phone number | `NOT NULL` |
| `address` | `TEXT` | Street address | `NOT NULL` |
| `city` | `TEXT` | City | `NOT NULL` |
| `province` | `TEXT` | Province/State | `NOT NULL` |
| `postalCode` | `TEXT` | Postal/ZIP code | `NOT NULL` |
| `vehicleType` | `vehicle_type` | Type of vehicle | `NOT NULL` |
| `vehicleMake` | `TEXT` | Vehicle manufacturer | `NOT NULL` |
| `vehicleModel` | `TEXT` | Vehicle model | `NOT NULL` |
| `vehicleYear` | `INTEGER` | Vehicle year | `NOT NULL` |
| `licensePlate` | `TEXT` | License plate number | `NOT NULL` |
| `driversLicenseUrl` | `TEXT` | URL to uploaded driver's license | nullable |
| `vehicleRegistrationUrl` | `TEXT` | URL to uploaded vehicle registration | nullable |
| `insuranceUrl` | `TEXT` | URL to uploaded insurance document | nullable |
| `driversLicenseStatus` | `document_verification_status` | Driver's license verification status | `DEFAULT 'pending'` |
| `vehicleRegistrationStatus` | `document_verification_status` | Vehicle registration verification status | `DEFAULT 'pending'` |
| `insuranceStatus` | `document_verification_status` | Insurance verification status | `DEFAULT 'pending'` |
| `documentsAdminFeedback` | `TEXT` | Admin feedback on documents | nullable |
| `documentsReviewedBy` | `INTEGER` | Admin who reviewed documents | `REFERENCES users(id)`, nullable |
| `documentsReviewedAt` | `TIMESTAMP` | When documents were reviewed | nullable |
| `feedback` | `TEXT` | Admin feedback (if rejected) | nullable |
| `status` | `delivery_application_status` | Current application status | `DEFAULT 'inReview'`, `NOT NULL` |
| `createdAt` | `TIMESTAMP` | When application was created | `DEFAULT NOW()`, `NOT NULL` |

### Key Fields

| Field | Description | Possible Values |
|-------|-------------|-----------------|
| `status` | Application status | `inReview`, `approved`, `rejected`, `cancelled` |
| `vehicleType` | Type of vehicle | `car`, `motorcycle`, `van`, `truck` |
| `driversLicenseStatus` | Driver's license verification | `pending`, `approved`, `rejected` |
| `vehicleRegistrationStatus` | Vehicle registration verification | `pending`, `approved`, `rejected` |
| `insuranceStatus` | Insurance verification | `pending`, `approved`, `rejected` |

### Application Status Flow
1. **`inReview`** - Being reviewed by admin
2. **`approved`** - Application approved
3. **`rejected`** - Application rejected
4. **`cancelled`** - Cancelled by applicant

## 🔗 Relationships

### Foreign Key Constraints

```sql
-- Applications belong to users
applications.user_id → users.id

-- Document reviewer is a user (admin)
applications.documents_reviewed_by → users.id

-- Delivery partner applications belong to users
delivery_partner_applications.user_id → users.id

-- Document reviewer is a user (admin)
delivery_partner_applications.documents_reviewed_by → users.id
```

### Relationship Types

1. **User → Applications** (One-to-Many)
   - One user can have multiple chef applications
   - Each application belongs to exactly one user

2. **User → Delivery Partner Applications** (One-to-Many)
   - One user can have multiple delivery partner applications
   - Each delivery partner application belongs to exactly one user

3. **Admin → Document Reviews** (One-to-Many)
   - One admin can review many applications' documents
   - Each document review is done by one admin

4. **User → Roles** (Many-to-Many)
   - Users can have multiple roles (chef, delivery partner)
   - Roles are stored as boolean flags in the users table

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
SELECT * FROM applications WHERE status = 'inReview' ORDER BY created_at ASC;

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
CREATE TYPE application_status AS ENUM ('inReview', 'approved', 'rejected', 'cancelled');
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
  status application_status DEFAULT 'inReview' NOT NULL,
  
  food_safety_license_url TEXT,
  food_establishment_cert_url TEXT,
  food_safety_license_status document_verification_status DEFAULT 'pending',
  food_establishment_cert_status document_verification_status DEFAULT 'pending',
  documents_admin_feedback TEXT,
  documents_reviewed_by INTEGER REFERENCES users(id),
  documents_reviewed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create delivery partner applications table
CREATE TABLE delivery_partner_applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  province TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  vehicle_type vehicle_type NOT NULL,
  vehicle_make TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  vehicle_year INTEGER NOT NULL,
  license_plate TEXT NOT NULL,
  
  drivers_license_url TEXT,
  vehicle_registration_url TEXT,
  insurance_url TEXT,
  drivers_license_status document_verification_status DEFAULT 'pending',
  vehicle_registration_status document_verification_status DEFAULT 'pending',
  insurance_status document_verification_status DEFAULT 'pending',
  
  documents_admin_feedback TEXT,
  documents_reviewed_by INTEGER REFERENCES users(id),
  documents_reviewed_at TIMESTAMP,
  
  feedback TEXT,
  status delivery_application_status DEFAULT 'inReview' NOT NULL,
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