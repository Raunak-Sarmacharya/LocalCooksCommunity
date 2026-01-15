# Route Reconciliation Audit Report

Generated: 2026-01-15T18:58:15.769Z

## Executive Summary

- **TypeScript Routes (server/routes.ts):** 159 routes
- **Firebase Routes (server/firebase-routes.ts):** 44 routes
- **Total TypeScript Routes:** 203 routes
- **Production Routes (api/index.js):** 252 routes
- **Route Divergence:** 49 routes

## Route Count Breakdown

### By Source File

| Source | Route Count |
|--------|-------------|
| server/routes.ts | 159 |
| server/firebase-routes.ts | 44 |
| **Total TypeScript** | **203** |
| api/index.js (Production) | 252 |
| **Difference** | **49** |

### By HTTP Method

#### TypeScript Routes
| Method | Count |
|--------|-------|
| GET | 99 |
| POST | 63 |
| PUT | 19 |
| PATCH | 13 |
| DELETE | 9 |

#### Production Routes
| Method | Count |
|--------|-------|
| GET | 123 |
| POST | 88 |
| PUT | 19 |
| DELETE | 11 |
| PATCH | 10 |
| USE | 1 |

## Phantom Routes (Only in Production)

**Total: 83 routes**

These routes exist in production (api/index.js) but are NOT found in TypeScript source files.

- **POST /api/admin-migrate-login** (line 1600 in index.js)
- **POST /api/manager-migrate-login** (line 1854 in index.js)
- **GET /api/debug/user-sync/:uid** (line 2115 in index.js)
- **POST /api/login** (line 2155 in index.js)
- **POST /api/logout** (line 2160 in index.js)
- **POST /api/manager/forgot-password** (line 2531 in index.js)
- **POST /api/manager/reset-password** (line 2641 in index.js)
- **GET /api/user-OLD** (line 2721 in index.js)
- **POST /api/debug/reset-welcome** (line 2914 in index.js)
- **POST /api/user/reset-welcome** (line 2965 in index.js)
- **GET /api/debug/welcome-status** (line 3016 in index.js)
- **GET /api/user-session** (line 3075 in index.js)
- **GET /api/health** (line 3080 in index.js)
- **GET /api/session-test** (line 3119 in index.js)
- **GET /api/debug-auth/:userId** (line 3145 in index.js)
- **GET /api/init-db** (line 4166 in index.js)
- **GET /api/files/kitchen-license/:locationId** (line 4336 in index.js)
- **GET /api/files/kitchen-license/manager/:locationId** (line 4509 in index.js)
- **GET /api/files/r2-presigned** (line 4610 in index.js)
- **GET /api/files/r2-proxy** (line 4720 in index.js)
- **GET /api/debug/applications/:id/documents** (line 5380 in index.js)
- **GET /api/debug/applications** (line 5437 in index.js)
- **POST /api/force-create-admin** (line 5752 in index.js)
- **GET /api/debug-admin** (line 5804 in index.js)
- **GET /api/document-verification** (line 5850 in index.js)
- **GET /api/admin/sessions/stats** (line 5915 in index.js)
- **POST /api/admin/sessions/cleanup** (line 5920 in index.js)
- **POST /api/admin/sessions/cleanup-old** (line 5925 in index.js)
- **GET /api/microlearning/certificate-status/:userId** (line 6571 in index.js)
- **POST /api/debug/test-full-verification-email** (line 6939 in index.js)
- **GET /api/delivery-partner-applications** (line 8719 in index.js)
- **PUT /api/firebase/delivery-partner-applications/:id** (line 8768 in index.js)
- **PATCH /api/delivery-partner-applications/:id/document-verification** (line 8839 in index.js)
- **PATCH /api/delivery-partner-applications/:id/cancel** (line 8971 in index.js)
- **GET /api/firebase/microlearning/progress/:userId** (line 9211 in index.js)
- **POST /api/firebase/microlearning/complete** (line 9332 in index.js)
- **GET /api/firebase/microlearning/completion/:userId** (line 9384 in index.js)
- **GET /api/firebase/microlearning/certificate/:userId** (line 9425 in index.js)
- **POST /api/firebase/upload-file** (line 9553 in index.js)
- **POST /api/sync-admin-to-firebase** (line 10033 in index.js)
- **POST /api/find-login-info** (line 10133 in index.js)
- **GET /api/hybrid/user/profile** (line 10211 in index.js)
- **GET /api/hybrid/applications** (line 10245 in index.js)
- **GET /api/hybrid/admin/dashboard** (line 10268 in index.js)
- **GET /api/auth-status** (line 10299 in index.js)
- **POST /api/debug-login** (line 10405 in index.js)
- **GET /api/test-admin** (line 10498 in index.js)
- **GET /api/debug-session** (line 10534 in index.js)
- **POST /api/hybrid-login** (line 10564 in index.js)
- **GET /api/test-applications-auth** (line 10827 in index.js)
- **GET /api/test-auth** (line 10883 in index.js)
- **GET /api/debug-hybrid-login** (line 10922 in index.js)
- **GET /api/verify-auth-methods** (line 10973 in index.js)
- **POST /api/check-user-exists** (line 11266 in index.js)
- **POST /api/debug/check-firebase-user** (line 11306 in index.js)
- **POST /api/debug/delete-firebase-user** (line 11377 in index.js)
- **POST /api/sync-verification-status** (line 11447 in index.js)
- **POST /api/test-email-delivery** (line 11506 in index.js)
- **POST /api/test-welcome-as-status** (line 11579 in index.js)
- **POST /api/test-email-comparison** (line 11624 in index.js)
- **POST /api/test-identical-subject** (line 11713 in index.js)
- **POST /api/test-delayed-email** (line 11764 in index.js)
- **POST /api/comprehensive-email-diagnostic** (line 11821 in index.js)
- **GET /test-subject** (line 11997 in index.js)
- **POST /api/debug-google-registration** (line 12264 in index.js)
- **PUT /api/manager/locations/:id** (line 17477 in index.js)
- **DELETE /api/manager/chef-location-access/:chefId/:locationId** (line 18410 in index.js)
- **POST /api/admin/change-password** (line 18762 in index.js)
- **GET /api/chef/kitchens/:kitchenId/policy** (line 19907 in index.js)
- **PUT /api/chef/bookings/:bookingId/cancel** (line 21397 in index.js)
- **POST /api/admin/chef-kitchen-access** (line 22234 in index.js)
- **DELETE /api/admin/chef-kitchen-access** (line 22275 in index.js)
- **GET /api/admin/chef-kitchen-access** (line 22307 in index.js)
- **PUT /api/admin/locations/:locationId/kitchen-license** (line 22511 in index.js)
- **GET /api/admin/locations/pending-licenses** (line 22575 in index.js)
- **GET /api/public/locations/:locationSlug** (line 22839 in index.js)
- **GET /api/public/locations/:locationSlug/kitchens** (line 22873 in index.js)
- **GET /api/public/kitchens/:kitchenId/availability** (line 23074 in index.js)
- **GET /api/portal/kitchens/:kitchenId/slots** (line 24043 in index.js)
- **GET /api/portal/kitchens/:kitchenId/policy** (line 24261 in index.js)
- **GET /api/portal/bookings** (line 24867 in index.js)
- **GET /api/files/r2-proxy/test** (line 25352 in index.js)
- **USE /api/*** (line 25411 in index.js)

## Missing Routes (Only in TypeScript)

**Total: 30 routes**

These routes exist in TypeScript source but are NOT found in production.

- **GET /api/auth/facebook** (line 116 in routes.ts)
- **GET /api/auth/facebook/callback** (line 130 in routes.ts)
- **GET /api/auth/instagram** (line 158 in routes.ts)
- **GET /api/auth/instagram/callback** (line 171 in routes.ts)
- **POST /api/test-document-status-email** (line 773 in routes.ts)
- **GET /api/user-exists** (line 927 in routes.ts)
- **POST /api/unsubscribe** (line 2387 in routes.ts)
- **GET /api/vehicles/preload** (line 2579 in routes.ts)
- **GET /api/manager/revenue/payouts/:payoutId** (line 5062 in routes.ts)
- **GET /api/manager/revenue/payouts/:payoutId/statement** (line 5174 in routes.ts)
- **GET /api/manager/bookings/:id** (line 6682 in routes.ts)
- **GET /api/chef/kitchens/:kitchenId/availability** (line 7566 in routes.ts)
- **GET /api/chef/storage-bookings** (line 8833 in routes.ts)
- **GET /api/chef/storage-bookings/:id** (line 8844 in routes.ts)
- **POST /api/admin/storage-bookings/process-overstayer-penalties** (line 8869 in routes.ts)
- **PUT /api/chef/storage-bookings/:id/extend** (line 8890 in routes.ts)
- **PUT /api/chef/bookings/:id/cancel** (line 9047 in routes.ts)
- **PUT /api/admin/kitchens/:id** (line 10599 in routes.ts)
- **PUT /api/admin/managers/:id** (line 10765 in routes.ts)
- **GET /api/portal/my-location** (line 11271 in routes.ts)
- **GET /api/public/kitchens/:kitchenId/availability-preview** (line 12322 in routes.ts)
- **GET /api/public/stats** (line 12402 in routes.ts)
- **POST /api/firebase/user/update-application-type** (line 781 in firebase-routes.ts)
- **PATCH /api/firebase/applications/:id/cancel** (line 872 in firebase-routes.ts)
- **PATCH /api/firebase/delivery-partner-applications/:id/cancel** (line 935 in firebase-routes.ts)
- **PATCH /api/firebase/admin/applications/:id/cancel** (line 998 in firebase-routes.ts)
- **PATCH /api/firebase/admin/delivery-partner-applications/:id/cancel** (line 1119 in firebase-routes.ts)
- **GET /api/vehicles/decode-vin/:vin** (line 2092 in firebase-routes.ts)
- **PATCH /api/firebase/chef/kitchen-applications/:id/documents** (line 2590 in firebase-routes.ts)
- **GET /api/manager/kitchen-applications/location/:locationId** (line 2686 in firebase-routes.ts)

## Routes Present in Both

**Total: 169 routes**

These routes exist in both TypeScript and production. They may have different implementations or middleware.

- **POST /api/webhooks/stripe**
  - TypeScript: routes.ts:3921
  - Production: index.js:178

- **POST /api/admin-login**
  - TypeScript: routes.ts:822
  - Production: index.js:1593

- **POST /api/register**
  - TypeScript: routes.ts:813
  - Production: index.js:2150

- **GET /api/get-users**
  - TypeScript: routes.ts:940
  - Production: index.js:2165

- **POST /api/firebase/forgot-password**
  - TypeScript: firebase-routes.ts:161
  - Production: index.js:2255

- **POST /api/firebase/reset-password**
  - TypeScript: firebase-routes.ts:251
  - Production: index.js:2402

- **GET /api/user**
  - TypeScript: firebase-routes.ts:510
  - Production: index.js:2716

- **POST /api/user/seen-welcome**
  - TypeScript: routes.ts:2372
  - Production: index.js:2835

- **POST /api/applications**
  - TypeScript: routes.ts:199
  - Production: index.js:3205

- **GET /api/applications**
  - TypeScript: routes.ts:408
  - Production: index.js:3574

- **GET /api/applications/my-applications**
  - TypeScript: routes.ts:428
  - Production: index.js:3693

- **GET /api/applications/:id**
  - TypeScript: routes.ts:445
  - Production: index.js:3839

- **PATCH /api/applications/:id/cancel**
  - TypeScript: routes.ts:623
  - Production: index.js:3892

- **PATCH /api/applications/:id/status**
  - TypeScript: routes.ts:467
  - Production: index.js:4049

- **GET /api/files/documents/:filename**
  - TypeScript: routes.ts:1155
  - Production: index.js:4194

- **POST /api/images/presigned-url**
  - TypeScript: routes.ts:1094
  - Production: index.js:4872

- **PATCH /api/applications/:id/documents**
  - TypeScript: routes.ts:1213
  - Production: index.js:4963

- **PATCH /api/applications/:id/document-verification**
  - TypeScript: routes.ts:1393
  - Production: index.js:5188

- **POST /api/upload**
  - TypeScript: firebase-routes.ts:843
  - Production: index.js:5489

- **POST /api/upload-file**
  - TypeScript: routes.ts:1024
  - Production: index.js:5589

- **GET /api/microlearning/progress/:userId**
  - TypeScript: routes.ts:1508
  - Production: index.js:6271

- **POST /api/microlearning/progress**
  - TypeScript: routes.ts:1546
  - Production: index.js:6350

- **POST /api/microlearning/complete**
  - TypeScript: routes.ts:1601
  - Production: index.js:6442

- **GET /api/microlearning/completion/:userId**
  - TypeScript: routes.ts:1698
  - Production: index.js:6512

- **GET /api/microlearning/certificate/:userId**
  - TypeScript: routes.ts:1725
  - Production: index.js:6617

- **POST /api/test-status-email**
  - TypeScript: routes.ts:698
  - Production: index.js:6846

- **POST /api/test-verification-email**
  - TypeScript: routes.ts:735
  - Production: index.js:6893

- **POST /api/firebase-sync-user**
  - TypeScript: firebase-routes.ts:337
  - Production: index.js:7051

- **POST /api/firebase-register-user**
  - TypeScript: firebase-routes.ts:94
  - Production: index.js:7108

- **GET /api/user/profile**
  - TypeScript: firebase-routes.ts:431
  - Production: index.js:8188

- **POST /api/firebase/user/update-roles**
  - TypeScript: firebase-routes.ts:809
  - Production: index.js:8292

- **POST /api/firebase/applications**
  - TypeScript: firebase-routes.ts:564
  - Production: index.js:8378

- **GET /api/firebase/applications/my**
  - TypeScript: firebase-routes.ts:649
  - Production: index.js:8441

- **GET /api/firebase/admin/applications**
  - TypeScript: firebase-routes.ts:664
  - Production: index.js:8468

- **GET /api/firebase/dashboard**
  - TypeScript: firebase-routes.ts:678
  - Production: index.js:8490

- **POST /api/firebase/delivery-partner-applications**
  - TypeScript: firebase-routes.ts:711
  - Production: index.js:8534

- **GET /api/firebase/delivery-partner-applications/my**
  - TypeScript: firebase-routes.ts:752
  - Production: index.js:8672

- **GET /api/firebase/admin/delivery-partner-applications**
  - TypeScript: firebase-routes.ts:767
  - Production: index.js:8697

- **PATCH /api/delivery-partner-applications/:id/status**
  - TypeScript: routes.ts:545
  - Production: index.js:9121

- **POST /api/firebase/microlearning/progress**
  - TypeScript: firebase-routes.ts:850
  - Production: index.js:9278

- **GET /api/firebase-health**
  - TypeScript: firebase-routes.ts:1177
  - Production: index.js:9651

- **GET /api/platform-settings/service-fee-rate**
  - TypeScript: firebase-routes.ts:2154
  - Production: index.js:9667

- **GET /api/admin/platform-settings/service-fee-rate**
  - TypeScript: firebase-routes.ts:2195
  - Production: index.js:9719

- **PUT /api/admin/platform-settings/service-fee-rate**
  - TypeScript: firebase-routes.ts:2236
  - Production: index.js:9785

- **POST /api/auth/forgot-password**
  - TypeScript: routes.ts:1767
  - Production: index.js:11080

- **POST /api/auth/reset-password**
  - TypeScript: routes.ts:1830
  - Production: index.js:11107

- **POST /api/auth/send-verification-email**
  - TypeScript: routes.ts:1870
  - Production: index.js:11153

- **GET /api/auth/verify-email**
  - TypeScript: routes.ts:1927
  - Production: index.js:11209

- **POST /api/admin/test-email**
  - TypeScript: routes.ts:2217
  - Production: index.js:12387

- **POST /api/admin/send-company-email**
  - TypeScript: firebase-routes.ts:1192
  - Production: index.js:12538


*... and 119 more routes*

## Recommendations

### For Phantom Routes (83 routes)

1. **Audit each route** to determine if it's:
   - Still in use (check frontend/client code)
   - Deprecated but kept for backward compatibility
   - Orphaned code that can be safely removed

2. **Action Items:**
   
   - [ ] Review each phantom route for usage
   - [ ] Document purpose of routes that should be kept
   - [ ] Create migration plan for routes that need to be added to TypeScript
   - [ ] Remove routes that are no longer needed
   

### For Missing Routes (30 routes)

1. **Verify these routes are needed** in production
2. **If needed:** Ensure they're properly included in the build process
3. **If not needed:** Remove them from TypeScript source

### Next Steps

1. ✅ Complete route audit (this report)
2. ⏳ Review phantom routes and decide: keep, migrate, or remove
3. ⏳ Update migration plan based on audit findings
4. ⏳ Proceed with Phase 2: Route Modularization

## Detailed Route Lists

### All TypeScript Routes (server/routes.ts)

- GET /api/auth/facebook
- GET /api/auth/facebook/callback
- GET /api/auth/instagram
- GET /api/auth/instagram/callback
- POST /api/applications
- GET /api/applications
- GET /api/applications/my-applications
- GET /api/applications/:id
- PATCH /api/applications/:id/status
- PATCH /api/delivery-partner-applications/:id/status
- PATCH /api/applications/:id/cancel
- POST /api/test-status-email
- POST /api/test-verification-email
- POST /api/test-document-status-email
- POST /api/register
- POST /api/admin-login
- GET /api/user-exists
- GET /api/get-users
- POST /api/upload-file
- POST /api/images/presigned-url
- GET /api/files/documents/:filename
- PATCH /api/applications/:id/documents
- PATCH /api/applications/:id/document-verification
- GET /api/microlearning/progress/:userId
- POST /api/microlearning/progress
- POST /api/microlearning/complete
- GET /api/microlearning/completion/:userId
- GET /api/microlearning/certificate/:userId
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
- POST /api/auth/send-verification-email
- GET /api/auth/verify-email
- POST /api/admin/send-promo-email
- POST /api/admin/test-email
- POST /api/user/seen-welcome
- POST /api/unsubscribe
- GET /api/vehicles/preload
- GET /api/vehicles/makes
- GET /api/vehicles/makes/type/:vehicleType
- GET /api/vehicles/models/by-name/:makeName
- GET /api/vehicles/models/:makeId
- GET /api/vehicles/years/:makeId
- PUT /api/manager/locations/:locationId/cancellation-policy
- GET /api/manager/locations
- POST /api/manager/locations
- PUT /api/manager/locations/:locationId
- POST /api/manager/onboarding/step
- POST /api/manager/complete-onboarding
- POST /api/manager/stripe-connect/create
- GET /api/manager/stripe-connect/onboarding-link
- GET /api/manager/stripe-connect/status
- GET /api/manager/stripe-connect/dashboard-link
- POST /api/webhooks/stripe
- GET /api/manager/revenue/overview
- GET /api/manager/revenue/by-location
- POST /api/manager/revenue/sync-payments
- GET /api/manager/payments/booking/:bookingId/status
- POST /api/manager/payments/booking/:bookingId/sync
- POST /api/manager/payments/booking/:bookingId/recover
- GET /api/manager/revenue/charts
- GET /api/manager/revenue/transactions
- GET /api/manager/revenue/invoices
- GET /api/manager/revenue/invoices/:bookingId
- GET /api/manager/revenue/payouts
- GET /api/manager/revenue/payouts/:payoutId
- GET /api/manager/revenue/payouts/:payoutId/statement
- GET /api/manager/kitchens/:locationId
- POST /api/manager/kitchens
- PUT /api/manager/kitchens/:kitchenId/image
- PUT /api/manager/kitchens/:kitchenId/gallery
- DELETE /api/manager/files
- PUT /api/manager/kitchens/:kitchenId
- GET /api/manager/kitchens/:kitchenId/pricing
- PUT /api/manager/kitchens/:kitchenId/pricing
- GET /api/manager/kitchens/:kitchenId/storage-listings
- GET /api/manager/storage-listings/:listingId
- POST /api/manager/storage-listings
- PUT /api/manager/storage-listings/:listingId
- DELETE /api/manager/storage-listings/:listingId
- GET /api/manager/kitchens/:kitchenId/equipment-listings
- GET /api/manager/equipment-listings/:listingId
- POST /api/manager/equipment-listings
- PUT /api/manager/equipment-listings/:listingId
- DELETE /api/manager/equipment-listings/:listingId
- POST /api/manager/availability
- GET /api/manager/availability/:kitchenId
- GET /api/manager/bookings
- GET /api/manager/profile
- PUT /api/manager/profile
- GET /api/manager/chef-profiles
- GET /api/manager/portal-applications
- PUT /api/manager/portal-applications/:id/status
- PUT /api/manager/chef-profiles/:id/status
- DELETE /api/manager/chef-location-access
- GET /api/manager/kitchens/:kitchenId/bookings
- GET /api/manager/bookings/:id
- PUT /api/manager/bookings/:id/status
- GET /api/manager/kitchens/:kitchenId/date-overrides
- POST /api/manager/kitchens/:kitchenId/date-overrides
- PUT /api/manager/date-overrides/:id
- DELETE /api/manager/date-overrides/:id
- GET /api/chef/kitchens
- GET /api/chef/kitchens/:kitchenId/pricing
- GET /api/chef/kitchens/:kitchenId/storage-listings
- GET /api/chef/kitchens/:kitchenId/equipment-listings
- GET /api/chef/locations
- GET /api/chef/kitchens/:kitchenId/slots
- GET /api/chef/kitchens/:kitchenId/availability
- POST /api/payments/create-intent
- POST /api/payments/confirm
- GET /api/payments/intent/:id/status
- POST /api/payments/capture
- POST /api/payments/cancel
- POST /api/chef/bookings
- GET /api/chef/bookings
- POST /api/bookings/checkout
- GET /api/chef/storage-bookings
- GET /api/chef/storage-bookings/:id
- POST /api/admin/storage-bookings/process-overstayer-penalties
- PUT /api/chef/storage-bookings/:id/extend
- GET /api/chef/bookings/:id
- GET /api/bookings/:id/invoice
- PUT /api/chef/bookings/:id/cancel
- POST /api/chef/share-profile
- GET /api/chef/profiles
- GET /api/admin/revenue/all-managers
- GET /api/admin/revenue/platform-overview
- GET /api/admin/revenue/manager/:managerId
- POST /api/admin/chef-location-access
- DELETE /api/admin/chef-location-access
- GET /api/admin/chef-location-access
- POST /api/admin/managers
- GET /api/admin/managers
- POST /api/manager/change-password
- GET /api/admin/locations
- POST /api/admin/locations
- GET /api/admin/kitchens/:locationId
- POST /api/admin/kitchens
- PUT /api/admin/locations/:id
- DELETE /api/admin/locations/:id
- PUT /api/admin/kitchens/:id
- DELETE /api/admin/kitchens/:id
- PUT /api/admin/managers/:id
- DELETE /api/admin/managers/:id
- POST /api/portal-login
- POST /api/portal-register
- GET /api/portal/my-location
- GET /api/portal/application-status
- GET /api/portal/locations
- GET /api/portal/locations/:locationSlug
- GET /api/portal/locations/:locationSlug/kitchens
- GET /api/portal/kitchens/:kitchenId/availability
- POST /api/public/bookings
- POST /api/portal/bookings
- GET /api/public/kitchens
- GET /api/public/locations
- GET /api/public/locations/:locationId/details
- GET /api/public/kitchens/:kitchenId/availability-preview
- GET /api/public/stats

### All Firebase Routes (server/firebase-routes.ts)

- POST /api/firebase-register-user
- POST /api/firebase/forgot-password
- POST /api/firebase/reset-password
- POST /api/firebase-sync-user
- GET /api/user/profile
- GET /api/user
- POST /api/user/seen-welcome
- POST /api/firebase/applications
- GET /api/firebase/applications/my
- GET /api/firebase/admin/applications
- GET /api/firebase/dashboard
- POST /api/firebase/delivery-partner-applications
- GET /api/firebase/delivery-partner-applications/my
- GET /api/firebase/admin/delivery-partner-applications
- POST /api/firebase/user/update-application-type
- POST /api/firebase/user/update-roles
- POST /api/upload
- POST /api/firebase/microlearning/progress
- PATCH /api/firebase/applications/:id/cancel
- PATCH /api/firebase/delivery-partner-applications/:id/cancel
- PATCH /api/firebase/admin/applications/:id/cancel
- PATCH /api/firebase/admin/delivery-partner-applications/:id/cancel
- GET /api/firebase-health
- POST /api/admin/send-company-email
- POST /api/admin/send-promo-email
- POST /api/test-promo-email
- POST /api/preview-promo-email
- GET /api/vehicles/makes
- GET /api/vehicles/models/by-name/:makeName
- GET /api/vehicles/decode-vin/:vin
- GET /api/platform-settings/service-fee-rate
- GET /api/admin/platform-settings/service-fee-rate
- PUT /api/admin/platform-settings/service-fee-rate
- POST /api/firebase/chef/kitchen-applications
- GET /api/firebase/chef/kitchen-applications
- GET /api/firebase/chef/kitchen-applications/location/:locationId
- GET /api/firebase/chef/kitchen-access-status/:locationId
- GET /api/firebase/chef/approved-kitchens
- PATCH /api/firebase/chef/kitchen-applications/:id/cancel
- PATCH /api/firebase/chef/kitchen-applications/:id/documents
- GET /api/manager/kitchen-applications
- GET /api/manager/kitchen-applications/location/:locationId
- PATCH /api/manager/kitchen-applications/:id/status
- PATCH /api/manager/kitchen-applications/:id/verify-documents

### All Production Routes (api/index.js)

- POST /api/webhooks/stripe
- POST /api/admin-login
- POST /api/admin-migrate-login
- POST /api/manager-migrate-login
- GET /api/debug/user-sync/:uid
- POST /api/register
- POST /api/login
- POST /api/logout
- GET /api/get-users
- POST /api/firebase/forgot-password
- POST /api/firebase/reset-password
- POST /api/manager/forgot-password
- POST /api/manager/reset-password
- GET /api/user
- GET /api/user-OLD
- POST /api/user/seen-welcome
- POST /api/debug/reset-welcome
- POST /api/user/reset-welcome
- GET /api/debug/welcome-status
- GET /api/user-session
- GET /api/health
- GET /api/session-test
- GET /api/debug-auth/:userId
- POST /api/applications
- GET /api/applications
- GET /api/applications/my-applications
- GET /api/applications/:id
- PATCH /api/applications/:id/cancel
- PATCH /api/applications/:id/status
- GET /api/init-db
- GET /api/files/documents/:filename
- GET /api/files/kitchen-license/:locationId
- GET /api/files/kitchen-license/manager/:locationId
- GET /api/files/r2-presigned
- GET /api/files/r2-proxy
- POST /api/images/presigned-url
- PATCH /api/applications/:id/documents
- PATCH /api/applications/:id/document-verification
- GET /api/debug/applications/:id/documents
- GET /api/debug/applications
- POST /api/upload
- POST /api/upload-file
- POST /api/force-create-admin
- GET /api/debug-admin
- GET /api/document-verification
- GET /api/admin/sessions/stats
- POST /api/admin/sessions/cleanup
- POST /api/admin/sessions/cleanup-old
- GET /api/microlearning/progress/:userId
- POST /api/microlearning/progress
- POST /api/microlearning/complete
- GET /api/microlearning/completion/:userId
- GET /api/microlearning/certificate-status/:userId
- GET /api/microlearning/certificate/:userId
- POST /api/test-status-email
- POST /api/test-verification-email
- POST /api/debug/test-full-verification-email
- POST /api/firebase-sync-user
- POST /api/firebase-register-user
- GET /api/user/profile
- POST /api/firebase/user/update-roles
- POST /api/firebase/applications
- GET /api/firebase/applications/my
- GET /api/firebase/admin/applications
- GET /api/firebase/dashboard
- POST /api/firebase/delivery-partner-applications
- GET /api/firebase/delivery-partner-applications/my
- GET /api/firebase/admin/delivery-partner-applications
- GET /api/delivery-partner-applications
- PUT /api/firebase/delivery-partner-applications/:id
- PATCH /api/delivery-partner-applications/:id/document-verification
- PATCH /api/delivery-partner-applications/:id/cancel
- PATCH /api/delivery-partner-applications/:id/status
- GET /api/firebase/microlearning/progress/:userId
- POST /api/firebase/microlearning/progress
- POST /api/firebase/microlearning/complete
- GET /api/firebase/microlearning/completion/:userId
- GET /api/firebase/microlearning/certificate/:userId
- POST /api/firebase/upload-file
- GET /api/firebase-health
- GET /api/platform-settings/service-fee-rate
- GET /api/admin/platform-settings/service-fee-rate
- PUT /api/admin/platform-settings/service-fee-rate
- POST /api/sync-admin-to-firebase
- POST /api/find-login-info
- GET /api/hybrid/user/profile
- GET /api/hybrid/applications
- GET /api/hybrid/admin/dashboard
- GET /api/auth-status
- POST /api/debug-login
- GET /api/test-admin
- GET /api/debug-session
- POST /api/hybrid-login
- GET /api/test-applications-auth
- GET /api/test-auth
- GET /api/debug-hybrid-login
- GET /api/verify-auth-methods
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
- POST /api/auth/send-verification-email
- GET /api/auth/verify-email
- POST /api/check-user-exists
- POST /api/debug/check-firebase-user
- POST /api/debug/delete-firebase-user
- POST /api/sync-verification-status
- POST /api/test-email-delivery
- POST /api/test-welcome-as-status
- POST /api/test-email-comparison
- POST /api/test-identical-subject
- POST /api/test-delayed-email
- POST /api/comprehensive-email-diagnostic
- GET /test-subject
- POST /api/debug-google-registration
- POST /api/admin/test-email
- POST /api/admin/send-company-email
- POST /api/admin/send-promo-email
- POST /api/test-promo-email
- POST /api/preview-promo-email
- GET /api/vehicles/makes
- GET /api/vehicles/makes/type/:vehicleType
- GET /api/vehicles/models/by-name/:makeName
- GET /api/vehicles/models/:makeId
- GET /api/vehicles/years/:makeId
- POST /api/admin/managers
- GET /api/admin/managers
- DELETE /api/admin/managers/:id
- GET /api/manager/locations
- POST /api/manager/locations
- PUT /api/manager/locations/:locationId
- PUT /api/manager/locations/:locationId/cancellation-policy
- POST /api/manager/stripe-connect/create
- GET /api/manager/stripe-connect/onboarding-link
- GET /api/manager/stripe-connect/status
- GET /api/manager/stripe-connect/dashboard-link
- POST /api/manager/revenue/sync-payments
- GET /api/manager/payments/booking/:bookingId/status
- POST /api/manager/payments/booking/:bookingId/sync
- POST /api/manager/payments/booking/:bookingId/recover
- GET /api/manager/revenue/overview
- GET /api/manager/revenue/by-location
- GET /api/manager/revenue/charts
- GET /api/manager/revenue/transactions
- GET /api/manager/revenue/invoices
- GET /api/manager/revenue/invoices/:bookingId
- GET /api/manager/revenue/payouts
- GET /api/manager/kitchens/:locationId
- POST /api/manager/kitchens
- PUT /api/manager/kitchens/:kitchenId/image
- PUT /api/manager/kitchens/:kitchenId/gallery
- DELETE /api/manager/files
- PUT /api/manager/kitchens/:kitchenId
- GET /api/manager/kitchens/:kitchenId/pricing
- PUT /api/manager/kitchens/:kitchenId/pricing
- GET /api/manager/kitchens/:kitchenId/storage-listings
- GET /api/manager/kitchens/:kitchenId/equipment-listings
- GET /api/manager/storage-listings/:listingId
- POST /api/manager/storage-listings
- PUT /api/manager/storage-listings/:listingId
- DELETE /api/manager/storage-listings/:listingId
- GET /api/manager/equipment-listings/:listingId
- POST /api/manager/equipment-listings
- PUT /api/manager/equipment-listings/:listingId
- DELETE /api/manager/equipment-listings/:listingId
- GET /api/manager/profile
- PUT /api/manager/profile
- GET /api/manager/chef-profiles
- POST /api/manager/onboarding/step
- POST /api/manager/complete-onboarding
- PUT /api/manager/locations/:id
- DELETE /api/manager/chef-location-access
- PUT /api/manager/chef-profiles/:id/status
- GET /api/manager/portal-applications
- PUT /api/manager/portal-applications/:id/status
- GET /api/manager/kitchen-applications
- PATCH /api/manager/kitchen-applications/:id/status
- PATCH /api/manager/kitchen-applications/:id/verify-documents
- DELETE /api/manager/chef-location-access/:chefId/:locationId
- GET /api/manager/bookings
- POST /api/manager/availability
- GET /api/manager/availability/:kitchenId
- POST /api/manager/change-password
- POST /api/admin/change-password
- GET /api/admin/locations
- GET /api/admin/revenue/all-managers
- GET /api/admin/revenue/platform-overview
- GET /api/admin/revenue/manager/:managerId
- POST /api/admin/locations
- PUT /api/admin/locations/:id
- DELETE /api/admin/locations/:id
- GET /api/admin/kitchens/:locationId
- POST /api/admin/kitchens
- DELETE /api/admin/kitchens/:id
- GET /api/chef/kitchens
- GET /api/chef/locations
- GET /api/chef/kitchens/:kitchenId/slots
- GET /api/chef/kitchens/:kitchenId/pricing
- GET /api/chef/kitchens/:kitchenId/storage-listings
- GET /api/chef/kitchens/:kitchenId/equipment-listings
- GET /api/chef/kitchens/:kitchenId/policy
- POST /api/payments/create-intent
- POST /api/bookings/checkout
- POST /api/payments/confirm
- GET /api/payments/intent/:id/status
- POST /api/payments/capture
- POST /api/payments/cancel
- POST /api/chef/bookings
- GET /api/chef/bookings
- GET /api/chef/bookings/:id
- GET /api/bookings/:id/invoice
- PUT /api/chef/bookings/:bookingId/cancel
- POST /api/chef/share-profile
- GET /api/chef/profiles
- GET /api/manager/kitchens/:kitchenId/date-overrides
- POST /api/manager/kitchens/:kitchenId/date-overrides
- PUT /api/manager/date-overrides/:id
- DELETE /api/manager/date-overrides/:id
- GET /api/manager/kitchens/:kitchenId/bookings
- PUT /api/manager/bookings/:id/status
- POST /api/admin/chef-kitchen-access
- DELETE /api/admin/chef-kitchen-access
- GET /api/admin/chef-kitchen-access
- POST /api/admin/chef-location-access
- DELETE /api/admin/chef-location-access
- PUT /api/admin/locations/:locationId/kitchen-license
- GET /api/admin/locations/pending-licenses
- GET /api/admin/chef-location-access
- GET /api/public/locations
- GET /api/public/locations/:locationSlug
- GET /api/public/locations/:locationSlug/kitchens
- GET /api/public/locations/:locationId/details
- GET /api/public/kitchens
- GET /api/public/kitchens/:kitchenId/availability
- POST /api/public/bookings
- POST /api/portal-login
- POST /api/portal-register
- GET /api/portal/application-status
- GET /api/portal/locations
- GET /api/portal/locations/:locationSlug
- GET /api/portal/locations/:locationSlug/kitchens
- GET /api/portal/kitchens/:kitchenId/slots
- GET /api/portal/kitchens/:kitchenId/policy
- GET /api/portal/kitchens/:kitchenId/availability
- POST /api/portal/bookings
- GET /api/portal/bookings
- GET /api/firebase/chef/kitchen-applications
- GET /api/firebase/chef/approved-kitchens
- GET /api/firebase/chef/kitchen-applications/location/:locationId
- POST /api/firebase/chef/kitchen-applications
- PATCH /api/firebase/chef/kitchen-applications/:id/cancel
- GET /api/firebase/chef/kitchen-access-status/:locationId
- GET /api/files/r2-proxy/test
- USE /api/*
