# Storage build — common brief for every WP agent (read first)

- Repo E:\codingstuff\LocalCooksCommunity, you are in an isolated git worktree of branch `development` (HEAD eb622313 or later).
- NEVER create a junction/symlink for node_modules (a cleanup can delete through it). Run `npm ci` in your worktree if needed.
- Stripe SANDBOX only, never live; never print secrets. Never touch the production database; do not apply migrations anywhere.
- Plan: docs/architecture/phase0/plan-storage-rentals-2026-10.md. Section §7 "Owner answers" OVERRIDES everything above it:
  daily price only; 30-day platform max (admin) with kitchen-lower max; start within 14 days; extend only when ≤14 days of paid time remain;
  chef taps to extend (NO auto-renew, NO off-session charges, NO retries); 5-day grace at the normal price, then holdover accrues at the
  normal daily price and is only charged when the kitchen raises a request the chef pays (or waives); removal review after 15 days of holdover
  (accrual frozen at 15); abandoned items: after Local Cooks' final notice the kitchen may discard perishables after 48 h, other items after
  7 days (photos + item list, never sold; behind the storage_kitchen_disposal_enabled toggle, off by default); reclaim: rentals ≤7 days not
  reclaimable by the kitchen (emergencies via Local Cooks), longer ones need 7 days' notice or the time left, unused days refunded and
  kitchen-funded; early move-out by the chef: no refund (kitchen may refund more); no deposit; KITCHEN PAYOUT AT THE END OF EACH PAID TERM
  (or earlier when the chef moves out and the kitchen clears the unit), paused while a problem/claim/flag is open; refunds/chargebacks after
  payout: kitchen owes (transfer reversal, else recorded kitchen debt) — EXCEPT chargebacks, which Local Cooks absorbs in the pilot;
  never-moved-in = no-show (kitchen confirms after start, no refund, chef can dispute via problem report); before-start cancellation uses the
  kitchen's booking cancellation policy snapshot; Vercel Hobby CPU: NO new cron — sweeps ride the existing 30-minute tick (≤3 items per task),
  exact deadlines use the Inngest deadline-timer, notices go through storage-rental-notices.ts.
- Already on development: migration 0093 (applied on dev) + shared/schema.ts; shared/storage-rental.ts (pure rules — reuse, never re-derive);
  server/services/storage-rental-notices.ts (queueStorageRentalNotice + storage i18n namespace); server/services/storage-settings.ts +
  storage-availability.ts (WP-ST2); server/services/storage-rentals.ts + server/routes/storage-rentals.ts (WP-ST4: quote, checkout,
  fulfillment, decide approve/decline, expiry, withdraw, readRental/listRentals DTO with server-computed actions[], storageTermStillEligible
  stub returning false, transfer gate for payout_timing 'storage_term').
- Copy rules: sentence case, plain words, say what to do next, always show amounts and dates (kitchen timezone), never "free" when a fee is
  deducted, never show Stripe ids to chefs or kitchens, chefs see the kitchen's name and kitchens see the chef's name. Every new user-facing
  string in en-CA, fr-CA and uk (real Canadian French and Ukrainian) — storage namespace unless the screen already uses another.
- Admin notices: in-app to every admin, email only to admins with the email toggle on (existing pattern).
- Validation: tests next to the code; run `npx vitest run -c vitest.config.server.ts --maxWorkers=2 <files>` (server/shared),
  `npx vitest run <client files>`, `npx vitest run -c vitest.config.storage-pglite.ts` if you touch SQL behaviour, and tsc on touched files via
  a temporary tsconfig under .phase0-harness/tmp/ extending ../../tsconfig.json (NODE_OPTIONS=--max-old-space-size=6144) — report real output.
- Commit on your worktree branch with explicit paths (never graphify-out/, .workbuddy-ai/, outputs/, node_modules); minimal diffs in the
  surrounding style; no new dependencies. Final message: files, endpoints/contracts, tests, deviations, anything unverified.
