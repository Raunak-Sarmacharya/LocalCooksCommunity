# Chef Kitchen Application System - Implementation Plan

## 📋 Overview

This document outlines the comprehensive implementation plan for replacing the "Share Profile" feature with a direct "Apply to Kitchen" system. This change enables chefs to apply directly to individual kitchens without requiring a prior platform-level application.

---

## 🎯 Business Requirements

### Current Flow (Being Replaced)
1. Chef registers → `is_chef=true`
2. Chef submits platform application → `applications` table
3. Admin approves platform application
4. Admin grants location access → `chef_location_access` table
5. Chef "shares profile" with location → `chef_location_profiles` table
6. Manager approves → Chef can book

### New Flow (To Be Implemented)
1. Chef registers → `is_chef=true`
2. Chef browses ALL available kitchens
3. Chef applies directly to a kitchen with full form + documents
4. Manager reviews application and documents
5. Manager approves → Chef can book that kitchen

### Key Changes
| Feature | Old | New |
|---------|-----|-----|
| Platform application | Required | Optional |
| Admin location access grant | Required | Removed |
| "Share Profile" | Click to share existing docs | Full application form |
| Document upload | Once at platform level | Per kitchen |
| Kitchen visibility | After admin grants access | Immediate for logged-in users |

---

## 🗄️ Phase 1: Database Changes

### 1.1 New Table: `chef_kitchen_applications`

```sql
-- Migration: 0013_add_chef_kitchen_applications.sql

-- Create chef_kitchen_applications table
-- This replaces the chef_location_profiles table with a full application workflow
CREATE TABLE IF NOT EXISTS "chef_kitchen_applications" (
  "id" SERIAL PRIMARY KEY,
  "chef_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "location_id" INTEGER NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  
  -- Personal Info (collected per application)
  "full_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  
  -- Business Info
  "kitchen_preference" kitchen_preference NOT NULL,
  "business_description" TEXT,
  "cooking_experience" TEXT,
  
  -- Food Safety License
  "food_safety_license" certification_status NOT NULL,
  "food_safety_license_url" TEXT,
  "food_safety_license_status" document_verification_status DEFAULT 'pending',
  
  -- Food Establishment Certificate (optional)
  "food_establishment_cert" certification_status NOT NULL,
  "food_establishment_cert_url" TEXT,
  "food_establishment_cert_status" document_verification_status DEFAULT 'pending',
  
  -- Application Status
  "status" application_status NOT NULL DEFAULT 'inReview',
  "feedback" TEXT,
  
  -- Manager Review
  "reviewed_by" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" TIMESTAMP,
  
  -- Timestamps
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Ensure one application per chef per location (can re-apply if rejected)
  UNIQUE("chef_id", "location_id")
);

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_chef_id" ON "chef_kitchen_applications"("chef_id");
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_location_id" ON "chef_kitchen_applications"("location_id");
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_status" ON "chef_kitchen_applications"("status");
CREATE INDEX IF NOT EXISTS "idx_chef_kitchen_apps_manager_review" ON "chef_kitchen_applications"("reviewed_by", "status");
```

### 1.2 Schema Definition (shared/schema.ts)

```typescript
// ===== CHEF KITCHEN APPLICATIONS TABLE (NEW) =====
// Direct application to kitchens - replaces chef_location_profiles

export const chefKitchenApplications = pgTable("chef_kitchen_applications", {
  id: serial("id").primaryKey(),
  chefId: integer("chef_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }).notNull(),
  
  // Personal Info
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  
  // Business Info
  kitchenPreference: kitchenPreferenceEnum("kitchen_preference").notNull(),
  businessDescription: text("business_description"),
  cookingExperience: text("cooking_experience"),
  
  // Food Safety License
  foodSafetyLicense: certificationStatusEnum("food_safety_license").notNull(),
  foodSafetyLicenseUrl: text("food_safety_license_url"),
  foodSafetyLicenseStatus: documentVerificationStatusEnum("food_safety_license_status").default("pending"),
  
  // Food Establishment Certificate
  foodEstablishmentCert: certificationStatusEnum("food_establishment_cert").notNull(),
  foodEstablishmentCertUrl: text("food_establishment_cert_url"),
  foodEstablishmentCertStatus: documentVerificationStatusEnum("food_establishment_cert_status").default("pending"),
  
  // Application Status
  status: applicationStatusEnum("status").default("inReview").notNull(),
  feedback: text("feedback"),
  
  // Manager Review
  reviewedBy: integer("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod validation schemas
export const insertChefKitchenApplicationSchema = createInsertSchema(chefKitchenApplications, {
  chefId: z.number(),
  locationId: z.number(),
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: phoneNumberSchema,
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
  businessDescription: z.string().optional(),
  cookingExperience: z.string().optional(),
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodSafetyLicenseUrl: z.string().optional(),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCertUrl: z.string().optional(),
}).omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  feedback: true,
  foodSafetyLicenseStatus: true,
  foodEstablishmentCertStatus: true,
});

export const updateChefKitchenApplicationStatusSchema = z.object({
  id: z.number(),
  status: z.enum(["inReview", "approved", "rejected", "cancelled"]),
  feedback: z.string().optional(),
});

// Type exports
export type ChefKitchenApplication = typeof chefKitchenApplications.$inferSelect;
export type InsertChefKitchenApplication = z.infer<typeof insertChefKitchenApplicationSchema>;
export type UpdateChefKitchenApplicationStatus = z.infer<typeof updateChefKitchenApplicationStatusSchema>;
```

---

## 🔌 Phase 2: Backend API

### 2.1 New Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/chef/kitchen-applications` | POST | Chef | Submit new application |
| `/api/chef/kitchen-applications` | GET | Chef | Get all my applications |
| `/api/chef/available-locations` | GET | Chef | Browse all locations |
| `/api/manager/kitchen-applications` | GET | Manager | Get applications for my locations |
| `/api/manager/kitchen-applications/:id/status` | PUT | Manager | Approve/reject application |

### 2.2 Storage Functions (storage-firebase.ts)

```typescript
// ===== CHEF KITCHEN APPLICATION MANAGEMENT =====

async createChefKitchenApplication(data: InsertChefKitchenApplication): Promise<ChefKitchenApplication> {
  // Check for existing application
  const existing = await db
    .select()
    .from(chefKitchenApplications)
    .where(
      and(
        eq(chefKitchenApplications.chefId, data.chefId),
        eq(chefKitchenApplications.locationId, data.locationId)
      )
    );
  
  if (existing.length > 0) {
    // Allow re-application only if rejected
    if (existing[0].status === 'rejected') {
      // Update existing application
      const [updated] = await db
        .update(chefKitchenApplications)
        .set({
          ...data,
          status: 'inReview',
          reviewedBy: null,
          reviewedAt: null,
          feedback: null,
          updatedAt: new Date(),
        })
        .where(eq(chefKitchenApplications.id, existing[0].id))
        .returning();
      return updated;
    }
    throw new Error('You have already applied to this kitchen');
  }
  
  // Create new application
  const [application] = await db
    .insert(chefKitchenApplications)
    .values(data)
    .returning();
  
  return application;
}

async getChefKitchenApplications(chefId: number): Promise<ChefKitchenApplication[]> {
  return await db
    .select()
    .from(chefKitchenApplications)
    .where(eq(chefKitchenApplications.chefId, chefId))
    .orderBy(desc(chefKitchenApplications.createdAt));
}

async getChefKitchenApplication(chefId: number, locationId: number): Promise<ChefKitchenApplication | undefined> {
  const [application] = await db
    .select()
    .from(chefKitchenApplications)
    .where(
      and(
        eq(chefKitchenApplications.chefId, chefId),
        eq(chefKitchenApplications.locationId, locationId)
      )
    );
  return application;
}

async getManagerKitchenApplications(managerId: number): Promise<any[]> {
  // Get locations managed by this manager
  const managerLocations = await this.getManagerLocations(managerId);
  const locationIds = managerLocations.map(loc => loc.id);
  
  if (locationIds.length === 0) return [];
  
  // Get all applications for these locations
  const applications = await db
    .select()
    .from(chefKitchenApplications)
    .where(inArray(chefKitchenApplications.locationId, locationIds))
    .orderBy(desc(chefKitchenApplications.createdAt));
  
  // Enrich with chef and location details
  const enrichedApplications = await Promise.all(
    applications.map(async (app) => {
      const chef = await this.getUser(app.chefId);
      const location = managerLocations.find(l => l.id === app.locationId);
      return {
        ...app,
        chef: chef ? { id: chef.id, username: chef.username } : null,
        location: location ? { id: location.id, name: location.name, address: location.address } : null,
      };
    })
  );
  
  return enrichedApplications;
}

async updateChefKitchenApplicationStatus(
  applicationId: number,
  status: 'approved' | 'rejected',
  reviewedBy: number,
  feedback?: string
): Promise<ChefKitchenApplication> {
  const [updated] = await db
    .update(chefKitchenApplications)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      feedback: feedback || null,
      updatedAt: new Date(),
    })
    .where(eq(chefKitchenApplications.id, applicationId))
    .returning();
  
  return updated;
}

async hasApprovedKitchenApplication(chefId: number, locationId: number): Promise<boolean> {
  const [application] = await db
    .select()
    .from(chefKitchenApplications)
    .where(
      and(
        eq(chefKitchenApplications.chefId, chefId),
        eq(chefKitchenApplications.locationId, locationId),
        eq(chefKitchenApplications.status, 'approved')
      )
    )
    .limit(1);
  
  return !!application;
}
```

### 2.3 Booking Validation Update (routes.ts)

```typescript
// BEFORE (remove these checks):
// const hasLocationAccess = await firebaseStorage.chefHasLocationAccess(chefId, locationId);
// const profile = await firebaseStorage.getChefLocationProfile(chefId, locationId);

// AFTER (new check):
const hasApproved = await firebaseStorage.hasApprovedKitchenApplication(chefId, kitchenLocationId);
if (!hasApproved) {
  return res.status(403).json({ 
    error: "You don't have an approved application for this kitchen. Please apply first." 
  });
}
```

---

## 🖥️ Phase 3: Frontend Components

### 3.1 New Components

| Component | Path | Purpose |
|-----------|------|---------|
| `KitchenDiscovery.tsx` | `components/chef/KitchenDiscovery.tsx` | Browse all available locations |
| `KitchenApplicationForm.tsx` | `components/chef/KitchenApplicationForm.tsx` | Full application form with doc upload |
| `KitchenApplicationStatus.tsx` | `components/chef/KitchenApplicationStatus.tsx` | Show status badges per location |
| `KitchenApplicationCard.tsx` | `components/chef/KitchenApplicationCard.tsx` | Card displaying location with apply button |

### 3.2 New Hooks

```typescript
// hooks/use-kitchen-applications.ts

export function useKitchenApplications() {
  const queryClient = useQueryClient();
  
  // Get all my applications
  const applicationsQuery = useQuery<ChefKitchenApplication[]>({
    queryKey: ["/api/chef/kitchen-applications"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/kitchen-applications", {
        credentials: "include",
        headers,
      });
      if (!response.ok) throw new Error("Failed to fetch applications");
      return response.json();
    },
  });
  
  // Get all available locations
  const locationsQuery = useQuery({
    queryKey: ["/api/chef/available-locations"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/available-locations", {
        credentials: "include",
        headers,
      });
      if (!response.ok) throw new Error("Failed to fetch locations");
      return response.json();
    },
  });
  
  // Submit application
  const submitApplication = useMutation({
    mutationFn: async (data: InsertChefKitchenApplication) => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/kitchen-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to submit application");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/kitchen-applications"] });
    },
  });
  
  return {
    applications: applicationsQuery.data ?? [],
    locations: locationsQuery.data ?? [],
    isLoadingApplications: applicationsQuery.isLoading,
    isLoadingLocations: locationsQuery.isLoading,
    submitApplication,
    getApplicationStatus: (locationId: number) => {
      return applicationsQuery.data?.find(a => a.locationId === locationId);
    },
  };
}
```

### 3.3 ApplicantDashboard Changes

The `ApplicantDashboard.tsx` will be updated to:
1. Remove references to "Share Profile"
2. Add "Kitchen Discovery" section showing all locations
3. Show application status for each location
4. Add "Apply" button for each location

---

## 🧹 Phase 4: Cleanup & Deprecation

### 4.1 Files to Remove/Deprecate

| File | Action |
|------|--------|
| `pages/ShareProfile.tsx` | DELETE |
| Route `/share-profile` in `App.tsx` | REMOVE |
| `use-chef-kitchen-access.ts` (shareProfile function) | DEPRECATE |

### 4.2 Endpoints to Deprecate

| Endpoint | Action |
|----------|--------|
| `POST /api/chef/share-profile` | DEPRECATE (keep for backward compat) |
| `GET /api/admin/chef-location-access` | DEPRECATE |
| `POST /api/admin/chef-location-access` | DEPRECATE |
| `DELETE /api/admin/chef-location-access` | DEPRECATE |

### 4.3 Database Tables to Deprecate

| Table | Action |
|-------|--------|
| `chef_location_profiles` | KEEP data, stop writing |
| `chef_location_access` | KEEP data, stop writing |

---

## 📊 State Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    CHEF KITCHEN APPLICATION STATES                        │
└──────────────────────────────────────────────────────────────────────────┘

                                 ┌─────────────┐
                                 │  LOGGED IN  │
                                 │   (Chef)    │
                                 └──────┬──────┘
                                        │
                              Can see ALL locations
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
            ┌───────▼───────┐                       ┌───────▼───────┐
            │  NOT APPLIED  │                       │    APPLIED    │
            │ "Apply" btn   │                       │ to Location X │
            └───────┬───────┘                       └───────┬───────┘
                    │                                       │
           Submit Application                    ┌──────────┴──────────┐
           Form + Documents                      ▼                     ▼
                    │                     ┌──────────┐          ┌──────────┐
                    │                     │ PENDING  │          │ APPROVED │
                    │                     │"Waiting" │          │ "Book"   │
                    │                     └────┬─────┘          └────┬─────┘
                    │                          │                     │
                    │                   Manager Reviews       Can Book Kitchen!
                    │                          │
                    │                  ┌───────┴───────┐
                    │                  ▼               ▼
                    │           ┌──────────┐    ┌──────────┐
                    │           │ APPROVED │    │ REJECTED │
                    └──────────►│  "Book"  │    │"Re-apply"│
                                └──────────┘    └─────┬────┘
                                                      │
                                                Re-apply with
                                                new documents
```

---

## 📅 Implementation Order

### Sprint 1: Database & Backend (Days 1-2)
1. ✅ Create migration file
2. ✅ Update schema.ts
3. ✅ Add storage functions
4. ✅ Create new API endpoints
5. ✅ Update booking validation

### Sprint 2: Frontend Components (Days 3-4)
1. ✅ Create KitchenDiscovery component
2. ✅ Create KitchenApplicationForm component
3. ✅ Create hooks/use-kitchen-applications.ts
4. ✅ Update ApplicantDashboard

### Sprint 3: Manager Side (Day 5)
1. ✅ Update ManagerChefProfiles to use new table
2. ✅ Update hooks/use-manager-chef-profiles.ts

### Sprint 4: Cleanup (Day 6)
1. ✅ Remove ShareProfile page
2. ✅ Remove old routes
3. ✅ Deprecate old endpoints
4. ✅ Update navigation links

---

## 🧪 Testing Checklist

### Chef Flow
- [ ] New user can register and immediately see all kitchens
- [ ] Chef can click "Apply" and see full application form
- [ ] Chef can upload documents in application form
- [ ] Application submits successfully
- [ ] Chef sees "Pending" status after submission
- [ ] Chef sees "Approved" status after manager approves
- [ ] Chef can book kitchen after approval
- [ ] Chef can re-apply after rejection

### Manager Flow
- [ ] Manager sees new applications in dashboard
- [ ] Manager can view application details and documents
- [ ] Manager can approve application
- [ ] Manager can reject application with feedback
- [ ] Manager sees updated status after action

### Booking Flow
- [ ] Booking blocked without approved application
- [ ] Booking works with approved application
- [ ] Old approved profiles still work (backward compat)

---

## 🔙 Rollback Plan

If issues arise, the rollback is safe because:
1. Old tables (`chef_location_profiles`, `chef_location_access`) are kept
2. Old endpoints are deprecated but not removed immediately
3. Booking validation can check both old and new tables

```typescript
// Fallback booking validation
const hasNewApproval = await firebaseStorage.hasApprovedKitchenApplication(chefId, locationId);
const hasLegacyApproval = await firebaseStorage.chefHasLocationAccess(chefId, locationId) &&
                          await firebaseStorage.getChefLocationProfile(chefId, locationId)?.status === 'approved';

if (!hasNewApproval && !hasLegacyApproval) {
  return res.status(403).json({ error: "Access denied" });
}
```

---

## 📝 Migration Notes

### Data Migration
Existing approved `chef_location_profiles` entries can be migrated to `chef_kitchen_applications`:
- This is OPTIONAL since we're keeping backward compatibility
- Can be done post-deployment if desired

### Email Notifications
Update email templates:
- "Profile Shared" → "Application Submitted"
- "Profile Approved" → "Kitchen Application Approved"
- "Profile Rejected" → "Kitchen Application Rejected"

---

*Document created: January 8, 2026*
*Last updated: January 8, 2026*

