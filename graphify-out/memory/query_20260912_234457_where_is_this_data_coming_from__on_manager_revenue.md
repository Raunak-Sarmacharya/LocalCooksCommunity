---
type: "query"
date: "2026-09-12T23:44:57.608373+00:00"
question: "where is this data coming from? on manager revenue page?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["RevenueMetricCards.tsx", "ManagerRevenueDashboard.tsx", "revenue-service-v2.ts"]
---

# Q: where is this data coming from? on manager revenue page?

## Answer

Expanded from original query via vocab: [revenue, manager, metric, gross, refund, stripe, transaction, overview, available, pending, booking, tax]. Revenue cards mix two sources: gross revenue, refunded amount, average booking value, and booking count come from the revenue overview API aggregating payment_transactions; tax, Stripe fee, and net revenue are recalculated in the browser from the transaction-history API; available and pending balances come live from the connected Stripe Balance API. This source mixing can make the cards internally inconsistent.

## Outcome

- Signal: useful

## Source Nodes

- RevenueMetricCards.tsx
- ManagerRevenueDashboard.tsx
- revenue-service-v2.ts