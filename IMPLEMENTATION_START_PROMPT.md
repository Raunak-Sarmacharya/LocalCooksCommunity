# Implementation Start Prompt

## Context

I need you to implement the storage and equipment booking features for my Local Cooks Community platform. I have created detailed implementation plans that you should read first.

## Required Reading

**IMPORTANT**: Before starting any implementation, please read these files (I will link them in the chat):

1. `REFINED_STORAGE_EQUIPMENT_BOOKING_PLAN.md` - Contains completion assessment and overall implementation strategy
2. `STORAGE_EQUIPMENT_BOOKING_IMPLEMENTATION_PLAN.md` - Contains detailed technical implementation plan

These files contain:
- Current state analysis
- What's already implemented vs what's missing
- Detailed implementation steps
- Code examples and patterns
- Testing checklists

## Implementation Priority Order

Follow this exact order - complete ONE feature fully before moving to the next:

### Feature 1: Manager Active Status Toggle (START HERE - Complete This First)

**Why First**: 
- Quick win (2-3 days)
- Backend already supports it (just needs UI)
- Self-contained feature
- Easy to test
- Provides immediate operational value

**What to Implement**:

1. **Storage Listing Management UI** (`client/src/pages/StorageListingManagement.tsx`)
   - Add toggle switch/button for `isActive` status
   - Display status badge (Active/Inactive) with color coding
   - Add confirmation dialog when deactivating
   - Show warning if storage has active bookings (optional but recommended)
   - Real-time status update after toggle

2. **Equipment Listing Management UI** (`client/src/pages/EquipmentListingManagement.tsx`)
   - Same implementation as storage (mirror the pattern)
   - Toggle switch for `isActive` status
   - Status badge display
   - Confirmation dialog
   - Warning for active bookings

**Technical Details**:
- Backend endpoint already exists: `PUT /api/manager/storage-listings/:id` and `PUT /api/manager/equipment-listings/:id`
- Send `{ isActive: boolean }` in request body
- Database field `is_active` already exists in both tables
- Use React Query for mutations
- Use shadcn/ui Switch component or similar

**Testing Requirements**:
- [ ] Toggle storage listing active/inactive
- [ ] Toggle equipment listing active/inactive
- [ ] Status badge updates immediately
- [ ] Confirmation dialog appears when deactivating
- [ ] Inactive listings don't appear in chef booking flow (verify this works)
- [ ] Active listings appear normally

**Definition of Done**:
- ✅ Both storage and equipment listing management pages have toggle switches
- ✅ Status badges are visible and update correctly
- ✅ Confirmation dialogs work
- ✅ Backend updates are successful
- ✅ UI reflects changes immediately
- ✅ Inactive listings are filtered out from chef view
- ✅ Feature is fully tested and working

**Files to Modify**:
- `client/src/pages/StorageListingManagement.tsx`
- `client/src/pages/EquipmentListingManagement.tsx`

**Files to Reference** (from the plans):
- See Phase 7 in `STORAGE_EQUIPMENT_BOOKING_IMPLEMENTATION_PLAN.md`
- See Phase 1 in `REFINED_STORAGE_EQUIPMENT_BOOKING_PLAN.md`

---

### Feature 2: Storage Booking UI with Date Range Picker (After Feature 1 is Complete)

**What to Implement**:
- Storage date range picker component
- Storage selection UI in booking calendar
- Integration with booking flow

**Files to Create**:
- `client/src/components/booking/StorageSelection.tsx` (NEW)

**Files to Modify**:
- `client/src/pages/KitchenBookingCalendar.tsx`

---

### Feature 3: Real-time Equipment Pricing (After Feature 2 is Complete)

**What to Implement**:
- Equipment pricing calculation hook
- Real-time pricing display in booking modal

**Files to Create**:
- `client/src/hooks/use-equipment-pricing.ts` (NEW)

**Files to Modify**:
- `client/src/pages/KitchenBookingCalendar.tsx`

---

### Feature 4: Complete Pricing Breakdown (After Feature 3 is Complete)

**What to Implement**:
- Unified pricing breakdown component
- Integration into booking modal

**Files to Create**:
- `client/src/components/booking/PricingBreakdown.tsx` (NEW)
- `client/src/hooks/use-storage-pricing.ts` (NEW)

**Files to Modify**:
- `client/src/pages/KitchenBookingCalendar.tsx`

---

## Important Guidelines

1. **Read the Plan Files First**: Understand the full context before coding
2. **Complete One Feature at a Time**: Don't start Feature 2 until Feature 1 is fully done and tested
3. **Follow Existing Patterns**: Look at how similar features are implemented in the codebase
4. **Test Thoroughly**: Each feature should be fully functional before moving on
5. **Use Existing Components**: Leverage shadcn/ui components and existing hooks
6. **Backend is Ready**: Most backend endpoints exist - focus on frontend implementation
7. **Database Schema**: All necessary fields exist - no migrations needed

## Current Codebase Context

- **Frontend**: React + TypeScript + shadcn/ui components
- **State Management**: React Query for server state
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Auth**: Firebase Auth for chefs, Session auth for managers

## Key Patterns to Follow

1. **API Calls**: Use React Query mutations with proper error handling
2. **UI Components**: Use shadcn/ui components (Switch, Dialog, Badge, etc.)
3. **State Management**: Local state with useState, server state with React Query
4. **Validation**: Client-side validation before API calls
5. **Error Handling**: Toast notifications for errors/success
6. **Loading States**: Show loading indicators during mutations

## Questions to Ask if Needed

- If you're unsure about existing patterns, search the codebase first
- If you need to understand the data flow, check the plan files
- If you encounter issues, check existing similar implementations

## Success Criteria for Feature 1

When Feature 1 is complete, managers should be able to:
- ✅ See active/inactive status of all storage listings
- ✅ Toggle storage listings active/inactive with one click
- ✅ See active/inactive status of all equipment listings
- ✅ Toggle equipment listings active/inactive with one click
- ✅ Get confirmation when deactivating (prevent accidents)
- ✅ See immediate visual feedback (status badge updates)
- ✅ Verify inactive listings don't show to chefs

## Next Steps After Feature 1

Once Feature 1 is complete and tested, I'll ask you to proceed with Feature 2. Do NOT start Feature 2 until I confirm Feature 1 is working correctly.

---

**Start with Feature 1: Manager Active Status Toggle**

Read the plan files I link, then implement the toggle functionality for both storage and equipment listings. Make sure it's complete and testable before moving on.

