---
type: "query"
date: "2026-09-14T23:12:02.976571+00:00"
question: "Why does First Point Commercial Kitchen show no available dates, what blocks Effie's approval, and why can Jennifer not review the submitted documents?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["getMonthBookableAvailability", "ApplicationDetailPanel.tsx", "ChefApplicationService"]
---

# Q: Why does First Point Commercial Kitchen show no available dates, what blocks Effie's approval, and why can Jennifer not review the submitted documents?

## Answer

Expanded from original query via graph vocab: availability monthly kitchen application approval approved booking calendar documents manager status. Production kitchen 80 stores all seven weekly rows as open 08:00 to 01:00. booking.service.ts generates slots only while startHour is less than endHour, so overnight windows produce zero slots and monthly availability becomes false. Effie's application 65 is approved at current_tier 2 with tier2_completed_at set, but tier1_completed_at and tier3_submitted_at are null and no chef_location_access exists. Location 94 requires an approved food establishment certificate and insurance; the insurance URL exists but both document statuses remain pending. The manager query includes application 65 and all three URLs, but verify-documents passes statuses to updateApplicationDocuments, which only persists URL fields, so status approvals are discarded. Runtime presigned-link behavior was not verified.

## Outcome

- Signal: useful

## Source Nodes

- getMonthBookableAvailability
- ApplicationDetailPanel.tsx
- ChefApplicationService