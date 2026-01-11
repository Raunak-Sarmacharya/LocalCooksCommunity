# Pricing Conversion Fix

## Issue
Double conversion bug: When setting hourly rate to $20.00:
- Database correctly stores: 2000 (cents) ✓
- UI incorrectly displays: 0.2 (dollars) ✗

## Root Cause
The `updateKitchenPricing()` and `getKitchenPricing()` methods in `server/storage-firebase.ts` already convert between cents (database) and dollars (API), but the route handlers in `server/routes.ts` were doing the conversion again.

## Fix Applied

### 1. GET Endpoint (`/api/manager/kitchens/:kitchenId/pricing`)
**Before:**
```typescript
const pricing = await firebaseStorage.getKitchenPricing(kitchenId);
const response = {
  ...pricing,
  hourlyRate: pricing.hourlyRate ? pricing.hourlyRate / 100 : null, // ❌ Double conversion!
};
res.json(response);
```

**After:**
```typescript
const pricing = await firebaseStorage.getKitchenPricing(kitchenId);
// getKitchenPricing already returns hourlyRate in dollars, no need to convert again
res.json(pricing);
```

### 2. PUT Endpoint (`/api/manager/kitchens/:kitchenId/pricing`)
**Before:**
```typescript
const updated = await firebaseStorage.updateKitchenPricing(kitchenId, pricing);
const response = {
  hourlyRate: updated.hourlyRate ? parseFloat(updated.hourlyRate.toString()) / 100 : null, // ❌ Double conversion!
  // ...
};
res.json(response);
```

**After:**
```typescript
const updated = await firebaseStorage.updateKitchenPricing(kitchenId, pricing);
// updateKitchenPricing already returns hourlyRate in dollars, no need to convert again
res.json(updated);
```

### 3. Storage Method (`updateKitchenPricing` in `server/storage-firebase.ts`)
**Issue:** The method was returning the entire kitchen object (`...updated`), which could cause field mismatches or type issues when the frontend receives the response.

**Before:**
```typescript
return {
  ...updated,  // ❌ Returns entire kitchen object with all fields
  hourlyRate: hourlyRateDollars,
};
```

**After:**
```typescript
// Return only pricing fields (not the entire kitchen object) for API consistency
return {
  hourlyRate: hourlyRateDollars, // Return in dollars for API consistency
  currency: updated.currency || 'CAD',
  minimumBookingHours: updated.minimumBookingHours || 1,
  pricingModel: updated.pricingModel || 'hourly',
};
```

This ensures the response structure matches what the frontend expects and avoids any potential field name or type mismatches.

## Conversion Flow (Correct)

1. **Frontend → Backend (PUT):**
   - Frontend sends: `20.00` (dollars)
   - `updateKitchenPricing()` converts: `20.00 * 100 = 2000` (cents)
   - Database stores: `2000` (cents) ✓

2. **Backend → Frontend (GET/PUT response):**
   - Database has: `2000` (cents)
   - `getKitchenPricing()` / `updateKitchenPricing()` converts: `2000 / 100 = 20` (dollars)
   - API returns: `20.00` (dollars) ✓
   - Frontend displays: `20.00` (dollars) ✓

## Files Modified
- `server/routes.ts` - Removed double conversion in GET and PUT endpoints
- `api/server/routes.js` - Already correct (uses firebaseStorage methods)
- `api/index.js` - Already correct (does conversion directly from DB)

## Testing
1. Set hourly rate to $20.00
2. Verify database has: `2000` (cents)
3. Verify UI displays: `20.00` (dollars)
4. Reload page and verify it still shows: `20.00` (dollars)

