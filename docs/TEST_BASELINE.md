# Test Coverage Baseline

Generated: 2026-01-15T18:50:29.255Z

## Executive Summary

This document establishes a baseline of API endpoints used by the frontend client before the architecture migration. This baseline will be used to validate that all endpoints continue to work after the migration.

- **Total API Endpoints Found:** 167
- **Firebase Auth Endpoints:** 20
- **Session Auth Endpoints:** 4
- **Public Endpoints:** 4
- **Uncategorized Endpoints:** 139

## Endpoint Categories

### Firebase Authentication Endpoints (20)

These endpoints use Firebase JWT authentication via `Authorization: Bearer <token>` header.

- **GET /api/firebase-sync-user** (src/pages/ApplicantDashboard.tsx:1078)
- **GET /api/firebase/applications** (src/components/application/CertificationsForm.tsx:128)
- **GET /api/firebase/chef/approved-kitchens** (src/hooks/use-chef-kitchen-applications.ts:342)
- **GET /api/firebase/chef/kitchen-access-status/${locationId}** (src/hooks/use-chef-kitchen-applications.ts:208)
- **GET /api/firebase/chef/kitchen-applications** (src/hooks/use-chef-kitchen-applications.ts:65)
- **GET /api/firebase/chef/kitchen-applications/${applicationId}/cancel** (src/hooks/use-chef-kitchen-applications.ts:119)
- **GET /api/firebase/chef/kitchen-applications/${applicationId}/documents** (src/hooks/use-chef-kitchen-applications.ts:155)
- **GET /api/firebase/chef/kitchen-applications/location/${locationId}** (src/hooks/use-chef-kitchen-applications.ts:257)
- **GET /api/firebase/delivery-partner-applications** (src/components/application/DeliveryPartnerDocumentsForm.tsx:112)
- **GET /api/firebase/delivery-partner-applications/${id}** (src/pages/DocumentVerification.tsx:131)
- **GET /api/firebase/delivery-partner-applications/my** (src/pages/DocumentVerification.tsx:54)
- **GET /api/firebase/microlearning/certificate/${firebaseUser.uid}** (src/pages/MicrolearningOverview.tsx:301)
- **GET /api/firebase/microlearning/certificate/${user** (src/components/microlearning/MicrolearningModule.tsx:1439)
- **GET /api/firebase/microlearning/certificate/${user.uid}** (src/pages/ApplicantDashboard.tsx:2098)
- **GET /api/firebase/microlearning/complete** (src/components/microlearning/MicrolearningModule.tsx:615)
- **GET /api/firebase/microlearning/completion/${user.uid}** (src/pages/ApplicantDashboard.tsx:794)
- **GET /api/firebase/microlearning/progress** (src/components/microlearning/MicrolearningModule.tsx:484)
- **GET /api/firebase/microlearning/progress/${user.uid}** (src/pages/ApplicantDashboard.tsx:852)
- **GET /api/firebase/microlearning/progress/${userId || user** (src/components/microlearning/MicrolearningModule.tsx:396)
- **GET /api/firebase/user/update-roles** (src/pages/DriverAuthPage.tsx:191)

### Session Authentication Endpoints (4)

These endpoints use session-based authentication (cookies).

- **GET /api/admin-login** (src/pages/AdminLoginTest.tsx:14)
- **GET /api/logout** (src/hooks/use-auth.tsx:527)
- **GET /api/portal-login** (src/pages/PortalLogin.tsx:103)
- **GET /api/user-session** (src/components/microlearning/MicrolearningModule.tsx:301)

### Public Endpoints (4)

These endpoints require no authentication.

- **GET /api/public/locations** (src/components/kitchen-application/KitchenDiscovery.tsx:82)
- **GET /api/public/locations/${locationId}/details** (src/pages/ApplyToKitchen.tsx:56)
- **GET /api/public/stats** (src/pages/DriverLanding.tsx:23)
- **GET /api/unsubscribe** (src/pages/UnsubscribePage.tsx:46)

### Uncategorized Endpoints (139)

These endpoints need manual review to determine auth requirements.

- **GET /api/admin-migrate-login** (src/pages/AdminLogin.tsx:65)
- **GET /api/admin/chef-location-access** (src/hooks/use-chef-kitchen-access.ts:151)
- **GET /api/admin/kitchens** (src/pages/AdminManageLocations.tsx:408)
- **GET /api/admin/kitchens/${deletingItem.id}** (src/pages/AdminManageLocations.tsx:479)
- **GET /api/admin/kitchens/${editingKitchen.id}** (src/pages/AdminManageLocations.tsx:443)
- **GET /api/admin/kitchens/${locationId}** (src/pages/AdminManageLocations.tsx:268)
- **GET /api/admin/locations** (src/components/admin/ChefKitchenAccessManager.tsx:33)
- **GET /api/admin/locations/${deletingItem.id}** (src/pages/AdminManageLocations.tsx:369)
- **GET /api/admin/locations/${editingLocation.id}** (src/pages/AdminManageLocations.tsx:329)
- **GET /api/admin/locations/${locationId}/kitchen-license** (src/pages/Admin.tsx:2881)
- **GET /api/admin/locations/pending-licenses** (src/pages/Admin.tsx:260)
- **GET /api/admin/managers** (src/pages/AdminManageLocations.tsx:137)
- **GET /api/admin/managers/${deletingItem.id}** (src/pages/AdminManageLocations.tsx:590)
- **GET /api/admin/managers/${editingManager.id}** (src/pages/AdminManageLocations.tsx:551)
- **GET /api/admin/platform-settings/service-fee-rate** (src/pages/Admin.tsx:3174)
- **GET /api/admin/revenue/all-managers** (src/pages/Admin.tsx:3450)
- **GET /api/admin/revenue/manager/${selectedManager}** (src/pages/Admin.tsx:3477)
- **GET /api/admin/revenue/platform-overview** (src/pages/Admin.tsx:3736)
- **GET /api/admin/send-promo-email** (src/components/admin/PromoCodeSender.tsx:477)
- **POST /api/applications** (src/components/application/KitchenPreferenceForm.tsx:38)
- **PATCH /api/applications/${applicationId}/cancel** (src/pages/ApplicantDashboard.tsx:991)
- **GET /api/applications/${id}/document-verification** (src/pages/Admin.tsx:575)
- **GET /api/applications/${id}/status** (src/pages/Admin.tsx:520)
- **GET /api/applications/my-applications** (src/components/microlearning/UnlockProgress.tsx:35)
- **GET /api/bookings/${booking.id}/invoice** (src/pages/PaymentSuccessPage.tsx:94)
- **GET /api/bookings/${bookingId}/invoice** (src/components/booking/BookingControlPanel.tsx:473)
- **GET /api/chef/bookings** (src/hooks/use-kitchen-bookings.ts:64)
- **GET /api/chef/bookings/${bookingId}** (src/pages/PaymentSuccessPage.tsx:43)
- **GET /api/chef/bookings/${bookingId}/cancel** (src/hooks/use-kitchen-bookings.ts:296)
- **GET /api/chef/kitchens** (src/hooks/use-kitchen-bookings.ts:160)
- **GET /api/chef/kitchens/${k.id}/equipment-listings** (src/pages/KitchenComparisonPage.tsx:257)
- **GET /api/chef/kitchens/${k.id}/storage-listings** (src/pages/KitchenComparisonPage.tsx:295)
- **GET /api/chef/kitchens/${kitchen.id}/equipment-listings** (src/pages/KitchenComparisonPage.tsx:393)
- **GET /api/chef/kitchens/${kitchen.id}/pricing** (src/pages/KitchenBookingCalendar.tsx:574)
- **GET /api/chef/kitchens/${kitchen.id}/storage-listings** (src/pages/KitchenComparisonPage.tsx:431)
- **GET /api/chef/kitchens/${kitchenId}/availability** (src/hooks/use-kitchen-bookings.ts:227)
- **GET /api/chef/kitchens/${kitchenId}/equipment-listings** (src/pages/KitchenBookingCalendar.tsx:488)
- **GET /api/chef/kitchens/${kitchenId}/policy** (src/pages/KitchenBookingCalendar.tsx:369)
- **GET /api/chef/kitchens/${kitchenId}/slots** (src/pages/KitchenBookingCalendar.tsx:389)
- **GET /api/chef/kitchens/${kitchenId}/storage-listings** (src/pages/KitchenBookingCalendar.tsx:472)
- **GET /api/chef/kitchens/${selectedKitchen.id}/equipment-listings** (src/pages/BookingConfirmationPage.tsx:191)
- **GET /api/chef/kitchens/${selectedKitchen.id}/pricing** (src/pages/BookingConfirmationPage.tsx:134)
- **GET /api/chef/kitchens/${selectedKitchen.id}/storage-listings** (src/pages/BookingConfirmationPage.tsx:173)
- **GET /api/chef/locations** (src/hooks/use-kitchen-bookings.ts:180)
- **GET /api/chef/profiles** (src/hooks/use-chef-kitchen-access.ts:56)
- **GET /api/chef/share-profile** (src/hooks/use-chef-kitchen-access.ts:76)
- **GET /api/chef/storage-bookings** (src/components/booking/BookingControlPanel.tsx:73)
- **GET /api/chef/storage-bookings/${booking.id}/extend** (src/components/booking/StorageExtensionDialog.tsx:111)
- **GET /api/debug-session** (src/pages/AdminLoginTest.tsx:42)
- **GET /api/debug/reset-welcome** (src/App.tsx:410)
- **GET /api/debug/user-sync/${testUid}** (src/pages/AdminLoginTest.tsx:73)
- **GET /api/debug/welcome-status** (src/App.tsx:472)
- **GET /api/delivery-partner-applications/${id}/document-verification** (src/pages/Admin.tsx:692)
- **GET /api/delivery-partner-applications/${id}/status** (src/pages/Admin.tsx:637)
- **GET /api/files/kitchen-license/${license.id}** (src/pages/Admin.tsx:3017)
- **GET /api/files/r2-presigned** (src/components/manager/ManagerKitchenApplications.tsx:132)
- **GET /api/images/presigned-url** (src/hooks/use-presigned-image-url.ts:32)
- **GET /api/manager-migrate-login** (src/components/auth/EnhancedLoginForm.tsx:85)
- **GET /api/manager/availability** (src/hooks/use-manager-dashboard.ts:229)
- **GET /api/manager/availability/${kitchenId}** (src/hooks/use-manager-dashboard.ts:195)
- **GET /api/manager/availability/${selectedKitchenId}** (src/pages/KitchenAvailabilityManagement.tsx:200)
- **GET /api/manager/bookings** (src/components/dashboard/KitchenDashboardOverview.tsx:129)
- **GET /api/manager/bookings/${bookingId}/status** (src/pages/ManagerBookingsPanel.tsx:171)
- **GET /api/manager/change-password** (src/pages/ManagerChangePassword.tsx:99)
- **GET /api/manager/chef-location-access** (src/hooks/use-manager-chef-profiles.ts:112)
- **GET /api/manager/chef-profiles** (src/hooks/use-manager-chef-profiles.ts:58)
- **GET /api/manager/chef-profiles/${profileId}/status** (src/hooks/use-manager-chef-profiles.ts:84)
- **GET /api/manager/complete-onboarding** (src/components/manager/ManagerOnboardingWizard.tsx:755)
- **GET /api/manager/date-overrides/${id}** (src/pages/KitchenAvailabilityManagement.tsx:365)
- **GET /api/manager/equipment-listings** (src/components/manager/ManagerOnboardingWizard.tsx:2436)
- **GET /api/manager/equipment-listings/${id}** (src/pages/EquipmentListingManagement.tsx:422)
- **GET /api/manager/equipment-listings/${listingId}** (src/pages/EquipmentListingManagement.tsx:252)
- **GET /api/manager/files** (src/pages/ManagerBookingDashboard.tsx:1643)
- **GET /api/manager/kitchen-applications** (src/components/dashboard/KitchenDashboardOverview.tsx:188)
- **GET /api/manager/kitchen-applications/${applicationId}/status** (src/hooks/use-manager-kitchen-applications.ts:113)
- **GET /api/manager/kitchen-applications/${applicationId}/verify-documents** (src/hooks/use-manager-kitchen-applications.ts:149)
- **GET /api/manager/kitchen-applications/location/${locationId}** (src/hooks/use-manager-kitchen-applications.ts:266)
- **GET /api/manager/kitchens** (src/components/manager/ManagerOnboardingWizard.tsx:559)
- **GET /api/manager/kitchens/${kitchen.id}/image** (src/pages/ManagerBookingDashboard.tsx:2872)
- **GET /api/manager/kitchens/${kitchen.id}/pricing** (src/components/manager/ManagerOnboardingWizard.tsx:582)
- **GET /api/manager/kitchens/${kitchenId}** (src/pages/ManagerBookingDashboard.tsx:1931)
- **GET /api/manager/kitchens/${kitchenId}/gallery** (src/pages/ManagerBookingDashboard.tsx:1597)
- **GET /api/manager/kitchens/${kitchenId}/image** (src/pages/ManagerBookingDashboard.tsx:2001)
- **GET /api/manager/kitchens/${location.id}** (src/components/manager/ManagerLocationsPage.tsx:75)
- **GET /api/manager/kitchens/${locationId}** (src/components/manager/ManagerOnboardingWizard.tsx:225)
- **GET /api/manager/kitchens/${selectedKitchenId}/bookings** (src/pages/KitchenAvailabilityManagement.tsx:282)
- **GET /api/manager/kitchens/${selectedKitchenId}/date-overrides** (src/pages/KitchenAvailabilityManagement.tsx:251)
- **GET /api/manager/kitchens/${selectedKitchenId}/equipment-listings** (src/components/manager/ManagerOnboardingWizard.tsx:516)
- **GET /api/manager/kitchens/${selectedKitchenId}/pricing** (src/pages/KitchenPricingManagement.tsx:137)
- **GET /api/manager/kitchens/${selectedKitchenId}/storage-listings** (src/components/manager/ManagerOnboardingWizard.tsx:478)
- **GET /api/manager/kitchens/${selectedLocationId}** (src/components/manager/ManagerOnboardingWizard.tsx:433)
- **GET /api/manager/locations** (src/components/layout/ManagerHeader.tsx:83)
- **GET /api/manager/locations/${location.id}** (src/components/manager/LocationEditModal.tsx:143)
- **GET /api/manager/locations/${location.id}/cancellation-policy** (src/components/manager/LocationEditModal.tsx:170)
- **GET /api/manager/locations/${locationId}/cancellation-policy** (src/pages/ManagerBookingDashboard.tsx:347)
- **GET /api/manager/locations/${newLocation.id}** (src/pages/ManagerBookingDashboard.tsx:966)
- **GET /api/manager/locations/${selectedLocationId}** (src/components/manager/ManagerOnboardingWizard.tsx:657)
- **GET /api/manager/onboarding/step** (src/components/manager/ManagerOnboardingWizard.tsx:799)
- **GET /api/manager/portal-applications** (src/hooks/use-manager-portal-applications.ts:54)
- **GET /api/manager/portal-applications/${id}/status** (src/hooks/use-manager-portal-applications.ts:85)
- **GET /api/manager/profile** (src/pages/ManagerProfile.tsx:64)
- **GET /api/manager/revenue/by-location** (src/pages/ManagerRevenueDashboard.tsx:211)
- **GET /api/manager/revenue/charts** (src/pages/ManagerRevenueDashboard.tsx:238)
- **GET /api/manager/revenue/invoices** (src/pages/ManagerRevenueDashboard.tsx:297)
- **GET /api/manager/revenue/invoices/${bookingId}** (src/pages/ManagerRevenueDashboard.tsx:498)
- **GET /api/manager/revenue/overview** (src/components/dashboard/KitchenDashboardOverview.tsx:251)
- **GET /api/manager/revenue/payouts** (src/pages/ManagerRevenueDashboard.tsx:333)
- **GET /api/manager/revenue/payouts/${payoutId}/statement** (src/pages/ManagerRevenueDashboard.tsx:525)
- **GET /api/manager/revenue/transactions** (src/pages/ManagerRevenueDashboard.tsx:269)
- **GET /api/manager/storage-listings** (src/components/manager/ManagerOnboardingWizard.tsx:1985)
- **GET /api/manager/storage-listings/${id}** (src/pages/StorageListingManagement.tsx:429)
- **GET /api/manager/storage-listings/${listingId}** (src/pages/StorageListingManagement.tsx:215)
- **GET /api/manager/stripe-connect/create** (src/components/manager/StripeConnectSetup.tsx:74)
- **GET /api/manager/stripe-connect/dashboard-link** (src/components/manager/StripeConnectSetup.tsx:160)
- **GET /api/manager/stripe-connect/onboarding-link** (src/components/manager/StripeConnectSetup.tsx:121)
- **GET /api/manager/stripe-connect/status** (src/pages/ManagerRevenueDashboard.tsx:315)
- **GET /api/microlearning/completion/${userId}** (src/pages/MicrolearningOverview.tsx:190)
- **GET /api/microlearning/progress** (src/components/microlearning/MicrolearningModule.tsx:459)
- **GET /api/microlearning/progress/${effectiveUserId}** (src/components/microlearning/MicrolearningModule.tsx:380)
- **GET /api/microlearning/progress/${userId}** (src/pages/MicrolearningOverview.tsx:96)
- **GET /api/payments/create-intent** (src/pages/BookingConfirmationPage.tsx:349)
- **GET /api/platform-settings/service-fee-rate** (src/components/booking/StorageExtensionDialog.tsx:62)
- **GET /api/portal-register** (src/pages/PortalRegister.tsx:137)
- **GET /api/portal/application-status** (src/pages/PortalBookingPage.tsx:52)
- **GET /api/portal/bookings** (src/pages/ManagerBookingPortal.tsx:318)
- **GET /api/portal/kitchens/${selectedKitchen.id}/policy** (src/pages/ManagerBookingPortal.tsx:160)
- **GET /api/portal/kitchens/${selectedKitchen.id}/slots** (src/pages/ManagerBookingPortal.tsx:179)
- **GET /api/portal/locations** (src/pages/PortalBookingPage.tsx:67)
- **GET /api/portal/locations/${locationSlug}** (src/pages/ManagerBookingPortal.tsx:98)
- **GET /api/portal/locations/${locationSlug}/kitchens** (src/pages/ManagerBookingPortal.tsx:119)
- **GET /api/sync-verification-status** (src/hooks/use-auth.tsx:788)
- **POST /api/test-status-email** (src/components/test/StatusEmailTest.tsx:60)
- **POST /api/test-verification-email** (src/components/test/StatusEmailTest.tsx:99)
- **GET /api/upload** (src/components/application/DeliveryPartnerDocumentsForm.tsx:25)
- **GET /api/upload-file** (src/components/manager/ManagerOnboardingWizard.tsx:723)
- **GET /api/user** (src/pages/AdminLoginTest.tsx:57)
- **GET /api/user/profile** (src/components/admin/AdminProtectedRoute.tsx:25)
- **GET /api/user/reset-welcome** (src/App.tsx:543)
- **GET /api/user/seen-welcome** (src/pages/DriverAuthPage.tsx:237)

## Critical User Flows

### 1. User Registration/Login Flow

**Endpoints:**
- /api/firebase-register-user
- /api/firebase/forgot-password
- /api/firebase/reset-password
- /api/admin-login
- /api/manager/forgot-password
- /api/manager/reset-password
- /api/portal-login
- /api/portal-register

**Test Cases:**
- [ ] User can register with email/password
- [ ] User can register with Google OAuth
- [ ] User can login with email/password
- [ ] User can reset forgotten password
- [ ] Admin can login via session auth
- [ ] Manager can login via session auth
- [ ] Portal user can login/register

### 2. Location Creation Flow

**Endpoints:**
- /api/locations
- /api/public/locations
- /api/portal/locations

**Test Cases:**
- [ ] Manager can create new location
- [ ] Manager can edit location details
- [ ] Public can view available locations
- [ ] Portal user can view locations

### 3. Kitchen Booking Flow

**Endpoints:**
- /api/bookings
- /api/kitchen-bookings
- /api/portal/bookings

**Test Cases:**
- [ ] Chef can view available kitchen slots
- [ ] Chef can create kitchen booking
- [ ] Chef can cancel booking (if allowed)
- [ ] Manager can view all bookings for their location
- [ ] Manager can update booking status
- [ ] Portal user can view bookings

### 4. Payment Processing Flow

**Endpoints:**
- /api/payments
- /api/stripe
- /api/webhooks/stripe

**Test Cases:**
- [ ] Stripe payment intent creation
- [ ] Payment confirmation
- [ ] Stripe webhook processing
- [ ] Payment history retrieval
- [ ] Refund processing

### 5. Manager Dashboard Flow

**Endpoints:**
- /api/manager/dashboard
- /api/manager/revenue
- /api/manager/bookings

**Test Cases:**
- [ ] Manager can view dashboard overview
- [ ] Manager can view revenue reports
- [ ] Manager can view booking statistics
- [ ] Manager can manage kitchen availability

### 6. Application Management Flow

**Endpoints:**
- /api/applications
- /api/firebase/applications
- /api/delivery-partner-applications

**Test Cases:**
- [ ] Chef can submit application
- [ ] Chef can upload documents
- [ ] Admin can review applications
- [ ] Admin can approve/reject applications
- [ ] Delivery partner can submit application

## All Endpoints (Complete List)

- **GET /api/admin-login** - src/pages/AdminLoginTest.tsx:14
- **GET /api/admin-migrate-login** - src/pages/AdminLogin.tsx:65
- **GET /api/admin/chef-location-access** - src/hooks/use-chef-kitchen-access.ts:151
- **GET /api/admin/kitchens** - src/pages/AdminManageLocations.tsx:408
- **GET /api/admin/kitchens/${deletingItem.id}** - src/pages/AdminManageLocations.tsx:479
- **GET /api/admin/kitchens/${editingKitchen.id}** - src/pages/AdminManageLocations.tsx:443
- **GET /api/admin/kitchens/${locationId}** - src/pages/AdminManageLocations.tsx:268
- **GET /api/admin/locations** - src/components/admin/ChefKitchenAccessManager.tsx:33
- **GET /api/admin/locations/${deletingItem.id}** - src/pages/AdminManageLocations.tsx:369
- **GET /api/admin/locations/${editingLocation.id}** - src/pages/AdminManageLocations.tsx:329
- **GET /api/admin/locations/${locationId}/kitchen-license** - src/pages/Admin.tsx:2881
- **GET /api/admin/locations/pending-licenses** - src/pages/Admin.tsx:260
- **GET /api/admin/managers** - src/pages/AdminManageLocations.tsx:137
- **GET /api/admin/managers/${deletingItem.id}** - src/pages/AdminManageLocations.tsx:590
- **GET /api/admin/managers/${editingManager.id}** - src/pages/AdminManageLocations.tsx:551
- **GET /api/admin/platform-settings/service-fee-rate** - src/pages/Admin.tsx:3174
- **GET /api/admin/revenue/all-managers** - src/pages/Admin.tsx:3450
- **GET /api/admin/revenue/manager/${selectedManager}** - src/pages/Admin.tsx:3477
- **GET /api/admin/revenue/platform-overview** - src/pages/Admin.tsx:3736
- **GET /api/admin/send-promo-email** - src/components/admin/PromoCodeSender.tsx:477
- **POST /api/applications** - src/components/application/KitchenPreferenceForm.tsx:38
- **PATCH /api/applications/${applicationId}/cancel** - src/pages/ApplicantDashboard.tsx:991
- **GET /api/applications/${id}/document-verification** - src/pages/Admin.tsx:575
- **GET /api/applications/${id}/status** - src/pages/Admin.tsx:520
- **GET /api/applications/my-applications** - src/components/microlearning/UnlockProgress.tsx:35
- **GET /api/bookings/${booking.id}/invoice** - src/pages/PaymentSuccessPage.tsx:94
- **GET /api/bookings/${bookingId}/invoice** - src/components/booking/BookingControlPanel.tsx:473
- **GET /api/chef/bookings** - src/hooks/use-kitchen-bookings.ts:64
- **GET /api/chef/bookings/${bookingId}** - src/pages/PaymentSuccessPage.tsx:43
- **GET /api/chef/bookings/${bookingId}/cancel** - src/hooks/use-kitchen-bookings.ts:296
- **GET /api/chef/kitchens** - src/hooks/use-kitchen-bookings.ts:160
- **GET /api/chef/kitchens/${k.id}/equipment-listings** - src/pages/KitchenComparisonPage.tsx:257
- **GET /api/chef/kitchens/${k.id}/storage-listings** - src/pages/KitchenComparisonPage.tsx:295
- **GET /api/chef/kitchens/${kitchen.id}/equipment-listings** - src/pages/KitchenComparisonPage.tsx:393
- **GET /api/chef/kitchens/${kitchen.id}/pricing** - src/pages/KitchenBookingCalendar.tsx:574
- **GET /api/chef/kitchens/${kitchen.id}/storage-listings** - src/pages/KitchenComparisonPage.tsx:431
- **GET /api/chef/kitchens/${kitchenId}/availability** - src/hooks/use-kitchen-bookings.ts:227
- **GET /api/chef/kitchens/${kitchenId}/equipment-listings** - src/pages/KitchenBookingCalendar.tsx:488
- **GET /api/chef/kitchens/${kitchenId}/policy** - src/pages/KitchenBookingCalendar.tsx:369
- **GET /api/chef/kitchens/${kitchenId}/slots** - src/pages/KitchenBookingCalendar.tsx:389
- **GET /api/chef/kitchens/${kitchenId}/storage-listings** - src/pages/KitchenBookingCalendar.tsx:472
- **GET /api/chef/kitchens/${selectedKitchen.id}/equipment-listings** - src/pages/BookingConfirmationPage.tsx:191
- **GET /api/chef/kitchens/${selectedKitchen.id}/pricing** - src/pages/BookingConfirmationPage.tsx:134
- **GET /api/chef/kitchens/${selectedKitchen.id}/storage-listings** - src/pages/BookingConfirmationPage.tsx:173
- **GET /api/chef/locations** - src/hooks/use-kitchen-bookings.ts:180
- **GET /api/chef/profiles** - src/hooks/use-chef-kitchen-access.ts:56
- **GET /api/chef/share-profile** - src/hooks/use-chef-kitchen-access.ts:76
- **GET /api/chef/storage-bookings** - src/components/booking/BookingControlPanel.tsx:73
- **GET /api/chef/storage-bookings/${booking.id}/extend** - src/components/booking/StorageExtensionDialog.tsx:111
- **GET /api/debug-session** - src/pages/AdminLoginTest.tsx:42
- **GET /api/debug/reset-welcome** - src/App.tsx:410
- **GET /api/debug/user-sync/${testUid}** - src/pages/AdminLoginTest.tsx:73
- **GET /api/debug/welcome-status** - src/App.tsx:472
- **GET /api/delivery-partner-applications/${id}/document-verification** - src/pages/Admin.tsx:692
- **GET /api/delivery-partner-applications/${id}/status** - src/pages/Admin.tsx:637
- **GET /api/files/kitchen-license/${license.id}** - src/pages/Admin.tsx:3017
- **GET /api/files/r2-presigned** - src/components/manager/ManagerKitchenApplications.tsx:132
- **GET /api/firebase-sync-user** - src/pages/ApplicantDashboard.tsx:1078
- **GET /api/firebase/applications** - src/components/application/CertificationsForm.tsx:128
- **GET /api/firebase/chef/approved-kitchens** - src/hooks/use-chef-kitchen-applications.ts:342
- **GET /api/firebase/chef/kitchen-access-status/${locationId}** - src/hooks/use-chef-kitchen-applications.ts:208
- **GET /api/firebase/chef/kitchen-applications** - src/hooks/use-chef-kitchen-applications.ts:65
- **GET /api/firebase/chef/kitchen-applications/${applicationId}/cancel** - src/hooks/use-chef-kitchen-applications.ts:119
- **GET /api/firebase/chef/kitchen-applications/${applicationId}/documents** - src/hooks/use-chef-kitchen-applications.ts:155
- **GET /api/firebase/chef/kitchen-applications/location/${locationId}** - src/hooks/use-chef-kitchen-applications.ts:257
- **GET /api/firebase/delivery-partner-applications** - src/components/application/DeliveryPartnerDocumentsForm.tsx:112
- **GET /api/firebase/delivery-partner-applications/${id}** - src/pages/DocumentVerification.tsx:131
- **GET /api/firebase/delivery-partner-applications/my** - src/pages/DocumentVerification.tsx:54
- **GET /api/firebase/microlearning/certificate/${firebaseUser.uid}** - src/pages/MicrolearningOverview.tsx:301
- **GET /api/firebase/microlearning/certificate/${user** - src/components/microlearning/MicrolearningModule.tsx:1439
- **GET /api/firebase/microlearning/certificate/${user.uid}** - src/pages/ApplicantDashboard.tsx:2098
- **GET /api/firebase/microlearning/complete** - src/components/microlearning/MicrolearningModule.tsx:615
- **GET /api/firebase/microlearning/completion/${user.uid}** - src/pages/ApplicantDashboard.tsx:794
- **GET /api/firebase/microlearning/progress** - src/components/microlearning/MicrolearningModule.tsx:484
- **GET /api/firebase/microlearning/progress/${user.uid}** - src/pages/ApplicantDashboard.tsx:852
- **GET /api/firebase/microlearning/progress/${userId || user** - src/components/microlearning/MicrolearningModule.tsx:396
- **GET /api/firebase/user/update-roles** - src/pages/DriverAuthPage.tsx:191
- **GET /api/images/presigned-url** - src/hooks/use-presigned-image-url.ts:32
- **GET /api/logout** - src/hooks/use-auth.tsx:527
- **GET /api/manager-migrate-login** - src/components/auth/EnhancedLoginForm.tsx:85
- **GET /api/manager/availability** - src/hooks/use-manager-dashboard.ts:229
- **GET /api/manager/availability/${kitchenId}** - src/hooks/use-manager-dashboard.ts:195
- **GET /api/manager/availability/${selectedKitchenId}** - src/pages/KitchenAvailabilityManagement.tsx:200
- **GET /api/manager/bookings** - src/components/dashboard/KitchenDashboardOverview.tsx:129
- **GET /api/manager/bookings/${bookingId}/status** - src/pages/ManagerBookingsPanel.tsx:171
- **GET /api/manager/change-password** - src/pages/ManagerChangePassword.tsx:99
- **GET /api/manager/chef-location-access** - src/hooks/use-manager-chef-profiles.ts:112
- **GET /api/manager/chef-profiles** - src/hooks/use-manager-chef-profiles.ts:58
- **GET /api/manager/chef-profiles/${profileId}/status** - src/hooks/use-manager-chef-profiles.ts:84
- **GET /api/manager/complete-onboarding** - src/components/manager/ManagerOnboardingWizard.tsx:755
- **GET /api/manager/date-overrides/${id}** - src/pages/KitchenAvailabilityManagement.tsx:365
- **GET /api/manager/equipment-listings** - src/components/manager/ManagerOnboardingWizard.tsx:2436
- **GET /api/manager/equipment-listings/${id}** - src/pages/EquipmentListingManagement.tsx:422
- **GET /api/manager/equipment-listings/${listingId}** - src/pages/EquipmentListingManagement.tsx:252
- **GET /api/manager/files** - src/pages/ManagerBookingDashboard.tsx:1643
- **GET /api/manager/kitchen-applications** - src/components/dashboard/KitchenDashboardOverview.tsx:188
- **GET /api/manager/kitchen-applications/${applicationId}/status** - src/hooks/use-manager-kitchen-applications.ts:113
- **GET /api/manager/kitchen-applications/${applicationId}/verify-documents** - src/hooks/use-manager-kitchen-applications.ts:149
- **GET /api/manager/kitchen-applications/location/${locationId}** - src/hooks/use-manager-kitchen-applications.ts:266
- **GET /api/manager/kitchens** - src/components/manager/ManagerOnboardingWizard.tsx:559
- **GET /api/manager/kitchens/${kitchen.id}/image** - src/pages/ManagerBookingDashboard.tsx:2872
- **GET /api/manager/kitchens/${kitchen.id}/pricing** - src/components/manager/ManagerOnboardingWizard.tsx:582
- **GET /api/manager/kitchens/${kitchenId}** - src/pages/ManagerBookingDashboard.tsx:1931
- **GET /api/manager/kitchens/${kitchenId}/gallery** - src/pages/ManagerBookingDashboard.tsx:1597
- **GET /api/manager/kitchens/${kitchenId}/image** - src/pages/ManagerBookingDashboard.tsx:2001
- **GET /api/manager/kitchens/${location.id}** - src/components/manager/ManagerLocationsPage.tsx:75
- **GET /api/manager/kitchens/${locationId}** - src/components/manager/ManagerOnboardingWizard.tsx:225
- **GET /api/manager/kitchens/${selectedKitchenId}/bookings** - src/pages/KitchenAvailabilityManagement.tsx:282
- **GET /api/manager/kitchens/${selectedKitchenId}/date-overrides** - src/pages/KitchenAvailabilityManagement.tsx:251
- **GET /api/manager/kitchens/${selectedKitchenId}/equipment-listings** - src/components/manager/ManagerOnboardingWizard.tsx:516
- **GET /api/manager/kitchens/${selectedKitchenId}/pricing** - src/pages/KitchenPricingManagement.tsx:137
- **GET /api/manager/kitchens/${selectedKitchenId}/storage-listings** - src/components/manager/ManagerOnboardingWizard.tsx:478
- **GET /api/manager/kitchens/${selectedLocationId}** - src/components/manager/ManagerOnboardingWizard.tsx:433
- **GET /api/manager/locations** - src/components/layout/ManagerHeader.tsx:83
- **GET /api/manager/locations/${location.id}** - src/components/manager/LocationEditModal.tsx:143
- **GET /api/manager/locations/${location.id}/cancellation-policy** - src/components/manager/LocationEditModal.tsx:170
- **GET /api/manager/locations/${locationId}/cancellation-policy** - src/pages/ManagerBookingDashboard.tsx:347
- **GET /api/manager/locations/${newLocation.id}** - src/pages/ManagerBookingDashboard.tsx:966
- **GET /api/manager/locations/${selectedLocationId}** - src/components/manager/ManagerOnboardingWizard.tsx:657
- **GET /api/manager/onboarding/step** - src/components/manager/ManagerOnboardingWizard.tsx:799
- **GET /api/manager/portal-applications** - src/hooks/use-manager-portal-applications.ts:54
- **GET /api/manager/portal-applications/${id}/status** - src/hooks/use-manager-portal-applications.ts:85
- **GET /api/manager/profile** - src/pages/ManagerProfile.tsx:64
- **GET /api/manager/revenue/by-location** - src/pages/ManagerRevenueDashboard.tsx:211
- **GET /api/manager/revenue/charts** - src/pages/ManagerRevenueDashboard.tsx:238
- **GET /api/manager/revenue/invoices** - src/pages/ManagerRevenueDashboard.tsx:297
- **GET /api/manager/revenue/invoices/${bookingId}** - src/pages/ManagerRevenueDashboard.tsx:498
- **GET /api/manager/revenue/overview** - src/components/dashboard/KitchenDashboardOverview.tsx:251
- **GET /api/manager/revenue/payouts** - src/pages/ManagerRevenueDashboard.tsx:333
- **GET /api/manager/revenue/payouts/${payoutId}/statement** - src/pages/ManagerRevenueDashboard.tsx:525
- **GET /api/manager/revenue/transactions** - src/pages/ManagerRevenueDashboard.tsx:269
- **GET /api/manager/storage-listings** - src/components/manager/ManagerOnboardingWizard.tsx:1985
- **GET /api/manager/storage-listings/${id}** - src/pages/StorageListingManagement.tsx:429
- **GET /api/manager/storage-listings/${listingId}** - src/pages/StorageListingManagement.tsx:215
- **GET /api/manager/stripe-connect/create** - src/components/manager/StripeConnectSetup.tsx:74
- **GET /api/manager/stripe-connect/dashboard-link** - src/components/manager/StripeConnectSetup.tsx:160
- **GET /api/manager/stripe-connect/onboarding-link** - src/components/manager/StripeConnectSetup.tsx:121
- **GET /api/manager/stripe-connect/status** - src/pages/ManagerRevenueDashboard.tsx:315
- **GET /api/microlearning/completion/${userId}** - src/pages/MicrolearningOverview.tsx:190
- **GET /api/microlearning/progress** - src/components/microlearning/MicrolearningModule.tsx:459
- **GET /api/microlearning/progress/${effectiveUserId}** - src/components/microlearning/MicrolearningModule.tsx:380
- **GET /api/microlearning/progress/${userId}** - src/pages/MicrolearningOverview.tsx:96
- **GET /api/payments/create-intent** - src/pages/BookingConfirmationPage.tsx:349
- **GET /api/platform-settings/service-fee-rate** - src/components/booking/StorageExtensionDialog.tsx:62
- **GET /api/portal-login** - src/pages/PortalLogin.tsx:103
- **GET /api/portal-register** - src/pages/PortalRegister.tsx:137
- **GET /api/portal/application-status** - src/pages/PortalBookingPage.tsx:52
- **GET /api/portal/bookings** - src/pages/ManagerBookingPortal.tsx:318
- **GET /api/portal/kitchens/${selectedKitchen.id}/policy** - src/pages/ManagerBookingPortal.tsx:160
- **GET /api/portal/kitchens/${selectedKitchen.id}/slots** - src/pages/ManagerBookingPortal.tsx:179
- **GET /api/portal/locations** - src/pages/PortalBookingPage.tsx:67
- **GET /api/portal/locations/${locationSlug}** - src/pages/ManagerBookingPortal.tsx:98
- **GET /api/portal/locations/${locationSlug}/kitchens** - src/pages/ManagerBookingPortal.tsx:119
- **GET /api/public/locations** - src/components/kitchen-application/KitchenDiscovery.tsx:82
- **GET /api/public/locations/${locationId}/details** - src/pages/ApplyToKitchen.tsx:56
- **GET /api/public/stats** - src/pages/DriverLanding.tsx:23
- **GET /api/sync-verification-status** - src/hooks/use-auth.tsx:788
- **POST /api/test-status-email** - src/components/test/StatusEmailTest.tsx:60
- **POST /api/test-verification-email** - src/components/test/StatusEmailTest.tsx:99
- **GET /api/unsubscribe** - src/pages/UnsubscribePage.tsx:46
- **GET /api/upload** - src/components/application/DeliveryPartnerDocumentsForm.tsx:25
- **GET /api/upload-file** - src/components/manager/ManagerOnboardingWizard.tsx:723
- **GET /api/user** - src/pages/AdminLoginTest.tsx:57
- **GET /api/user-session** - src/components/microlearning/MicrolearningModule.tsx:301
- **GET /api/user/profile** - src/components/admin/AdminProtectedRoute.tsx:25
- **GET /api/user/reset-welcome** - src/App.tsx:543
- **GET /api/user/seen-welcome** - src/pages/DriverAuthPage.tsx:237

## Environment-Specific Behavior

### Development Environment
- Uses local file storage for uploads
- Vite dev server for hot reloading
- Local PostgreSQL database
- Firebase emulator (if configured)

### Production Environment
- Uses Cloudflare R2 for file storage
- Static file serving
- Neon PostgreSQL database
- Production Firebase project

## Testing Strategy

### Pre-Migration Testing
1. Document current behavior of all critical flows
2. Capture response formats and status codes
3. Note any environment-specific differences

### Post-Migration Validation
1. Test all critical flows match baseline behavior
2. Verify authentication still works correctly
3. Confirm file uploads/downloads work
4. Validate payment processing unchanged
5. Check error handling consistent

## Notes

- This baseline was generated automatically by scanning client source code
- Some endpoints may be called dynamically and not captured
- Manual review recommended for critical endpoints
- Update this document after migration to reflect any changes
