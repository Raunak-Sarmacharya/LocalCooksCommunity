# Storage redesign implementation — October 19, 2026

Branch: `t3/storage-readiness-redesign`, based on `development` at `329bdcd2`. No push or merge.

Implementation commits:
- `addba03c` — Separate storage listing readiness from kitchen publishing.
- `5e1634cc` — Give storage its own setup and compact chef listing experience.
- `39f03b5e` — Complete storage board, payout estimates and rental action timeline.
- `135f285e` — Validate storage upload evidence and finish rental regression fixes.

## Decisions 1–8

1. **Independent listing readiness.** Added the shared `storageListingReadiness` rule: name, type, positive daily price, a positive whole unit count, valid longest rental (the existing null/platform-default rule remains), and both location storage instructions. Photos and optional checklist requirements do not gate listing. New listings start Draft; explicitly listing an unready row returns 409 with missing item IDs. Draft, Listed and Paused appear on the Storage tab. The same rule gates chef/public listing and availability reads, discovery summaries, manager live-inventory counts, global chef search, and new rental quotes/checkout. Existing rentals remain readable, approvable and usable when their listing becomes unready. Removed storage setup from kitchen listing requirements, details, review UI and tests.
   Files: `shared/storage-listing-readiness.ts`, `server/services/storage-listing-readiness.ts`, `server/routes/storage-listings.ts`, `server/routes/locations.ts`, `server/routes/manager.ts`, `server/services/global-search-service.ts`, `server/services/storage-rentals.ts`, `shared/kitchen-listing-readiness.ts`, `server/services/kitchen-listing-readiness-service.ts`, `client/src/components/manager/settings/KitchenListingReview.tsx`, and their tests.

2. **Instructions on the Storage tab.** Replaced the setup prompt with two required instruction fields saved through the existing location settings endpoint. The optional checklist/photos page remains linked. The instructions remain one set per location; listing-specific notes remain on the listing. Saving these fields does not change optional tracking switches or kitchen-booking Arrival & departure settings.
   Files: `client/src/components/manager/settings/StorageTrackingSetup.tsx`, `client/src/pages/StorageListingManagement.tsx`, their tests, and manager locale files.

3. **Compact manager listing rows.** Rows show name, type, daily price, longest rental, status and occupancy/request counts with a small bar. Occupancy reads the board’s rental cache and uses `unitRows`, with periodic refresh. View units filters the board by listing ID. Edit opens a side sheet with Basics, Pricing & limits, Photos, and Details & access. Existing form validation, multi-kitchen editing and undo-delete behavior remain in place; creation saves a draft.
   Files: `client/src/pages/StorageListingManagement.tsx`, `client/src/pages/ManagerStorageBookingsPage.tsx`, and tests.

4. **Board and request estimates.** Kept the summary and requests first. Requests show dates, days and the server’s payout estimate, repeated in the approval confirmation. The estimate uses `getFeeConfig`, `heldCardCountry`, `cardFeeRate` and `estimateCardFeeCents`; no new hard-coded card rate or payment writes. Tiles have status colours, date ranges, a link across the tile to the current rental, and the next booked chef/date. The existing earlier-start tie-break remains. Empty units read Available, including the filter. Draft inventory can be viewed on the manager board.
   Files: `client/src/lib/storage-board.ts`, `client/src/pages/ManagerStorageBookingsPage.tsx`, `client/src/components/manager/storage/StorageUnitCard.tsx`, `StorageRequestCard.tsx`, `server/services/storage-rentals.ts`, and tests.

5. **Rental detail and uploader.** Added dated Requested → Approved → Moved in → Moving out → Ended steps with the current step highlighted. Allowed actions are visible buttons and retain their confirmations, previews, reasons and validation. Each term distinguishes card holds, charges, released holds and payout estimates/scheduled/paid states. Reused `PhotoRequirementUploader` (and its `useSessionFileUpload` transport) for handover evidence in `storage-handover`; removed the URL textarea. Found the existing R2 host check in `server/routes/files.ts`, extracted it for reuse, and require our HTTPS upload host for manager handover/items-still-here evidence at both the route and service boundaries. Existing URL shape and photo-count validation remain.
   Files: `client/src/components/manager/storage/StorageRentalDetail.tsx`, `StorageMoreActions.tsx`, `server/services/storage-rentals.ts`, `server/services/storage-checkout-service.ts`, `server/routes/storage-rentals.ts`, `server/routes/files.ts`, `server/utils/upload-url.ts`, and tests.

6. **Shared placeholders.** Added `StoragePhoto` with dry, cold, frozen and other icons on tinted backgrounds. Used it on the chef kitchen section, chef request details, manager Storage rows and board tiles. Uploaded photos retain a type fallback.
   Files: `client/src/components/storage/StoragePhoto.tsx`, `StorageRentCta.tsx`, `client/src/pages/StorageListingManagement.tsx`, `client/src/components/manager/storage/StorageUnitCard.tsx`, and placeholder tests.

7. **Compact chef kitchen section.** Replaced the duplicate inventory list/CTA presentation with thumbnail, name, type/key detail, daily price, availability and Rent rows. Shows three listings initially and a Show all storage count. Reuses the public kitchen response for visitors and chefs without another availability fetch. The existing inventory storage type is now shared with the preview page.
   Files: `client/src/pages/KitchenPreviewPage.tsx`, `client/src/components/storage/StorageRentCta.tsx`, `client/src/components/kitchen-application/KitchenInventory.tsx`, and CTA tests.

8. **Chef sentences and actions.** Reserved rentals starting today or earlier say the unit is ready through the paid end, using kitchen-local today. An already-ended paid term gets a historical sentence. Removal review cannot show Extend, including a stale DTO that advertises it. Ended rentals use their release date. Elapsed response and extension windows no longer promise a future action by a past deadline.
   Files: `client/src/lib/storage-rentals.ts`, `client/src/pages/ChefStoragePage.tsx`, `server/services/storage-rentals.ts`, chef list/detail tests and locale files.

All new/changed copy is in UTF-8 JSON for en-CA, fr-CA and uk. A focused check confirmed the 24 changed manager keys and 26 changed storage keys have matching ICU variables in all three locales. No Stripe IDs were added to UI output.

The policy register’s §5b now records storage readiness/statuses, instruction editing on the Storage tab, and kitchen listing independence, marked built rather than live-verified.

## Validation

Final full server run:
`npx vitest run -c vitest.config.server.ts --maxWorkers=2 --reporter=json --outputFile=.verify-final-server.json`

4,204 passed, 1 failed, 12 skipped across 325 files.
The one failure is `server/stripe-webhook-contract.test.ts:40` (“refuses live Stripe keys”). This worktree has no `STRIPE_SECRET_KEY`; the existing assertion requires a value beginning with the test-key prefix. It also fails alone. No real credential was requested or added, and the unrelated test was left unchanged. The initial full run also caught the paused-kitchen fixture’s missing readiness dependency; that fixture was updated and passes in the final run. The full suite’s existing skipped tests remain skipped.

Final client storage, kitchen-listing and booking coverage:
`npx vitest run storage Storage kitchen-listing KitchenListing booking Booking --maxWorkers=2 --reporter=json --outputFile=.verify-final-client.json`

840 passed, 0 failed, 0 skipped across 87 files.
An earlier run had one new tile-date test failure while the component was being updated. The settled-code run above passes completely. None of the named load-sensitive tests required an isolated flaky-test rerun.

Focused server checks before the full run:
- `npx vitest run -c vitest.config.server.ts server/services/global-search-service.test.ts shared/storage-listing-readiness.test.ts shared/kitchen-listing-readiness.test.ts server/routes/storage-listings.test.ts server/services/kitchen-listing-readiness-service.test.ts server/services/storage-rentals.test.ts`: 70 passed, 0 failed.
- `npx vitest run -c vitest.config.server.ts server/utils/upload-url.test.ts server/routes/storage-rentals.test.ts server/services/storage-move-in-out.test.ts`: 35 passed, 0 failed.

The PGlite storage tests exercise real SQL, production table columns and the existing storage exclusion constraint. They prove that missing location instructions block new quotes/checkout while an existing request remains readable and approvable. Focused client coverage includes draft listing, direct instructions, edit sheets, next reservations, Available, placeholders, real-uploader wiring and submitted URLs, timeline/term labels, approval payout copy, reserved/past sentences and removal-review actions.

`npx tsc --noEmit -p .` ran once in the foreground and exited 1 with 12 missing-property errors, all from the preview page’s duplicate `StorageListing` declaration. Replaced that duplicate with the existing inventory type. A subsequent TypeScript Compiler API semantic check of `KitchenPreviewPage.tsx`, using the project’s compiler options, completed with **0 diagnostics**. The full-project command was not repeated, following the requested once-only process. No other files had diagnostics in that full run. No node processes were killed.

`git diff --check` passed. No dependencies were added or changed. The worktree had no node_modules, so verification reused the main checkout’s existing dependency installation through a local junction.

## Data, questions and limits

- **Migration:** none. Existing `isActive`, the existing draft/active status values, and location checklist instruction columns cover the design. No data migration or backfill was written.
- **Existing dev listings becoming Draft:** any active listing missing a name/type, positive daily rate, valid unit count/longest-rental setting, or either nonblank location storage instruction. Photos do not affect readiness. These rows are hidden from chef-facing reads until ready; their active flag, existing rentals and history are preserved. No dev DB was queried, so no listing names/IDs are claimed here.
- **Questions:** none unresolved. Preserved the existing prohibition on $0 storage and the existing empty-max-days/platform-maximum fallback.
- **Deliberately skipped:** production access, dev data changes, push, merge, deployment and live browser/payment/R2 end-to-end verification. No implementation decision 1–8 was deliberately omitted. The full-project typecheck was not repeated after its targeted fix, as described above.

## Changed files

- `client/src/components/kitchen-application/KitchenInventory.tsx`
- `client/src/components/manager/settings/KitchenListingReview.test.tsx`
- `client/src/components/manager/settings/KitchenListingReview.tsx`
- `client/src/components/manager/settings/StorageTrackingSetup.test.tsx`
- `client/src/components/manager/settings/StorageTrackingSetup.tsx`
- `client/src/components/manager/storage/StorageMoreActions.test.tsx`
- `client/src/components/manager/storage/StorageMoreActions.tsx`
- `client/src/components/manager/storage/StorageRentalDetail.test.tsx`
- `client/src/components/manager/storage/StorageRentalDetail.tsx`
- `client/src/components/manager/storage/StorageRequestCard.tsx`
- `client/src/components/manager/storage/StorageUnitCard.test.tsx`
- `client/src/components/manager/storage/StorageUnitCard.tsx`
- `client/src/components/storage/StoragePhoto.test.tsx`
- `client/src/components/storage/StoragePhoto.tsx`
- `client/src/components/storage/StorageRentCta.test.tsx`
- `client/src/components/storage/StorageRentCta.tsx`
- `client/src/lib/storage-board.test.ts`
- `client/src/lib/storage-board.ts`
- `client/src/lib/storage-rentals.test.ts`
- `client/src/lib/storage-rentals.ts`
- `client/src/pages/ChefStoragePage.test.tsx`
- `client/src/pages/ChefStoragePage.tsx`
- `client/src/pages/ChefStorageRentalPage.test.tsx`
- `client/src/pages/KitchenPreviewPage.tsx`
- `client/src/pages/ManagerStorageBookingsPage.test.tsx`
- `client/src/pages/ManagerStorageBookingsPage.tsx`
- `client/src/pages/StorageListingManagement.test.tsx`
- `client/src/pages/StorageListingManagement.tsx`
- `docs/architecture/phase0/policy-facts-booking.md`
- `server/routes/files.ts`
- `server/routes/locations.ts`
- `server/routes/manager.ts`
- `server/routes/paused-kitchen-assets.test.ts`
- `server/routes/storage-listings.test.ts`
- `server/routes/storage-listings.ts`
- `server/routes/storage-rentals.test.ts`
- `server/routes/storage-rentals.ts`
- `server/services/global-search-service.test.ts`
- `server/services/global-search-service.ts`
- `server/services/kitchen-listing-readiness-service.test.ts`
- `server/services/kitchen-listing-readiness-service.ts`
- `server/services/storage-checkout-service.ts`
- `server/services/storage-listing-readiness.ts`
- `server/services/storage-move-in-out.test.ts`
- `server/services/storage-rentals.test.ts`
- `server/services/storage-rentals.ts`
- `server/utils/upload-url.test.ts`
- `server/utils/upload-url.ts`
- `shared/i18n/locales/en-CA/manager.json`
- `shared/i18n/locales/en-CA/storage.json`
- `shared/i18n/locales/fr-CA/manager.json`
- `shared/i18n/locales/fr-CA/storage.json`
- `shared/i18n/locales/uk/manager.json`
- `shared/i18n/locales/uk/storage.json`
- `shared/kitchen-listing-readiness.test.ts`
- `shared/kitchen-listing-readiness.ts`
- `shared/storage-listing-readiness.test.ts`
- `shared/storage-listing-readiness.ts`
