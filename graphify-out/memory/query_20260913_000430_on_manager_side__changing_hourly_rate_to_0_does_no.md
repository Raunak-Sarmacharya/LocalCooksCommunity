---
type: "query"
date: "2026-09-13T00:04:30.421751+00:00"
question: "On manager side, changing hourly rate to 0 does not work; managers may want only daily or only hourly pricing."
contributor: "graphify"
outcome: "useful"
source_nodes: ["KitchenPricingManagement.tsx", "kitchen.repository.ts", "schema.ts"]
---

# Q: On manager side, changing hourly rate to 0 does not work; managers may want only daily or only hourly pricing.

## Answer

Expanded via graph vocab: [manager, kitchen, pricing, rate, hour, daily, validation, update, save, listing]. The manager route accepted zero, but KitchenRepository.update used a truthy check and converted zero to undefined, leaving the previous database value unchanged. Fixed explicit zero persistence, allowed zero in updateKitchenSchema, and required at least one hourly or daily rate above zero in both client and route validation.

## Outcome

- Signal: useful

## Source Nodes

- KitchenPricingManagement.tsx
- kitchen.repository.ts
- schema.ts