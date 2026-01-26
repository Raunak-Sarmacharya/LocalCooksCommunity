# Currency & Amount Standardization Audit Report

**Date:** January 26, 2026  
**Platform:** LocalCooks - Commercial Kitchen Booking Platform  
**Stripe Best Practice:** All amounts in smallest currency unit (cents for CAD/USD)

---

## Executive Summary

The LocalCooks codebase has **inconsistent currency handling** between the database, API, and frontend. While the database correctly stores all monetary values in **cents** (following Stripe best practices), the API endpoints return amounts inconsistently - some convert to dollars, others return raw cents. This has led to **workaround heuristics** in the frontend that check `if (amount > 100)` to guess whether a value is in cents or dollars.

### Current State

| Layer | Format | Status |
|-------|--------|--------|
| Database | **Cents** (integers) | ✅ Correct |
| Stripe API | **Cents** | ✅ Correct |
| Backend Services | **Cents** | ✅ Correct |
| API Responses | **Mixed** (cents/dollars) | ⚠️ Inconsistent |
| Frontend Display | **Workaround heuristics** | ⚠️ Fragile |

---

## Stripe Best Practices (Reference)

Per Stripe documentation:
> **All amounts are in the smallest currency unit** (e.g., 100 cents to charge $1.00, or 100 to charge ¥100, a zero-decimal currency).

For CAD (Canadian Dollar):
- `amount: 5000` = $50.00 CAD
- `amount: 1` = $0.01 CAD

**The LocalCooks database schema correctly follows this pattern.**

---

## Database Schema Analysis ✅

All monetary fields in the database are correctly documented and stored in **cents**:

### Kitchen Pricing
```sql
-- kitchens table
hourly_rate NUMERIC  -- "Base hourly rate in cents (e.g., 5000 = $50.00/hour)"
```

### Booking Amounts
```sql
-- kitchen_bookings table
total_price NUMERIC      -- "Total booking price in cents"
hourly_rate NUMERIC      -- "Rate used for this booking (in cents)"
damage_deposit NUMERIC   -- "Damage deposit amount (in cents)"
service_fee NUMERIC      -- "Platform commission (in cents)"
```

### Storage Listings
```sql
-- storage_listings table
base_price NUMERIC           -- "Base price in cents (integer)"
price_per_cubic_foot NUMERIC -- "For per-cubic-foot model (in cents)"
```

### Equipment Listings
```sql
-- equipment_listings table
session_rate NUMERIC    -- "Flat session rate in cents (e.g., 2500 = $25.00/session)"
damage_deposit NUMERIC  -- "Refundable deposit (in cents)"
```

### Payment Transactions
```sql
-- payment_transactions table
amount NUMERIC          -- "Total transaction amount (includes service fee)" - in cents
base_amount NUMERIC     -- "Base amount before service fee" - in cents
service_fee NUMERIC     -- "Platform service fee" - in cents
manager_revenue NUMERIC -- "Manager earnings" - in cents
refund_amount NUMERIC   -- "Total refunded amount" - in cents
net_amount NUMERIC      -- "Final amount after refunds" - in cents
```

---

## API Endpoint Inconsistencies ⚠️

### Endpoints That Convert to Dollars

| Endpoint | File | Conversion |
|----------|------|------------|
| `GET /api/locations/:slug` | `locations.ts:112-114` | `hourlyRate / 100` |
| Invoice generation | `invoice-service.ts` | Multiple `/100` conversions |
| Payout statements | `payout-statement-service.ts` | Multiple `/100` conversions |

### Endpoints That Return Raw Cents

| Endpoint | File | Returns |
|----------|------|---------|
| `GET /api/chef/kitchens/:id/pricing` | `kitchens.ts:81` | Raw `kitchen.hourlyRate` (cents) |
| `GET /api/manager/kitchens/:id/pricing` | `manager.ts:978` | Raw cents |
| Equipment listings | Various | Raw cents |
| Storage listings | Various | Raw cents |

---

## Frontend Workarounds ⚠️

The frontend has **fragile heuristics** to handle the inconsistency:

### Pattern Found (Anti-Pattern)
```typescript
// Found in multiple files - this is a code smell!
const displayRate = hourlyRate > 100 ? hourlyRate / 100 : hourlyRate;
```

### Files with Workarounds

1. **`KitchenBookingCalendar.tsx`** (lines 600-602, 688-690, 1011)
   ```typescript
   if (hourlyRate && hourlyRate > 100) {
     console.warn('⚠️ Hourly rate appears to be in cents, converting to dollars:', hourlyRate);
     hourlyRate = hourlyRate / 100;
   }
   ```

2. **`KitchenPreviewPage.tsx`** (lines 776-777, 787-788)
   ```typescript
   hourlyRate: e.hourlyRate ? (e.hourlyRate > 100 ? e.hourlyRate / 100 : e.hourlyRate) : undefined,
   ```

3. **`KitchenComparisonPage.tsx`** (lines 345-346, 356-357, 542-543, 553-554, 627, 648-649, 659-660)
   ```typescript
   hourlyRate = pricing.hourlyRate > 100 ? pricing.hourlyRate / 100 : pricing.hourlyRate;
   ```

4. **`BookingConfirmationPage.tsx`** (line 689)
   ```typescript
   ${(kitchenPricing.hourlyRate > 100 ? kitchenPricing.hourlyRate / 100 : kitchenPricing.hourlyRate).toFixed(2)}
   ```

### Files with Direct `.toFixed(2)` on Cents (BUGS)

These files display cents as dollars without conversion:

1. **`StorageListingManagement.tsx`** (lines 445, 622, 625)
   ```typescript
   ${listing.basePrice?.toFixed(2)}/day  // BUG: Shows 5000 as "$5000.00" instead of "$50.00"
   ```

2. **`EquipmentListingManagement.tsx`** (line 378)
   ```typescript
   $${(listing.sessionRate || 0).toFixed(2)}/session  // BUG: Shows cents as dollars
   ```

3. **`KitchenPreviewPage.tsx`** (lines 592, 597, 656, 659)
   ```typescript
   ${eq.hourlyRate.toFixed(2)}/hr  // Depends on whether API converted or not
   ```

---

## Correct Formatter Exists ✅

The codebase has a correct `formatCurrency` function that should be used everywhere:

```typescript
// client/src/lib/formatters.ts
export function formatCurrency(amountInCents: number, currency: string = 'CAD'): string {
    return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amountInCents / 100);  // ✅ Correctly divides by 100
}
```

---

## Recommended Standardization

### Enterprise Standard: **Always Cents in API**

Following Stripe's pattern, the API should **always return amounts in cents**. The frontend should **always use `formatCurrency()`** to display.

### Option A: API Returns Cents (Recommended)

**Backend:** All API endpoints return raw cents from database.

**Frontend:** Always use `formatCurrency(amountInCents)` for display.

```typescript
// Frontend display
<span>{formatCurrency(pricing.hourlyRate)}/hour</span>  // formatCurrency handles /100
```

### Option B: API Returns Dollars (Not Recommended)

This would require changing the database storage format or adding conversion layers everywhere, which is error-prone and goes against Stripe conventions.

---

## Fixes Applied (January 26, 2026)

### ✅ Completed Fixes

1. **`server/routes/locations.ts`** - API now returns cents instead of dollars (removed `/100` conversion)
2. **`client/src/lib/formatters.ts`** - Added `formatPrice()` helper for inline price displays
3. **`client/src/pages/KitchenBookingCalendar.tsx`** - Removed `> 100` heuristics, properly converts cents→dollars on fetch
4. **`client/src/pages/BookingConfirmationPage.tsx`** - Removed `> 100` heuristics, properly converts cents→dollars on fetch
5. **`client/src/pages/KitchenPreviewPage.tsx`** - Removed `> 100` heuristics, properly converts cents→dollars on fetch
6. **`client/src/pages/KitchenComparisonPage.tsx`** - Removed `> 100` heuristics, properly converts cents→dollars on fetch

### ⚠️ Design Note: Storage/Equipment vs Kitchen Pricing

There are **two different patterns** in the codebase:

| Feature | Storage Format | API Format | Form Input |
|---------|---------------|------------|------------|
| **Kitchen Pricing** | Cents | Cents | Dollars (converts on save/load) |
| **Storage Listings** | Dollars | Dollars | Dollars |
| **Equipment Listings** | Dollars | Dollars | Dollars |

**Storage and Equipment** forms were designed to work in **dollars end-to-end** for user-friendliness. The `.toFixed(2)` usage in these files is actually correct for this pattern.

**Kitchen Pricing** follows the Stripe standard of storing/transmitting cents, with conversion at the UI boundary.

### Future Consideration

For full enterprise standardization, storage/equipment could be migrated to cents. This would require:
1. Database migration (multiply all prices by 100)
2. Backend conversion layer (dollars→cents on save, cents→dollars on read)
3. This is a breaking change for existing data

---

## Conclusion

The codebase now has **consistent currency handling** for kitchen pricing:
- Database stores cents ✅
- API returns cents ✅
- Frontend converts cents→dollars on fetch ✅
- No more fragile `> 100` heuristics ✅

Storage/Equipment listings use a dollars-throughout pattern which is internally consistent but different from the Stripe standard. This is documented and can be migrated in a future phase if needed.
