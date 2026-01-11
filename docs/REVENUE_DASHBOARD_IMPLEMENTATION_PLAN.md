# 💰 Revenue Dashboard Implementation Plan
## Comprehensive Manager Revenue Monitoring System

**Date**: January 10, 2026  
**Status**: Planning Phase  
**Approach**: Step-by-step implementation with thorough testing

---

## 📋 Executive Summary

This plan implements a comprehensive revenue monitoring system for managers in the LocalCooks Community booking portal. The system will provide:

1. **Dynamic Revenue Calculations** - Configurable service fee (manager gets 100% - service_fee%)
2. **Revenue Dashboards** - Real-time metrics, charts, and analytics
3. **Invoice Management** - View booking invoices and payout statements
4. **Stripe Connect Integration** - Automatic weekly payouts with tracking
5. **Multi-Location Support** - Combined and per-location filtering
6. **Admin Oversight** - Platform-wide revenue visibility

---

## 🎯 Requirements Analysis

### 1. Revenue Split Logic
- **Current**: Hardcoded 5% service fee
- **Required**: Dynamic calculation from `platform_settings` table
- **Formula**: Manager Revenue = Total Revenue × (1 - service_fee_rate)
- **Edge Cases**: 
  - If service_fee = 0% → Manager gets 100%
  - If service_fee = 20% → Manager gets 80%
  - Default to 5% if setting not found

### 2. Invoice Visibility
- **Booking Invoices**: Managers can view invoices for bookings at their locations
- **Payout Statements**: Monthly/weekly summary statements showing earnings
- **Standard Practice**: Both types (research confirms this is standard)

### 3. Stripe Connect Payouts
- **Schedule**: Automatic weekly payouts (configurable)
- **Implementation**: Use Stripe API to configure payout schedule
- **Tracking**: Display pending/completed payouts in dashboard
- **Modular**: Easy to change frequency (daily, weekly, monthly)

### 4. Pricing Endpoints Verification
- **Verify**: All booking creation properly calculates prices
- **Fix**: Ensure `total_price` is always populated for new bookings
- **Test**: Kitchen, storage, and equipment pricing calculations

### 5. Multi-Location Support
- **Combined View**: Default shows all locations combined
- **Filtering**: Dropdown to filter by specific location
- **Breakdown**: Per-location revenue metrics

### 6. Currency Display
- **Storage**: All prices in cents (CAD)
- **Display**: Format as dollars ($31.50)
- **Consistency**: Use throughout dashboard

### 7. Date Range Filtering
- **Presets**: Today, This Week, This Month
- **Custom**: Date range picker for custom periods
- **Default**: This Month

### 8. Admin Revenue Dashboard
- **Access**: Admins can view all manager revenues
- **Aggregation**: Platform-wide metrics
- **Filtering**: By manager, location, date range

---

## 🏗️ Architecture Overview

### Backend Services

1. **Revenue Service** (`server/services/revenue-service.ts`)
   - Calculate manager revenue (dynamic fee)
   - Aggregate revenue metrics
   - Generate payout statements

2. **Stripe Payout Service** (`server/services/stripe-payout-service.ts`)
   - Configure automatic payouts
   - Track payout status
   - Retrieve payout history

3. **Invoice Service** (extend existing)
   - Generate manager payout statements
   - Retrieve booking invoices for managers

### Database Changes

1. **Platform Settings**
   - Add `service_fee_rate` setting (default: 0.05 for 5%)
   - Add `payout_schedule` setting (default: 'weekly')

2. **New Tables** (if needed)
   - `payout_statements` - Store generated payout statements
   - `revenue_snapshots` - Optional: cache revenue metrics

### API Endpoints

#### Manager Revenue Endpoints
- `GET /api/manager/revenue/overview` - Revenue metrics
- `GET /api/manager/revenue/transactions` - Transaction history
- `GET /api/manager/revenue/charts` - Chart data
- `GET /api/manager/revenue/invoices` - Booking invoices
- `GET /api/manager/revenue/payout-statements` - Payout statements
- `GET /api/manager/revenue/payouts` - Stripe payouts

#### Admin Revenue Endpoints
- `GET /api/admin/revenue/all-managers` - All manager revenues
- `GET /api/admin/revenue/platform-overview` - Platform-wide metrics

### Frontend Components

1. **Manager Revenue Dashboard** (`client/src/pages/ManagerRevenueDashboard.tsx`)
   - Revenue overview cards
   - Charts (line, bar, pie)
   - Transaction table
   - Invoice viewer

2. **Admin Revenue Dashboard** (`client/src/pages/AdminRevenueDashboard.tsx`)
   - All managers view
   - Platform metrics
   - Filtering and export

---

## 📝 Implementation Steps

### Phase 1: Foundation (Steps 1-3)
**Goal**: Make system configurable and verify pricing

#### Step 1: Make Service Fee Configurable
- [ ] Create helper function to get service fee from `platform_settings`
- [ ] Update `pricing-service.ts` to use dynamic fee
- [ ] Update all payment endpoints to use dynamic fee
- [ ] Add default service fee (5%) if setting not found
- [ ] Test with different fee percentages (0%, 5%, 20%)

#### Step 2: Verify Pricing Endpoints
- [ ] Review `calculateKitchenBookingPrice` - ✅ Already exists
- [ ] Review storage pricing calculation - ✅ Already exists
- [ ] Review equipment pricing calculation - ✅ Already exists
- [ ] Verify `total_price` is saved in booking creation
- [ ] Test end-to-end booking flow with pricing

#### Step 3: Create Revenue Service
- [ ] Create `server/services/revenue-service.ts`
- [ ] Implement `calculateManagerRevenue()` - dynamic fee calculation
- [ ] Implement `getRevenueMetrics()` - aggregate metrics
- [ ] Implement `getRevenueByLocation()` - per-location breakdown
- [ ] Implement `getRevenueByDateRange()` - date filtering

### Phase 2: Backend APIs (Steps 4-5)
**Goal**: Create all necessary API endpoints

#### Step 4: Manager Revenue API Endpoints
- [ ] `GET /api/manager/revenue/overview` - Main metrics endpoint
- [ ] `GET /api/manager/revenue/transactions` - Transaction list with filters
- [ ] `GET /api/manager/revenue/charts` - Chart data (daily/weekly/monthly)
- [ ] `GET /api/manager/revenue/by-location` - Per-location breakdown
- [ ] `GET /api/manager/revenue/invoices` - Booking invoices list
- [ ] `GET /api/manager/revenue/invoices/:id` - Single invoice download
- [ ] `GET /api/manager/revenue/payout-statements` - Payout statements
- [ ] `GET /api/manager/revenue/payouts` - Stripe payout history

#### Step 5: Admin Revenue API Endpoints
- [ ] `GET /api/admin/revenue/all-managers` - All managers with revenue
- [ ] `GET /api/admin/revenue/platform-overview` - Platform totals
- [ ] `GET /api/admin/revenue/manager/:managerId` - Specific manager details
- [ ] `GET /api/admin/revenue/export` - Export revenue data (CSV)

### Phase 3: Stripe Connect Payouts (Step 6)
**Goal**: Implement automatic weekly payouts

#### Step 6: Stripe Payout Service
- [ ] Create `server/services/stripe-payout-service.ts`
- [ ] Implement `configurePayoutSchedule()` - Set weekly schedule
- [ ] Implement `getPayoutHistory()` - Retrieve payouts
- [ ] Implement `getPendingBalance()` - Check pending balance
- [ ] Add webhook handler for payout events
- [ ] Create admin endpoint to configure payout schedule

### Phase 4: Frontend Dashboard (Steps 7-8)
**Goal**: Build manager revenue dashboard UI

#### Step 7: Manager Revenue Dashboard UI
- [ ] Create `ManagerRevenueDashboard.tsx` page
- [ ] Revenue overview cards (Total, Net, Pending, Average)
- [ ] Revenue trend chart (line/area chart)
- [ ] Revenue by location chart (bar chart)
- [ ] Payment status distribution (pie chart)
- [ ] Transaction history table with filters
- [ ] Date range picker (Today, This Week, This Month, Custom)
- [ ] Location filter dropdown
- [ ] Export functionality

#### Step 8: Invoice Management UI
- [ ] Invoice list view (booking invoices)
- [ ] Payout statement viewer
- [ ] Invoice detail modal/page
- [ ] PDF download functionality
- [ ] Invoice search and filtering

### Phase 5: Admin Dashboard (Step 9)
**Goal**: Admin revenue oversight

#### Step 9: Admin Revenue Dashboard
- [ ] Create `AdminRevenueDashboard.tsx` page
- [ ] Platform-wide revenue metrics
- [ ] All managers revenue table
- [ ] Manager revenue detail view
- [ ] Export functionality
- [ ] Date range and manager filtering

### Phase 6: Integration & Testing (Steps 10-11)
**Goal**: Finalize and test

#### Step 10: Integration
- [ ] Add revenue dashboard link to manager navigation
- [ ] Add admin revenue link to admin navigation
- [ ] Update routing
- [ ] Add loading states and error handling
- [ ] Responsive design testing

#### Step 11: Testing & Documentation
- [ ] Test with multiple locations
- [ ] Test with different service fees
- [ ] Test date range filtering
- [ ] Test invoice generation
- [ ] Test Stripe payout integration
- [ ] Write API documentation
- [ ] Create user guide

---

## 🔧 Technical Details

### Service Fee Configuration

```typescript
// Get service fee from platform_settings
async function getServiceFeeRate(dbPool: Pool): Promise<number> {
  const result = await dbPool.query(
    'SELECT value FROM platform_settings WHERE key = $1',
    ['service_fee_rate']
  );
  
  if (result.rows.length === 0) {
    return 0.05; // Default 5%
  }
  
  return parseFloat(result.rows[0].value) || 0.05;
}

// Calculate manager revenue
function calculateManagerRevenue(
  totalRevenue: number,
  serviceFeeRate: number
): number {
  return Math.round(totalRevenue * (1 - serviceFeeRate));
}
```

### Revenue Metrics Structure

```typescript
interface RevenueMetrics {
  totalRevenue: number;        // Total booking revenue (cents)
  platformFee: number;         // Platform commission (cents)
  managerRevenue: number;       // Manager earnings (cents)
  pendingPayments: number;     // Unpaid bookings (cents)
  completedPayments: number;   // Paid bookings (cents)
  averageBookingValue: number; // Average per booking (cents)
  bookingCount: number;        // Total bookings
  paidBookingCount: number;    // Paid bookings
}
```

### Stripe Payout Configuration

```typescript
// Configure weekly payouts for Connect account
async function configureWeeklyPayouts(accountId: string) {
  await stripe.accounts.update(accountId, {
    settings: {
      payouts: {
        schedule: {
          interval: 'weekly',
          weekly_anchor: 'monday', // Payout every Monday
        },
      },
    },
  });
}
```

---

## 📊 Database Queries

### Revenue Aggregation Query

```sql
-- Get revenue metrics for a manager
SELECT 
  COALESCE(SUM(kb.total_price), 0) as total_revenue,
  COALESCE(SUM(kb.service_fee), 0) as platform_fee,
  COALESCE(SUM(kb.total_price - kb.service_fee), 0) as manager_revenue,
  COUNT(*) as booking_count,
  COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END) as paid_count,
  AVG(kb.total_price) as avg_booking_value
FROM kitchen_bookings kb
JOIN kitchens k ON kb.kitchen_id = k.id
JOIN locations l ON k.location_id = l.id
WHERE l.manager_id = $1
  AND kb.booking_date >= $2
  AND kb.booking_date <= $3
  AND kb.status != 'cancelled';
```

---

## 🎨 UI/UX Design

### Manager Revenue Dashboard Layout

```
┌─────────────────────────────────────────────────────────┐
│  Revenue Dashboard                    [Date Range ▼]   │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│  │  Total   │  │   Net    │  │  Pending │  │ Average ││
│  │ Revenue  │  │ Revenue  │  │ Payments │  │ Booking ││
│  │ $12,450  │  │ $11,828  │  │  $622    │  │  $155   ││
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘│
├─────────────────────────────────────────────────────────┤
│  Revenue Trend (Line Chart)                             │
│  [Chart showing revenue over time]                      │
├─────────────────────────────────────────────────────────┤
│  Revenue by Location (Bar Chart)    [Location Filter ▼] │
│  [Chart showing revenue per location]                    │
├─────────────────────────────────────────────────────────┤
│  Recent Transactions                                    │
│  [Table with booking details, amounts, status]          │
└─────────────────────────────────────────────────────────┘
```

---

## ✅ Success Criteria

1. ✅ Service fee is configurable and dynamic
2. ✅ All pricing endpoints work correctly
3. ✅ Managers can view comprehensive revenue metrics
4. ✅ Managers can view and download invoices
5. ✅ Stripe Connect payouts are automatic and tracked
6. ✅ Multi-location filtering works correctly
7. ✅ Date range filtering works (Today, Week, Month, Custom)
8. ✅ Admin can view all manager revenues
9. ✅ All amounts display in dollars (formatted)
10. ✅ System is production-ready and tested

---

## 🚀 Next Steps

1. **Start with Step 1**: Make service fee configurable
2. **Verify Step 2**: Test all pricing endpoints
3. **Build Step 3**: Create revenue service
4. **Continue sequentially** through all steps

---

## 📚 References

- Stripe Connect Documentation: https://docs.stripe.com/connect
- Stripe Payouts: https://docs.stripe.com/payouts
- Recharts Documentation: https://recharts.org/
- Industry Best Practices: Research completed

---

**Status**: Ready for implementation  
**Estimated Time**: 8-10 hours of development  
**Priority**: High - Core feature for manager portal
