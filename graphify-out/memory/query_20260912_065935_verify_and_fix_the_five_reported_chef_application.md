---
type: "query"
date: "2026-09-12T06:59:35.772104+00:00"
question: "Verify and fix the five reported chef application and kitchen-manager booking and checkout confusions."
contributor: "graphify"
outcome: "useful"
source_nodes: ["ApplyToKitchen.tsx", "KitchenApplicationCard.tsx", "AdminKitchenApplicationsStep1Section.tsx", "ManagerBookingsPanel.tsx", "BookingDetailsPage.tsx", "processKitchenCheckoutClear"]
---

# Q: Verify and fix the five reported chef application and kitchen-manager booking and checkout confusions.

## Answer

Verified all five against the application and checkout flows. Rejected or cancelled applications now route directly to reapply; Step 1 shows the declared food-safety answer without falsely presenting Step 2 documents as missing; admins see the declaration and timing; booking rows consistently open full booking details; checkout-requested bookings expose the existing clear-checkout action. Targeted regression test, TypeScript check, and production build pass.

## Outcome

- Signal: useful

## Source Nodes

- ApplyToKitchen.tsx
- KitchenApplicationCard.tsx
- AdminKitchenApplicationsStep1Section.tsx
- ManagerBookingsPanel.tsx
- BookingDetailsPage.tsx
- processKitchenCheckoutClear