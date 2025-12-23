# Continuation Prompt for Storage & Equipment Platform (Updated)

Use this prompt when starting a new chat to continue the implementation of the Storage, Equipment & Pricing Payment Platform.

---

## Context & Current State

I'm working on a comprehensive booking platform that extends kitchen bookings with storage and equipment rental capabilities. The system uses:

- **Tech Stack**: React (TypeScript), Express.js, PostgreSQL with Drizzle ORM, Neon database, Vercel deployment
- **Authentication**: Firebase Auth for chefs, Session-based for managers/admins
- **File Storage**: Vercel Blob
- **Architecture**: Serverless-compatible, follows existing patterns in codebase

## ✅ Completed Work

### Phase 1.1: Kitchen Pricing
- ✅ Added pricing fields to `kitchens` table: `hourlyRate`, `currency`, `minimumBookingHours`, `pricingModel`
- ✅ Created migration: `migrations/0005_add_kitchen_pricing_fields.sql`
- ✅ Created API endpoints: `GET/PUT /api/manager/kitchens/:kitchenId/pricing`
- ✅ Created UI: `client/src/pages/KitchenPricingManagement.tsx`
- ✅ Integrated into Manager Dashboard

### Phase 1.2: Storage Listings
- ✅ Created `storage_listings` table with all specifications
- ✅ Created enums: `storage_type`, `storage_pricing_model`, `listing_status`, `booking_duration_unit`
- ✅ Flexible booking duration: `minimumBookingDuration` (integer) + `bookingDurationUnit` (hourly/daily/monthly)
- ✅ Removed tiered pricing from enum and schema
- ✅ Currency locked to CAD (not user-selectable)
- ✅ Created migrations: `0006_add_storage_listings_table.sql`, `0007_update_storage_listings_booking_duration.sql`, `0008_add_daily_to_pricing_model_enum.sql`
- ✅ Created CRUD API endpoints for managers (in `server/routes.ts` and `api/index.js`)
- ✅ Created UI: `client/src/pages/StorageListingManagement.tsx` (multi-step form)
- ✅ Integrated into Manager Dashboard

### Phase 1.3: Equipment Listings (COMPLETED IN THIS CHAT)
- ✅ Created `equipment_listings` table with all specifications
- ✅ Created enums: `equipment_category`, `equipment_condition`, `equipment_pricing_model`, `equipment_availability_type`
- ✅ **CRITICAL CHANGE**: Equipment has `availability_type` enum:
  - `'included'` = Free with kitchen booking (no pricing required)
  - `'rental'` = Paid addon during kitchen booking (pricing required)
- ✅ **CRITICAL CHANGE**: Removed delivery/pickup fields (`delivery_available`, `delivery_fee`, `setup_fee`, `pickup_required`) - equipment stays in kitchen
- ✅ Created migration: `0009_add_equipment_listings_table.sql` (applied via MCP Neon)
- ✅ Created CRUD API endpoints for managers (in `server/routes.ts` and `api/index.js`)
- ✅ Created UI: `client/src/pages/EquipmentListingManagement.tsx` (multi-step form with availability_type selector)
- ✅ Integrated into Manager Dashboard
- ✅ **Tested**: User confirmed equipment listing creation and deletion works

## 🚨 CRITICAL BUSINESS RULES (MUST FOLLOW)

### 1. Storage & Equipment Booking Restriction
**CRITICAL**: Storage and equipment can **ONLY** be booked as part of a kitchen booking. They **CANNOT** be booked individually/standalone.

- ❌ **NO** standalone storage booking page
- ❌ **NO** standalone equipment booking page  
- ❌ **NO** `/api/chef/storage-bookings` endpoint (standalone)
- ❌ **NO** `/api/chef/equipment-bookings` endpoint (standalone)
- ✅ Storage/equipment selection happens **DURING** kitchen booking flow
- ✅ `storage_bookings` table must have `kitchen_booking_id` foreign key (required, not nullable)
- ✅ `equipment_bookings` table must have `kitchen_booking_id` foreign key (required, not nullable)

### 2. Equipment Availability Types
**CRITICAL**: Equipment has two types:

- **`'included'`**: Free with kitchen booking
  - No pricing fields required
  - Automatically available when kitchen is booked
  - Shown in kitchen booking UI as "Included Equipment"
  - No booking record needed (just listed as available)
  
- **`'rental'`**: Paid addon during kitchen booking
  - Pricing fields required (`pricingModel`, rates, etc.)
  - Chef must explicitly add to cart during kitchen booking
  - Creates `equipment_bookings` record with pricing
  - Only rental equipment can be booked

### 3. Equipment Location
**CRITICAL**: Equipment stays in the kitchen - no delivery/pickup.

- ❌ **NO** `delivery_available`, `delivery_fee`, `setup_fee`, `pickup_required` fields
- ✅ Equipment is always at the kitchen location
- ✅ Chefs use equipment during their kitchen booking time

## Critical Implementation Patterns

### 1. Numeric Type Handling (CRITICAL)
**Problem**: Drizzle ORM's `numeric` type causes issues with type conversion.

**Solution Pattern** (established by user):
- **When READING from database**: Use direct `pool.query()` with `::text` casting:
  ```typescript
  const result = await pool.query(`
    SELECT base_price::text as base_price, ...
    FROM storage_listings WHERE id = $1
  `, [id]);
  const priceDollars = parseFloat(result.rows[0].base_price) / 100;
  ```
- **When WRITING to database**: Convert dollars to cents, store as string:
  ```typescript
  const priceCents = Math.round(priceDollars * 100);
  await db.insert(storageListings).values({
    basePrice: priceCents.toString(), // Store as string
    ...
  });
  ```
- **API Layer**: Always return dollar values, never convert twice
- **Storage Layer**: Handle all conversions (cents ↔ dollars)

### 2. Database Migrations
- **Pattern**: Use direct SQL migrations with Node.js scripts (NOT drizzle-kit push)
- **Reason**: Avoids interactive prompts and numeric type issues
- **Location**: `migrations/000X_description.sql` + `scripts/apply-*.js`
- **Scripts**: Added to `package.json` as `db:apply-*` commands
- **IMPORTANT**: User expects assistant to apply migrations via MCP Neon, not manually

### 3. API Endpoint Duplication
- **Pattern**: Must update BOTH `server/routes.ts` (TypeScript) AND `api/index.js` (JavaScript for Vercel)
- **Reason**: Vercel uses `api/index.js` for serverless deployment
- **Always**: Keep both files in sync

### 4. Currency & Pricing
- **Currency**: Always CAD (locked, not user-selectable)
- **Storage**: All prices in cents (integers) in database, dollars in API/UI
- **Conversion**: Dollars → Cents (×100) when storing, Cents → Dollars (÷100) when reading

## Next Steps (Priority Order)

### Phase 1.4: Kitchen Bookings Enhancement (NEXT)
1. Add pricing fields to `kitchen_bookings` table:
   - `totalPrice` (numeric) - Total booking price in cents
   - `hourlyRate` (numeric) - Rate used for this booking (in cents)
   - `durationHours` (numeric) - Calculated duration (decimal for partial hours)
   - `storageItems` (jsonb) - Array of storage booking IDs: `[{storageBookingId: 1, storageListingId: 5}]`
   - `equipmentItems` (jsonb) - Array of equipment booking IDs: `[{equipmentBookingId: 2, equipmentListingId: 8}]`
   - `paymentStatus` (paymentStatusEnum) - Payment status
   - `paymentIntentId` (text) - Stripe PaymentIntent ID (nullable, unique)
   - `damageDeposit` (numeric) - Damage deposit amount (in cents)
   - `serviceFee` (numeric) - Platform commission (in cents)
   - `currency` (text, default: 'CAD')
2. Create `payment_status` enum: `['pending', 'paid', 'refunded', 'failed', 'partially_refunded']`
3. Update booking creation API to calculate and store prices
4. Update UI to display pricing

### Phase 1.5: Storage Bookings Table
1. Create `storage_bookings` table
2. **CRITICAL**: Must include `kitchen_booking_id` (integer, NOT NULL, foreign key to `kitchen_bookings.id`)
3. Fields: `id`, `storage_listing_id`, `chef_id`, `kitchen_booking_id` (required), `start_date`, `end_date`, `status`, `total_price`, `pricing_model`, `payment_status`, `payment_intent_id`, `service_fee`, `currency`, `created_at`, `updated_at`
4. Foreign key: `kitchen_booking_id` → `kitchen_bookings.id` (CASCADE delete)

### Phase 1.6: Equipment Bookings Table
1. Create `equipment_bookings` table
2. **CRITICAL**: Must include `kitchen_booking_id` (integer, NOT NULL, foreign key to `kitchen_bookings.id`)
3. **CRITICAL**: Only rental equipment (`availability_type='rental'`) can be booked - included equipment doesn't need booking records
4. Fields: `id`, `equipment_listing_id`, `chef_id`, `kitchen_booking_id` (required), `start_date`, `end_date`, `status`, `total_price`, `pricing_model`, `damage_deposit`, `payment_status`, `payment_intent_id`, `service_fee`, `currency`, `created_at`, `updated_at`
5. Foreign key: `kitchen_booking_id` → `kitchen_bookings.id` (CASCADE delete)
6. **NO** delivery/pickup fields (equipment stays in kitchen)

### Phase 1.7: Payment Transactions Table
1. Create `payment_transactions` table
2. Create `transaction_status` enum: `['pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'cancelled']`
3. Create `booking_type_enum`: `['kitchen', 'storage', 'equipment', 'bundle']`
4. Fields: `id`, `booking_id`, `booking_type`, `chef_id`, `amount`, `currency`, `payment_intent_id`, `payment_method_id`, `status`, `platform_fee`, `host_payout`, `refund_amount`, `refund_reason`, `metadata`, `created_at`, `updated_at`

### Phase 2: Booking Flow Integration
1. Update `KitchenBookingCalendar.tsx` to:
   - Display hourly rates and total price calculations
   - Show available storage listings for selected kitchen
   - Show available equipment listings (both included and rental)
   - Allow chefs to add storage/equipment to booking cart
   - Calculate total price including storage/equipment rentals
2. Create/Update `BookingCheckout.tsx`:
   - Show kitchen booking details
   - Show selected storage items
   - Show selected equipment items (rental only)
   - Show included equipment (informational, no charge)
   - Total pricing breakdown
   - Payment integration ready
3. Create pricing calculation service:
   - Calculate kitchen booking price (hourly rate × duration)
   - Calculate storage booking price (based on pricing model)
   - Calculate equipment booking price (based on pricing model)
   - Calculate total booking price (kitchen + storage + equipment)
   - Calculate platform commission

## Important Files & Locations

### Schema & Database
- `shared/schema.ts` - All table definitions, enums, Zod schemas
- `migrations/` - SQL migration files
- `scripts/apply-*.js` - Migration application scripts

### Backend
- `server/storage-firebase.ts` - Database operations (use direct SQL for numeric fields)
- `server/routes.ts` - TypeScript API endpoints
- `api/index.js` - JavaScript API endpoints (Vercel serverless)

### Frontend
- `client/src/pages/ManagerBookingDashboard.tsx` - Manager dashboard
- `client/src/pages/StorageListingManagement.tsx` - Storage listing form (reference)
- `client/src/pages/EquipmentListingManagement.tsx` - Equipment listing form (reference)
- `client/src/pages/KitchenBookingCalendar.tsx` - Kitchen booking (needs enhancement)

## Key Requirements

1. **Use MCP Context7** for library documentation (Drizzle ORM, PostgreSQL, React patterns)
2. **Use MCP Firecrawl** for web research when needed
3. **Use MCP Neon** to apply database migrations (user expects assistant to handle migrations)
4. **Follow existing patterns** - don't reinvent, match codebase style
5. **Test on localhost** - each feature should be testable before moving to next
6. **Handle numeric types correctly** - always use direct SQL queries with `::text` casting for numeric fields
7. **Keep API files in sync** - update both `server/routes.ts` and `api/index.js`
8. **Complete features thoroughly** - don't leave partial implementations
9. **CRITICAL**: Storage and equipment can ONLY be booked during kitchen booking - no standalone pages/endpoints
10. **CRITICAL**: Equipment has two types (included vs rental) - handle accordingly

## Execution Plan Reference

The full updated execution plan is located at:
`c:\Users\rauna\.cursor\plans\storage_equipment_pricing_payment_platform_9301e5d1.plan.md`

## Current Database State

- ✅ `kitchens` table has pricing fields
- ✅ `storage_listings` table exists with flexible booking duration
- ✅ `equipment_listings` table exists with `availability_type` enum
- ✅ Enums: `storage_type`, `storage_pricing_model`, `listing_status`, `booking_duration_unit`, `equipment_category`, `equipment_condition`, `equipment_pricing_model`, `equipment_availability_type`
- ⏳ `kitchen_bookings` table - needs pricing fields added
- ⏳ `storage_bookings` table - NOT YET CREATED (must include `kitchen_booking_id`)
- ⏳ `equipment_bookings` table - NOT YET CREATED (must include `kitchen_booking_id`)
- ⏳ `payment_transactions` table - NOT YET CREATED
- ⏳ `payment_status` enum - NOT YET CREATED

## Testing Checklist

After implementing each feature:
- [ ] Test on localhost
- [ ] Verify database migrations applied correctly (via MCP Neon)
- [ ] Check API endpoints work (both TypeScript and JavaScript versions)
- [ ] Verify UI components render and function
- [ ] Test numeric conversions (cents ↔ dollars)
- [ ] Verify enum values work correctly
- [ ] Check error handling
- [ ] Verify storage/equipment can ONLY be booked during kitchen booking
- [ ] Verify included equipment shows as free, rental equipment shows pricing

---

## Summary of Changes Made in This Chat

1. **Equipment Listings Completed**:
   - Added `availability_type` enum ('included' vs 'rental')
   - Removed delivery/pickup fields (equipment stays in kitchen)
   - Made pricing fields conditional (only for rental equipment)
   - Updated UI to show availability type selector
   - Pricing step only shown for rental equipment

2. **Business Rules Clarified**:
   - Storage and equipment can ONLY be booked as part of kitchen booking
   - No standalone booking pages or endpoints
   - Equipment stays in kitchen (no delivery/pickup)
   - Included equipment is free, rental equipment is paid addon

3. **Next Steps**:
   - Phase 1.4: Enhance kitchen_bookings table with pricing fields
   - Phase 1.5: Create storage_bookings table (with kitchen_booking_id)
   - Phase 1.6: Create equipment_bookings table (with kitchen_booking_id)
   - Phase 1.7: Create payment_transactions table
   - Phase 2: Integrate storage/equipment selection into kitchen booking flow

---

**Start by reading the plan file and understanding the current state, then proceed with Phase 1.4: Kitchen Bookings Enhancement.**

