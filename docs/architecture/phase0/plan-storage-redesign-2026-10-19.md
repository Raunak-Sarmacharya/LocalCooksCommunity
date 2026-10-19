# Storage redesign — owner decisions Oct 19, 2026 (design by lead)

Goal: storage (standalone daily rentals at a kitchen) feels as clear as Neighbor.com (request → card hold → host approves → move-in
details) and self-storage operator software (unit grid coloured by status, live occupancy), and consistent with our kitchen
booking pages. Approval stays MANUAL (owner: no instant book). Chefs find storage on the kitchen's own page only (owner).

Research: Neighbor host guide (approve/decline within 24–48 h, approve from email/text, move-in details sent after approval,
access hours per host); Stora / Unit Trac / Rent Manager (colour-coded unit map: vacant / occupied / overdue, click a unit to act,
occupancy summary on top); Airbnb/Neighbor only publish a listing once its essentials are complete.

## Decisions (owner)
1. **Storage has its own listing procedure, independent of the kitchen listing.**
   - Remove `storageVisitSetup` from the KITCHEN listing requirements (`shared/kitchen-listing-readiness.ts`,
     `server/services/kitchen-listing-readiness-service.ts`, `KitchenListingReview.tsx`). A kitchen can be listed with storage not ready.
   - A storage listing can be **Listed** only when its own essentials are complete; otherwise it is a **Draft** (chefs never see it).
     Essentials: name, type, price per day > 0 (or explicit 0 only if the existing form allows free storage — keep existing rule),
     unit count ≥ 1, longest rental (max days), AND the kitchen's storage move-in AND move-out instructions are set (decision 2).
     Photos are optional; without photos a type-based placeholder is shown everywhere (decision 6).
   - One source of truth for "visible to chefs": a listing is shown/rentable iff it is listed (existing `isActive`) AND ready.
     Find every chef-facing read (kitchen preview storage section, `/kitchens/:id/storage` availability, rental quote/checkout,
     `server/routes/locations.ts` storage counts, discover summaries) and apply the same readiness rule via ONE shared function.
     The server refuses listing (PUT isActive=true or create with isActive=true) when not ready: 409 with the missing items.
     New listings start as Draft. Existing rentals are never affected by a listing becoming un-ready.
   - The Storage tab shows each listing's status: Draft (with "Finish setup: …missing items" and a "List" button disabled
     until ready), Listed, or Paused (listed off by the kitchen). The existing active toggle becomes "Listed / Paused".
2. **Move-in / move-out instructions: one set per kitchen location** (already built: `storageCheckinInstructions` /
   `storageCheckoutInstructions` on `/manager/locations/:id/checkin-checkout-settings`). Show the two fields DIRECTLY on the
   Storage tab (required, with "Shared with the chef once you approve. Applies to all storage at this kitchen."), saved from
   there. The optional checklist and photo requirements stay on the existing sub-page, linked as
   "Optional: checklist and photos chefs complete at move-in and move-out". Each listing keeps its optional "Notes for chefs"
   for listing-specific details. Kitchen-booking Arrival & departure (kitchen time) is unrelated and stays where it is.
3. **Storage tab listing rows** (`client/src/pages/StorageListingManagement.tsx`): compact rows — name, type, $/day, longest
   rental, status, and LIVE occupancy ("2 units · 2 in use · 1 request", small bar) from the same data as the board; buttons
   "View units" (opens the Storage board filtered/scrolled to that listing) and "Edit" (side sheet with the existing fields,
   grouped: Basics · Pricing & limits · Photos · Details & access). Keep the existing form logic; don't rewrite validation.
4. **Storage board** (`ManagerStorageBookingsPage.tsx`, `client/src/lib/storage-board.ts`, `StorageUnitCard.tsx`,
   `StorageRequestCard.tsx`):
   - Summary line on top (keep). Requests first: chef, listing, unit, dates, days, **Chef pays $X · You receive about $Y**
     (server-provided estimate: total − service fee − estimated card fee, using `shared/card-fee-estimate.ts`
     `cardFeeRate(base from getFeeConfig, held card country)`; expose `estimatedPayoutCents` on requested rentals), answer-by
     time, Approve / Decline. The approve sheet repeats the payout line.
   - Units as a grid of tiles per listing, coloured by status (in use / reserved / needs action / available / out of service),
     each with occupant + dates, and a "Next: {chef} · {date}" line when a later rental is booked on the same unit
     (the board currently keeps one rental per unit; keep the current-first rule just added in `unitRows` and add `next`).
   - Rename the "Free" chip/filter to **"Available"** (it means an empty unit, not free of charge).
   - A tile opens the rental page.
5. **Rental page** (`StorageRentalDetail.tsx`, `StorageMoreActions.tsx`):
   - A timeline: Requested → Approved → Moved in → Moving out → Ended (with dates), current step highlighted.
   - Actions as visible buttons (from the DTO's `actions[]`), not hidden in "More": Approve/Decline (requests — already
     added via `StorageRequestCard`), confirm move-in/handover, move-out by…, items still here, report damage, etc. Keep each
     action's existing confirmation/validation.
   - Money per term labelled honestly: "Held on the chef's card" (requested), "Charged" (paid), "Your payout" (estimate /
     scheduled / paid) — matching the booking statement wording.
   - **Photos use the real uploader**: replace the photo-URL textarea in `StorageMoreActions.tsx` with
     `PhotoRequirementUploader` / `useSessionFileUpload` (R2 via `/api/firebase/upload-file`, folder e.g. `storage-handover`),
     the same component the chef's move-in dialog uses. Server already validates `photoUrls` as URLs; keep that, and accept
     only our upload URLs if a helper exists (check `server/upload-handler.ts` / `r2-storage.ts`).
6. **Placeholders**: a storage listing without photos shows a tasteful type-based placeholder (dry / cold / frozen / other —
   icon on a soft tinted background), on the chef kitchen page, the chef request page, the kitchen Storage tab and the board.
   One shared component.
7. **Chef kitchen page storage section** (`client/src/pages/KitchenPreviewPage.tsx` + `StorageRentCta.tsx`): compact rows —
   photo/placeholder thumbnail, name, type + key detail (e.g. "Cold · 35–40°F"), "$X/day", "Available from {date}" (or
   "Available now"), and a "Rent" button. One intro line ("Rent by the day. No automatic charges. The kitchen approves each
   request."). More than 3 listings → first 3 + "Show all storage (N)". No congestion.
8. **Chef storage list** (`ChefStoragePage.tsx`, `client/src/lib/storage-rentals.ts`): a reserved rental whose start is today or
   past reads "Unit {n} is ready. Move in any time before {end}." (not a past date); a rental under removal review never shows
   "Extend" (only View). Check every state's sentence for past/incorrect dates.

## Constraints
- Dev only; never touch production. No new dependencies. Translations: en-CA, fr-CA, uk (UTF-8 JSON, ICU `{var}`), sentence
  case, never show Stripe IDs. Keep existing money/state logic; this is UI + listing readiness, not a money change (the payout
  estimate is display only).
- Tests: update/add focused tests (readiness rule incl. server 409 and chef-visibility filter; kitchen readiness no longer needs
  storage; board tiles next/available; uploader wiring; placeholder; chef sentences). Real-Postgres (PGlite) test for the
  readiness filter if the existing storage tests use PGlite.
- Policy register `docs/architecture/phase0/policy-facts-booking.md` §5b: add rows for storage listing readiness (draft/listed),
  instructions on the Storage tab, kitchen listing independence.
