# Continuation Prompt for Storage & Equipment Platform

Use this prompt when starting a new chat to continue the implementation of the Storage, Equipment & Pricing Payment Platform.

---

## Context & Current State

I'm working on a comprehensive booking platform that extends kitchen bookings with storage and equipment rental capabilities. The system uses:

- **Tech Stack**: React (TypeScript), Express.js, PostgreSQL with Drizzle ORM, Neon database, Vercel deployment
- **Authentication**: Firebase Auth for chefs, Session-based for managers/admins
- **File Storage**: Vercel Blob
- **Architecture**: Serverless-compatible, follows existing patterns in codebase

## Completed Work (Phase 1.1 & 1.2)

### ✅ Phase 1.1: Kitchen Pricing
- Added pricing fields to `kitchens` table: `hourlyRate`, `currency`, `minimumBookingHours`, `pricingModel`
- Created migration: `migrations/0005_add_kitchen_pricing_fields.sql`
- Created API endpoints: `GET/PUT /api/manager/kitchens/:kitchenId/pricing`
- Created UI: `client/src/pages/KitchenPricingManagement.tsx`
- Integrated into Manager Dashboard

### ✅ Phase 1.2: Storage Listings (with updates)
- Created `storage_listings` table with all specifications
- Created enums: `storage_type`, `storage_pricing_model`, `listing_status`, `booking_duration_unit`
- **Updates Applied**:
  - Flexible booking duration: `minimumBookingDuration` (integer) + `bookingDurationUnit` (hourly/daily/monthly)
  - Removed tiered pricing (removed from enum and schema)
  - Currency locked to CAD (not user-selectable)
- Created migrations: 
  - `0006_add_storage_listings_table.sql`
  - `0007_update_storage_listings_booking_duration.sql`
  - `0008_add_daily_to_pricing_model_enum.sql`
- Created CRUD API endpoints for managers (all in `server/routes.ts` and `api/index.js`)
- Created UI: `client/src/pages/StorageListingManagement.tsx` (multi-step form)
- Integrated into Manager Dashboard
- **Fixed Issues**: 
  - GET endpoint 500 errors (added COALESCE for NULL handling)
  - DELETE endpoint errors (added proper verification with RETURNING clause)
  - Enum error for 'daily' pricing model (added to database enum)

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

### 3. API Endpoint Duplication
- **Pattern**: Must update BOTH `server/routes.ts` (TypeScript) AND `api/index.js` (JavaScript for Vercel)
- **Reason**: Vercel uses `api/index.js` for serverless deployment
- **Always**: Keep both files in sync

### 4. Currency & Pricing
- **Currency**: Always CAD (locked, not user-selectable)
- **Storage**: All prices in cents (integers) in database, dollars in API/UI
- **Conversion**: Dollars → Cents (×100) when storing, Cents → Dollars (÷100) when reading

## Next Steps (Priority Order)

### Phase 1.3: Equipment Listings (NEXT)
1. Create `equipment_listings` table schema in `shared/schema.ts`
2. Create equipment enums: `equipment_category`, `equipment_condition`, `equipment_pricing_model`
3. Create Zod validation schemas
4. Create migration file and script
5. Add CRUD methods to `server/storage-firebase.ts` (following storage pattern)
6. Create API endpoints (manager CRUD)
7. Create UI: `EquipmentListingManagement.tsx` (multi-step form)
8. Integrate into Manager Dashboard

### Phase 1.4: Kitchen Bookings Enhancement
1. Add pricing fields to `kitchen_bookings` table
2. Create `payment_status` enum
3. Update booking creation to calculate and store prices
4. Update UI to display pricing

### Phase 1.5-1.7: Booking Tables
1. Create `storage_bookings` table
2. Create `equipment_bookings` table
3. Create `payment_transactions` table
4. Add all required enums

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
- `client/src/pages/ManagerBookingDashboard.tsx` - Manager dashboard (add new tabs here)
- `client/src/pages/StorageListingManagement.tsx` - Storage listing form (reference for equipment)
- `client/src/pages/KitchenPricingManagement.tsx` - Kitchen pricing (reference pattern)

## Key Requirements

1. **Use MCP Context7** for library documentation (Drizzle ORM, PostgreSQL, React patterns)
2. **Use MCP Firecrawl** for web research when needed
3. **Follow existing patterns** - don't reinvent, match codebase style
4. **Test on localhost** - each feature should be testable before moving to next
5. **Handle numeric types correctly** - always use direct SQL queries with `::text` casting for numeric fields
6. **Keep API files in sync** - update both `server/routes.ts` and `api/index.js`
7. **Complete features thoroughly** - don't leave partial implementations

## Execution Plan Reference

The full 40-step execution plan is located at:
`c:\Users\rauna\.cursor\plans\storage_equipment_pricing_payment_platform_9301e5d1.plan.md`

## Current Database State

- ✅ `kitchens` table has pricing fields
- ✅ `storage_listings` table exists with flexible booking duration
- ✅ Enums: `storage_type`, `storage_pricing_model` (includes 'daily'), `listing_status`, `booking_duration_unit`
- ⏳ `equipment_listings` table - NOT YET CREATED
- ⏳ Booking tables - NOT YET CREATED
- ⏳ Payment tables - NOT YET CREATED

## Testing Checklist

After implementing each feature:
- [ ] Test on localhost
- [ ] Verify database migrations applied correctly
- [ ] Check API endpoints work (both TypeScript and JavaScript versions)
- [ ] Verify UI components render and function
- [ ] Test numeric conversions (cents ↔ dollars)
- [ ] Verify enum values work correctly
- [ ] Check error handling

## Questions to Ask User

If unclear about requirements:
1. Should I proceed with Phase 1.3 (Equipment Listings)?
2. Any specific equipment categories to prioritize?
3. Any changes to the plan needed?

---

**Start by reading the plan file and understanding the current state, then proceed with the next phase systematically.**
