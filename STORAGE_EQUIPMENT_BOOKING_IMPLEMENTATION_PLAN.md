# Storage & Equipment Booking Implementation Plan

## Executive Summary

This plan outlines the implementation of storage booking functionality and real-time equipment pricing calculation for the Local Cooks Community platform. The goal is to provide chefs with a seamless, industry-standard booking experience that allows them to:

1. **Book storage space** independently with custom date ranges
2. **See real-time pricing** for equipment add-ons during booking
3. **View complete pricing breakdown** before confirming bookings

---

## Current State Analysis

### ✅ What's Already Implemented

1. **Database Schema**
   - `storage_bookings` table exists with proper structure
   - `equipment_bookings` table exists with proper structure
   - `kitchen_bookings` has `storage_items` and `equipment_items` JSONB fields
   - Foreign key relationships are properly set up

2. **Backend Logic**
   - Storage booking creation logic exists in `server/routes.ts` (lines 5988-6046)
   - Equipment booking creation logic exists (lines 6048-6109)
   - Storage can be booked alongside kitchen bookings
   - Pricing calculation logic exists for both storage and equipment

3. **Frontend Display**
   - Storage listings are displayed in the booking calendar (lines 955-1012)
   - Equipment listings are displayed (included vs rental)
   - Equipment can be selected via checkboxes

### ❌ What's Missing

1. **Storage Booking UI**
   - No date range picker for storage selection
   - Storage listings are displayed but not selectable
   - No way to specify storage start/end dates independently from kitchen booking
   - Current code shows "Book separately" but provides no booking mechanism

2. **Equipment Pricing Display**
   - Equipment pricing shows "will be calculated later" message
   - Real-time pricing calculation not displayed in booking modal
   - Total price breakdown doesn't include equipment costs

3. **Pricing Calculation Issues**
   - Storage pricing currently uses kitchen booking dates (incorrect)
   - Storage should have independent date range selection
   - Equipment pricing is calculated but not shown to user

---

## Industry Best Practices Research

Based on research of booking systems (hotel, rental, equipment booking platforms):

### 1. **Add-on Selection Pattern**
- **Progressive Disclosure**: Show add-ons after primary booking (kitchen) is selected
- **Visual Hierarchy**: Clear distinction between included vs paid add-ons
- **Real-time Pricing**: Show price updates immediately when selections change
- **Summary View**: Always show total cost breakdown before confirmation

### 2. **Date Range Selection**
- **Dual Calendar**: Use date range picker for storage (start + end date)
- **Minimum Duration**: Enforce minimum booking duration clearly
- **Visual Feedback**: Highlight selected date ranges
- **Validation**: Prevent invalid date ranges (past dates, end before start)

### 3. **Pricing Transparency**
- **Line-item Breakdown**: Show each component separately
- **Service Fees**: Clearly labeled and explained
- **Total Calculation**: Real-time updates as selections change
- **Currency Display**: Consistent currency formatting

### 4. **User Experience Flow**
```
1. Select Kitchen → 2. Select Date → 3. Select Time Slots
4. View Add-ons → 5. Select Equipment (if needed)
6. Select Storage (if needed) → 7. Review Pricing → 8. Confirm
```

---

## Implementation Plan

### Phase 1: Storage Booking UI Components

#### 1.1 Storage Selection Component
**File**: `client/src/components/booking/StorageSelection.tsx` (NEW)

**Features**:
- Date range picker for storage start/end dates
- Minimum duration validation
- Visual calendar for date selection
- Price preview based on selected dates
- Integration with existing storage listings

**Props**:
```typescript
interface StorageSelectionProps {
  storageListings: StorageListing[];
  selectedStorage: SelectedStorage[]; // { id, startDate, endDate }
  onSelectionChange: (selections: SelectedStorage[]) => void;
  kitchenBookingDate?: Date; // Suggested start date
}
```

#### 1.2 Update KitchenBookingCalendar.tsx
**Changes**:
- Replace static storage display (lines 955-1012) with interactive component
- Add state for selected storage with date ranges
- Include `selectedStorage` in booking submission
- Show storage pricing in booking modal

**State Management**:
```typescript
const [selectedStorage, setSelectedStorage] = useState<Array<{
  storageListingId: number;
  startDate: Date;
  endDate: Date;
}>>([]);
```

#### 1.3 Storage Date Range Picker
**Component**: Use a library like `react-date-range` or build custom
- Start date picker
- End date picker
- Minimum duration enforcement
- Visual calendar display
- Date validation (no past dates, end after start)

---

### Phase 2: Real-time Equipment Pricing

#### 2.1 Equipment Pricing Calculation Hook
**File**: `client/src/hooks/use-equipment-pricing.ts` (NEW)

**Functionality**:
- Calculate equipment prices based on selected items
- Handle session rates (flat fee per booking)
- Calculate damage deposits
- Calculate service fees (5%)
- Return formatted pricing breakdown

**Implementation**:
```typescript
export function useEquipmentPricing(selectedEquipmentIds: number[], equipmentListings: EquipmentListing[]) {
  return useMemo(() => {
    let totalPrice = 0;
    let totalDeposit = 0;
    const items = selectedEquipmentIds.map(id => {
      const eq = equipmentListings.rental.find(e => e.id === id);
      if (!eq) return null;
      const price = eq.sessionRate || 0;
      const deposit = eq.damageDeposit || 0;
      totalPrice += price;
      totalDeposit += deposit;
      return { ...eq, price, deposit };
    }).filter(Boolean);

    const serviceFee = totalPrice * 0.05;
    return {
      items,
      subtotal: totalPrice,
      deposits: totalDeposit,
      serviceFee,
      total: totalPrice + serviceFee
    };
  }, [selectedEquipmentIds, equipmentListings]);
}
```

#### 2.2 Update Booking Modal Pricing Display
**File**: `client/src/pages/KitchenBookingCalendar.tsx` (lines 1424-1497)

**Changes**:
- Remove "will be calculated later" message
- Show real-time equipment pricing breakdown
- Include equipment in total price calculation
- Display damage deposits separately (refundable)

**New Pricing Section**:
```typescript
{/* Equipment Pricing */}
{equipmentPricing.items.length > 0 && (
  <div className="space-y-2">
    <h4 className="font-semibold">Equipment Add-ons:</h4>
    {equipmentPricing.items.map(item => (
      <div key={item.id} className="flex justify-between text-sm">
        <span>{item.equipmentType}</span>
        <span>${item.price.toFixed(2)}</span>
      </div>
    ))}
    {equipmentPricing.deposits > 0 && (
      <div className="flex justify-between text-sm text-amber-600">
        <span>Damage Deposits (refundable):</span>
        <span>${equipmentPricing.deposits.toFixed(2)}</span>
      </div>
    )}
  </div>
)}
```

---

### Phase 3: Storage Pricing Calculation

#### 3.1 Storage Pricing Hook
**File**: `client/src/hooks/use-storage-pricing.ts` (NEW)

**Functionality**:
- Calculate storage prices based on date ranges
- Handle daily pricing model
- Enforce minimum booking duration
- Calculate service fees
- Return formatted pricing breakdown

**Implementation**:
```typescript
export function useStoragePricing(
  selectedStorage: SelectedStorage[],
  storageListings: StorageListing[]
) {
  return useMemo(() => {
    const items = selectedStorage.map(selection => {
      const listing = storageListings.find(s => s.id === selection.storageListingId);
      if (!listing) return null;

      const days = Math.ceil(
        (selection.endDate.getTime() - selection.startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const minDays = listing.minimumBookingDuration || 1;
      const effectiveDays = Math.max(days, minDays);
      const basePrice = (listing.basePrice || 0) * effectiveDays;
      const serviceFee = basePrice * 0.05;

      return {
        ...listing,
        startDate: selection.startDate,
        endDate: selection.endDate,
        days: effectiveDays,
        basePrice,
        serviceFee,
        total: basePrice + serviceFee
      };
    }).filter(Boolean);

    const subtotal = items.reduce((sum, item) => sum + (item?.basePrice || 0), 0);
    const totalServiceFee = items.reduce((sum, item) => sum + (item?.serviceFee || 0), 0);

    return {
      items,
      subtotal,
      serviceFee: totalServiceFee,
      total: subtotal + totalServiceFee
    };
  }, [selectedStorage, storageListings]);
}
```

#### 3.2 Update Booking Submission
**File**: `server/routes.ts` (lines 5988-6046)

**Changes**:
- Accept storage selections with date ranges from frontend
- Use provided dates instead of kitchen booking dates
- Validate minimum duration
- Calculate pricing based on actual date range

**New Request Body**:
```typescript
{
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  specialNotes?: string;
  selectedEquipmentIds?: number[];
  selectedStorage?: Array<{
    storageListingId: number;
    startDate: string; // ISO date string
    endDate: string;   // ISO date string
  }>;
}
```

---

### Phase 4: Complete Pricing Breakdown

#### 4.1 Unified Pricing Component
**File**: `client/src/components/booking/PricingBreakdown.tsx` (NEW)

**Features**:
- Kitchen booking pricing
- Equipment add-ons pricing
- Storage booking pricing
- Service fees breakdown
- Damage deposits (refundable)
- Grand total calculation

**Display Structure**:
```
Kitchen Booking
  Base Price (X hours × $Y/hour)        $XX.XX
  Service Fee (5%)                      $X.XX
  ──────────────────────────────────────────
  Kitchen Subtotal                     $XX.XX

Equipment Add-ons
  Equipment 1                          $XX.XX
  Equipment 2                          $XX.XX
  Service Fee (5%)                     $X.XX
  ──────────────────────────────────────────
  Equipment Subtotal                   $XX.XX

Storage
  Storage 1 (X days × $Y/day)          $XX.XX
  Service Fee (5%)                      $X.XX
  ──────────────────────────────────────────
  Storage Subtotal                      $XX.XX

Damage Deposits (refundable)           $XX.XX

──────────────────────────────────────────
GRAND TOTAL                            $XXX.XX
```

#### 4.2 Update Booking Modal
**File**: `client/src/pages/KitchenBookingCalendar.tsx`

**Changes**:
- Replace existing pricing section with `PricingBreakdown` component
- Pass all pricing data to component
- Show complete breakdown before confirmation

---

### Phase 5: Backend Updates

#### 5.1 Update Booking Endpoint
**File**: `server/routes.ts` (POST `/api/chef/bookings`)

**Changes**:
1. Accept new storage format with date ranges
2. Validate storage date ranges
3. Calculate storage pricing based on actual dates
4. Return complete pricing breakdown in response

**Validation Logic**:
```typescript
// Validate storage date ranges
if (selectedStorage && Array.isArray(selectedStorage)) {
  for (const storage of selectedStorage) {
    const startDate = new Date(storage.startDate);
    const endDate = new Date(storage.endDate);
    
    // Validate dates
    if (startDate >= endDate) {
      return res.status(400).json({ 
        error: `Storage booking ${storage.storageListingId}: End date must be after start date` 
      });
    }
    
    // Validate minimum duration
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const listing = await getStorageListing(storage.storageListingId);
    if (days < listing.minimumBookingDuration) {
      return res.status(400).json({ 
        error: `Storage booking requires minimum ${listing.minimumBookingDuration} days` 
      });
    }
  }
}
```

#### 5.2 Storage Booking Creation
**Update**: `server/routes.ts` (lines 5988-6046)

**Changes**:
- Use provided start/end dates instead of kitchen booking dates
- Calculate pricing based on actual date range
- Validate minimum duration before creating booking

---

### Phase 6: UI/UX Enhancements

#### 6.1 Storage Selection Modal
**Component**: `client/src/components/booking/StorageBookingModal.tsx` (NEW)

**Features**:
- Full-screen or modal overlay
- Date range picker
- Storage listing details
- Price preview
- Minimum duration indicator
- Validation messages

#### 6.2 Visual Indicators
- ✅ Selected storage items
- 📅 Date range display
- 💰 Price preview
- ⚠️ Validation warnings
- ℹ️ Information tooltips

#### 6.3 Responsive Design
- Mobile-friendly date pickers
- Touch-optimized controls
- Collapsible sections
- Clear visual hierarchy

---

## Technical Implementation Details

### Date Handling
- **Format**: ISO 8601 strings for API communication
- **Timezone**: Use location timezone for display
- **Storage**: Store as UTC timestamps in database
- **Validation**: Client and server-side validation

### Pricing Calculation
- **Storage**: Daily rate × number of days (minimum enforced)
- **Equipment**: Flat session rate (not duration-based)
- **Service Fee**: 5% of base price (calculated separately per item type)
- **Currency**: All prices in CAD cents, converted to dollars for display

### State Management
- Use React hooks for local state
- No need for global state (booking is single-page flow)
- Clear state on booking completion or cancellation

### Error Handling
- Client-side validation before submission
- Server-side validation for security
- Clear error messages for users
- Graceful degradation if pricing unavailable

---

## Database Considerations

### Current Schema (No Changes Needed)
- `storage_bookings.kitchen_booking_id` is nullable (supports standalone)
- `storage_bookings.start_date` and `end_date` support independent dates
- Pricing fields are properly structured

### Validation Queries
- Check for overlapping storage bookings
- Validate minimum duration
- Check availability (if needed in future)

---

## Testing Strategy

### Unit Tests
- Pricing calculation hooks
- Date range validation
- Minimum duration enforcement

### Integration Tests
- Complete booking flow with storage
- Complete booking flow with equipment
- Complete booking flow with both
- Pricing breakdown accuracy

### Manual Testing Checklist
- [ ] Select storage with date range
- [ ] Validate minimum duration
- [ ] See real-time equipment pricing
- [ ] View complete pricing breakdown
- [ ] Submit booking with all add-ons
- [ ] Verify backend creates correct bookings
- [ ] Check pricing calculations match frontend

---

## Implementation Order

### Week 1: Storage UI Foundation
1. Create `StorageSelection` component
2. Add date range picker
3. Integrate with `KitchenBookingCalendar`
4. Add state management

### Week 2: Pricing Calculation
1. Create equipment pricing hook
2. Create storage pricing hook
3. Update booking modal with real-time pricing
4. Test pricing calculations

### Week 3: Backend Integration
1. Update booking endpoint
2. Implement storage date validation
3. Update storage booking creation
4. Test end-to-end flow

### Week 4: Polish & Testing
1. Create unified pricing breakdown component
2. Add visual enhancements
3. Comprehensive testing
4. Bug fixes and refinements

---

## Success Metrics

### User Experience
- ✅ Chefs can select storage with custom date ranges
- ✅ Real-time pricing visible for all add-ons
- ✅ Complete pricing breakdown before confirmation
- ✅ Clear visual feedback for all selections

### Technical
- ✅ All pricing calculations accurate
- ✅ Date validations working correctly
- ✅ Backend creates bookings properly
- ✅ No performance issues

### Business
- ✅ Increased storage booking adoption
- ✅ Reduced booking abandonment
- ✅ Clear pricing transparency
- ✅ Improved user satisfaction

---

## Future Enhancements (Post-MVP)

1. **Storage Availability Calendar**: Show when storage is available/booked
2. **Storage Extensions**: Allow extending existing storage bookings
3. **Bulk Equipment Discounts**: Discount for multiple equipment items
4. **Storage Auto-renewal**: Option to auto-renew storage bookings
5. **Advanced Pricing**: Seasonal rates, volume discounts
6. **Storage Inventory Management**: Track available storage capacity

---

## Risk Mitigation

### Technical Risks
- **Date Timezone Issues**: Use consistent timezone handling
- **Pricing Calculation Errors**: Extensive testing, use cents for precision
- **State Management Complexity**: Keep state local, clear on navigation

### UX Risks
- **UI Complexity**: Progressive disclosure, clear visual hierarchy
- **Mobile Usability**: Test on real devices, optimize touch targets
- **User Confusion**: Clear labels, tooltips, validation messages

---

## Phase 7: Manager Active Status Toggle (NEW REQUIREMENT)

### 7.1 Storage Listing Active Status Toggle
**File**: `client/src/pages/StorageListingManagement.tsx`

**Features**:
- Toggle switch/button to activate/deactivate storage listings
- Visual status badge (Active/Inactive)
- Confirmation dialog when deactivating
- Warning if storage has active bookings
- Real-time status update

**Implementation**:
```typescript
// Add to listing card
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
    onCheckedChange={(checked) => {
      if (!checked) {
        // Show confirmation dialog
        if (confirm('Deactivate this storage listing? It will no longer be available for booking.')) {
          handleToggleActive(listing.id, false);
        }
      } else {
        handleToggleActive(listing.id, true);
      }
    }}
  />
</div>
```

**API Integration**:
- Use existing `PUT /api/manager/storage-listings/:id` endpoint
- Send `{ isActive: boolean }` in request body
- Backend already supports this (verified in database schema)

### 7.2 Equipment Listing Active Status Toggle
**File**: `client/src/pages/EquipmentListingManagement.tsx`

**Features**: Same as storage (mirror implementation)
- Toggle switch for equipment active status
- Status badge display
- Confirmation dialog
- Warning for active bookings

**Use Cases**:
- **Storage Full**: Manager toggles `isActive: false` when storage is at capacity
- **Equipment Repair**: Manager toggles `isActive: false` when equipment is being serviced
- **Temporary Unavailability**: Quick way to hide listings without deleting them

### 7.3 Backend Validation (Optional Enhancement)
**File**: `server/storage-firebase.ts` or `server/routes.ts`

**Enhancement**: Check for active bookings before allowing deactivation
```typescript
// In updateStorageListing method
if (updates.isActive === false) {
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
    
    // Option 2: Allow but return warning
    // return { ...updated, warning: `${activeBookings.length} active bookings exist` };
  }
}
```

**Note**: Backend already supports `isActive` updates. This validation is optional but recommended for better UX.

---

## Conclusion

This implementation plan provides a comprehensive roadmap for adding storage booking functionality and real-time equipment pricing to the Local Cooks Community platform. The approach follows industry best practices and ensures a smooth, transparent booking experience for chefs.

**Key Addition**: The manager active status toggle feature allows quick management of storage and equipment availability without deleting listings - essential for operational flexibility.

The phased approach allows for incremental development and testing, reducing risk and ensuring quality at each stage.

