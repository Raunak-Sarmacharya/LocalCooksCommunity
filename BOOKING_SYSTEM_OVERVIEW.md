# Kitchen Booking System - Complete Overview

## 🎯 System Architecture

This document provides a comprehensive end-to-end overview of the Kitchen Booking System, covering both the **Manager Portal** (for setting availability) and the **Chef Portal** (for making bookings).

---

## 📋 Table of Contents

1. [Manager Side - Setting Availability](#manager-side---setting-availability)
2. [Chef Side - Making Bookings](#chef-side---making-bookings)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Business Logic & Validation](#business-logic--validation)
6. [UI/UX Best Practices](#uiux-best-practices)

---

## 🏢 Manager Side - Setting Availability

### Purpose
Managers can set when their kitchens are available for booking, similar to how restaurant managers set operating hours on booking platforms like OpenTable.

### Key Features

#### 1. **Weekly Schedule**
- Set regular weekly availability (e.g., "Open Monday-Friday 9 AM - 5 PM")
- Stored in `kitchen_availability` table
- Each day of the week (0-6) has its own availability settings

#### 2. **Date Overrides**
- Override weekly schedule for specific dates
- Use cases:
  - **Close for holidays** (e.g., Christmas Day)
  - **Special hours** (e.g., Extended hours for events)
  - **Maintenance days**
- Stored in `kitchen_date_overrides` table

#### 3. **Booking Conflict Prevention**
- **Server-side validation**: Cannot close dates with confirmed bookings
- **Client-side warnings**: Visual indicators and confirmation dialogs
- **Real-time feedback**: See existing bookings when editing availability

### UI Components

**File**: `client/src/pages/KitchenAvailabilityManagement.tsx`

#### Visual Indicators:
- 🟢 **Green dates**: Kitchen is open/available
- 🔴 **Red dates**: Kitchen is closed
- 🔵 **Blue dot**: Has confirmed bookings
- ⚠️ **Warnings**: When trying to close dates with bookings

#### Calendar Features:
- Month view with navigation
- Click any date to set/edit availability
- Visual booking indicators
- Time slot preview

### Manager API Endpoints

```typescript
// Get date overrides for a kitchen
GET /api/manager/kitchens/:kitchenId/date-overrides

// Create date override
POST /api/manager/kitchens/:kitchenId/date-overrides
Body: {
  specificDate: "2025-12-25",
  isAvailable: false,
  reason: "Christmas Holiday"
}

// Update date override
PUT /api/manager/date-overrides/:id
Body: { isAvailable: true, startTime: "10:00", endTime: "18:00" }

// Delete date override
DELETE /api/manager/date-overrides/:id

// Get bookings for a kitchen (to check conflicts)
GET /api/manager/kitchens/:kitchenId/bookings
```

---

## 👨‍🍳 Chef Side - Making Bookings

### Purpose
Chefs can browse available kitchens, view available time slots, and book kitchen time for their culinary needs.

### Redesigned UI (Cal.com/Calendly Style)

**File**: `client/src/pages/KitchenBookingCalendar.tsx`

#### 3-Step Booking Process

**Step 1: Select Kitchen**
- Browse kitchens grouped by location
- See manager information
- View kitchen descriptions
- One-click selection

**Step 2: Choose Date**
- **Month view calendar** (not just a date picker)
- Visual indicators:
  - Gray = Past/unavailable dates
  - White = Available dates
  - Blue = Selected date
  - Border highlight = Today
- Month navigation (prev/next)
- Only current month dates are clickable

**Step 3: Select Time**
- **30-minute interval slots** (09:00, 09:30, 10:00, etc.)
- Only shows available slots (already booked slots are filtered out)
- Large, clickable time buttons
- Visual feedback on selection
- Real-time availability checking

#### Booking Modal
- Summary of selection (kitchen, date, start time)
- End time picker (validated to be after start time)
- Special notes/requirements field (optional)
- Character counter (500 max)
- Clear action buttons
- Loading states during submission

### Chef API Endpoints

```typescript
// Get all available kitchens
GET /api/chef/kitchens
Response: Array of kitchens with location and manager info

// Get available time slots for a specific date
GET /api/chef/kitchens/:kitchenId/availability?date=2025-10-30
Response: ["09:00", "09:30", "10:00", "10:30", ...]

// Create a booking
POST /api/chef/bookings
Body: {
  kitchenId: 1,
  bookingDate: "2025-10-30T00:00:00.000Z",
  startTime: "09:00",
  endTime: "11:30",
  specialNotes: "Need extra prep space"
}

// Cancel a booking
PUT /api/chef/bookings/:id/cancel

// Get my bookings
GET /api/chef/bookings
```

---

## 🗄️ Database Schema

### 1. `kitchens` Table
```sql
- id: Primary key
- locationId: Foreign key to locations
- name: Kitchen name
- description: Kitchen description
- isActive: Boolean (only active kitchens shown to chefs)
```

### 2. `kitchen_availability` Table (Weekly Schedule)
```sql
- id: Primary key
- kitchenId: Foreign key to kitchens
- dayOfWeek: 0-6 (Sunday-Saturday)
- isAvailable: Boolean
- startTime: "09:00"
- endTime: "17:00"
```

### 3. `kitchen_date_overrides` Table (Special Dates)
```sql
- id: Primary key
- kitchenId: Foreign key to kitchens
- specificDate: Date
- isAvailable: Boolean
- startTime: Optional custom hours
- endTime: Optional custom hours
- reason: Why this override exists
```

### 4. `kitchen_bookings` Table
```sql
- id: Primary key
- kitchenId: Foreign key to kitchens
- chefId: Foreign key to users
- bookingDate: Date
- startTime: "09:00"
- endTime: "11:30"
- status: "pending" | "confirmed" | "cancelled"
- specialNotes: Text
- createdAt, updatedAt: Timestamps
```

---

## 🔧 API Endpoints Reference

### Authentication
All endpoints require authentication:
- **Chef endpoints**: `requireChef` middleware (Firebase Auth + Session)
- **Manager endpoints**: Manager role check (Session + Firebase Auth)

### Manager Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/manager/kitchens/:kitchenId/date-overrides` | List all date overrides |
| POST | `/api/manager/kitchens/:kitchenId/date-overrides` | Create date override |
| PUT | `/api/manager/date-overrides/:id` | Update date override |
| DELETE | `/api/manager/date-overrides/:id` | Delete date override |
| GET | `/api/manager/kitchens/:kitchenId/bookings` | Get bookings (for conflict checking) |

### Chef Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/chef/kitchens` | List all active kitchens |
| GET | `/api/chef/kitchens/:kitchenId/availability` | Get available slots for date |
| POST | `/api/chef/bookings` | Create a booking |
| GET | `/api/chef/bookings` | Get chef's bookings |
| PUT | `/api/chef/bookings/:id/cancel` | Cancel a booking |

---

## ✅ Business Logic & Validation

### Slot Generation Algorithm

**File**: `server/storage-firebase.ts` → `getAvailableTimeSlots()`

#### Process:
1. **Check for date override** for the specific date
   - If override exists and `isAvailable = false` → Return empty array
   - If override exists with custom hours → Use those hours
   
2. **Fall back to weekly schedule** if no override
   - Get day of week (0-6)
   - Look up in `kitchen_availability` table
   - If not available → Return empty array

3. **Generate 30-minute interval slots**
   ```typescript
   for (let hour = startHour; hour < endHour; hour++) {
     slots.push(`${hour}:00`);
     slots.push(`${hour}:30`);
   }
   ```

4. **Filter out booked slots**
   - Get all bookings for the kitchen on that date
   - For each booking, mark all overlapping 30-min slots as unavailable
   - Remove unavailable slots from the list

### Conflict Checking

#### On Creating Date Override:
```typescript
// POST /api/manager/kitchens/:kitchenId/date-overrides
if (!isAvailable) { // Trying to close
  const bookings = await getBookingsByKitchen(kitchenId);
  const bookingsOnDate = bookings.filter(/* date matches & confirmed */);
  
  if (bookingsOnDate.length > 0) {
    return 400 error with booking details
  }
}
```

#### On Updating Date Override:
```typescript
// PUT /api/manager/date-overrides/:id
if (isAvailable === false) { // Changing to closed
  // Same conflict check as above
}
```

### Booking Validation

#### On Creating Booking:
```typescript
// POST /api/chef/bookings
1. Validate required fields (kitchenId, date, times)
2. Check if kitchen exists and is active
3. Validate booking time is within available hours
4. Check for time conflicts with existing bookings
5. Create booking with status "pending" or "confirmed"
```

---

## 🎨 UI/UX Best Practices

### Design Principles (Following Cal.com/Calendly)

#### 1. **Progressive Disclosure**
- Show one step at a time
- Clear numbered steps (1, 2, 3)
- Context carried forward (show selected kitchen when choosing date)

#### 2. **Visual Hierarchy**
- Large, clickable elements
- Clear color coding (green = available, red = closed, blue = selected)
- White space for breathing room

#### 3. **Feedback & Validation**
- Loading states for async operations
- Success/error toasts
- Inline validation messages
- Confirmation dialogs for destructive actions

#### 4. **Accessibility**
- Semantic HTML
- ARIA labels on buttons
- Keyboard navigation support
- High contrast colors

#### 5. **Responsive Design**
- Mobile-first approach
- Touch-friendly tap targets
- Adaptive layouts (grid → stack on mobile)

### Color Scheme

```css
/* Status Colors */
✅ Green (#10B981): Available/Open
❌ Red (#EF4444): Closed/Unavailable
🔵 Blue (#3B82F6): Selected/Bookings
⚠️ Yellow (#F59E0B): Warnings
⚫ Gray (#6B7280): Disabled/Past
```

---

## 🔄 Complete User Flow

### Manager Flow

1. **Login** → Manager Dashboard
2. **Select Kitchen** → From their assigned location
3. **View Calendar** → Month view with existing availability
4. **Click Date** → Opens edit modal
5. **Set Availability**:
   - Toggle open/closed
   - Set custom hours
   - Add reason (optional)
6. **Review Bookings** → See warning if date has bookings
7. **Confirm** → Server validates and saves
8. **Visual Feedback** → Calendar updates with color coding

### Chef Flow

1. **Login** → Chef Dashboard
2. **Navigate to Bookings** → "Book a Kitchen" page
3. **Browse Kitchens** → Grouped by location, with descriptions
4. **Select Kitchen** → Kitchen card highlighted
5. **Choose Date** → Interactive calendar, only future dates
6. **View Time Slots** → Grid of available 30-min slots
7. **Select Time** → Slot highlighted
8. **Booking Modal** → Enter end time and notes
9. **Submit** → Server validates availability
10. **Confirmation** → Toast notification + booking appears in sidebar

---

## 🔐 Security & Authorization

### Authentication Layers

1. **Firebase Authentication** (Primary)
   - Token-based auth
   - Validated on each request
   - User roles enforced

2. **Session-based Authentication** (Fallback)
   - Express session
   - Cookie-based
   - Used for managers

### Role-Based Access Control

```typescript
// Chef Endpoints
async function requireChef(req, res, next) {
  const user = await authenticateUser(req);
  if (!user) return 401;
  if (user.role !== 'chef') return 403;
  next();
}

// Manager Endpoints
// Inline checks in each route:
const user = await getAuthenticatedUser(req);
if (user.role !== 'manager') return 403;
```

### Data Isolation

- **Chefs**: Only see active kitchens, own bookings
- **Managers**: Only see their location's kitchens and bookings
- **Admins**: Full system access

---

## 📊 Key Improvements Made

### Manager Side
✅ Fixed 404 errors on date-override endpoints
✅ Added inline authentication (replaced undefined middleware)
✅ Server-side validation for booking conflicts
✅ Visual indicators for booked dates
✅ Real-time booking information in edit modal
✅ Client-side warnings before closing booked dates
✅ Improved calendar UX with color coding

### Chef Side
✅ Complete UI redesign (Calendly-style)
✅ Month view calendar (not just date picker)
✅ 30-minute interval slots (was hourly)
✅ Better slot availability algorithm
✅ Improved API error handling
✅ Progressive booking flow (3 clear steps)
✅ Real-time slot updates after booking
✅ Better loading and error states
✅ Mobile-responsive design

---

## 🚀 Testing the System

### Test Scenario 1: Manager Sets Availability

1. Login as manager
2. Navigate to Kitchen Availability
3. Select a kitchen
4. Click a future date
5. Set custom hours (e.g., 9 AM - 5 PM)
6. Save and verify green indicator on calendar

### Test Scenario 2: Chef Books Kitchen

1. Login as chef
2. Go to "Book a Kitchen"
3. Select a kitchen
4. Choose date with availability
5. Verify time slots appear (30-min intervals)
6. Select slot and complete booking
7. Verify booking appears in sidebar

### Test Scenario 3: Booking Conflict Prevention

1. As chef, create a booking for a specific date/time
2. As manager, try to close that date
3. Verify warning message appears
4. Verify server returns 400 error if manager proceeds
5. Cancel booking as chef
6. Retry closing date as manager
7. Verify success

---

## 📝 Files Modified

### Frontend
- `client/src/pages/KitchenBookingCalendar.tsx` (Complete redesign)
- `client/src/pages/KitchenAvailabilityManagement.tsx` (Enhanced with booking info)
- `client/src/hooks/use-kitchen-bookings.ts` (Already good)

### Backend
- `server/routes.ts` (Fixed authentication, added validation)
- `server/storage-firebase.ts` (Improved slot generation to 30-min intervals)

### Documentation
- `BOOKING_SYSTEM_OVERVIEW.md` (This file)

---

## 🎓 Learning from Best Practices

This system follows patterns from industry-leading booking platforms:

### From Cal.com:
- Progressive disclosure (step-by-step)
- Month calendar view
- 30-minute slot intervals
- Clear visual hierarchy
- Real-time availability

### From OpenTable:
- Conflict prevention
- Manager/customer separation
- Status indicators
- Booking management

### From Calendly:
- Smooth booking flow
- Minimal clicks to book
- Clear time selection
- Confirmation modals

---

## 🐛 Debugging Tips

### Common Issues

#### "No slots available"
- Check manager has set availability for that day of week
- Verify no date override is closing the kitchen
- Check all slots aren't already booked

#### 404 on date-overrides
- Verify manager authentication is working
- Check Firebase token is being sent
- Verify user role is "manager"

#### Bookings not showing
- Check chef authentication
- Verify booking status is "confirmed" or "pending"
- Check date filtering logic

### Debug Logging

```typescript
// Backend logs to check:
🔍 = Fetching/querying data
✅ = Success responses
❌ = Errors
📅 = Slot generation details
📦 = Data samples
```

---

## 📞 Support

For issues or questions about the booking system:
1. Check this documentation first
2. Review console logs for detailed errors
3. Test with authentication tokens in browser DevTools
4. Verify database records directly if needed

---

**Last Updated**: October 29, 2025
**Version**: 2.0 (Complete redesign)
**Status**: ✅ Production Ready

