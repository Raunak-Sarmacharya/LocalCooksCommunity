# Kitchen Manager Portal: Code-Evidence Plan

This plan is based on the live React routes, manager components, fetch calls, server routes, notification deep links, and role middleware. Older product docs were not used as the source of truth.

## Operating workflows found in code

| Workflow | Manager work | Current UI implementation | Primary backend surface |
|---|---|---|---|
| Account entry | Sign in, email verification, password setup, profile changes | `ManagerLogin`, `ManagerChangePassword`, `ManagerProfileSettings`, `ManagerProtectedRoute` | `/api/user/profile`, `/api/manager/profile`, Firebase auth |
| Location onboarding | Create/select a location, upload licence, complete setup | `ManagerSetupPage`, manager onboarding provider and steps | `/api/manager/locations`, `/api/manager/onboarding/step`, `/api/manager/complete-onboarding` |
| Facility configuration | Maintain location identity, licence, facility documents, booking rules and notification delivery | Manager settings components | `/api/manager/locations/:id`, location requirements and checklist endpoints |
| Rentable inventory | Create and maintain kitchens, storage, equipment, photos and pricing | `KitchensManagement`, `StorageListingManagement`, `EquipmentListingManagement`, `KitchenPricingManagement` | Manager kitchen, storage-listing and equipment-listing endpoints |
| Supply scheduling | Set recurring availability, date overrides and viewing slots/blackouts | `KitchenAvailabilityManagement`, `ViewingSettingsPanel`, `ViewingsDashboard` | Manager availability/date-override routes and `/api/viewings/*` |
| Chef access | Configure application requirements; review, approve or reject chef access and coordination documents | `LocationRequirementsSettings`, `ManagerKitchenApplicationsContent` | Manager kitchen-application and chef-location-access endpoints |
| Booking operations | Review bookings, approve/decline, handle cancellation requests, access codes and details | `ManagerBookingsPanel`, `TodaysKitchenBookings`, booking action sheets | `/api/manager/bookings/*`, cancellation and access-code endpoints |
| Session controls | Configure and review kitchen/storage check-in and check-out evidence | Check-in/out settings, pending storage check-ins/checkouts | Manager checklist and storage inspection endpoints |
| Communication | Read manager messages; receive and follow notification deep links | `UnifiedChatView`, manager `NotificationCenter` | Chat service, `/api/manager/notifications/*` |
| Revenue and payouts | Connect Stripe, inspect metrics/transactions/invoices/payouts, issue supported refunds | `ManagerRevenueDashboard`, `StripeConnectSetup` | `/api/manager/revenue/*`, `/api/manager/stripe-connect/*` |
| Exception resolution | Review storage overstays, approve/waive penalties, create/resolve damage claims, escalate disputes | `OverstayPenaltyQueue`, `DamageClaimQueue`, storage inspection queues | Manager overstay and damage-claim endpoints |

## Information architecture

The sidebar exposes six workflow groups. No destination or server capability is removed.

1. **Overview** — dashboard.
2. **Operations** — bookings, viewings, availability, kitchen check-in/out, storage check-in/out.
3. **Facility** — locations, kitchens, pricing, storage, equipment, licence, booking rules, facility documents, location details, notification delivery settings.
4. **People** — applications and application requirements.
5. **Finance** — revenue and payouts/payment setup.
6. **Inbox** — messages, notification center, overstay penalties, damage claims, storage inspections.

Profile, language, and sign-out remain in the account menu. The location selector remains persistent shell context.

Managers follow a single-location, multi-kitchen interaction model: they can create their first location, then manage any number of kitchens, storage listings, and equipment listings inside it. Existing multi-location records remain selectable and supported, but the manager UI hides “Add New Location” after the first location exists to prevent accidental expansion and confusion.

## Route and compatibility contract

- `/manager/dashboard?view=notifications` is the notification center, matching Chef behavior.
- `/manager/dashboard?view=notification-settings` configures email/SMS delivery for the selected location.
- Existing manager view IDs remain unchanged for all other destinations.
- `shared/notification-deep-links.ts` continues normalizing legacy `/manager/booking-dashboard` and legacy view aliases.
- Notification item clicks continue resolving by role, type, action URL and metadata before navigating.
- Existing `/manager/bookings`, `/manager/applications`, and `/manager/booking/:id` routes remain available.

## UI parity contract

Manager pages should use the same shell grammar already used by Chef:

- persistent collapsible sidebar and sticky header;
- shared spacing (`p-4 md:p-6 lg:p-8`) and `max-w-7xl` content width;
- page title + short description + actions in one header row;
- rounded `1.35rem` cards, semantic theme tokens, and no hard-coded gray/blue status colors;
- shared loading, empty, error, table, sheet, dialog and responsive patterns;
- breadcrumbs for nested records instead of additional permanent menu items.

## Delivery phases

### Phase 1 — Navigation and notification split

- Six workflow groups in the manager sidebar.
- Dedicated notification-center page.
- Separate notification-delivery settings view.
- Chef-style notification page header, filters, actions, states and deep-link behavior.
- Preserve all current view IDs except the intentional settings split.

### Phase 2 — Shared manager page frame

- Extract only the repeated page header, state panel and section card styles already proven on Chef pages.
- Migrate manager pages one workflow group at a time without changing data hooks or mutations.
- Replace hard-coded color classes with semantic tokens and verify dark/light themes.

### Phase 3 — Record-level flow verification

- Applications: requirements → submission → review → approve/reject → chat access.
- Bookings: request → approval → payment → access code → check-in/out → completion/refund.
- Storage: booking → check-in → extension → checkout inspection → overstay decision.
- Damage: claim → evidence → chef response → charge or admin dispute.
- Revenue: payment transaction → platform fee → payout → statement/refund.

### Phase 4 — Regression and accessibility

- Add route/view contract tests for every sidebar destination and legacy deep link.
- Add notification popover-to-page and notification-item deep-link tests.
- Run role/ownership tests for manager APIs, keyboard navigation checks, responsive checks, and i18n parity.
- Remove obsolete duplicate manager views only after route telemetry or a full reference scan proves they are unreachable.

## Definition of done

- Every capability in the workflow table is reachable from one of the six groups or a contextual action.
- Every notification type opens the correct manager queue or record.
- Every view has loading, empty, error, and success behavior where applicable.
- No manager can access another manager's location-scoped records.
- Chef and Manager shells share visual structure while retaining role-specific wording and workflows.
- Type-check, focused tests, i18n parity, architecture validation, desktop visual checks, and end-to-end journey checks pass.
