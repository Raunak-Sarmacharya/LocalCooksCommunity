---
type: "implementation"
date: "2026-09-14T13:24:27.533746+00:00"
question: "Fix applicant phone resubmission, kitchen tour contact/status, kitchen access navigation, full-day checkout, refund invoice/action consistency, and green control styling."
contributor: "graphify"
outcome: "useful"
source_nodes: ["KitchenApplicationForm.tsx", "ViewingsDashboard.tsx", "AdminTourRequestsSection.tsx", "OverviewTabContent.tsx", "stripe-checkout-service.ts", "checkout-metadata.ts", "invoice-service.ts", "ManagerRevenueDashboard.tsx"]
---

# Q: Fix applicant phone resubmission, kitchen tour contact/status, kitchen access navigation, full-day checkout, refund invoice/action consistency, and green control styling.

## Answer

Expanded query vocabulary: application, phone, tour, viewing, booking, checkout, refund, invoice, revenue, kitchen, status, contact. Implemented user and application phone fallback, admin/manager tour contact visibility, one-click accepted status, kitchen preview navigation, compact Stripe slot metadata with reconstruction, a single booking refund workflow, net-after-refund invoice totals, and primary-theme interactive controls. Type-check and targeted pricing/checkout tests passed.

## Outcome

- Signal: useful

## Source Nodes

- KitchenApplicationForm.tsx
- ViewingsDashboard.tsx
- AdminTourRequestsSection.tsx
- OverviewTabContent.tsx
- stripe-checkout-service.ts
- checkout-metadata.ts
- invoice-service.ts
- ManagerRevenueDashboard.tsx