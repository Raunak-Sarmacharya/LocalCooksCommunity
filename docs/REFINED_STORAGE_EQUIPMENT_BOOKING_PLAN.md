# Refined Storage & Equipment Booking Implementation Plan

## Executive Summary

This refined plan incorporates:
1. **Storage booking with independent date ranges** (currently missing)
2. **Real-time equipment pricing display** (currently shows "calculated later")
3. **Manager ability to toggle storage/equipment active status** (NEW requirement)
4. **Complete pricing breakdown** before booking confirmation

---

## Completion Assessment: Original Plan vs Current State

### ✅ **COMPLETED** (From Original Plan)

#### Phase 1: Database Schema (100% Complete)
- ✅ `storage_listings` table created with all fields
- ✅ `equipment_listings` table created with all fields
- ✅ `storage_bookings` table created
- ✅ `equipment_bookings` table created
- ✅ `kitchen_bookings` enhanced with pricing fields
- ✅ All enums created (`storage_type`, `equipment_category`, `listing_status`, etc.)
- ✅ `is_active` field exists in both `storage_listings` and `equipment_listings`
- ✅ Indexes created on `is_active` fields
- ✅ Foreign key relationships properly configured

#### Phase 2: Backend API (90% Complete)
- ✅ Manager endpoints for storage listings (CRUD)
- ✅ Manager endpoints for equipment listings (CRUD)
- ✅ Chef endpoints to fetch storage/equipment listings
- ✅ Storage booking creation logic (but uses kitchen dates - needs fix)
- ✅ Equipment booking creation logic
- ✅ Pricing calculation service exists
- ✅ `updateStorageListing` supports `isActive` updates
- ✅ `updateEquipmentListing` supports `isActive` updates
- ❌ **Missing**: Manager UI to toggle `isActive` status

#### Phase 3: Manager UI (80% Complete)
- ✅ `StorageListingManagement.tsx` - Create/edit storage listings
- ✅ `EquipmentListingManagement.tsx` - Create/edit equipment listings
- ✅ `KitchenPricingManagement.tsx` - Set kitchen hourly rates
- ❌ **Missing**: Toggle `isActive` button/switch in listing management pages
- ❌ **Missing**: Visual indicator showing active/inactive status
- ❌ **Missing**: Bulk activate/deactivate functionality

#### Phase 4: Chef UI (40% Complete)
- ✅ Storage listings displayed in booking calendar
- ✅ Equipment listings displayed (included vs rental)
- ✅ Equipment selection checkboxes work
- ❌ **Missing**: Storage date range picker
- ❌ **Missing**: Storage selection functionality
- ❌ **Missing**: Real-time equipment pricing display
- ❌ **Missing**: Complete pricing breakdown component

#### Phase 5: Payment Integration (0% Complete - Deferred)
- ⏸️ Payment service stubs (not priority for MVP)
- ⏸️ Stripe integration (deferred)

#### Phase 6: Admin Moderation (Status Unknown)
- ❓ Admin approval workflow (needs verification)

---

## What Needs to Be Implemented

### Priority 1: Storage Booking Functionality (HIGH)
**Status**: Backend exists but uses wrong dates; Frontend missing entirely

1. **Storage Date Range Picker Component**
   - Start date picker
   - End date picker
   - Minimum duration validation
   - Visual calendar display

2. **Storage Selection UI**
   - Replace static display with interactive component
   - Allow chefs to select storage with custom date ranges
   - Show price preview based on selected dates

3. **Backend Fix**
   - Update booking endpoint to accept storage date ranges
   - Use provided dates instead of kitchen booking dates
   - Validate minimum duration

### Priority 2: Real-time Equipment Pricing (HIGH)
**Status**: Calculation exists but not displayed to user

1. **Equipment Pricing Hook**
   - Calculate prices in real-time
   - Include service fees and deposits
   - Return formatted breakdown

2. **Update Booking Modal**
   - Remove "will be calculated later" message
   - Show real-time pricing
   - Include in total calculation

### Priority 3: Manager Active Status Toggle (MEDIUM)
**Status**: Backend supports it; UI missing

1. **Storage Listing Management UI**
   - Add toggle switch/button for `isActive`
   - Show current status visually
   - Add confirmation dialog when deactivating
   - Show warning if storage has active bookings

2. **Equipment Listing Management UI**
   - Add toggle switch/button for `isActive`
   - Show current status visually
   - Add confirmation dialog when deactivating
   - Show warning if equipment has active bookings

3. **Backend Validation** (Optional Enhancement)
   - Prevent deactivating if active bookings exist
   - Or allow deactivation but show warning

### Priority 4: Complete Pricing Breakdown (MEDIUM)
**Status**: Partial implementation

1. **Unified Pricing Component**
   - Kitchen booking price
   - Equipment add-ons
   - Storage bookings
   - Service fees
   - Damage deposits
   - Grand total

---

## Detailed Implementation Plan

### Phase 1: Manager Active Status Toggle (NEW)

#### 1.1 Update StorageListingManagement.tsx
**File**: `client/src/pages/StorageListingManagement.tsx`

**Changes**:
1. Add `isActive` field to `StorageListing` interface (if missing)
2. Display active/inactive status badge in listing cards
3. Add toggle switch/button to change status
4. Add confirmation dialog when deactivating
5. Show warning if storage has active bookings

**UI Component**:
```typescript
// In listing card
<div className="flex items-center gap-2">
  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
    listing.isActive 
      ? 'bg-green-100 text-green-700' 
      : 'bg-gray-100 text-gray-600'
  }`}>
    {listing.isActive ? '✓ Active' : '✗ Inactive'}
  </span>
  <Switch
    checked={listing.isActive}
    onCheckedChange={(checked) => handleToggleActive(listing.id, checked)}
    disabled={isUpdating}
  />
</div>
```

**API Call**:
```typescript
const toggleActive = useMutation({
  mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/manager/storage-listings/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ isActive }),
    });
    if (!response.ok) throw new Error('Failed to update status');
    return response.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['storage-listings'] });
    toast({
      title: "Status Updated",
      description: `Storage listing is now ${isActive ? 'active' : 'inactive'}`,
    });
  },
});
```

#### 1.2 Update EquipmentListingManagement.tsx
**File**: `client/src/pages/EquipmentListingManagement.tsx`

**Changes**: Same as storage (mirror implementation)
- Add `isActive` toggle switch
- Show status badge
- Add confirmation dialog
- Show warnings for active bookings

#### 1.3 Backend Validation (Optional)
**File**: `server/routes.ts` or `server/storage-firebase.ts`

**Enhancement**: Check for active bookings before allowing deactivation
```typescript
// In updateStorageListing or updateEquipmentListing
if (updates.isActive === false) {
  // Check for active bookings
  const activeBookings = await db.select()
    .from(storageBookings)
    .where(
      and(
        eq(storageBookings.storageListingId, id),
        inArray(storageBookings.status, ['pending', 'confirmed'])
      )
    );
  
  if (activeBookings.length > 0) {
    // Option 1: Prevent deactivation
    throw new Error('Cannot deactivate: Active bookings exist');
    
    // Option 2: Allow but warn (return warning in response)
    // return { ...updated, warning: 'Active bookings exist' };
  }
}
```

---

### Phase 2: Storage Booking UI (HIGH PRIORITY)

#### 2.1 Create StorageSelection Component
**File**: `client/src/components/booking/StorageSelection.tsx` (NEW)

**Features**:
- Date range picker (use `react-date-range` or similar)
- Minimum duration validation
- Price preview
- Multiple storage selection support

**Implementation**:
```typescript
import { DateRangePicker } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

interface StorageSelectionProps {
  storageListings: StorageListing[];
  selectedStorage: Array<{
    storageListingId: number;
    startDate: Date;
    endDate: Date;
  }>;
  onSelectionChange: (selections: Array<{
    storageListingId: number;
    startDate: Date;
    endDate: Date;
  }>) => void;
  kitchenBookingDate?: Date;
}

export function StorageSelection({ 
  storageListings, 
  selectedStorage, 
  onSelectionChange,
  kitchenBookingDate 
}: StorageSelectionProps) {
  // Implementation with date range picker
  // Show price preview
  // Validate minimum duration
}
```

#### 2.2 Update KitchenBookingCalendar.tsx
**File**: `client/src/pages/KitchenBookingCalendar.tsx`

**Changes**:
1. Replace static storage display (lines 955-1012) with `StorageSelection` component
2. Add state for selected storage with date ranges
3. Include `selectedStorage` in booking submission
4. Show storage pricing in booking modal

**State Addition**:
```typescript
const [selectedStorage, setSelectedStorage] = useState<Array<{
  storageListingId: number;
  startDate: Date;
  endDate: Date;
}>>([]);
```

**Booking Submission Update**:
```typescript
createBooking.mutate({
  kitchenId: selectedKitchen.id,
  bookingDate: bookingDate.toISOString(),
  startTime,
  endTime,
  specialNotes: notes,
  selectedEquipmentIds: selectedEquipmentIds.length > 0 ? selectedEquipmentIds : undefined,
  selectedStorage: selectedStorage.length > 0 ? selectedStorage.map(s => ({
    storageListingId: s.storageListingId,
    startDate: s.startDate.toISOString(),
    endDate: s.endDate.toISOString(),
  })) : undefined,
});
```

---

### Phase 3: Real-time Equipment Pricing (HIGH PRIORITY)

#### 3.1 Create Equipment Pricing Hook
**File**: `client/src/hooks/use-equipment-pricing.ts` (NEW)

**Implementation**: (See original plan for full code)

#### 3.2 Update Booking Modal
**File**: `client/src/pages/KitchenBookingCalendar.tsx` (lines 1424-1497)

**Changes**:
- Remove "will be calculated later" message
- Use `useEquipmentPricing` hook
- Display real-time pricing breakdown
- Include in total calculation

---

### Phase 4: Storage Pricing Calculation

#### 4.1 Create Storage Pricing Hook
**File**: `client/src/hooks/use-storage-pricing.ts` (NEW)

**Implementation**: (See original plan for full code)

#### 4.2 Update Booking Submission Backend
**File**: `server/routes.ts` (POST `/api/chef/bookings`, lines 5988-6046)

**Changes**:
1. Accept `selectedStorage` array with date ranges
2. Validate date ranges (end after start, minimum duration)
3. Use provided dates instead of kitchen booking dates
4. Calculate pricing based on actual date range

**New Request Body Handling**:
```typescript
const { 
  kitchenId, 
  bookingDate, 
  startTime, 
  endTime, 
  specialNotes, 
  selectedStorageIds,  // OLD - remove
  selectedStorage,     // NEW - with date ranges
  selectedEquipmentIds 
} = req.body;

// Replace old storage booking logic with:
if (selectedStorage && Array.isArray(selectedStorage)) {
  for (const storage of selectedStorage) {
    const startDate = new Date(storage.startDate);
    const endDate = new Date(storage.endDate);
    
    // Validate dates
    if (startDate >= endDate) {
      return res.status(400).json({ 
        error: `Storage booking: End date must be after start date` 
      });
    }
    
    // Validate minimum duration
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const listing = await getStorageListing(storage.storageListingId);
    if (days < listing.minimumBookingDuration) {
      return res.status(400).json({ 
        error: `Storage requires minimum ${listing.minimumBookingDuration} days` 
      });
    }
    
    // Create booking with actual dates
    await createStorageBooking({
      storageListingId: storage.storageListingId,
      kitchenBookingId: booking.id,
      chefId,
      startDate,
      endDate,
      // ... pricing calculation
    });
  }
}
```

---

### Phase 5: Complete Pricing Breakdown

#### 5.1 Create PricingBreakdown Component
**File**: `client/src/components/booking/PricingBreakdown.tsx` (NEW)

**Implementation**: (See original plan for structure)

#### 5.2 Integrate into Booking Modal
**File**: `client/src/pages/KitchenBookingCalendar.tsx`

**Changes**:
- Replace existing pricing section with `PricingBreakdown`
- Pass all pricing data (kitchen, equipment, storage)
- Show complete breakdown before confirmation

---

## Implementation Order (Revised)

### Week 1: Manager Active Status Toggle + Storage UI Foundation
1. ✅ Add `isActive` toggle to `StorageListingManagement.tsx`
2. ✅ Add `isActive` toggle to `EquipmentListingManagement.tsx`
3. ✅ Create `StorageSelection` component
4. ✅ Integrate storage selection into `KitchenBookingCalendar.tsx`

### Week 2: Pricing Calculation & Display
1. ✅ Create `use-equipment-pricing.ts` hook
2. ✅ Create `use-storage-pricing.ts` hook
3. ✅ Update booking modal with real-time pricing
4. ✅ Test pricing calculations

### Week 3: Backend Integration & Validation
1. ✅ Update booking endpoint to accept storage date ranges
2. ✅ Implement storage date validation
3. ✅ Fix storage booking creation to use actual dates
4. ✅ Test end-to-end flow

### Week 4: Complete Pricing Breakdown & Polish
1. ✅ Create `PricingBreakdown` component
2. ✅ Integrate into booking modal
3. ✅ Comprehensive testing
4. ✅ Bug fixes and refinements

---

## Completion Status Summary

### Overall Progress: ~65% Complete

| Phase | Status | Completion |
|-------|--------|------------|
| Database Schema | ✅ Complete | 100% |
| Backend API | ✅ Mostly Complete | 90% |
| Manager UI - Listings | ✅ Mostly Complete | 80% |
| Manager UI - Active Toggle | ❌ Missing | 0% |
| Chef UI - Storage Booking | ❌ Missing | 0% |
| Chef UI - Equipment Pricing | ❌ Missing | 0% |
| Chef UI - Pricing Breakdown | ❌ Missing | 0% |
| Payment Integration | ⏸️ Deferred | 0% |

### What's Left to Complete

**Critical Path (Must Have)**:
1. ✅ Manager active status toggle UI (2-3 days)
2. ✅ Storage date range picker & selection (3-4 days)
3. ✅ Real-time equipment pricing display (2-3 days)
4. ✅ Complete pricing breakdown component (2-3 days)
5. ✅ Backend storage date handling fix (1-2 days)

**Total Estimated Time**: 10-15 days of focused development

**Nice to Have (Post-MVP)**:
- Storage availability calendar
- Bulk activate/deactivate
- Advanced pricing features
- Payment integration

---

## Key Design Decisions

### 1. Active Status Toggle
- **Visual**: Use switch/toggle component with status badge
- **Confirmation**: Show dialog when deactivating (prevent accidental deactivation)
- **Warning**: Show if active bookings exist (but allow deactivation)
- **Backend**: Already supports `isActive` updates - just need UI

### 2. Storage Booking Dates
- **Independent**: Storage dates completely separate from kitchen booking
- **Validation**: Enforce minimum duration on frontend and backend
- **Default**: Suggest kitchen booking date as storage start date (but allow change)
- **Flexibility**: Allow booking storage for longer than kitchen booking

### 3. Pricing Display
- **Real-time**: Update immediately when selections change
- **Transparent**: Show all fees, deposits, and service charges
- **Grouped**: Kitchen, Equipment, Storage each in separate sections
- **Total**: Clear grand total at bottom

### 4. Equipment Pricing
- **Session-based**: Flat rate per booking (not duration-based)
- **Deposits**: Show separately as refundable
- **Service Fee**: 5% calculated on base price

---

## Testing Checklist

### Manager Active Status Toggle
- [ ] Toggle storage listing active/inactive
- [ ] Toggle equipment listing active/inactive
- [ ] See status badge update immediately
- [ ] Confirmation dialog appears when deactivating
- [ ] Warning shown if active bookings exist
- [ ] Inactive listings don't appear in chef booking flow

### Storage Booking
- [ ] Select storage with date range picker
- [ ] Validate minimum duration
- [ ] See price preview update in real-time
- [ ] Submit booking with storage dates
- [ ] Backend creates booking with correct dates
- [ ] Pricing calculated correctly

### Equipment Pricing
- [ ] See real-time pricing when selecting equipment
- [ ] Service fees calculated correctly
- [ ] Damage deposits shown separately
- [ ] Total includes all equipment costs

### Complete Flow
- [ ] Book kitchen + storage + equipment together
- [ ] See complete pricing breakdown
- [ ] All bookings created correctly
- [ ] Pricing matches frontend calculation

---

## Risk Mitigation

### Technical Risks
1. **Date Timezone Issues**: Use ISO strings, consistent timezone handling
2. **Pricing Calculation Errors**: Extensive testing, use cents for precision
3. **State Management**: Keep state local, clear on navigation

### UX Risks
1. **UI Complexity**: Progressive disclosure, clear visual hierarchy
2. **Mobile Usability**: Test on real devices, optimize touch targets
3. **User Confusion**: Clear labels, tooltips, validation messages

### Business Risks
1. **Storage Full**: Manager can quickly toggle inactive (mitigated by toggle feature)
2. **Equipment Repair**: Manager can quickly toggle inactive (mitigated by toggle feature)
3. **Pricing Transparency**: Complete breakdown reduces confusion

---

## Success Criteria

### Must Have (MVP)
- ✅ Managers can toggle storage/equipment active status
- ✅ Chefs can select storage with custom date ranges
- ✅ Real-time equipment pricing visible
- ✅ Complete pricing breakdown before confirmation
- ✅ All bookings created with correct dates and pricing

### Nice to Have (Post-MVP)
- Storage availability calendar
- Bulk operations
- Advanced analytics
- Payment integration

---

## Conclusion

You're approximately **65% complete** with the original plan. The foundation is solid:
- ✅ Database schema is complete
- ✅ Backend APIs are mostly done
- ✅ Manager listing management exists

**What's needed to finish**:
1. Manager active status toggle (quick win - 2-3 days)
2. Storage booking UI with date ranges (3-4 days)
3. Real-time pricing display (2-3 days)
4. Complete pricing breakdown (2-3 days)

**Total remaining work**: ~10-15 days of focused development

The `isActive` toggle is a great addition - it allows managers to quickly mark storage as full or equipment as under repair without deleting listings. This is a common pattern in booking platforms and will improve the user experience significantly.

