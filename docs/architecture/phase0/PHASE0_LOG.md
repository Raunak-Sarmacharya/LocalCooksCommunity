# Phase 0 master log (kitchen booking redesign)

Single source of truth for everything done, decided and pending in Phase 0. Read this first when resuming.
Last updated: 2026-10-13.

## Oct13 late — dev end-to-end walkthrough, email unification, receipt vs invoice
- **Owner:**
  - Booking emails must match the tour emails (same platform, mobile, Airbnb-level).
  - Sender: dev `test_automated@localcooks.ca`, prod `automated@localcooks.ca`. Support: `support@localcooks.ca` for both (confirmed; "localcook.ca" was a typo).
  - **Emails show the total only**; the itemized breakdown goes in an attached PDF. The fee rate is admin-configurable (pilot 0% or 7%) and is never printed in email copy.
- **Owner (roadmap, payment cycle): receipt vs invoice are separate.** Parent design, to be confirmed with the owner at the closeout/payout step:
  - **Receipt** at capture (confirmation): proves payment; attached to the confirmation email.
  - **Final invoice** at closeout (manager inspection or automatic deadline): reflects refunds, partial cancellations, extensions and any approved post-visit charges. Issued together with the manager payout statement.
  - Research: Airbnb receipt vs VAT invoice; Turo post-trip invoices (fuel/tolls with evidence within set windows).
- Done by the parent: `getSupportEmail()` now returns `SUPPORT_EMAIL` or support@localcooks.ca (it was derived from the sender's domain). Local `.env` sender aligned with dev (backup at `.phase0-harness/.env.bak-email`). Deployed dev already sends as `Local Cooks <test_automated@localcooks.ca>` (verified in `email_logs`).
- **Dev walkthrough (KB-143, real Stripe sandbox checkout, manager approve).** Works end to end; capture OK; visit code is live on dev with the Vercel secret. UX findings → `build-booking-email-and-ux.md` Package U.
  - Possible harness artifacts, to re-check in a visible tab: the approve dialog stays open, and the cancellation dialog lingers (its data-state was "closed").
  - The cancellation dialog's vague refund copy waits for the policy engine.
- DeepSeek inventory → `map-booking-emails.md`: 12 notice-layout, 19 legacy-uniform (plus 16 dead), 5 bare, 2 text-only; duplicate storage-extension sends.
- Launched: Package E (emails onto the tour shell, PDF receipt, no breakdown in bodies) on Codex Sol high; Package U (walkthrough UX fixes) on Sonnet.
- **Dev walkthrough, continued (KB-145, check-in → in session → checkout → inspection clear).** All steps work on dev.
  - Bug found in the arrival work: after checkout, the chef page showed the pre-release "What to expect" card with a past date.
  - Plus post-arrival UX issues; all sent to Package U as items 12–17.
  - Inspection page copy issues to fix in a later pass: IANA zone, raw "Booking status: confirmed", "person booking", a legalistic photo line, the duplicated deadline, and a native `window.confirm` (should be an in-app dialog).
- **Admin walkthrough** (synthetic admin 381; the parent set its password via `set-pw.cjs`, `@localcooks.test` only):
  - **no Booking support screen**: the ⌘K lookup lands on Transactions;
  - admin times are shown in UTC without a label;
  - Damage Claims navigation is stale (deposits were removed);
  - the Overview "Total bookings 5" looks wrong.
  - This confirms audit P0 (`audit-admin-support-controls.md` §4).
- **Owner decisions (support):**
  - Pilot support is **one person** (the owner): no second approver; every action requires a reason and note, is audited, and notifies both parties.
  - **Goodwill cap $25** per booking from Local Cooks' pocket; above that, a double confirmation recorded as an exception.
  - **Chargebacks and failed payouts:** flag properly on the booking, notify the admin (email + in-app), freeze conflicting refunds and payouts, and keep the user-facing experience trustworthy and top-platform-like. Resolution happens in the Stripe dashboard for now.
- The owner offered the Comet browser on their PC for testing; it is not connected to this session. The fallback is API and DB verification.
- **Planned:** `build-booking-support.md`: an admin Booking support case screen.
  - Search; case view with chronology; a state-valid action panel reusing existing services; `support_actions` audit; `booking_flags` for disputes and payout failures with freeze plus admin notify; $25 goodwill cap.
  - Migration **0077** goes to support, so **multi-day moves to 0078+**.
  - Launch after Package E lands (shared email shell).
- **Seller-side staging links fixed** (colleague report: the shop-credentials email linked to staging in production).
  - Cause: hard-coded `stagingwebapp.localcook.shop` fallbacks. `VENDOR_DASHBOARD_URL` is set only for dev/preview, and `PHP_SHOP_LOGIN_URL` is set nowhere.
  - Fix:
    - New `server/shop-urls.ts` derives the shop origin from `SHOP_BASE_URL`, else `PHP_BRIDGE_API_URL` (Vercel prod = `shop.localcook.shop`, dev/preview = `stagingwebapp.localcook.shop`; verified with the owner's go-ahead), else `VERCEL_ENV`.
    - New `client/src/lib/shop-urls.ts`: `VITE_SHOP_BASE_URL`, else production hostnames → shop, else staging.
  - Replaced in:
    - the credentials email (HTML + text);
    - the vendor onboarding link;
    - the applications credentials endpoint;
    - **seller analytics, which was fetching from the staging PHP API in production**;
    - `ChefStripeConnectSetup`, `ApplicantDashboard`, `useSellerRevenue`.
  - The unsubscribe emails now use support@localcooks.ca instead of `localcooks@localcook.shop`.
  - Full tsc clean. Not committed or deployed; production gets it on the next merge.
- **Package U RETURNED** (Sonnet) → `.phase0-harness/booking-ux-checkpoint.md`.
  - Items 1–17 done; client tsc clean.
  - Parent verification: 14 of the other client failures also fail at HEAD `517df182` (tour, manager getting-started and cancellation-policy-dialog tests, checked in a clean worktree); the 15th, KitchenHero, passes alone (a timeout under load). **No new failures.**
  - API gaps to add server-side:
    - a `responseDeadlineAt` field on booking payloads (the client currently derives created + 24 h);
    - `preparationReminderHours` exposed to the checkout step (the "48 hours" text is a literal).
  - Extra: `compareHistoryEvents` was added in `shared/booking-history.ts`.
- **Package E RETURNED** (Codex) → `.phase0-harness/booking-email-checkpoint.md`.
  - Every live booking/storage/access/licence email is on the tour notice shell, with plain-text parts.
  - 20 dead generators removed; duplicate storage-extension sends removed.
  - Totals only in email bodies. The PDF receipt is a **link** ("Download PDF receipt"; the generator is too heavy for send time on Hobby, and Airbnb uses "Get receipt" too).
  - The Stripe line item names the kitchen and date. Request emails carry the response deadline (stored `createdAt` + `AUTH_EXPIRY_HOURS`).
- **Parent review on rendered mail** found and fixed three bugs:
  - (1) the chef confirmation greeted "Hi Kitchen manager";
  - (2) the manager email used the chef's EMAIL as their name;
  - (3) the Google Calendar link was double-encoded (`%2520`).
  - Fix: the producer uses `getUserDisplayName` (profile name, then Firebase name, never an email; outside the tx, failures fall back to "there"), and `URLSearchParams` values are no longer pre-encoded.
  - Re-rendered: "Hi TestSprite chef", "Booking confirmed · TestSprite chef", a clean calendar title. 89/89 targeted tests pass; full tsc clean.
- **Dev deploy `624e0c0d` re-walk (KB-149, real sandbox checkout in a visible preview):**
  - **Verified on dev:**
    - the checkout "What happens next" block;
    - consistent a.m./p.m. times;
    - the chef pending banner with the deadline and "only charged if they accept";
    - "Booked {date}";
    - the manager "Respond by…", "The chef's payment is on hold" and the HST line;
    - after approval, the dialog closes and the page refreshes to Confirmed;
    - the visit-code panel says "Chef";
    - the redesigned confirmation emails.
  - **Bug found:** the real checkout path queues a generic `requested` lifecycle event ("Booking #149 awaits manager approval. Payment is authorized and has not been captured."), so the new request templates were never used. Parent fix (local, not yet deployed): the `requested` event now renders `generateBookingRequestEmail` (chef) and `generateBookingNotificationEmail` (manager) with the stored deadline, hold state and total. Verified in the mail sink ("Request sent to PHASE0 Main Kitchen", "New booking request · TestSprite chef"); tsc clean; 65 tests pass.
  - Harness: `seed-requested.mjs`.
- **Owner flagged** the manager "Attendance correction" dialog ("Message to chef (shared with chef and kitchen manager)", unexplained No-show/Attended/Withdraw buttons, duplicated Manage visit / Visit inspection).
  - The owner wants every surface at top-platform level, with nothing ignored.
  - → `build-ux-sweep.md`: Part 1 is a binding redesign "Fix the visit record" (guided option cards, Turo-style no-show reporting with a note to the chef and the ability to reply); Part 2 is a sweep of all chef/manager booking surfaces plus in-app notification copy.
  - Launched on Codex Sol high.
- **Owner: revamp the booking details page** (hierarchy, platform messaging, odd tags, empty visit-code heading).
  - Parent review agreed with all four points.
  - Pushed back on adding a progress stepper (Airbnb's reservation page has none) and on redesigning the payment card, history and help, which are already at par.
  - Spec: `design-booking-details-page.md`:
    - header with who and when, one status pill, one next-step line, one state-based primary action, Message always, an overflow menu;
    - main: Visit / When & where / person card / add-ons / note;
    - sidebar: Payment / Cancellation / Activity / Help.
  - Owner decision on phone: show it as an underlined `tel:` link (no call button), with Airbnb-style "keep messages in Local Cooks" guidance. The parent shows it **once confirmed** (the owner may override).
  - Build after the UX sweep lands, on an **Opus** agent (owner's preference for this work).
- **UX sweep RETURNED** (Codex) → `.phase0-harness/ux-sweep-checkpoint.md` (+ `ux-sweep-inventory.md`: 53 surfaces, about 2,755 strings).
  - "Fix the visit record" built to spec. Inspection page cleaned (in-app confirm, no legalese, one deadline, no visit code after the visit). Dashboard inline clear/claim dialogs removed in favour of the inspection page. Notification copy is plain language. "Your note"; Stripe date "Fri, Oct 16".
  - tsc clean; no new failures.
  - Parent spot-check: the server diffs are copy only; none of the changed event titles is matched by logic.
  - Gaps: notifications are persisted as rendered English (no per-recipient i18n); the standalone admin correction lacks name/zone context.
- **Booking details page redesign launched** on an Opus agent: `design-booking-details-page.md` plus `.phase0-harness/ux-sweep-review-notes.md` leftovers. Client only.
- **Owner (Oct 14):** once the booking-page redesign passes the parent's review, **deploy to Vercel development without reconfirming** (this one deploy only).
  - **Next session**, in order:
    1. walk both roles through every booking state, including at 390 px;
    2. the admin Booking support screen (`build-booking-support.md`);
    3. the remaining booking-cycle parts, end to end, to top-platform level: reminders → private reviews → payout after closeout with receipt vs final invoice → cancellation policy engine → invites → extension/early/late offers → multi-day (0078+) → storage; reschedule (simple, Food Corridor style) after the cancellation engine.
- **Booking page redesign RETURNED** (Opus) → `.phase0-harness/booking-page-redesign-checkpoint.md` (28 mock screenshots: 7 states × 2 roles × 1440/390).
  - Parent review accepted it, with three copy fixes:
    - the manager next step "Confirmed. Check-in details… under Visit" → "{chef} is booked. Give them the visit code in person when they arrive.";
    - the chef "Download invoice" → "Download receipt" (receipt vs invoice decision);
    - the manager "Your payment was collected" → "Payment collected from the chef".
  - Closed the messaging gap: `POST /bookings/:id/conversation` now allows `pending` (Airbnb lets both sides message before acceptance); Message is shown while pending.
  - Accepted the agent's calls: a "Review cancellation" manager primary; "You can cancel until…" instead of "Free cancellation".
  - Open gaps: "Member since" needs `createdAt` on the payloads; the kitchen contact name.
  - All targeted tests pass; full tsc clean.
- **Committed `1f985dbb` and pushed to development** (owner pre-authorized). Includes the UX sweep, the redesign and the requested-email fix.
- The booking side was already environment-aware (`getAppBaseUrl`). About 15 older storage/auth-expiry stragglers use `VITE_APP_URL || 'https://localcooks.ca'` (wrong subdomain); they are folded into the email cleanup.

## Step 2 live test (booking KB-132, local, synthetic) + two Codex designs returned
- **Live-verified:**
  - manager panel shows the code beside customer, kitchen and local time; "Issue new code" asks for confirmation, then rotates (old code rejected);
  - chef wrong code → "4…1 attempts left", 5th → locked screen with "Message kitchen"; the manager sees "5 of 5 · Locked", and issuing a new code unlocks;
  - correct code → arrival recorded once (`consumed_method=code`, staffed);
  - chef in-session panel: countdown, "Need more time?", leave early, report a problem;
  - manager header badge "In session · 49 min left · ends 10:15 p.m.";
  - a problem report saves `category=equipment`, with inline "Report sent";
  - no code appears in any captured email (all 17 scanned).
- **Fixed in place:** the check-in record said "via self check-in" for a staffed code arrival. Old copy: `checkedInMethod='self'` means the chef recorded it, which now collides with the new mode name. It now reads "Recorded by you" (chef) / "Recorded by the chef" (manager); key `bdViaSelfManager` added in en-CA, fr-CA and uk. Locale suite: only the 9 known `booking.json` failures.
- **Gaps found (go to the arrival-communication build):**
  - the chef's locked screen does not refresh itself after the manager issues a new code; it needed a reload;
  - the manager panel does not refresh attempts or lock until a reload (design D adds a bounded refresh);
  - problem-report emails are bare ("Support request #10: Awaiting response.") and omit the category;
  - the manager page shows the chef line "Check in when you arrive and check out when you leave."
- **Designs returned (Codex Sol High):** `design-reschedule.md` and `design-arrival-communication.md`. The owner questions are in §8 and §5 of each; answers are pending.
  - Reschedule recommendation: amend the same booking (no cancel + rebook). A same-price move involves no Stripe operation; a price rise is a new PaymentIntent for the difference only; a price drop is a partial refund. Manager approval is required in the pilot; the cancellation anchor is the earliest accepted start.
  - Reschedule prerequisites: the cancellation engine, post-closeout settlement and multi-day. **Reschedule is therefore sequenced after those**, not next.
  - Arrival communication: mode lines at confirmation, explanation in preparation (T−24h), one action line at T−2h; the visit code stays with staff. No code ever goes in email. Instruction free-text also leaves email (a door code typed by a manager could leak), replaced by a link to the authenticated visit page. Manager reminders are added.

## Oct13 night owner decisions — reschedule + arrival communication
- **Reschedule = amend the same booking** (CONFIRMED). The owner wants any processing fee shown when it applies. Parent rule, consistent with the locked cancellation rule (chef-caused refunds are minus the Stripe fee):
  - price up: the chef pays only the difference; the new charge's Stripe fee is the kitchen's normal processing cost, as on every booking;
  - price down: the refund is the difference minus the non-returned Stripe fee on that difference, shown as its own line before the chef submits;
  - same price: no money moves and no fee.
- **Arrival instructions in email** (owner): follow Airbnb.
  - Confirmation carries a "what to expect" overview only.
  - The timed preparation email carries the full arrival and departure instructions in the email body, because many chefs never sign in.
  - This overrides design §3's "link, not text" recommendation.
- **Self check-in:** no extra block. Listings cannot save without arrival and departure instructions (verified: `KitchenCheckinCheckoutEditor` marks them "Required before you can save"), registration requires a phone, and Local Cooks meets every kitchen in person. The existing confirmation dialog stays.
- **Reschedule kept simple, Food Corridor style** (owner): no complex engine.
  - The chef can move a confirmed booking themselves only while the full-refund window is open, with manager approval.
  - After that, there is no chef self-service; Local Cooks admin/support controls handle exceptions.
  - The money rules above stay. In-session extra time stays the linked extension offer.
  - `design-reschedule.md` remains research background; its v3 engine, two-move cap, anchors and late-move tiers are NOT adopted.
  - Sequenced after the cancellation engine.
- **Instruction release = preparation time, page and email in sync** (owner, security):
  - Detailed arrival and departure instructions are released at T−48h on both the platform and email; before that, only the overview.
  - Late bookings must still work without bombarding the chef: confirmed inside 48 h → instructions are released immediately and folded into the confirmation (no separate preparation email); inside 2 h → one consolidated message.
- Dev `platform_settings` reminder values set to product values: preparation 48 h, arrival 2 h, departure 30 min (they were a teammate's test values 2/1/5; the owner says the parent is now the only person working on this).
- **Arrival-communication build launched** from the parent plan `build-arrival-communication.md`:
  - Package S (server) on Codex GPT-6.1 Sol high; checkpoint at `.phase0-harness/arrival-comms-server-checkpoint.md`;
  - Package C (client) on Sonnet; checkpoint at `.phase0-harness/arrival-comms-client-checkpoint.md`;
  - no shared files between the two.
- **Client package RETURNED** → `.phase0-harness/arrival-comms-client-checkpoint.md`.
  - tsc clean; no new failures; 12 new tests; 15 chef keys added.
  - Accepted the one-line edit outside its list (`BookingAttendancePanel.tsx`, needed for the manager sentence).
  - **Gap for parent review:** `GET /chef/locations/:id/checklist` (fallback in `use-location-checklist.ts`) returns location instructions to any approved chef at any time, so it bypasses the release gate. Fix: chef-facing instruction text is removed from that endpoint, and the client uses booking-scoped duties only.
- **Server package RETURNED** (Codex) → `.phase0-harness/arrival-comms-server-checkpoint.md`.
  - 193 tests across 10 files pass; tsc clean.
  - Every chef instruction path is gated, including the location checklist (its text is now always null for chefs).
- **Parent live test (local, mail sink, synthetic KB-140/141/142).** New harness `seed-confirmed.mjs <hours>` runs the real confirmation side effects with a local-only $0 payment row; the `pi_phase0_synthetic_*` id is not a Stripe object.
  - KB-140 (72 h out): the confirmation carries only the overview and "instructions arrive Oct 14, 10:00 p.m. (Newfoundland Time)". The page shows "What to expect". Its API endpoints return no instruction text (checked with the chef's own token), and its entry in `/api/chef/bookings` doesn't either.
  - KB-141 (30 h out): the confirmation includes the full instructions; the preparation reminder is acknowledged, so it won't be resent.
  - KB-142 (1.5 h out): one consolidated confirmation; preparation and arrival reminders are both acknowledged. Manager arrival reminders are scheduled.
  - The manager switched KB-140 to self → the chef email "Self check-in is now enabled · {kitchen}" contains no code and says "booked time has not changed".
- **Parent fixes during the test:**
  - the mode line was printed twice in confirmations;
  - single-visit confirmations had a bare time line;
  - time zones showed the IANA id; they now use friendly names ("Newfoundland Time"), and visit ranges are compact.
  - Files: `booking-lifecycle-delivery.ts`, `email.ts`. Lifecycle, reminder, calendar and visit-code tests pass; tsc clean.
- **Polish backlog:**
  - the confirmation still has two robotic generic lines ("Check in for each visit when the action opens…", "Request checkout… Manager inspection remains pending");
  - the manager confirmation lacks the staffed "give the code in person" line;
  - the generic notice footer uses `getSupportEmail()` (locally support@localcook.shop) while confirmations hard-code support@localcooks.ca;
  - the chef visit-time note says "(America/St_Johns)";
  - for overnight operating windows, the itinerary header date (booking date) differs from the calendar and visit instant (operating day). This is pre-existing.
- **DEPLOYED to dev (owner approved, "All environments"):**
  - `VISIT_CODE_HMAC_SECRET` was added to Vercel: sensitive for production and preview, encrypted for development. It is a fresh value, different from the local `.env` one.
  - Commit `517df182` on `development` → preview deployment `dpl_G6c1KWraqFyDRnmGcWZBAj9Ucm1v`.
  - Excluded from the commit: `.workbuddy-ai/`, `graphify-out/`, `.verify-tour-instruction-update/`.
  - Migrations 0072–0076 were verified present on dev Supabase before the push.

## Checkpoint — closeout + access fixes re-tested locally (synthetic data)
- Passed: deadline guard (a manager cannot confirm after 24 h; the hold is released); closeout cutover (KB-129 before the cutover closes silently, KB-130 queues `service_ended`); role-specific closeout emails for chef and manager, tour-quality, UTF-8 verified at the byte level (the earlier "�" was an extraction artifact); expired-document banner and renew link; early renewal does not block booking; manager renewal approve updates the expiry; the revoke menu opens the "End access" dialog directly (lists KB-127, reason required); "before the kitchen confirms" refund copy.
- Not re-run: the access-ended banner on `/book/47` after a revoke. Revoke (403, no re-grant) was verified earlier. Re-running needs a SQL restore of `chef_location_access` for chef 380 / location 47.
- Left in place: `platform_settings.closeout_notifications_from = 2026-10-13T19:30:53Z` (test row; the owner declined the delete). Effect on deploy: bookings ending after that instant get closeout emails, nearly the same as the auto-anchor. An admin can change it in Lifecycle settings.
- New polish backlog: document dates show one day early (UTC parse of date-only values, old A1/C4 item); no success toast on renewal approve.
- Tests: combined tsc exit 0; booking-payment-decision 10/10; full server suite has about 49 pre-existing failures in untouched files; 1 known BookingCancellationChooser copy failure.
- Next: step 2, visit code + in-session screen (`map-visitcode-insession.md`).

## Step 2 started — visit code + in-session screen
- Map re-verified (DeepSeek) → `map-visitcode-insession-v2.md` (line drift fixed; overlap risks §2). Every open question in it was already decided above.
- Code design (parent): there is no plaintext at rest. Code = HMAC(key[version], target|revision|nonce) → 6 digits, derived on demand for the owning manager only. Each row stores the key version, revision, nonce, attempts, mode, consumption method, request key and revocation. Enrollment is new confirmations only: challenge rows are created at confirmation, and bookings without rows keep tap arrival. Lock order: booking → visit → challenge.
- Running in parallel (Sonnet), with no shared files:
  - **Server visit code:** migration 0075, `visit-code-challenge.ts`, arrival-writer gates, manager endpoints, redacted projections. Report goes to `.phase0-harness/visitcode-server-checkpoint.md`.
  - **In-session screen:** chef panel, `session_ending` reminder at 15 min, and a problem category. Migration **0076** (`commitment_problems.category`), so multi-day now starts at 0077. Report goes to `.phase0-harness/insession-checkpoint.md`.
- **In-session RETURNED** → `.phase0-harness/insession-checkpoint.md`.
  - Built: `InSessionPanel.tsx` in `KitchenCheckinTracker`; the `session_ending` reminder (end − 15 min, checked-in only, no backfill, skips visits ≤30 min); problem `category` (Safety flagged); fr-CA/uk strings.
  - Tests: 24 new tests pass; tsc clean.
  - Parent check: the client `canCheckout` now allows checkout during the end+15 grace. The server checkout has no end-time gate, and closeout flips the status at end+15, so client and server agree.
  - Gaps: the manager "In session · N min left" is not built (goes to the visit-code UI package); no equipment/storage summary (not in the status data).
  - **0076 must be applied before any deploy:** Drizzle selects all columns, so `commitment_problems` queries fail without it.
- **Visit-code server RETURNED** → `.phase0-harness/visitcode-server-checkpoint.md`.
  - Tests: tsc clean; 23 new tests (mocked database).
  - Parent review OK:
    - unbiased HMAC derivation and a timing-safe compare;
    - the failed-attempt count is committed in its own short transaction that locks only the challenge row, then the arrival transaction re-checks booking → visit → challenge (no lock cycle);
    - assisted arrival consumes the challenge with method `assisted`;
    - cancellation revokes via `cancelLinkedBookingDates`.
  - Degrades safely: if `VISIT_CODE_HMAC_SECRET` is missing, enrollment is skipped (logged) and tap arrival continues; if the table is missing, everything is treated as legacy.
  - **The deployed dev needs `VISIT_CODE_HMAC_SECRET` on Vercel (ASK the owner first)** plus migrations 0075 and 0076.
  - Known gaps: there is no reschedule path to revoke on; a second request key on an already checked-in visit gets the generic "already checked in" message.
- Client visit-code UI agent (Sonnet) launched: chef code field, manager `VisitCodePanel`, manager "In session · N min left". Report goes to `.phase0-harness/visitcode-client-checkpoint.md`.
- **Owner (Oct13 late):**
  - Codex is back; use it as before, plus DeepSeek where useful.
  - BIG tasks for cheaper models must be planned by a higher-grade model first.
  - The owner authorized Supabase dev migrations as needed; ask before a Vercel deploy and before adding the secret.
  - Reschedule must be researched to top-platform level, keeping in mind that capture happens at confirmation, so a reschedule is roughly a new booking.
  - The chef must be told about the code intuitively, perhaps in the preparation email; research how top platforms do it.
- A resumed, superseded Codex access-integrity task was cancelled; it had made no file changes.
- **APPLIED to dev Supabase:**
  - 0073 (closeout due indexes);
  - 0075 (visit-code challenges, RLS on, revoked from PUBLIC; also RLS for 0074's `chef_document_renewals`, which shipped without it);
  - 0076 (problem category).
- Launched on Codex Sol High (research + design, docs only):
  - `design-reschedule.md`
  - `design-arrival-communication.md`
- After both land: a client agent builds the visit-code UI (manager code panel; chef code field), then the parent reviews and does a live test. Migrations 0075/0076 are applied only after review.

## Oct14 owner decisions — policy money rules, documents, deploy rule, model routing

- **Kitchen cancels (policy R1, CONFIRMED, owner's fairness rule):**
  - Before confirmation, a decline releases the hold and nobody loses money.
  - After confirmation, the chef gets a 100% refund INCLUDING the Stripe fee, because the chef is not responsible for a kitchen cancellation. The kitchen bears the fee: it is withheld from the kitchen's settlement for that booking. Under deferred settlement the kitchen was never paid for it; otherwise the fee is debited from its next earnings or its Express balance via [Stripe account debits](https://docs.stripe.com/docs/connect/account-debits) (platform-liable accounts can be debited).
  - Local Cooks absorbs the fee only when recovery is impossible (no balance or future earnings), and records it as a loss.
  - Local Cooks support may waive the kitchen's fee with a reason.
- **Owner follow-up (Oct14):** "if the Stripe fee is too complicated, consider it gone after confirmation". Parent's response:
  - For CHEF cancellations this already IS the policy (fee non-refundable after confirmation, disclosed).
  - For KITCHEN cancellations, keeping the fee from the chef is non-standard: Airbnb, Peerspace (refunds including its own fees), Turo and Vrbo all fully refund on host cancellation. It is also chargeback-exposed (a merchant-cancelled service is a winnable dispute, so we would lose the full amount plus a ~$15 dispute fee).
  - Recommended simplification: in the pilot the chef gets 100%, the kitchen gets $0 for that booking, Local Cooks absorbs the rare fee, and kitchen cancellations are tracked. Fee recovery from the kitchen's next settlement can be switched on later, once deferred settlement exists. AWAITING owner confirmation of this pilot version.
- **No-show (R3, CONFIRMED):** the chef is responsible. It is treated as a cancellation at start time (the policy's in-window outcome); no extra penalty; disputed attendance goes to Local Cooks review; a missing tap alone is not a no-show.
- **Delegated to parent ("make those choices"), adopted as recommended:**
  - R2: a kitchen unusable on arrival (locked out, unsafe, no access) is treated like a kitchen cancellation once evidenced: full refund including the fee, kitchen-funded under the R1 rule; partial use is reviewed by Local Cooks.
  - R4: exceptional circumstances get a Local Cooks-funded full refund during the pilot.
  - R5: the manager response deadline is the earlier of 24 h or a buffer before start.
  - Operating clocks proposed in `local-cooks-booking-policy.md` §C, adopted as admin-configurable defaults: service ends at scheduled end + 15 min grace, and inspection auto-closes 24 h after the later of scheduled end or departure.
- **Chef documents:** when a chef's required document is expiring or has expired, notify them intuitively (reminders before expiry, and on expiry, with a link to upload), then BLOCK NEW bookings at that location on expiry; existing bookings are untouched (customers design §H Q5 = yes).
- **Account deletion:** handled manually for now; no change (customers design §H Q6 deferred).
- **Commit/deploy rule:** dev environment, but ASK the owner first, and deploy only when a test genuinely cannot or should not run locally (for example real Inngest event wakeups, Stripe webhooks, real SMTP delivery, Vercel runtime behaviour).
- **Model routing (updated):**
  - Main thread on Opus.
  - DeepSeek (Code Buddy) is unlimited: use it freely for heavy reading and mapping.
  - Sonnet and Haiku for most delegated Claude work.
  - Fable only for a truly critical feature or a thorough at-par check that nothing else can do.
  - Codex GPT-6.1 Sol Medium/High for implementation.
  - Do NOT cancel a rate-limited task; let it resume.
- **Active builds (Oct14, Codex Sol High, local only, parallel, non-overlapping files):**
  - `phase0-access-integrity-docexpiry-sol-r1-20261014` (CU0 + document expiry). Revocation must stick (remove self-healing re-grants), no booking before final manager approval (single shared eligibility check), an atomic revoke with a reason and a truthful notice (paid future bookings kept by default), and chef document expiry reminders at 30/7/0 days with new bookings blocked on expiry. Report: `.phase0-harness/access-integrity-checkpoint.md`.
  - `phase0-clock-closeout-sol-r1-20261014`. A pure closeout reducer driven by saved instants and the location zone; service ends at the last visit end + 15 min (configurable); inspection auto-closes 24 h after the later of scheduled end and departure, as "no inspection recorded"; bookings complete without taps (attendance unknown); one bounded worker sweep task; no GET mutation. Any migration is written as 0073 but NOT applied (needs approval). Report: `.phase0-harness/clock-closeout-checkpoint.md`.
- **Owner decisions (Oct14, later):**
  - Kitchen cancel pilot CONFIRMED: the chef gets 100% and Local Cooks absorbs the rare Stripe fee; kitchen cancellations are tracked.
  - Weekly standing bookings OUT for now.
  - Multi-day consecutive ranges WANTED: refuse a range if any day conflicts (hourly booking, hold, blackout); the manager sets max (and min) consecutive days, like max hours.
  - Invites: the standard discount on the listed kitchen price, then the customer books normally.
  - Extension: whatever keeps booking frictionless when easy (to be recommended).
  - Storage must be redesigned decoupled from kitchen sessions (owner research: monthly subscriptions per unit, daily holdover, a "Manage my storage" module) — to be verified, not assumed.
- **Stripe sandbox verified read-only (Oct14):**
  - Platform `acct_1SmNI9CvcNYAkDXN` balance: CA$318.96 available, CA$18.20 pending.
  - Express `acct_1UPWdbCf9PlKmwqd`: controller.losses.payments = application, fees.payer = application_express, transfers active, debit_negative_balances true, payouts daily with a 7-day delay.
  - Separate charges and transfers means refunds come from the platform balance, so a full refund on kitchen cancel needs nothing special, and a deferred transfer fits.
  - The LIVE platform/Connect configuration is NOT verified; do a read-only check before enabling payout-after-closeout.
- **Model routing (Oct14):** Codex is near its cap, so new work goes to Code Buddy (DeepSeek, unlimited) and Claude (Sonnet/Haiku; Opus main; Fable only if critical). The two Sol builds already running continue. The Sol multi-day design task was cancelled immediately.
- **Closeout fixes RETURNED (Sonnet, Oct14)** → `.phase0-harness/closeout-fixes-checkpoint.md`.
  - `closeout_notifications_from` cutover (auto-set on the first sweep if unset; admin routes + a LifecycleSettings field): pre-cutover bookings close silently, and already-queued flood rows are dropped at send.
  - New `server/services/closeout-notice-email.ts` with role-specific, tour-quality emails; inspection-auto-closed is manager-only.
  - outcome-delivery fixture fixed; status badge localized.
  - Tests: 167/167 server/shared, 16/16 client; full-suite 49 failures, all in untouched files (was 53). tsc errors only in the access agent's in-flight `status.ts`.
  - LIVE re-test pending (with the access fixes). NOTE: the cutover auto-sets on first use and `platform_settings` is the SHARED dev table, so set it explicitly during local testing rather than letting a local run choose it.
- **Visit-code build map COMPLETE (DeepSeek)** → `map-visitcode-insession.md`. Parent verified: single/contiguous bookings have no visit rows (`kitchen-booking-visits.ts:30`); there is no HMAC helper in server/shared.
  - **Parent decisions on the map's open questions (Oct14):**
    - Migration numbers: 0073 closeout indexes, 0074 renewal slot, **0075 visit codes**, multi-day 0076+.
    - "Report a problem" reuses commitment-problems with new categories (safety, access, equipment, cleanliness); no new incident table yet.
    - Manager-assisted arrival needs no code (a recorded manager assertion with a reason).
    - "Need more time?" (interim) opens the existing booking conversation (`POST /api/bookings/:id/conversation`) with a prefilled message.
    - A NEW `session_ending` reminder kind at 15 min (the existing 30-min departure reminder is unchanged).
    - Manager "In session · N min left" on the booking detail and inspection pages now; the Today board comes with Customers CU1.
    - HMAC with versioned keys (`VISIT_CODE_HMAC_SECRET`, key version stored per row) for future rotation.
    - Codes redacted everywhere after issuance; after consumption show only method and time.
    - One code per day.
  - START the visit-code + in-session build only AFTER the two fix agents land (overlap: BookingDetailsPage/status badge, advance-reminders), and re-verify the map's insertion points first.
- **COMBINED REVIEW + LIVE TEST of closeout + access (Oct14, local harness, parent).**
  - Combined tree: tsc 0.
  - Parent wired the cross-file requests: `chefDocumentExpiry` sweep in the background tasks and `access` (dispatchAccessNotices) in the delivery list of `recurring-worker.ts`. Worker tests were updated with mocks and expected names (15/15 pass with email-booking-calendar).
  - The stale "Arrival tracking is off" assertion was flipped.
  - Access agent result: Codex partial + Sonnet completion, 57/57 server, 96/96 client in its files. It noted the old 293/7 baseline is stale (a pristine HEAD fails 49 of the same tests).
  - **LIVE PASS:**
    - Fixture 128 (no taps, ended 2 h ago): the chef page derives "Visit finished · Arrival not recorded · Inspection due by Oct 14 3:45 p.m." and the GET wrote NOTHING (DB still confirmed, no clock state).
    - Single-booking persist (`.phase0-harness/sweep-closeout-one.mjs 128`; NEVER run the global sweep locally on the shared DB): status completed, attendance unknown, serviceEnded = end + 15 min, inspection deadline = end + 24 h, `service_ended` queued.
    - Simulated time past the deadline: `auto_closed_uninspected`, nextDueAt null, `inspection_auto_closed` queued.
    - Expired chef doc (synthetic app 67, restored): checkout 403.
    - Manager revoke via the new dialog (lists the upcoming KB-127, reason required): access row deleted, application stays approved, "Your access to … has ended" sent; a chef checkout afterwards gets 403 and NO re-grant. Access restored afterwards (row 31).
  - **LIVE FAILURES → fix agents (Sonnet High, parallel, separate ownership):**
    1. Silent 403s: no banner, no error, after five steps.
    2. Closeout rollout would email every old booking.
    3. Closeout emails are bare generic text, the same for both roles, and the chef gets "inspection closed".
    4. Early renewal blocks booking (needs a renewal slot; migration 0074 drafted only).
    5. The "Revoke Access" menu opens details instead of the dialog; the dialog shows raw "America/St_Johns".
    6. Owner note: "100% refund before confirmation" is vague; use kitchen-confirmation wording.
    7. Raw lowercase "completed" badge.
    8. Stale outcome-delivery fixture.
    - Tasks: `phase0-closeout-fixes-sonnet-r1-20261014` (items 2, 3, 7, 8) → `.phase0-harness/closeout-fixes-checkpoint.md`; `phase0-access-ux-fixes-sonnet-r1-20261014` (items 1, 4, 5, 6 + a tier-2 test) → `.phase0-harness/access-ux-fixes-checkpoint.md`.
  - Not tested live: tier 2 (unit tests only); real worker/Inngest delivery (local worker endpoint 503s on the pooler URL).
- **Clock closeout build RETURNED (Sonnet, Oct14)** → `.phase0-harness/clock-closeout-checkpoint.md`.
  - Results: tsc 0; i18n lint pass; 28 server/shared test files, 471 pass; 23 client files, 213 pass / 1 known BookingCancellationChooser copy failure; manager-confirmed-receipt has the same 7 baseline failures.
  - Visits are keyed by kitchen_booking_visits id, else `date|start-end|blockIndex` (steer applied, with tests).
  - Repaired Codex's literal-"?" fr-CA/uk clock strings; replaced "auto-clears if no issues" copy with "no inspection recorded".
  - Migration 0073 still NOT applied (approval pending).
  - Cross-file requests for the access agent: `endLocationAccessTitle` fr-CA/uk has "?" encoding damage.
  - **REVIEW ITEM:** GETs no longer lazily expire stale authorizations (correct, no writes on read), so expiry now depends on the `authorizations` worker task. VERIFY that the manager decision command itself refuses capture after the 24 h response deadline, so a worker delay can't allow a late confirm.
  - Not live-tested yet; awaiting the access build for a combined review and live test.
  - **REVIEW ITEM RESOLVED by the parent:** confirmed the gap (`decideAuthorizedBooking` had no deadline check; no request path called the kitchen lazy expiry any more). Fixed in `server/services/booking-payment-decision.ts`: a new decision to CONFIRM a pending/authorized request older than `AUTH_EXPIRY_HOURS` releases the hold immediately (via `lazyExpireKitchenBookingAuth`, a command not a read) and throws `BookingRequestExpired` (a subclass of BookingTermsReviewRequired, so the manager route's existing 409 handler returns a clear message). Recovery of an already-recorded decision is unaffected. Tests: 2 added to `booking-payment-decision.test.ts`; 10/10 pass. The R5 rule (deadline capped before start) is still to come with the policy engine/reminders.
- **Handover draft parked** at `HANDOVER-2026-10-14.md`. The owner will ask for an updated version when ready; continue as planned until then.
- Active (read-only, free): `phase0-visitcode-map-deepseek-r1-20261014` → `map-visitcode-insession.md`. It prepares the visit-code + in-session build (target resolution, atomic insertion points, surfaces, migration draft, 2–3 non-overlapping work packages). Re-verify against source after the closeout/access builds land.
- **ROADMAP (authoritative order, Oct14; the parent owns sequencing):**
  1. Clock closeout + access integrity (Sonnet, running).
  2. **Visit code checkpoint**: staffed code and deliberately enabled self check-in, per `visit-code-checkpoint-proposal.md` (owner-selected; new confirmations only).
  3. Timed reminders.
  4. Private two-sided reviews.
  5. Payout after closeout (live Stripe config check first).
  6. Cancellation policy engine (presets, versioning, automatic refunds).
  - Parallel design tracks: multi-day ranges + invites + extension (Sonnet); storage decoupling (DeepSeek); manager Customers area (`design-manager-customers.md`).
  - Visit code needs owner approvals: (a) an additive dev table for per-visit challenges (keyed hash, mode, revision, attempts, replay id); (b) a new server secret env var (local first; ask before setting it on Vercel); (c) a 6-digit code, 5 wrong attempts, then the manager rotates it.
  - The owner noted it had dropped out of recent status updates; the parent must keep it visible.
- **DECISIONS LOCKED (Oct14; the owner delegated to the parent "as a top developer at a startup: simple where it costs users nothing"):**
  - **Multi-day:**
    - Per-day cancellation cutoffs (owner liked).
    - Manager-controlled, location default + kitchen override; **default ON for kitchens with a daily rate, min 1 / max 7 consecutive days** (max 1 = off).
    - Tasks every day, kept low-friction: from day 2, instructions collapse to "Same as yesterday · View" and required tasks are one tap.
    - One visit code per day, plus manager "self check-in for all days" in one action.
  - **Invites:**
    - Kitchen price floor $1; default expiry 48 h (manager can choose 24 h–7 days); only the location manager sends.
    - **Local Cooks support controls:** view all, withdraw, extend expiry, create on behalf (reason + audit + both notified).
    - Standing rule restated: every feature ships with support actions for every state, so no DB fixes are ever needed.
  - **Storage (parent's recommendations adopted):**
    - Platform-as-merchant monthly charge in advance on the saved card; transfer after the month closes (at charge until payout-after-closeout exists).
    - Monthly price per unit + a daily holdover rate.
    - The manager approves the first rental only; auto-renew.
    - Cancel anytime, effective at the end of the paid month; 5-day payment grace.
    - Abandoned goods handled manually by support; legacy rows keep their contract.
    - DB migrations only once the build plan is final (owner).
  - **Owner APPROVED (Oct14):**
    - The extension design below.
    - Visit-code approvals: (a) the additive dev table for per-visit codes (keyed hash, mode, revision, attempts, replay id); (b) a new server secret env var, local first, asking before setting it on Vercel; (c) a 6-digit code, 5 wrong attempts, then the manager rotates it.
    - The owner was NOT previously shown the storage questions properly; storage decisions above are provisional until the owner answers them.
  - **In-session screen (owner idea, researched and ADOPTED Oct14)**, built INTO the visit-code checkpoint (same chef visit page).
    - Evidence: Turo in-trip "Manage trip" (extend in progress, end early, app messaging); Getaround "Need more time? extend instantly"; ParkMobile live countdown + extend + 15-min expiry alert; Airbnb reservation-as-hub during the stay.
    - Spec, mobile-first, opens after check-in:
      - kitchen + "In session · ends {time} {zone}" + a client-side countdown/progress bar (no polling; refresh on focus);
      - a time-aware primary button: "Need more time?" (extension request; until extensions ship it opens a message to the kitchen) → in the last 15 min "Start check-out" (departure instructions/tasks) → after the end, "Your booked time ended" with check-out still open;
      - always available: leave early / check out now (states no refund for unused booked time), message kitchen, report a problem (safety first, then access/equipment/cleanliness), get help from Local Cooks, departure instructions/tasks preview, booked equipment/storage;
      - an alert 15 min before the end, in-app + email (no SMS; native push later);
      - the manager Today board mirrors "In session · N min left".
  - **STORAGE — owner answers (Oct14, via AskUserQuestion), FINAL:**
    - Billing: monthly in advance; the kitchen is paid after the month closes (at charge until payout-after-closeout exists).
    - Pricing: monthly price per unit + a daily holdover rate.
    - Approval: first rental only, auto-renew.
    - Ending: cancel ANYTIME (owner). Parent's design for this: anniversary billing (the rental starts any day and renews on that date; no partial first month); cancel stops the renewal; move out early anytime via the move-out inspection; no partial refund of the paid month (industry norm; the owner may override); 5-day payment grace, then new access is paused and holdover starts; never auto-dispose.
    - Legacy storage rows keep their contract; abandoned goods are handled manually by support.
    - DB changes only once the build plan is final.
  - **Extension — owner's intent confirmed:** a manager-sent custom "extend your booking" offer, either chef-initiated ("Need more time?" → manager sees availability → offer) or manager-initiated ("Offer more time"). One-tap accept + pay; implemented as a linked booking but SHOWN as one longer visit; departure and closeout follow the new end.
  - The same mechanism covers **early arrival / late departure** offers for adjacent free time. Never offers occupied time; never mutates the original payment; support can withdraw or extend any offer.
  - **Extension (APPROVED):** "Need more time?" (chef, in session) → manager sees the request plus next-slot availability → one-tap approve sends an extension offer (a pre-approved linked booking for the adjacent slots, same rate, reusing invites) → the chef pays in one tap → the visit's departure/closeout extend. No mutation of the original booking's money. Build right after invites.
- **Storage decoupling design COMPLETE (DeepSeek)** → `design-storage-decoupling.md`. Parent spot-checked: the schema comment says storage is kitchen-only (`shared/schema.ts:1392`) while `kitchenBookingId` is nullable; the overstay engine accepts only frozen daily terms (`overstay-penalty-service.ts:206`); approval runs through the kitchen decision (`booking-payment-decision.ts:185-187`).
  - Research: monthly per-unit pricing CONFIRMED; members-only CONFIRMED; daily holdover PARTLY (as an overstay charge); two-module dashboard not documented but adopted.
  - Design: storage as its own monthly per-unit product; the manager approves the first rental only; auto-renew on the saved card; move-in/out reuses arrival/departure; daily holdover after grace; never auto-dispose; "Manage my storage" plus a manager occupancy view; legacy rows keep their contract.
  - **Parent correction:** the doc's Option B uses `on_behalf_of` (kitchen as merchant of record). Recommend instead platform-as-merchant monthly charges plus a transfer after period close, consistent with kitchen bookings.
  - Owner questions pending: billing path, pricing + holdover rate, first-rental approval, cancel-anytime-ends-at-period-end + 5-day payment grace (the parent simplified the doc's 15-day notice), manual abandoned-goods handling, legacy contracts kept.
- **Multi-day/invites/extension design COMPLETE (Sonnet)** → `design-multiday-invites-extension.md`.
  - Multi-day: one booking with N daily visits, each a full operating day at the daily rate.
  - All or nothing: one hold group, one decision, one capture.
  - Per-day check-in/out (and a per-day visit code).
  - Per-day cancellation allocation.
  - Max/min consecutive days, default off (location default + kitchen override).
  - Invitations: a discount on the kitchen price only; the invitation is the manager's pre-approval; normal checkout; nothing reserved by sending.
  - Defer the paid "add an hour"; ship only a no-money "Need more time? Ask the manager" entry.
  - Order: invites → multi-day → extension. Migrations 0074/0075 are drafted in the doc only.
  - Code risks verified by the parent: closeout/attendance match visits by start/end time (`clock-closeout.ts:29,62`, `shared/clock-closeout.ts:68`, `shared/booking-attendance.ts:27`). The parent STEERED the in-flight closeout agent to key visits by visit id or date+time+block. Still pending: `resolveCapturedKitchenRate` (`shared/kitchen-booking-rate.ts:83-86`) shows one day's price for a multi-day booking — fix in the multi-day checkpoint.
  - Six owner questions in its §F.
- **Moved to Claude (owner, Oct14).** Both Codex tasks were cancelled to prevent an auto-resume collision. Codex had already edited about 60 files (16:51–17:02 NDT), including a baseline snapshot at `.phase0-harness/access-integrity-before/` and `migrations/0073_clock_closeout_due_indexes.sql` (two additive indexes, NOT applied, code works without them).
  - Resumed on Claude Sonnet High with explicit file ownership and shared-file rules (manager.ts, bookings.ts and the i18n JSONs get targeted edits only):
    - `phase0-access-integrity-sonnet-resume-r2-20261014` → `.phase0-harness/access-integrity-checkpoint.md`
    - `phase0-clock-closeout-sonnet-resume-r2-20261014` → `.phase0-harness/clock-closeout-checkpoint.md`
  - The owner will say when Codex is available again.
- (historical) **Both Codex builds hit the usage limit (Oct14)** — `phase0-access-integrity-docexpiry-sol-r1-20261014` and `phase0-clock-closeout-sol-r1-20261014` are terminal "failed" with partial source on disk; Codex resets at 7:22 PM. Do NOT cancel them; they should auto-resume after the reset. If they don't, relaunch each with its original brief plus "continue from partial edits on disk", either on Codex or on Claude Sonnet. Do not edit their files meanwhile. Awaiting the owner's choice: wait or move them to Claude.
- Active design (read-only):
  - `phase0-multiday-invites-design-sonnet-r1-20261014` (Claude Sonnet High) → `design-multiday-invites-extension.md`.
  - `phase0-storage-decoupling-deepseek-r1-20261014` (Code Buddy DeepSeek) → `design-storage-decoupling.md`.
- Research complete: `local-cooks-booking-policy.md` (citations corrected by Fable after the stop) and `research-booking-model-gaps.md`. The gap research's ranked recommendation is to finish the current checkpoints, then add P0 duration/notice rules, turnover buffers, blackouts and a support exit, then before-confirmation invites, then bounded weekly bookings, then a paid "one more hour". Six owner questions are in its §E.

## Oct13 owner decisions — arrival/departure scope (supersede older wording)

- **Per-kitchen tracking switch removed.** Every kitchen always has arrival & departure. Only the customer task list (checklist items and photos) is optional.
- **One scope pattern everywhere:** location default + optional kitchen override, for arrival/departure instructions, customer tasks, the booking/cancellation policy (already location→kitchen) and terms (add an optional kitchen-specific version). Show the end user "Using {location} default · Customize for this kitchen", with a preview.
- **No per-booking lock on instructions.** Managers edit freely. When a kitchen's effective arrival/departure instructions or tasks change, chefs with upcoming confirmed bookings at that kitchen get an "instructions updated" email (tour pattern). Booking-level evidence still records what was shown at arrival/departure.
- **No commit, push or deploy without asking the owner first.** Finish check-in/check-out locally before testing on the deployed server.
- **Model routing:** Code Buddy DeepSeek v4.1 Flash (free) for token-heavy reading/mapping; Codex GPT-6.1 Sol Medium/High for implementation; Claude Haiku Medium/High for routine work; Claude Opus High only for very important tasks or heavy UI/UX changes.
- DeepSeek map completed → `map-arrival-scope-and-updates.md`. Parent verified its key claims against source (location-only unique key, `resolveKitchenTracking` flag gate, check-in refusal on `arrival.enabled`, visit page preferring the snapshot).
- Active (no migration needed): `phase0-remove-tracking-switch-sol-r1-20261013` (Codex GPT-6.1 Sol High) for map PRs 1–3 and 7: resolver, workflow-vs-tasks split, switch removal (column kept, not dropped), and the chef visit page showing current instructions/tasks with current-task validation. Local only.
- **Owner answers (Oct13):**
  - Money rules live only in structured tiers in Booking rules, with limited preset options like top platforms, displayed clearly to customers.
  - Manager discretion inside the window is upward only, never below the tier.
  - Terms are accepted when applying to the kitchen, not at checkout (no checkout checkbox).
  - Policy/terms must not affect people with active or upcoming bookings, and are not handled with the tour-style update email. The parent recommended versioning (edits apply only to new bookings) over blocking edits; awaiting confirmation.
  - Migration approved.
  - Update email also fires on task changes.
  - In-progress (checked-in) bookings get the email when departure notes change.
  - Managers get no copy.
- **Migration `0072_kitchen_arrival_overrides_and_terms` APPLIED to dev Supabase (Oct13)**, file in `migrations/`. It adds a new table `kitchen_checkin_checkout_overrides` (unique kitchen_id; NULL field = inherit the location default) and nullable `kitchens.kitchen_terms_url` / `kitchen_terms_uploaded_at`. It deliberately does NOT alter `checkin_checkout_checklists` (deployed dev upserts on its unique location_id at `manager.ts:3032`). Verified: table present with 0 rows, 2 columns present.
- **Owner confirmed (Oct13, later):**
  - Versioning (edits apply to new bookings only).
  - Presets Flexible/Moderate/Strict, no custom.
  - The inside-window notice is shown before payment.
  - Before the window, cancellation is automatic: refund minus the Stripe fee, no manager action, and the manager cannot cut it.
  - "Automatic refund" means the system issues the policy amount on cancel; it is not a manager setting.
  - Every situation must be handled end to end, with support controls, and nothing may get stuck.
- Active: `phase0-company-booking-policy-sol-r1-20261013` (Codex Sol High, read-only) → `local-cooks-booking-policy.md` (public policy, manager responsibilities, full situation matrix, disclosure map, no-stuck checklist). Its open recommendations: kitchen-cancel fee charged to the manager; unusable kitchen; no-show = cancellation at start; exceptional circumstances; response deadline capped before start.
- **Checkpoint PASSED — arrival-scope r1 (Oct13, local live).** Sol r1 completed: 54 files changed; server 253 pass / 7 fail (the same 7 pre-existing receipt failures; baseline 237/7); client 119/119; tsc, i18n and whitespace checks clean. Report: `.phase0-harness/arrival-scope-implementation-checkpoint.md`. Harness restarted on the new code.
  - Live, with kitchen 54's old flags temporarily OFF (kitchen flag plus location checkin/checkout_enabled), on new $0 fixture **126** (seeded by `.phase0-harness/arrival-scope-fixture.cjs`, no Stripe object):
    - Arrival page open; instructions shown; photos marked Optional.
    - Check-in with no photo succeeded; toast shown; the page refreshed to "Checked In 10:37".
    - The departure note was edited live: the departure page showed the current text plus "Updated by the kitchen since you booked".
    - A required task was added after booking: it showed as Required, Submit stayed disabled until ticked, and checkout then succeeded.
    - DB: the submitted checklist recorded the current task; the snapshot kept the booking-time departure note and empty task list as history.
    - Manager kitchen page: no switch and no tracking copy; the Arrival & departure tab is clear, with a live preview.
  - All test edits restored and verified (notes, empty tasks, both location flags and the kitchen flag back to true).
  - New polish items:
    - Raw "(America/St_Johns)" in visit times; it should read "Newfoundland time".
    - "Message from chef to kitchen manager" and "When chefs may check in" use "chef" as a noun.
    - Instruction headings read "Required arrival instructions".
    - Vague "Check-in or checkout has been recorded".
    - A disabled Submit doesn't say why ("Complete 1 required task").
    - Checklist checkbox has no accessible label.
    - "No-show grace period" copy implies automatic no-show marking, which is off.
    - Cancel is still offered while checked in.
  - Fixture 126 is retained (checkout_requested).
- **Checkpoint PASSED — kitchen overrides + instructions-updated email, Sol r3 (Oct13, local live).** Report: `.phase0-harness/kitchen-overrides-email-checkpoint.md`. r2's kitchen-terms edits reverted (8 terms files byte-identical to baseline; only the LOCATION `kitchenTermsUrl` remains in the schema). Server 293 pass / same 7 baseline failures; client 134/0; tsc, i18n, whitespace clean. One unrelated pre-existing failure noted: `BookingCancellationChooser.test.tsx` "hold will be released" copy assertion.
  - Live on the restarted harness (CAPTURE_MAIL=1, sink on :2525; worker off; no Stripe listener), kitchen 54 / location 47, new $0 fixture **127** (upcoming, 3 h ahead):
    - Manager tab shows per section "Using {location} default · Customize for this kitchen"; the location defaults have their own entry; the preview is per kitchen.
    - Customizing departure and saving (via the page-header Save) wrote ONLY the override row (`kitchen_checkin_checkout_overrides` k=54: departure set, arrival NULL = inherit); the location row was untouched.
    - The chef's visit page for 127 showed the kitchen-specific departure note and "Newfoundland Time" (friendly zone label, polish item done).
    - An `instructions_updated` outbox row was queued for 127 only (chef-only, sections=[departureInstructions], revision 1). Delivered through the real delivery path to the sink (`.phase0-harness/deliver-one.mjs 127`): mail 0007, subject "Booking instructions updated at PHASE0 Main Kitchen", name greeting, kitchen/location, visit time with zone label, reference KB-127, booking link, current departure text, no "Chef"-as-noun, no "admin"; viewport meta + lang attr present; text/plain part present.
    - Coalescing verified: after row 48 was delivered, the next three saves (EDIT-A, EDIT-B, then the reset) all merged into ONE pending row (49), now at revision 3 — one pending email per booking, updated in place, as designed.
    - "Use {location} default" reset deleted the override row; the section returned to "Using … default".
  - Harness limitation found (not a product bug): the local worker endpoint returns 503 because the harness DATABASE_URL is the transaction pooler (:6543) and `assertWorkerSessionConnection` requires a session connection; delivery was exercised via the direct function instead. Email greeting still uses the account display name ("TestSprite chef") because that is the synthetic user's name.
  - State left: fixture 127 retained (confirmed, not started); override row for kitchen 54 deleted; location 47 row at baseline; outbox row 49 pending (will deliver only through the real worker/Inngest on dev).
  - **STOPPED here at the owner's request (model change).** Nothing committed, pushed, deployed or migrated beyond 0072 (already recorded).
- Opus Customers design `phase0-manager-customers-design-opus-r1-20261013`: task status "failed" (rate limit on its final message) but the document is COMPLETE at `design-manager-customers.md` (536 lines, sections 0–H + sources). Parent cancelled the task to avoid an auto-resume spending credits; owner noted the limit had refreshed and it should not have been stopped — nothing was lost. Lesson recorded: do not cancel a rate-limited task; let it resume. Key findings for the owner: (1) revoking access doesn't stick (self-healing re-grant in `chef.service.ts:186-200`, `booking.service.ts:112-144`); (2) booking may be possible at application tier 2 before the manager's final review; (3) revoke is two non-atomic requests with no handling of paid future bookings; (4) heavy manager polling on Hobby; (5) customer document expiry is never re-checked after approval; (6) account deletion purges booking/payment history. Six owner questions in §H.
- Still running (read-only): `phase0-company-booking-policy-sol-r1-20261013` and `phase0-booking-model-gaps-sol-r1-20261013`.
- Historical (superseded) note:
  - `phase0-kitchen-overrides-email-sol-r2-20261013` (Sol High, local): kitchen overrides, kitchen terms PDF, the `instructions_updated` email and the r1 polish items. Report goes to `.phase0-harness/kitchen-overrides-email-checkpoint.md`.
  - `phase0-booking-model-gaps-sol-r1-20261013` (Sol High, read-only) → `research-booking-model-gaps.md`. Owner concern: the booking time model (hourly fixed slots, single-day daily), invites with custom price, check-in/out (early arrival / late departure) requests, in-session extension, and anything else needed to feel end to end at par. Ranked P0/P1/P2 with a short owner-question list.
  - `phase0-company-booking-policy-sol-r1-20261013` is still running.
  - `phase0-manager-customers-design-opus-r1-20261013` (Opus High, read-only) → `design-manager-customers.md`: the manager Customers list/detail, the Today board, privacy, edge cases, phased plan and wireframes.
- **Owner decision (Oct13):**
  - Access stays approved per LOCATION (verified: `chef_location_access`, `shared/schema.ts:790-798`; the per-kitchen table is legacy and unused). This matches The Food Corridor's facility onboarding.
  - **Terms are location-level only (option 1).** Kitchen differences go in per-kitchen rules and instructions.
  - Sol r2 was CANCELLED mid-run (owner: stop spending on the unwanted scope) and replaced by `phase0-kitchen-overrides-email-sol-r3-20261013` (Sol High). r3 first reverts r2's partial kitchen-terms edits, keeping location terms exactly as before, then builds overrides, the update email and the polish items. The `kitchens.kitchen_terms_url` / `kitchen_terms_uploaded_at` columns from 0072 stay unused; dropping them later needs owner approval.
- **Owner confirms a manager Customers area is needed:** manage each customer individually, with their status and upcoming activity. Restricting a customer to specific kitchens is to be decided in that design.
- Next (after the r1 terminal result): Sol High r2 to wire the overrides into the resolver, write route and setup UI ("Using {location} default · Customize for this kitchen"), kitchen terms override, and the `instructions_updated` booking email (chef-only, one coalesced pending row per booking, delivery-time revalidation, upcoming confirmed bookings plus checked-in visits for departure changes, triggered by instruction AND task changes). Opus High to review the setup UX.

## Oct13 final checkpoint / stop

Opus r6 completed the manager instruction-tab/task-page split: 94 focused tests, i18n lint, scoped whitespace check, and final whole-project typecheck exit 0. Report: `.phase0-harness/arrival-tab-instructions-checkpoint.md`. Instructions render directly in Arrival & departure; Customer tasks is a separate full page with selected kitchen/location and matching breadcrumb. Each surface submits only its own fields. The tab's imperative save bypasses an invisible status-button cooldown, allowing immediate save/retry through the leave guard.

Parent's authenticated local walkthrough used manager379, kitchen54/location47 only. Edited arrival note; opening Customer tasks showed the unsaved-change guard. Keep editing retained the draft with zero PUTs. Reopening and choosing Save Changes made exactly one PUT containing only `checkinInstructions`, persisted the note, preserved all four task/photo arrays, and opened Customer tasks with kit54/location47. Back to kitchen returned to the same Arrival & departure tab. A second UI save restored the original note. GET corroborated exact baseline restoration of both notes, all arrays, both enable flags and timeWindowSettings. No task, activation, timing, booking or financial mutation was made. At live 390px width, document width was390, fields stacked at x33/w324, selected tab right341.91 within scroller right374 and clear of32px fade/chevron. Snapshot was duplicated by the preview renderer; this is responsive behavior evidence, not comprehensive aesthetic approval.

Orchestration correction: failed Codex r5 automatically resumed when its limit reset, briefly overlapping Opus r6. Parent discovered pending work while answering the owner, cancelled r5 including its resumed turn, and read its interrupted result. Opus retained matching current-source mobile alignment changes and completed final verification. Both tasks are terminal; no active implementation agent remains. Earlier claim that Codex had not resumed was incorrect.

Remaining limitation: Customer tasks Save and leave within2.5s of a failed pinned save can require a second click; draft is retained. One task-mode test flaked once under load, then passed repeated runs. Native browser Back/unload prompts were not exercised live. Broader pending work remains visit-code persistence/new-confirmation enrollment, shared scheduled-end/history/report eligibility timezone contracts, automatic no-tap closeout/exception proof, private feedback, durable timed reminders, cancellation/remedies and deferred settlement. This checkpoint does not complete the full booking redesign.

Owner-requested stop point reached. No new feature/delegate, commit/push/deploy, schema migration or production action. Resume from this section and the handoff when owner returns.

## Oct13 harness restart / final checkpoint recovery

T3 restart cancelled the old local launcher. Owner asked to continue and noted Claude is available again. The Sol instruction-tab resume r5 was terminal FAILED (usage limit), with partial source and no `arrival-tab-instructions-checkpoint.md`. Started one completion round, not a new feature: `phase0-arrival-tab-final-opus-resume-r6-20261013` (Opus5.5 High), full task ID `node:delegated-task:command%3Amcp%3A9c88b28d-e1ac-4960-bc30-406261a78708%3Adelegate-task%3Aphase0-arrival-tab-final-opus-resume-r6-20261013`. It owns only interrupted manager UI/nav/locales and final focused tests/typecheck; parent owns live review. Read its terminal report before editing those files.

Guarded launcher restarted successfully with dev Supabase/Stripe-sandbox guards, outbound suppression, local worker disabled, no Stripe listener and credential blanking intact. Local authenticated manager379 GET fixture125/details returned200: completed/checked_out, saved arrival `22:49:01.169Z`, checkout request `23:54:01.169Z`, approval `23:55:31.144Z`, saved shared manager message and deadline `2026-10-13T00:54:01.169Z`, America/St_Johns. Page corroborated that closed inspection record. No new clear/assistance/claim action, DB fixture or financial operation was created for this reread. Backend196-case evidence is reused because source is unchanged; no additive unique test count claim.

Owner's requested finish point remains: close existing instruction-tab checkpoint, focused local walkthrough/current-state report, then stop. Codes, shared historical/closeout clocks, feedback, timed-reminder scheduling and settlement are not newly started. No commit/push/deploy/migration. Final revised UI live checks await r6 completion.

**Owner checkpoint/stop request:** after the current instruction-tab and ordinary timezone tasks finish, run one focused local walkthrough using existing evidence where sufficient, report achievements and remaining work, then stop until owner resumes. Do not start visit-code implementation or another feature after those handbacks.

Ordinary timezone handback `phase0-single-visit-timezone-sol-r2-20261013` completed: owned location zone now controls single/contiguous arrival bounds, departure-only opening and actual HH:mm fields; UTC instants, saved windows and lifecycle policies preserved.196 mocked tests across9 files passed, including81 single-service cases and the prior84-case group (not additive unique counts), whitespace pass. Whole-project typecheck/live API remain with parent after UI terminal. Shared attendance scheduled-end, report-after-end, historical-review and manager Today filtering still use default-zone contracts; exact caller map in ignored `single-visit-timezone-checkpoint.md`. Those are deferred clock/closeout follow-ups, not repaired or a reason to expand work beyond the owner's requested stop point. Instruction-tab resume remains the current pending task.

## Timezone prerequisite handback and interrupted UI recovery

Sol split/assistance backend pass `phase0-visit-timezone-prerequisite-sol-r1-20261013` completed:84 mocked tests across5 files, whitespace pass. Split arrival bounds, departure-only opening and actual wall times now use owned location timezone with the existing legacy fallback. Assistance resolves raw minute-local input only after manager ownership, rejects missing/repeated DST wall times unless explicitly disambiguated, preserves UTC/offset instants and separates reported departure from recording time. Configured windows/statuses/locks/CAS/duties/notices remain unchanged. Typecheck encountered3 errors in unfinished Opus-owned settings UI; no whole-project green claim.

Parent closed the client assistance gap: VisitAssistancePanel receives the kitchen zone from manager inspection/detail callers; unambiguous kitchen input is submitted as raw datetime-local for server-owned conversion, repeated times send the selected ISO occurrence. Storage keeps its existing explicit ISO conversion/default behavior. Labels/history use the displayed kitchen zone.35 focused assistance/attendance/inspection UI tests passed, including Tokyo without false DST ambiguity and Toronto's second autumn occurrence `06:30Z`. No live assistance API/DB trial yet; the running server needs restart after backend handback before using new raw-time payloads.

Ordinary single/contiguous booking lifecycle still has fixed-zone behavior; Sol High follow-up `phase0-single-visit-timezone-sol-r2-20261013` now owns that existing service/tests. Shared scheduled-end/attendance and historical review readers also have default-zone uses; these remain a traced separate clock contract and are not claimed fixed. Code/retry/financial semantics are outside this pass.

Opus instruction-tab split `phase0-arrival-tab-instructions-opus-r4-20261013` FAILED with Claude API rate limit; no active child remains. Its source is partial, not rolled back or treated complete. Resumed as new Sol High task `phase0-arrival-tab-instructions-sol-resume-r5-20261013`, retaining original brief, prior results, mobile-resize objection, partial-save/dirty-guard requirements and3 current owned compiler errors. It owns manager UI/nav/locales only; parent assistance changes and the other Sol's backend files do not overlap. Parent will review and do authenticated instruction/task split checks after terminal result. No fake code UI or migration was added.

**Visit-code rollout decision (owner follow-up):** new confirmations only. Owner reports no current production bookings; avoid a separate retrospective customer conversion/consent experience. This is owner-provided context, not a verified production query. Preserve accepted development fixtures and test old/new confirmation behavior without rewriting historical records. The optional rollout question is answered; it does not itself authorize the proposed persistent credential migration/key provisioning or deferred settlement.

## Resume after owner pause — navigation and instruction-tab checkpoint

Owner resumed local work, requiring digestible browser/API/data checkpoints, UX observations logged or repaired in scope, three-provider routing with Medium/High effort, and development-only pushes if specifically needed for testing. No push is needed yet. Pause is revoked; historical pending visual tasks are completed, not restarted.

Live manager379, location47/kitchen54: My Kitchens → Arrival & departure → shared setup → Back to kitchen preserved `kit=54`, `locationId=47` and selected section. Dirty instructions opened the existing focused leave confirmation. Keep editing retained the draft and sent zero PUT. Save and leave sent one settings PUT, waited for persistence, and returned to the same kitchen/section; GET confirmed the labelled note. A second explicit save restored the exact original notes, stage flags, four arrays and timing fields. No other fixture records were modified. Haiku independently reran60 mocked navigation tests and checked268 literal manager keys across EN/FR/UK. It flagged native Back/unload gaps in the old full-page settings flow; these are now acceptance cases for the revised split, not verified fixes.

Mobile issue: selected restored Arrival & departure tab can sit beyond the scroller. Parent added horizontal-only selected-tab visibility and a mocked geometry regression;51 focused kitchen/setup/editor tests passed. A subsequent live viewport resize still left the tab partly clipped, so mobile resize/return visibility is NOT yet closed. No document horizontal overflow was seen. Shared-scope copy was repeated in header/body; parent reduced the body to the publication/zero-task rule, keeping scope in the header. Customer-task tag now says Optional to add, preserving customer requiredness.

**Owner supersession:** instructions should appear directly inside the kitchen’s Arrival & departure tab; the optional-added substantial task list should open separately. New Opus High implementation `phase0-arrival-tab-instructions-opus-r4-20261013` replaces the interim tab→landing→all-settings design. It must keep one save owner per surface, guard drafts, expose shared-location scope in the tab, and write only its own fields (instruction changes cannot overwrite unseen tasks; task changes cannot overwrite newer notes/timing). Existing server endpoint merges supplied fields; no backend/schema change is needed for this UI split. User preference for full pages applies to the larger task editor; it does not require a redundant page for two instruction fields.

Read-only DeepSeek and Opus code research completed. Their claims were checked against current source: ordinary/contiguous bookings do not have kitchenBookingVisits rows, so code credentials only on that table would omit most bookings. Split-visit functions select location timezone but use fixed Newfoundland bounds; assistance uses default-zone wall time. Sol High `phase0-visit-timezone-prerequisite-sol-r1-20261013` owns that bounded backend repair and mocked tests, with no new clocks/retry/code/money semantics or DB calls. Existing UTC instants must not be reinterpreted. Lost-response replay needs identity/payload provenance, not blanket success for any already-checked-in row.

Concrete next code proposal is `visit-code-checkpoint-proposal.md`: staff-issued attendance challenge, deliberately shared authenticated self-service, assisted/offline recovery, single/split targeting, durable guess counters, current window/status/revision validation, same-operation replay, participant privacy and no financial coupling. No credential schema/key/migration exists yet. Optional owner question is pending about new-confirmation-only rollout versus existing-booking opt-in with customer agreement; silence is not implementation approval. One challenge table/canonical target, key provisioning and trial enrollment remain a review gate. Competitor sources distinguish personal PINs/door credentials from attendance evidence and do not establish universal mandatory app taps.

Current active scopes: Opus manager tab/task split; Sol visit timezone prerequisite. Do not edit their owned source until terminal results. DeepSeek/Haiku routine tasks have completed. Parent will perform real local acceptance and record limits; no financial cohort, real messages, migration, production settings, commit/push/deploy occurred.

## Latest visual checkpoint review — 2026-10-13 00:25 UTC

- Both pending Opus High visual rounds completed. Chef narrow Visit status disclosure removed; current status, kitchen-local schedule/timestamps and next step are always visible, with neutral Kitchen visit title on finished visits. Original task passed39 related mocked tests/typecheck. Parent corrected automatic-closure copy (does not claim personal manager inspection) in EN/FR/UK and a cancelled-with-recorded-arrival title edge. Final focused27 tests pass, whitespace clean. Real signed-in chef fixture125 shows closed status/times without disclosure, no live instructions/submissions, 390px document width390. No DB/provider writes in this follow-up. Screenshot was inspected but compositor blur means no comprehensive visual sign-off.
- Manager visual cleanup completed: one card with instruction/tasks/timing/preview sections, desktop paired instruction fields/mobile stacking, concise help/examples, one pinned Save after edits (hidden bar inert), timing before preview, touch-visible task row actions.26 mocked settings tests/typecheck/i18n lint pass. Current manager setup locale block has43 keys; earlier41-key count is historical. Source serialization, legacy optional flags, storage flows and existing activation policy are unchanged. Exact report/screenshots: `.phase0-harness/manager-setup-visual-checkpoint.md` and `setup-visual/shots/`; static mocks are not live final-layout proof.
- Owner-required discoverability is now delegated separately: `phase0-kitchen-visit-navigation-r1-20261012`, GPT-6.1 Sol Medium, full task ID `node:delegated-task:command%3Amcp%3A9a35aa08-042a-46bf-905b-5a8014c149e9%3Adelegate-task%3Aphase0-kitchen-visit-navigation-r1-20261012`. It owns kitchen entry/return/context and focused guard tests, not activation or code semantics. Read result before editing its owned navigation/setup-header files. Visit-specific code remains unimplemented; next code proposal still precedes schema authorization.
- Remaining chef rough edges recorded by Opus: cancellation summary hard-coded Newfoundland zone, early Open check-in CTA, inconsistent status casing, photo uploader keyboard/screen-reader focus, secondary history disclosures. None is claimed repaired by the status pass. Claims/settlement clocks, actual uploads and feedback remain separate.

## Restart continuation — 2026-10-12, 23:55 UTC checkpoint

- Recovered this thread's durable activity, prior decisions and ignored reports. Inspection and setup tasks were terminal usage-limit failures with no pending child runs; their source survived. Resumed as new T3 tasks: `phase0-inspection-resume-r2-20261012` (GPT-6.1 Sol High), `phase0-setup-resume-opus-r2-20261012` (Opus 5.5 High for UX quality). DeepSeek v4.1 Flash Medium recovered Customers/Today evidence. Haiku 5.5 Medium verified preparation regressions and is integrating setup translations. Only Medium/High is selected. Pricing is owner-reported, not verified by the model catalog.
- Guarded local launcher restarted: sandbox key/dev Supabase checked, outbound suppressed, local recurring worker disabled, R2/Twilio/Inngest/Sentry blank, `NO_STRIPE_LISTEN=1`; no duplicate webhook consumer. Authentication reused synthetic manager379/chef380 through password sign-in; no login-helper/credential file was created or exposed. Correct role hosts are `kitchen.localhost:5001` and `chef.localhost:5001`; plain localhost's main-domain routing does not render manager routes.
- **Manager inspection review completed locally:** fresh pre-clear context must retain the saved requirements, valid unchanged deadline and kitchen timezone as well as selected-visit/booking revision. Lost or changed context blocks POST and keeps the note. Resumed task passed 57 frontend tests, 21 server tests and TypeScript. Parent simplified architecture-heavy inspection copy into the actual review/clear/report task; all 24 inspection tests passed afterward.
- **Authenticated inspection proof:** new fixture125, chef380/kitchen54/location47, explicitly seeded attendance, $0, no PaymentIntent or ledger. Earlier fixtures118–124 retained. Native confirmation dismissal sent zero clear POST and kept the draft. Temporarily setting only125 to `checked_in` made pre-clear refresh block the stale action with “Visit changed”; zero POST, note retained. Restored `checkout_requested`, refreshed, retried and accepted confirmation: exactly one clear POST with the shared message, HTTP success, refreshed completed/checked-out UI. SQL corroborated checkout approval `2026-10-12 23:55:31.144` and the saved message; ledger empty. This does not verify paid service, transfers or bank payout. The first seed used JavaScript Date parameters with timezone-sensitive pg formatting; corrected only this owned fixture to explicit UTC ISO strings, and fixed the diagnostic script before further tests.
- Fixture125's chef detail page shows the shared manager message and historical attendance, without the live preparation panel. Manager issue entry opens support reporting without making a claim/charge mutation. Actual uploads, two-sided private feedback, staffed/self-service visit codes, exact reminder timers and deferred settlement remain separate unfinished checkpoints. Fixture124 was already completed when revisited (closure recorded20:30UTC); no pending-inspection claim is based on that row.
- **Preparation regression:** Haiku independently passed63 reminder tests and20 preparation/visit tests. Both arrival/departure eligibility helpers explicitly require confirmed status; its tentative concern about completed live action buttons was checked against those helpers and is not a reproduced bug. Reminder timing remains recurring-worker delivery, not minute-exact due-time scheduling. UI retaining guidance during `cancellation_requested` while reminders pause is not by itself a contradiction requiring a policy change.
- **Access ownership repair:** parent verified DeepSeek's report: DELETE `/api/manager/chef-location-access` had role/email middleware but no location ownership check; repository deletion used only body IDs. Local repair validates positive safe-integer IDs and verifies `location.managerId` before revoking.13 actual-route mocked regressions passed (foreign/missing locations, invalid IDs, failed lookup, owned success). No live cross-manager revocation was attempted; admin route/service behavior preserved. Not deployed.
- Customers/Today evidence is recovered: no customer aggregate or navigation exists; reuse `manager-overview-lifecycle` next-action rules, current application/tour/access relationships and existing Today component. Owner-selected visit code supports staffed/unattended arrival; private offers are before-confirmation first. Neither feature was silently enabled. Claims escalation/charge provenance remains a consequential unresolved boundary; inspection claim mutation remains unavailable on the new page.
- Browser DOM check at390px gave document width390. Screenshot transport produced stale/duplicated compositor images despite correct DOM state, so no new screenshot visual sign-off is claimed. Source, tests and retained fixtures remain local/uncommitted/undeployed; no migration, production change, SMS, real email or payment execution was performed.

Setup handback completed: Opus passed25 focused settings tests and TypeScript; Haiku integrated41 source-matching setup keys in en-CA/fr-CA/uk and verified ICU substitution. Targeted locale tests passed1633 with9 failures in untouched booking-history ICU entries; no full green claim. Old18-key report map is superseded. Native-speaker translation review/ESLint toolchain remain open. Parent live location47 smoke: whitespace arrival shows error/disables all visible Saves/no PUT; changed note updates preview/no autosave; one explicit save persisted both stages, both notes, four empty task/photo arrays and unchanged null timings. A second save restored the baseline; GET compared all ten fields and matched exactly. T3 typing reported success without changing controlled values; native textarea setter/input events in the owned browser produced the actual form test. Hidden aria-hidden pinned content is not a visible unsaved-change error.

**New owner visual observations:** narrow chef “Visit status” disclosure hides essential context; manager kitchen setup instructions are intuitive but presentation is cluttered. Separate bounded Opus High visual rounds now run: `phase0-chef-status-ux-opus-r1-20261012` owns chef status/actions/preparation sections; `phase0-setup-visual-opus-r3-20261012` owns manager setup layout/tests. Essential status/next action should be visible; repeated Save controls, nested panels, typography/spacing and timing placement need visual review. Source clocks, backend, financial behavior and fixtures are outside both tasks. Read terminal results before editing their files. These visual checkpoints are pending, not completed by the earlier copy pass. Full task IDs are in durable T3 activity. Port5001 was restarted to load the local server guard, with suppression/worker-off/no-listener unchanged.

Owner follow-up: setup must be discoverable from the selected kitchen, alongside existing kitchen sections, without needing the agent’s direct URL. Current entry is My Kitchens → selected kitchen → Details & Pricing → tracking configuration, which navigates to shared location setup; there is no dedicated arrival/departure kitchen section. Add clear kitchen-context entry/return and shared-location scope to navigation acceptance; preserve dirty-navigation guard and kitchen identity. Visit-specific attendance codes remain NOT implemented: staffed kitchen handover, deliberately shared self-service mode, wrong/expired/unavailable recovery, per-visit authorization/revision/replay protection and no payout coupling are recorded proposals. No unanswered question blocks current UX repairs. A concrete code implementation proposal must identify schema/rollout and unattended disclosure before migration authorization; do not silently enable the deferred code/settlement architecture. Next order: review both visual rounds and kitchen navigation, then code checkpoint, then scheduled-end/missing-tap/inspection-remedy closeout; feedback, timed reminders and before-confirmation offers/customer context remain in the existing roadmap.

Final guard follow-up: authenticated DELETE using chef380 and a nonexistent location was denied without revocation, but returned500 because the real location service throws a404 DomainError rather than returning null. Switched the route catch to the existing `errorResponse` helper and added the real-service-shaped regression:14 route tests now pass. The corrected404 response has mocked verification; another server reload is required before claiming its live HTTP status. Foreign-location denial is mocked only; no other manager's real records were touched. Direct completed chef visit route125 also hides instructions and live submit controls. Agent-owned browser tab closed after tests to stop idle polling; guarded listener remains running for follow-up.

**Continuation precedence:** read [continuation-handoff.md](continuation-handoff.md) for the recovered earlier thread, latest owner directions and qualifications to older proposals. The existing eight phases in `../booking-target-phases.md` remain the roadmap. Latest instruction is to keep harness testing, fix bounded issues and verify each checkpoint; it is not blanket approval of numerical policies, migrations, settlement enrollment or production rollout.

Companion docs (same folder):
- `phase0-evidence-pack.md`: environment map, walkthrough, ranked defects (C1–C2, H1–H6, M1–M10).
- `ux-polish-backlog.md`: every UX/UI rough edge, including the small ones (O, A, C, B, M, G, E, H series).
- `research-cancellation-deposit-policy.md` (Codex): cancellation, deposit and manager-window research.
- `audit-copy-terminology.md` (Codex): wording audit, glossary, "show fee only when > 0" rule.
- `audit-timezone-and-email-parity.md` (Codex): time zone and email audit.
- `research-booking-standards.md` (Codex): 87 sources; P0/P1/P2 standards checklist.
- `design-modular-cancellation-policy.md` (Codex, in progress): structured, versioned cancellation policy design.
- `audit-admin-support-controls.md` (Codex, in progress): per-state support actions on behalf of chef/manager, guardrails, startup-sized plan.

---

## 1. Ground rules (from the owner; never break)
- **Stripe live account is reference only.** Real customers. All testing on sandbox `acct_1SmNI9CvcNYAkDXN` ("Kitchen.LocalCooks Test").
- **Don't touch real users' data** on dev Supabase. Use our own synthetic users and records. Production (separate Neon DB and URLs) is never touched.
- Never print secrets; never decrypt Vercel env values.
- **Don't edit shared rows** (e.g. `email_logs` for the admin inbox). Document instead. The owner declined such an edit once.
- **SMS is out of scope.** Emails must be truthful, tour-quality, mobile-responsive and accessible.
- **Time zones must be modular**, never hard-coded to Newfoundland.
- Codex delegation is allowed at reasoning effort ≤ high.
- Log every small UX issue in `ux-polish-backlog.md`. Bar: Airbnb-level.
- Wording: call people by **name** (never "Chef" as a greeting or generic noun), and call the company **"Local Cooks"** (never "admin") in user-facing copy.
- The owner has no uncommitted work in the repo (2026-10-12) and has said to do what's needed on the dev/test side, including the background worker.

## 2. Environment
| Thing | Value |
|---|---|
| Stripe sandbox | `acct_1SmNI9CvcNYAkDXN`; webhook → `dev-chef.localcooks.ca/api/webhooks/stripe` |
| Dev DB | Supabase `zjiaghzmmgvswsllzxip` (ca-central-1), shared with teammates and dev Vercel |
| Vercel | project `prj_7R4Zwen18giSl8Q6cQJHiEPOmNDj`, team `team_7bHIEGwgaAHhjTK1uucFs1Sf`, branch `development` → dev-chef/dev-kitchen/dev-admin |
| Inngest | env `staging-0d2e45a4`, app `localcooks-lifecycle-staging`, fn `lifecycle-recurring-worker` |
| Email | Hostinger SMTP. Only `test_admin@localcooks.ca` has admin email on. `.test` addresses get a permanent 554. |
| Local harness | `.phase0-harness/` (git-excluded): `start-local.cjs` (guards: sandbox key and dev DB; blanks Twilio/R2/Inngest/Sentry). `CAPTURE_MAIL=1` sends to `smtp-sink.cjs` on :2525. **`NO_STRIPE_LISTEN=1` is required** because dev already consumes sandbox webhooks (see C1). Also `eml2html.cjs`, `set-pw.cjs` (only `@localcooks.test`). The bypass secret is in `.bypass-secret`. |

## 3. Synthetic test data we own (clean up at the end)
- Users 379 (manager), 380 (chef), 381 (admin via dev bypass). All `@localcooks.test` except the admin login.
- Location 47, kitchen 54 (oven $25 rental, fridge $12/day), Stripe Express account `acct_1UPWdbCf9PlKmwqd`.
- Bookings 114 (paid → cancelled → refunded), 115 (voided by the C1 race), 116 (pending → cancelled by the chef), 117 (lifecycle run, paid, transfer `tr_3UPnFICvcNYAkDXN0OXnf8xG`).
- Outbox events 20–25 (these bookings; undeliverable `.test` recipients), two R2 objects, APPLICATION-67.
- Local harness files.

## 4. Owner decisions (final unless reopened)
| # | Topic | Decision | Date |
|---|---|---|---|
| D1 | Klarna/BNPL | Off for kitchen bookings (`payment_method_types: ['card']`, both checkout paths). Stripe also bars Klarna for B2B. **Done.** | 10-11 |
| D2 | Service fee | Admin-configurable, including zero; **must not surface when that transaction's recorded fee is 0**. Owner permits refunding the platform fee where appropriate. Universal pilot-zero and GST/HST registration were earlier lead assertions, not verified by recovered owner messages; verify registration/basis before changing fee tax. | 10-11; qualified 10-12 |
| D3 | Kitchen tax | Location tax settings are manager-controlled; kitchen-tax proceeds are intended for the manager. The Stripe charge lands on the platform balance; legal supplier/agency, registration, collection and remittance responsibilities remain separate verification gates. | 10-11; qualified 10-12 |
| D4 | Before confirmation | Card hold only; chef cancel releases it, 100% back, nothing charged. | 10-11 |
| D5 | After confirmation, before the window | **Self-serve**, instant cancellation with an automatic refund. No manager approval. Owner chooses to exclude the **actual Stripe processing cost**, disclosed before payment and itemized on cancellation. This is Local Cooks' proposed implementation of owner policy, not a Stripe prohibition on full customer refunds. The earlier Peerspace "all cancellations" claim is overbroad: its current Very Flexible early tier includes fees. Specialist validation/clear wording still required. | 10-12 |
| D6 | Inside the window | The chef can still cancel. The default refund follows the kitchen's disclosed policy. **The manager decides any discretionary refund**, any amount up to total minus the Stripe fee, and can never refund the Stripe fee. | 10-12 |
| D7 | Policy modularity | Managers may keep money only if their terms disclosed it before booking. The policy is structured (tiers and presets), generates the text everywhere, and is snapshotted on each booking. Design delegated to Codex. | 10-12 |
| D8 | Damage deposit | **Removed for now.** **Done** (see §6). A claims flow may come later. | 10-12 |
| D9 | Manager response window | 24 h, hard-coded `AUTH_EXPIRY_HOURS` (not admin-controlled). Wants intuitive notifications. | 10-11 |
| D11 | Support controls | In **every** booking state, Local Cooks support must be able to act on behalf of either side and make manual adjustments on request, like a top marketplace, with startup-safe guardrails (audit trail, reason, no money-losing foot-guns). Audit delegated to Codex → `audit-admin-support-controls.md`. Standing requirement for every design. | 10-12 |
| D10 | Background worker | The owner re-enabled it on dev and allowed changes needed to test it. The 2-min cron previously pushed Vercel Fluid CPU over 100%. | 10-12 |

Open questions for the owner: see §8.

## 5. What was tested (walkthrough) — details in the evidence pack §2
Manager onboarding and Connect; admin licence approval; chef application; booking with oven; pay with 4242; manager approve (capture); chef cancel → manager accept → refund and transfer reversal (booking 114, money reconciled). Decline card. 3DS flow (booking 115, voided by the race). Pending-request cancel with a Canadian card (booking 116). Emails captured locally at 375 px. Worker resumed: 3 runs on 10-12 at 01:02–01:06 UTC, then paused by the owner; running again from 13:38 UTC.

Not yet exercised: manager decline; 24 h no-response expiry; cancel inside the window; abandoned-checkout expiry; storage booking; DST-day booking; disputes; payout failure; re-verify the O1 onboarding redirect.

## 6. Code changes made (uncommitted unless noted)
| Change | Files | Tests |
|---|---|---|
| Klarna off: cards only on both kitchen Checkout paths | `server/services/stripe-checkout-service.ts` | checkout suites: 10 pass, 1 failed already before the change |
| Damage deposit removed: the legacy `/payments/create-intent` no longer adds the listing deposit to the charge; new equipment bookings record `damageDeposit: '0'`; the manager form field and list badge are removed (saving writes 0); the chef calendar "Deposit" line is removed; the "Damage deposits · Held per booking" marketing claim is replaced with "Cancellation terms · Set by you" (en-CA, fr-CA, uk) | `server/routes/bookings.ts`, `server/routes/webhooks.ts`, `server/services/booking-checkout-fulfillment.ts`, `server/domains/bookings/booking.service.ts`, `client/src/pages/EquipmentListingManagement.tsx`, `client/src/pages/KitchenBookingCalendar.tsx`, `client/src/pages/manager-welcome-screen.tsx`, `client/src/components/auth/KitchenAuthShowcase.tsx`, `shared/i18n/locales/*/manager.json` | tsc clean |
| Booking email retry policy (fixes backlog H5): a permanent recipient refusal (5xx at RCPT TO) stops worker retries for that address, raises Local Cooks recovery once, and lets the event complete. Other failures back off from 1 min, doubling up to a 6 h cap, and park after 8 attempts. **The admin Email Log "Retry" still works**: an explicit retry re-attempts a refused or parked channel and reopens the event. | `server/services/bounded-smtp.ts`, `server/email.ts`, `server/services/booking-lifecycle-delivery.ts`, `server/services/email-log-service.ts` | 3 new tests |
| Inline delivery is scoped to the booking acted on (it previously drained anyone's backlog inside a user request, including SMTP attempts) | `server/routes/bookings.ts`, `server/routes/manager.ts` | — |
| Worker cadence configurable via `LIFECYCLE_CRON` (`*/N * * * *`, N 1–30), default **every 5 min** (was every 2); per-task `timings` added to run output | `server/lifecycle-inngest.ts`, `server/services/recurring-worker.ts` | 1 new test |

Already-failing tests found before any change (baseline, not ours): 21 in `tour-delivery-service.test.ts` (copy assertions), 2 in `decision-ordering.test.ts`, 1 in `stripe-checkout-cancel` (non-consecutive slot fixture).

## 7. Findings log (beyond the evidence pack)
- **Worker idle cost:** an idle tick with zero work took 7.5–12.8 s, mostly about 75 sequential DB round trips (21 checkpoint saves plus task queries). Wall time, not work. A permanently failing `.test` email also cost an SMTP attempt on every tick.
- **H5 corrected:** a failed event blocks later events for the same booking only until Local Cooks recovery is raised (after the first failure). The real cost was retrying every 60 s forever.
- **Manager window vs short notice:** auth expiry is `created_at + 24 h` (`auth-expiry-service.ts:42,77`) and ignores start time. With the default `minimum_booking_window_hours = 1`, a request can still be pending after its start time.
- **Chef can't cancel inside the window:** `bookings.ts` ~2229 returns 400 ("cannot be cancelled within {hours} hours"), which contradicts D6.
- Terms (`TermsContent.tsx` §4.8) still describe damage deposits conditionally; to be revised along with the policy work.

### Vercel Hobby budget (2026-10-12)
- The Hobby team gets **4 h Active CPU/month, a hard cap shared by dev and production**. Usage hit 75% on Oct 6 and 100% on Oct 7. The cause was the dev Inngest tick every 2 min: ~720 runs/day × ~1.3 s CPU ≈ 7.8 h/month. Production (`main`, 56 commits behind `development`) has no outbox, worker or `LIFECYCLE_*` env yet.
- **Vercel's terms restrict Hobby to non-commercial use.** Taking payments counts as commercial, so production should be on Pro regardless of CPU.
- Fix shipped (`a6d500a9`): booking notices are **event-driven** (each new outbox row sends `localcooks/booking.notice.queued`; the debounced per-booking function `booking-notice-delivery` delivers within ~10 s). The tick is only a backstop: production every 15 min, staging every 30 min (`LIFECYCLE_CRON` overrides). Estimated staging cost: ~48 runs/day ≈ 0.5 h/month.
- Remaining ideas: a one-query "anything due?" early exit; per-reminder `step.sleepUntil` in place of polling; fewer checkpoint writes; `sslmode=verify-full`.

### Live lifecycle run, booking 117 (2026-10-12) → `lifecycle-walkthrough.md`
- Event-driven notices verified live (manager request email 17 s after booking; `.test` addresses parked as undeliverable). Klarna absent and deposit absent, verified on dev.
- **Manager is paid at confirmation**: $55.43 transferred 1 h 46 m before the session. Express payout schedule daily, 7-day delay; `losses.payments = application`. Recommend deferred settlement (pay after the session + closeout), matching Airbnb, Peerspace and Turo.
- A booking made inside the window was never warned; the deadline shown predates the booking.
- Bookings only complete via checkout; otherwise "Confirmed" forever. No reviews.
- Synthetic users 379/380 have `password_set_by_user = true` (set by me for dev login). Test password is in `.phase0-harness/.synthetic-pw` (git-ignored).
- Commits: `f06f736c` (5xx at DATA = permanent).

## 8. Open questions for the owner
1. Short-notice requests: make the manager's deadline the earlier of 24 h or a fixed lead before start (structural; recommended), versus raising the default minimum notice.
2. Platform service fee inside the window when > 0: refund it proportionally to the manager's discretionary refund? (Moot while it's 0%.)
3. Deliverable mock inboxes for dev testing (e.g. plus-addresses on a Local Cooks mailbox), or keep the local SMTP sink plus `test_admin`?

## 9. Next checkpoints (updated continuation)
1. The earlier worker/email/deposit/Klarna work is already in commits `771c0f47`, `a6d500a9`, and `f06f736c`; do not recommit it. The five-minute cadence in §6 is intermediate history; §7 records current staging 30-minute / production-default 15-minute backstop behavior.
2. Continue scoped harness scenarios; record browser, API, DB and provider separately. No local Stripe listener. Distinguish simulated attendance fixtures from real sandbox authorizations.
3. Complete the first bounded visit UX checkpoint: a full-page chef arrival/departure task; prominent instructions separate from saved checklist/photo requirements; meaningful errors/draft retention and refreshed successful outcomes. Then test manager inspection and missing-tap exit paths. Do not label the entire redesign complete from a happy-path pass.
4. Reconcile the cancellation/support/check-in reports into the existing eight-phase plan. Older gross convenience-refund recommendations are superseded by D5; kitchen/platform-fault remedies and exact windows still require their own decision.
5. Introduce private booking feedback as part of the redesign, using tours' participant-own/operator-private precedent. Do not make reviews public or let a conflict flag automatically decide attendance, liability or payment.
6. Preserve separate service-end, inspection, customer-remedy, damage filing/response, transfer and bank-payout states. No early manager clear may silently erase customer protection; no forgotten tap may be the sole indefinite settlement gate. Exact target clocks remain proposed.

## 10. Continuation on 2026-10-12

- Recovered the full original thread messages and independently reconciled its decisions. Earlier "Phase 0 done" meant the first diagnostic walkthrough, not complete exception coverage. See `continuation-handoff.md` for scope and decision provenance.
- Owner prefers substantial booking tasks as full pages. Reserve modal dialogs for focused confirmations/alerts and short actions. Arrival/departure instructions must be distinct from configurable actionable checklist/photo evidence. Tours are the UX reference, not a complete business-rule template.
- Owner requests private two-sided booking feedback and operator flags, with public exposure deferred. Owner routing preference: Codex for consequential work, Haiku for routine Claude work, Opus only when justified; delegated effort never above High. Code Buddy `deepseek-v4.1-flash` is available and executed a bounded read-only PDF index at Medium. Owner reports free pricing; pricing was not independently verified.
- Both new PDFs were extracted and treated as hypotheses. Full amendments and multi-day storage redesign remain deferred; their existing coupling and original-contract/cancellation-clock invariants must be preserved.
- Harness verified sandbox test key/dev Supabase, no listener, outbound suppressed, recurring worker disabled, R2/Twilio/Inngest/Sentry blank. Authenticated only existing synthetic users 379/380. No shared settings, real-user data, production or live Stripe changes.
- **New attendance-only fixtures:** 118 no taps, 119 missed departure, 120 expired submitted inspection, 121 zero required evidence. They have no PaymentIntent, no charge and no financial ledger; their manually staged states are not a paid end-to-end test. 118/119 remain confirmed after end; 120 auto-completed after its saved 60-minute review window via GET `checkin-status`. 121 accepted real check-in and checkout POSTs without photos/items; UI still incorrectly labels generic photos required and keeps the dialog open. Details in `lifecycle-walkthrough.md`.
- **Real sandbox booking 122 (KB-4JE5RW):** October 16, 10–11 a.m., $30.50, PI `pi_3UPny1CvcNYAkDXN19XFq3ug`. Authorized through real hosted Checkout; manager declined through the UI. Stripe status `canceled`, received 0, capturable 0; SQL booking cancelled/payment failed and completed release decision. No capture/transfer/refund. Immediately after success the manager UI wrongly retained Payment Held/estimated payout; reload corrected money but called the manager decline Expired. Review dialog also displayed October 15 while detail correctly showed October 16.
- **Bounded response fix:** `booking-payment-decision.ts` now returns the existing frontend's `authorizationVoided` contract after verified cancellation and on completed-decision replay. Eight focused payment-decision tests passed before and after, including the strengthened retry assertion. Combined check has the same two already-recorded `decision-ordering` failures (9 pass/2 fail across both files); no all-green-suite claim.
- **Read-only Stripe settings verified now:** test platform country CA, manual payout schedule / delay 3; own test manager country CA, daily / delay 7, transfers active, losses responsibility application. This supports delayed-transfer feasibility in sandbox. It does not prove production settings, permissible holding horizon, protection of retained liabilities or contract/legal approval.
- Application changes from this continuation are local until validated; no commit/push/deploy or schema migration performed. The initial premature frontend draft was safely shelved before scope recovery. Current full-page implementation is a new bounded Codex task under the owner's newer testing/fixing instruction.

**Retention:** fixtures 118–121, real booking 122, their own new activity/outbox rows and sandbox objects are retained for reproducibility. Never reuse their IDs for a different scenario. Diagnostic scripts/transcript/PDF extracts/private login helper are git-excluded in `.phase0-harness/`; remove the secret-bearing login helper after the walkthrough. Do not annotate or delete unrelated shared email-log rows.

### Checkpoint: local full-page arrival/departure repair

- **Implemented and reviewed:** chef booking-list/detail actions open `/booking/:id/visit`, with optional selected-visit targeting. The page separates required operational instructions from configured checklist/photo actions, identifies optional generic photos, uses kitchen-local dates/timezone, exposes submission/load errors, retains in-memory drafts, and refreshes status/list/details/attendance before returning to booking details. Primary visit dialogs are removed from the two callers. Unopened dialogs no longer mount a status poll; unfinished visible visits still poll every 30 seconds. Other attendance/list polling remains; no blanket CPU-cost reduction claim.
- **Real authenticated fixture 124:** labelled zero-price/no-payment/no-Stripe attendance diagnostic, Oct 12 16:21–17:21. A temporarily staged pending state caused HTTP 400 on arrival. The inline error and note survived; status revalidation hid the unavailable form, revealing a recovery gap. Parent moved the error outside the action form and added manual status refresh, with a focused regression. After restoring the fixture to confirmed, refresh retained the note and real retry succeeded without photos/items at 19:05:13 UTC (16:35 local). The page returned to fresh Checked In details. Departure from the real detail button opened Kitchen departure; empty-evidence POST succeeded at 19:07:23 UTC (16:37 local), returned to fresh Checkout Pending details, and saved its note. Manager page and SQL corroborated both timestamps/messages. No financial proof is claimed for this synthetic attendance fixture.
- **Real sandbox fixture 123, decline replay:** $30.50 hosted Checkout authorization for Oct 16, PI `pi_3UPoHFCvcNYAkDXN01FaWVJz`. Manager UI response HTTP 200, `status: cancelled`, `authorizationVoided: true`; held-payment/payout estimate disappears immediately. Stripe canceled/received 0/capturable 0/live false; ledger canceled/transfer null. No capture/refund/transfer. 122 remains the before-fix comparison.
- **Additional display corrections:** manager review preserves its agreed calendar day instead of converting UTC midnight into the previous browser-local day (date-only and ISO regression cases). Cancelled bookings now say Cancelled rather than treating any failed payment as proof of expiry. Cause/actor-specific copy is still future work.
- **Current verification:** 30 frontend tests across six files pass; eight payment-decision tests pass; TypeScript and scoped whitespace checks pass. Existing two decision-ordering failures remain documented. Configured task/photo payloads, both mocked 400 paths, unavailable-form retry, overnight/selected visits and refresh ordering are covered. R2 credentials stayed blank: actual upload/object access is not verified. Authenticated desktop DOM width 1280 had no horizontal overflow; mobile T3 width 390 did not overflow, and the delegated isolated layout passed at 375. Screenshot-based visual QA could not finish: T3 snapshots timed out twice and Chrome `Page.captureScreenshot` timed out. Do not substitute DOM checks for visual approval.
- **Baseline qualifications:** 119 initially proved missing departure; later a labelled other-device checkout diagnostic changed it to checkout requested. That later test did not observe the intended stale-form 400; the actual 400/retry proof is fixture 124. 121 was cleared at 18:47:24 UTC, before its scheduled end. Current source already asks native confirmation before clear; older deployed observations require version-aware retesting.
- **Next checkpoint:** manager inspection/assistance, visible authoritative deadline, clear/issue choices, photo comparison and shared notes, focused confirmations and support exits. Then separately prove no-tap/missed-departure endings, private feedback, timed communications and deferred-transfer eligibility. Exact new clocks and payout cohort remain unapproved.
- **New cancellation/outcome finding:** a manager-declined uncaptured booking offers View cancellation and refund outcomes; it opens a quote with `500: No cancellation request awaits a decision`. No refund was attempted. Keep this for the cancellation/outcome checkpoint rather than changing financial policy in the visit repair.

**Updated retention:** keep fixtures 118–124 (122/123 real sandbox authorizations, all others attendance-only) and their own activity/outbox/provider evidence. Local source changes remain uncommitted and undeployed; no migrations or account settings changed. Private login helper and temporary login/Checkout HTML are removed after the walkthrough; transcript, extracted PDFs, shelved patch and guarded diagnostic scripts remain excluded for reproducibility.

**Manager checkpoint now running:** delegated Codex High task `phase0-manager-inspection-checkpoint-r1-20261012`, implementation limited to full-page manager inspection and existing supported contracts, with only necessary read-only deadline enrichment. It must not call DB/providers or change clocks/money/roles/lifecycle policy. Parent review and authenticated fixture tests remain required after its terminal result; see the exact task ID/resume rule in `continuation-handoff.md`. Local listener PID33432/port5001 retained, outbound suppressed and local worker/listener disabled. Agent-owned browser tabs are closed after first-checkpoint tests to stop idle polling.

## Oct14 (session 2) — two-role every-state walkthrough on dev + parallel builds

- **Walkthrough on dev `1f985dbb`** (manager 379 in the default profile, chef 380 in incognito; 1280 px and 390 px). Live path on new booking **152** (seeded $0 confirmed, start 9:30 NDT): today → real code check-in (569 032, staff mode) → in session → real chef checkout → real manager "Finish inspection" → completed. Also 150 (pending, synthetic `payment_status=pending`, so no response deadline, a seed artifact), 123 (declined real sandbox) and both lists.
- **At par:** the details header (who/when/one pill/next step) in every state; the sticky mobile Message bar; no horizontal overflow at 390 on any details page; in-session screen; checkout toast; in-app inspection confirm dialog.
- **Bugs found** (→ `build-walkthrough-fixes.md`, Sonnet, client-only):
  - chef list dates one day early;
  - "Upcoming" includes finished visits;
  - the manager list labels completed bookings "Pending";
  - "Cancel or change" on a finished visit;
  - declined/expired/withdrawn all shown as "Cancelled";
  - the manager sees "Your payment hold was released";
  - "View cancellation and refund details" shows on uncaptured bookings (a 500);
  - the inspection page keeps the live form after finishing.
- **Copy/clarity items:** 14 in total, also in that doc. They include removing the inspection "Refresh" button, the draft helper, "0 photos requested", the "Booking Requests" title and Title Case chips. Also: a manager on a chef URL gets "not found" instead of a redirect.
- Seeded bookings have no `reference_code` (UI fallbacks differ: "152", "#152", "BOOKING-152"); unify to `#id`.
- **Running in parallel:**
  - Codex Sol High builds the admin Booking support server (migration 0077, written NOT applied) per `build-booking-support.md`;
  - Sonnet does the walkthrough fixes;
  - DeepSeek maps payout-after-closeout, the response deadline (R5 + manager decision reminders) and private feedback → `map-payout-deadline-feedback.md`.
- **Research (Oct14):**
  - Turo US initiates payout ~3 h after trip end (3 business days on the first trip; non-US 3 business days) ([Turo](https://help.turo.com/en_us/getting-paid-SyALrVeN9.md));
  - Airbnb releases ~24 h after scheduled check-in;
  - Peerspace processes within 7 days after the reservation ends ([Peerspace](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119524));
  - Peerspace and Airbnb use mutual reviews after completion (Airbnb: a 14-day double-blind window).
  - Direction for Local Cooks: release the kitchen transfer at closeout (inspection finished, or auto-closed 24 h after end), and keep feedback private to Local Cooks per the owner.
- **Support server RETURNED (Codex Sol High)** → `.phase0-harness/booking-support-server-checkpoint.md`.
  - Search/case/actions API at `/api/admin/booking-support`;
  - append-only `support_actions` (trigger-protected) and `booking_flags`;
  - flag freeze in every refund/transfer writer, including the legacy claim/overstay paths;
  - dispute and payout-failure webhooks;
  - goodwill funded by Local Cooks without reversing the kitchen transfer, with the $25 cap and an exception path;
  - tsc clean; 244 tests pass across 17 files; only the known pre-existing failures.
  - Gaps: chef cancellation inside the cutoff still blocked (waits for the policy engine); kitchen-caused refund refuses used/separately charged add-ons; unattributed manual payouts alert the admin without a booking flag; Connect has no `transfer.failed` event; flag emails need the owner's admin operational-email preference ON.
  - Migration 0077 APPLIED to dev (owner approved; the Supabase MCP apply tool is permission-blocked, so it went through the guarded `.phase0-harness/apply-migration.mjs` dev-only script). RLS verified on both tables.
- **Next builds launched (parallel, ownership split by file):**
  - Sonnet: support admin UI → `.phase0-harness/booking-support-client-checkpoint.md`;
  - Codex Sol Medium: `build-response-deadline.md` (R5 rule `min(created+24h, start−1h)` with a short-notice fallback; manager reminders at −12 h/−2 h; `responseDeadlineAt` on payloads; people-language expiry copy);
  - Codex Sol Medium: `build-private-feedback.md` (migration 0078, private to Local Cooks, 14-day window, day-3 reminder, low-rating admin flag).
  - Payout-after-closeout is next, after those land (it touches the same refund/transfer writers).
- **Deployed `a5c2eb41` to dev (owner approved).** Pre-deploy checks: full server suite 50 failed / 2306 passed against the HEAD baseline of 51/2150 (no new failing files); client 12 pre-existing failing files; tsc clean. Migration 0078 applied to dev.
- **Live check on dev (chef, manager, admin):**
  - list dates correct;
  - #152 under Past;
  - 123 shows "Declined… Your card wasn't charged" + "Find another time" + "Request declined" + "Not charged $30.50";
  - booking 153 (seeded, auto-closed by deployed dev) shows the feedback card for both roles; the chef sent 4★ with "Trouble getting in" (→ admin flag event "Booking feedback needs a look"), the manager 5★; the admin case shows both, chef marked "Needs attention";
  - a $10 goodwill refund on 149 via the support desk: Stripe sandbox `re_3UQInrCvcNYAkDXN1zc427ie` succeeded, metadata `manager_debited=0`, `platform_goodwill_cents=1000`;
  - a $16 exception after the double-confirm, "Recorded as an exception"; refunded total $26.
  - Not yet tested live: the dispute webhook (needs a sandbox payment with a dispute card) and payout-failure.
- **Owner Q (refund fees):** Stripe charges no fee on refunds and doesn't return the original processing fee. Goodwill costs exactly the refund amount; the preview label was changed to "Original processing fee".
- **Polish batch** (`build-live-check-polish.md`, Sonnet) done locally, not committed:
  - no-check-in wording;
  - admin names/date/code-state/exception copy/toast + banner, `#id` fallback;
  - chef/manager see goodwill refunds (`goodwillRefundCents`, history `goodwill_refunded`);
  - overnight slot calendar dates on the chef list/details (the manager list is still on the operating date; follow-up);
  - the fee label.
- **Launched:** Codex Sol High builds `build-payout-after-closeout.md`: transfer at closeout (inspection cleared or auto-closed), hold on issue/flag, `release_payout` support action, migration 0079, env `KITCHEN_PAYOUT_TIMING` (dev `after_closeout`, default `at_capture`), the manager "Sent after the visit closes" card, the revenue "Upcoming payouts" view, the chef "Final invoice" at closeout.
- **Dispute live test PASSED (sandbox).**
  - Booking 154 (KB-33A3C5): booked by the chef through real hosted Checkout with card 4000000000000259. The "What happens next" block showed the R5 deadline "Oct 15, 12:15 p.m." and the manager banner "Respond by Oct 15, 12:16 p.m.".
  - Manager approved → capture → Stripe dispute `du_1UQTSECvcNYAkDXNcJYOWFhb` → webhook opened `booking_flags` #1 (chargeback) → admin email "Booking payment needs review" sent.
  - The support case shows the red flag; goodwill and kitchen-caused cancel are no longer offered (frozen).
  - It also proves the payout risk: the kitchen's $27.32 was transferred at capture, minutes before the chargeback.
  - Leave flag #1 open as the fixture.
- **Observed:** the chef has two scheduled "Before you leave the kitchen" emails, and the manager two "arrives at 11:00 a.m." emails, for booking 154. Check whether these are departure (30 min) + session_ending (15 min) with the same subject, or duplicates; if both are intended, give them distinct subjects or merge.
- **Payout-after-closeout Codex task hit the usage limit** (resets 14:24 NDT) with partial edits in the tree (migration 0079 written, `KitchenPayoutStatus.tsx`, transfer/revenue files). It will be re-delegated to continue from the partial state, per the owner's "let rate-limited tasks resume" rule. The polish batch is mixed into the same uncommitted tree.
- **Reminder "duplicates" explained:** each reminder has a notification row and an email row (same tracking id, different channel). Not a bug.
- **In-app notification copy bugs (next package, after payout lands; same server files):**
  - (a) the chef got "New kitchen booking request: A new kitchen booking request is ready to review." on their own request (manager copy sent to the chef);
  - (b) the reminder `message` text uses raw "Visit: 2026-10-20 11:00–2026-10-20 12:00" instead of "Tue, Oct 20 · 11:00 a.m.–12:00 p.m.";
  - (c) the chef departure reminder's in-app message repeats the arrival text ("When you arrive…");
  - (d) reminder titles read "Kitchen booking #154" (use the kitchen name + reference);
  - (e) confirmation copy "approved items are paid" is stiff; seeded 153 shows "Booking #153 is confirmed. Follow the applicable check-in and checkout requirements" (old producer copy is still reachable).
  - Ties into the known gap "per-recipient notification i18n".
- **Owner (Oct14): don't wait for Codex; use Claude and Code Buddy.**
  - Payout-after-closeout re-delegated to Claude Opus, which first inventories Codex's partial edits (keep/fix/redo) and preserves the uncommitted polish batch.
  - Code Buddy DeepSeek fixes the reminder copy (b, c, d) in `advance-reminders.ts` only, and maps producers (a, e) read-only (those live in payout-owned files and are fixed after payout lands).
- **Owner (Oct14): pre-authorized for THIS round:** after the lead reviews the payout + notification-copy + polish work, push to development and deploy on Vercel dev, applying the needed dev migration (0079), without asking again.
- **Deployed `14f0d405` to dev** after the lead's review.
  - Review: Opus's partial-state inventory; the gate/release/sweep code reviewed (decision persisted before Stripe, no lock held across I/O, holds re-checked under the source lock; commitment problems have an admin resolve path + the `release_payout` override, so no permanent hold).
  - Lead fixes: the chef's own request notice via `roleText` (made non-blocking after the fulfillment tests showed a copy failure could roll back a booking); the manager confirmation `roleText`; plain-language deadline reminders.
  - Full suites: server 51 failures/16 files, all in baseline files; client 11 pre-existing files; tsc clean.
  - Migration 0079 applied to dev. Vercel env `KITCHEN_PAYOUT_TIMING=after_closeout` added (preview, git branch `development` only; production unset → at_capture).
- **Payout live test, booking 155 (KB-22VHDC), real sandbox 4242, Oct 14 4–5 p.m.:**
  - checkout showed the R5 deadline "Oct 14, 3:00 p.m." (start − 1 h);
  - the chef in-app notice is "Request sent to PHASE0 Main Kitchen… until Oct 14, 2026, 3:00 p.m. · Newfoundland Time";
  - the manager approved → PT `succeeded`, `payout_timing=after_closeout`, `transfer_id` null, eligible Oct 15 17:00 NDT;
  - Stripe sandbox: PI succeeded, received 3050, charge.transfer null, 0 transfers in the group;
  - the manager card reads "Sent after the visit closes (around Oct 15, 2026, 5:00 p.m.)".
- **Next-batch findings:**
  - (1) the manager payment card repeats "Your payout $27.32" (the new `KitchenPayoutStatus` + the old headline);
  - (2) checkout "What happens next" for same-day bookings says "Arrival details are shared 48 hours before" and "you can cancel up to 24 hours before" (both already past; use the late-booking variants);
  - (3) the "3:00 p.m. · Newfoundland Time to respond" separator in sentences (`emailLocalDateTime` is for fact rows; use a sentence variant);
  - (4) the reminder range "2:00 p.m.–3:00 p.m." should collapse to "2:00–3:00 p.m.";
  - (5) a double period after manager instructions that end with ".";
  - (6) the manager list overnight date (follow-up from polish).
- **PAYOUT LIVE TEST PASSED (booking 155, sandbox).**
  - To avoid waiting for 3:45 p.m. (owner: manipulate dev as needed), the booking time was moved to 14:30–15:30 and its saved closeout snapshot cleared. Lesson: set `updated_at` with `date_trunc('milliseconds', …)`, or the optimistic version check refuses the check-in ("Booking changed; refresh before checking in").
  - Real code check-in (952 636) → chef checkout → manager "Finish inspection".
  - Result: `payout_released_at` set (reason `inspection_clear`); Stripe sandbox transfer `tr_3UQVOWCvcNYAkDXN1UlqpwKi` of $27.32 to `acct_1UPWdbCf9PlKmwqd` with `source_transaction` = the charge; event `payout_released` queued; no transfer existed before the inspection.
- **Owner UX points (Oct 14):**
  - (1) the kitchen code panel "Staff gives the code" is unintuitive → rename to "check-in code" everywhere; staffed panel "Share this code with {chef} when they arrive…";
  - (2) kitchens must understand that finishing the inspection gets them paid sooner. The lead's nuance: the inspection is optional (auto-release ~24 h after the end), so the copy says "sooner", not "must".
  - Both delegated to Sonnet → `.phase0-harness/checkin-code-payout-copy-checkpoint.md`.
- **Next-batch fixes DONE (Sonnet)** → `.phase0-harness/next-batch-checkpoint.md`: the payout amount shown once, late-booking checkout copy, `emailLocalDateTimeSentence` for prose, "2:00–3:00 p.m." ranges, no double periods, manager overnight dates.
- **Cancellation engine — owner decisions (Oct 14):**
  - short-notice bookings inside the no-refund window are ALLOWED with a clear warning before payment;
  - add-ons cancel together at the same %; started storage goes to support (storage note kept for the storage redesign);
  - POLICY MODEL = **Food Corridor style** (after research on TFC + real shared kitchens): the kitchen picks a notice period 24/48/72 h + a late charge 50%/100% of kitchen time; % only (no flat fee); NO grace period (Peerspace's was researched and not adopted); admin controls allowed options/default + a per-kitchen override with a reason.
  - Plan: `build-cancellation-engine.md`. Codex Sol High r2 is implementing (r1 was cancelled before any edits, when the model changed).
- **Cancellation engine RETURNED (Codex Sol High r2)** → `.phase0-harness/cancellation-engine-checkpoint.md`:
  - pure two-knob engine;
  - the actual Stripe `stripe_fee` only (fee pending → the refund waits, no estimate);
  - self-serve instant cancel (no manager approval);
  - kitchen-caused cancel 100% with a reason;
  - admin options/default/override (audited);
  - checkout acknowledgement + short-notice warning;
  - a frozen snapshot per booking (DB-immutable).
- **Lead review fixes:**
  - added RLS + PUBLIC/anon/authenticated revokes to 0080 (missing);
  - updated the payout-notice test to the new "You've been paid $X · KB-…" title and the shorter in-app text;
  - made the BookingPreparation test dates relative (they were hard-coded and had gone stale).
  - Full suites: server 50 failures in 15 files, all on the baseline list; client 9 pre-existing files (the BookingCancellationChooser, cancellation-policy-dialog and BookingPreparation failures are now fixed).
- **Migration 0080 applied to dev:** 5 kitchens mapped, all 24 h / 100% (kitchen 54 included).
- **Check-in code + payout clarity copy DONE (Sonnet)** → `.phase0-harness/checkin-code-payout-copy-checkpoint.md`: "visit code" → "check-in code" everywhere; staffed panel "Check-in code for {chef}"; finish-inspection-to-get-paid-sooner messaging; payout toast/done state; "You've been paid $X · KB-…" email with a breakdown; "Payment confirmed" replaces "Payment Received from <email>"; manager check-in/checkout notices.
- **Deployed `21f06e85` to dev** (cancellation engine + check-in code wording + payout clarity). Live cancellation tests are next (the first attempt's browser call was interrupted).
- **Arrival package launched (Sonnet)**, after research (TFC uses PIN sign-in/out to reconcile hours used vs booked; shared kitchens ask renters to tell the manager when late/over; nobody gives early access by default):
  - chef one-tap "Running late?" (reusing the tour running-late pattern);
  - a manager alert 15 min after the start when the chef isn't checked in (skipped when running-late covers it);
  - "Your booking still ends at…" on late check-in;
  - "Arrived early? Message the kitchen".
  - → `.phase0-harness/arrival-package-checkpoint.md`
- **Extensions — owner decisions (Oct 14) after research** (TFC: extend an ongoing booking, instant under auto-approval else the kitchen approves; Turo: in-app only, auto when free; Peerspace: host proposes + guest approves; overtime in 30-min blocks with a dispute window):
  - (1) the chef asks for more time with one tap; the kitchen approves by DEFAULT (owner leaned off; lead agreed: consistent with request-to-book and TFC manual approval; calendar-free ≠ staff available); kitchens can enable instant auto-approval; requests expire after 15 min; card hold → capture on approval;
  - (2) the kitchen can "Offer more time" in one tap; the chef accepts and pays in one tap;
  - (3) overstay: the kitchen sends an extra-time charge after the visit (30-min blocks from the recorded checkout, can only lower); the chef pays in one tap or disputes; unanswered after 48 h → support; NO automatic charges.
  - Extensions are non-refundable once added; payout follows the parent booking.
  - Plan: `build-session-extensions.md`; Codex Sol High implementing (migration 0081).
- **CANCELLATION LIVE TESTS PASSED (dev `21f06e85`, real sandbox 4242, kitchen 54 policy 24 h / 100%):**
  - **156 (KB-ZH477K, Oct 20) early cancel:** the quote "Your refund is $29.07. The $1.43 card processing fee is kept" came from the charge's `fee_details` type `stripe_fee` (143). Stripe refund 2907 succeeded; 0 transfers; events cancelled + refund_issued.
  - **157 (KB-XQ8SD2, tonight 9 p.m.) late cancel:** checkout showed the short-notice warning + the required acknowledgement; after approval the cancel quote was $0 ("Amount kept: $30.50"); booking cancelled, payment paid; the kitchen payout is scheduled at the end + grace (10:15 p.m. NDT); 0 transfers yet.
  - **158 (KB-U3SRZ6, Oct 21) kitchen-caused:** ⋯ → "Cancel as the kitchen" + reason; full refund 3050 succeeded; 0 transfers; cause = kitchen; the chef got an apology notice with the reason.
- **UX defects found** (→ Sonnet polish `.phase0-harness/cancellation-polish-checkpoint.md`):
  - a past deadline shown inside the short-notice window;
  - "under your booking's saved policy" jargon;
  - "Choose what to cancel" with nothing to choose;
  - the redundant "Amount kept";
  - the add-ons sentence shown without add-ons;
  - the success state doesn't restate the refund;
  - "Done" observed disabled once;
  - the kitchen-cancel chef notice title/double punctuation, with no "Find another time";
  - the manager menu has both "Cancel as the kitchen" and the old "Cancel or change booking";
  - "there?s" corrupted apostrophes (3 en-CA keys fixed by the lead).
- **Arrival package DONE (Sonnet)** → `.phase0-harness/arrival-package-checkpoint.md`:
  - running late (15/30/60 + note, max 3, persisted as `running_late` lifecycle events, no migration);
  - the `manager_no_checkin` alert (default 15 min, admin setting `managerNoCheckinMinutes`, defers to the running-late ETA);
  - "Your booking still ends at…";
  - "Arrived early? Message the kitchen".
- **Early access — owner decision (Oct 14) after research** (Airbnb: guest asks, host decides, sometimes a fee; Peerspace: setup inside the booked time, longer booking via host update; shared kitchens: the operator controls access times). The chef can never start early on their own. One kitchen control, "Let them start early": ≤30 min earlier = a FREE early check-in grant; >30 min = a PAID earlier-start offer (30-min blocks at the hourly rate, the chef accepts and pays in one tap, only when free). Plus a booking-flow line: "Include setup and cleanup in your booking time." Added to the Opus extensions build.
- **Session extensions:** Codex hit model capacity after mapping (partial files left) → re-delegated to Claude Opus to inventory and finish.
- **Cancellation polish DONE + "Change booking" restored for managers on confirmed bookings** (cancel an add-on / send a partial refund out of the payout). The lead corrected the add-on refund: kitchen-caused → full refund including the proportional fee (Local Cooks absorbs; R1). In progress.
- **Owner correction (Oct 14):** the kitchen manager CHOOSES free vs paid for early starts and for offered extra time; the 30-min rule is only the pre-selected default; nothing is ever sent automatically; the chef is never charged without accepting. Chef-requested extensions stay paid (kitchen approves). Sent to the Opus extensions build.
- **Add-on refund fix DONE (Sonnet):** new `refundKitchenCausedAddons` + `POST /manager/bookings/:id/addon-refund`. The chef gets the item + its service-fee share (full, incl. the card fee); the kitchen is debited the item minus its fee share; Local Cooks funds the fee share (metadata like cancelKitchenCausedBooking). Guards: no frozen allocation / prior goodwill / unresolved refund / already refunded; idempotent. Lesson recorded: server tests must run with `-c vitest.config.server.ts` (the default config excludes server/**).
- **Owner (Oct 14), extensions free option:** after research (Peerspace host decides whether/what to charge overtime; Airbnb late checkout at host discretion; TFC kitchens manage/credit billing), the kitchen responding to a CHEF extension request has three choices: Approve + charge / Approve for free / Decline. Chef request copy: 'up to $X; only charged if the kitchen approves with a charge'. Instant mode stays paid. Every extra-time path now has a free and a paid option chosen by the kitchen. Sent to the Opus build.
- **Session extensions DONE (Claude Opus)** → `.phase0-harness/session-extensions-checkpoint.md`:
  - Codex partials inventoried; 6 real defects fixed (a missing payout import; rewriting the immutable cancellation snapshot; an escalation opening a flag that froze the whole payout; a lost hold blocking time forever; static retry keys; no decline handling);
  - all owner choices implemented (chef request with 3 kitchen answers incl. free; kitchen offer/early start with Free/Charge; overstay charge 30-min blocks lower-only, 48 h → support; toggle default off; admin override + kill switch; the "Include setup and cleanup" line);
  - migration 0081 (RLS added);
  - tsc 0; new tests pass; full server suite no new failing files.
  - Gaps: PDFs omit extensions; a chef cancel after an early start goes to support review.
- **Lead review found a money-correctness risk:** extension charges are extra `payment_transactions` rows with `booking_type='kitchen'` and the same `booking_id`. The lead scoped the chef/manager details lookups to the booking's own `payment_intent_id`. The scan flagged list/revenue joins (possible duplicate rows / double counts) and the cancellation refund source set → a focused Opus audit (`.phase0-harness/extension-join-audit.md`) runs BEFORE the next deploy.
- **Extension join audit DONE (Opus)** → `.phase0-harness/extension-join-audit.md`. Five money defects fixed:
  - `findPaymentTransactionByBooking` returned the extension row;
  - `syncStripeAmountsToBookings` overwrote `kitchen_bookings.service_fee` with the extension's commission;
  - double-counted tax in revenue-v2/legacy;
  - extension payouts counted zero times in payout reads/upcoming;
  - parent amounts shown on extension lines.
  - Other changes: the invoice list joins the own PI; the payout statement counts the booking + extensions once each (behaviour change: damage-claim rows are no longer in the statement); history labels "Extra time - {kitchen}".
  - Cancellation refunds already exclude extensions (now tested).
  - Open: booking-change/damage-claim rows have the same display/tax issue; legacy revenue fallback omits extensions; the client "Extra time" label.
- Final checks: tsc 0; client 9 pre-existing failing files; server 15 files/50 tests (baseline 16/51), no new failures. **Migration 0081 applied to dev.**
- **Deployed `3984ee75` to dev.** Live test on booking 159 (KB-6WAXEF, real sandbox 4242; times moved via DB, updated_at truncated to ms):
  - the manager page shows the check-in code panel with the new wording; the chef sees "Arrived early? Message the kitchen";
  - "Let them start early" → 6:15 (30 min) with Free preselected (Charge $15.26 shown) → "Give it free" → 6:15–7:45, history "… start 30 minutes early — no charge"; the chef's visit page shows the grant;
  - chef check-in with code 287 169;
  - "Need more time?" → options "Request until 7:25/7:55/8:55 · up to $15.26/$30.50/$61.00" + "You're only charged if… approves with a charge" + non-refundable line → requested +1 h → Stripe hold `requires_capture` 3050 (row `kitchen_booking_extensions` #2, expires 15 min);
  - the manager banner "asked for 1 more hour (until 7:55 p.m.) · you'd get $28.75" with Approve · charge / Approve for free / Decline → approved with charge → PI succeeded 3050, a separate PT row (after_closeout), 0 transfers;
  - "Offer more time" 30 min → Free → until 8:25 p.m., "no charge".
- **Defects found** (→ Opus `.phase0-harness/extension-live-fixes-checkpoint.md`):
  - (1) CRITICAL overstay dead end: after end + grace the chef's visit page shows "Visit finished" ×3 with no checkout button, and the manager has no action, so an overstay can't be recorded or charged;
  - (2) early-start options include past times;
  - (3) third-person history on the manager's own actions;
  - (4) systematic double periods after "p.m.";
  - (5) "booking ends at … right away" copy;
  - (6) the header duration uses a stale `duration_hours`.
  - Pending after the fix: closeout → payout release covering booking + extension (expect 2 transfers).
- **Extension live fixes DONE (Opus)** → `.phase0-harness/extension-live-fixes-checkpoint.md`:
  - overstay: late checkout allowed until the visit's inspection window closes; the manager can "Record when they left"; "Charge for extra time" is based on the recorded departure vs the current end after extensions; one clear "Your booked time ended" state;
  - early start only offers times ≥ now, with "Start now";
  - first-person manager history;
  - a global double-period i18n post-processor;
  - copy fixes;
  - duration derived from the real spans;
  - owner addition: any-length extensions/early starts (15-min steps up to availability, quick-pick chips + "Choose a time…").
  - Suites: server 15/48 vs baseline 16/51; client = the known set.
- **Owner design rule (Oct 14):** any setting that changes the flow (self check-in, auto-approve extensions, policy changes) must state, before confirming: what changes for chefs, when it applies (now vs new bookings), current impact ("affects 3 upcoming bookings; we'll tell those chefs"), how to undo; confirm step only for impactful changes. To be enforced in the design-consolidation pass.
- **Owner:** the booking pages feel congested in places → a dedicated design-consolidation pass (Fable review/plan, then build), with screenshots of every state × role × 1280/390.
- **Damage claims — owner decisions FINAL (Oct 14)** after research (Airbnb 14 d / 72 h guest response / platform review + AirCover; Peerspace 72 h + receipts, no arbitrary fines):
  - the kitchen files within 72 h; damage + extra cleaning, itemized with receipts; check-in/checkout photos auto-attached; cap $250 (more → Local Cooks support case);
  - the chef pays one-tap or disputes within 72 h; disputed/unanswered → Local Cooks review (uphold/reduce/reject/close; "Local Cooks pays the kitchen" with write-off or owed);
  - NEVER auto-charged; an unpaid upheld claim after 7 days → new bookings held until resolved;
  - disclosed in Terms/booking policy, not at checkout;
  - claims do NOT hold the kitchen's booking payout (correction of earlier behaviour);
  - Local Cooks absorbs the processing fee on claim payments so the kitchen is made whole.
  - Stripe: no holds, so nothing expires (on-session PI at tap; compensation is a platform-balance transfer without source_transaction).
  - Plan `build-damage-claims.md`; Codex Sol High implementing (migration 0082 if needed).
- **Process slip (lead):** commit `b0a17a6d` accidentally included Codex's in-progress damage-claims files (0082, damage-claims-v2.ts, shared/damage-claims.ts, schema columns). They are inert except the schema columns, so 0082 (purely additive) was APPLIED to dev to keep the deployed schema consistent. Snapshot `.phase0-harness/0082-applied-snapshot.sql`; any later change to 0082 must be applied as a delta. Rule going forward: stage explicit paths while an agent is active.
- **Damage claims amendment (owner, Oct 14):** Local Cooks reviews EVERY claim before the chef sees it (Peerspace-style). First review: send to chef (full/reduced) / ask the kitchen for info / close / Local Cooks pays. A chef dispute returns to the admin for a final decision. The admin can withdraw at any stage. A setting `damageClaimsReviewFirst` (default true) lets small claims go direct later. Plan amended.
- **Deployed `b0a17a6d`; extension/overstay live test COMPLETED on booking 159 (sandbox):**
  - the chef's late-checkout state ("Your booking ended at 5:50 p.m. Please check out now — … may charge for the extra time", "1 h 13 min past your booking", "Check out now");
  - late checkout recorded 7:03 p.m. → the inspection deadline moved to the departure + 24 h;
  - the manager next step "Finish the inspection to get your $54.64 now…" (booking + extension once each);
  - "Charge for extra time" prefilled "74 minutes … 90 minutes … up to $45.76" → lowered to $15 + required note → chef "Pay $15.00 / This isn't right" → paid;
  - inspection finished → 3 transfers: booking 2732, extension 2732, extra-time 1328; 3 `payout_released` events.
- **Polish items** (for the design-consolidation pass):
  - 3 separate "You've been paid" notices → one combined notice with lines;
  - the header "0.33 hrs" → "20 min";
  - the chef visit page still shows "In session · ends 5:50 p.m." in the ended state and "Inspection due by…" (kitchen-only info);
  - the chef-side "90 minutes of extra time" wording when the amount was reduced.
- **Limits hit (Oct 14 ~19:00):** Fable design review (reset 19:20) and Codex damage claims (reset 19:35). Both resumed: Fable via SendMessage; Codex's queued steer turn (review-every-claim amendment) auto-started at 19:35. Code Buddy (DeepSeek) launched read-only mapping: `map-storage-current.md` (for the storage redesign) + `map-notification-i18n.md` (English-only in-app notices).
- **Code Buddy maps DONE:** `map-storage-current.md`, `map-notification-i18n.md`.
  - Storage findings: no inventory/capacity enforcement (the same unit can be double-booked); `per-cubic-foot` is priced as daily; storage extension charges transfer at capture (they don't follow after-closeout); pricing is computed in 3 places; no standalone creation path; no "Manage my storage".
  - Notifications: ~150–180 English-only strings; proposal: translate at creation with the recipient's locale (quick win) → key+params rendered per viewer (durable).
- **Storage — owner direction (Oct 14):** not monthly-only (needs modular terms); the listing form must be simple; research storage check-in/out, early move-out, holdover, cancellation and approval at Food Corridor/peers before deciding. FINISH BOOKING FIRST; storage research runs in parallel (Code Buddy → `research-storage-structure.md`); the booking design keeps a clean Storage slot/placeholder. The earlier `design-storage-decoupling.md` remains reference, not a decision.
- **Design consolidation spec DONE (Fable)** → `design-booking-consolidation.md` (audit, per-state IA chef/manager, settings consequence previews incl. the finding that changing the check-in window silently affects existing bookings, 12 notification merges, 3 file-disjoint work packages, a storage placeholder). The owner approved the direction but asked for a PREMIUM finish (Airbnb / Skedda / Nexudus) → the lead added §6 'Visual quality layer' (cover photo, map preview, avatars, type scale, reui frame/alert, timeline history, single filled button, motion, frosted sticky mobile bar, sheets, skeletons, a reference comparison; screenshots to the owner before deploy).
- **Owner (Oct 14): must not look congested or cluttered; premium and intentional for the target user** → the lead added §7 'Restraint budget' to the consolidation spec (above-the-fold limits, max 3 visible links, ≤20-word status sentence, hide all empty/zero content, progressive disclosure, one accent colour, whitespace over dividers, sidebar max 3 cards, a self-check per screenshot).
- **Storage research DONE (Code Buddy)** → `research-storage-structure.md` (TFC verified by the lead: kitchen-created units with a count + monthly price). **Owner storage decisions (Oct 14) recorded in that doc:** approved members only, decoupled standalone + booking shortcut; monthly + daily multi-day ranges (no weekly/hourly); 30-day kitchen reclaim for monthly; renewals = one-tap 'Renew for next month' (Stripe Checkout fallback, NO auto-retries), with a kitchen option to let chefs opt in to auto-renew; admin controls; defaults adopted. Storage build after booking.
- **Owner (Oct 14): storage availability + manager occupancy tracking must be designed end to end** (currently none). The lead's framing: per-unit availability (unit count × date ranges, atomic assignment, separate from the session calendar) + a manager storage board (unit states Free/Reserved/Items stored/Move-out due/Holdover/Needs cleaning, occupant, dates, paid status, timeline, one-tap actions). Code Buddy is researching TFC/Neighbor/self-storage software/Skedda-Nexudus → availability & occupancy section.
- **Storage availability research DONE** (`research-storage-availability.md`; no peer does our exact hybrid — the design combines self-storage occupancy boards with Skedda/Nexudus date ranges). **Owner LOCKED the defaults** (auto-assign, chef-visible unit label, reserved hold + 7-day alert, pause listing + needs-cleaning, 'Available from', optional cleaning buffer off, no waitlist, manager storage board) with the guardrail: no overkill, minimal options, intuitive, uncluttered.
- **Owner (Oct 14): storage kitchen flexibility** — waive/charge holdover, early move-out with an optional refund, extend free/charged, invite a specific chef with a special price, one-off adjustments; all reuse booking patterns, in the rental's '⋯ More' menu so the board stays uncluttered. Recorded in `research-storage-structure.md`.
- **Damage claims v2 SHIPPED to dev** (commit 6b76d432; migration 0083 applied to dev; 0082 hash unchanged). The lead reviewed the money code: an unconfirmed on-session PaymentIntent (never off-session); the kitchen gets the full amount (the platform absorbs the fee); compensation draws on the platform balance with a balance check; persisted operation keys; a 23 h reconciliation fence.
- **Live test on dev (sandbox, synthetic users), Oct 14:**
  - claim #6 (booking 155): filed $83.50 (2 lines, receipts) → only kitchen + admin notified, chef saw nothing → admin Send to chef reduced to $70 → chef paid in one tap with the saved card → transfer `tr_3UQbUXC…` $70.00 to the Express account from the claim charge; a $2.89 fee recorded as a platform cost.
  - claim #7 (booking 159): the $275 cap redirect works → filed $120 → Ask kitchen for info → kitchen replied → back to review → sent $120 → chef disputed → admin Reduce and uphold $90 → `upheld_at` backdated 8 days → the chef dashboard showed the hold banner → the chef paid $90 → the hold lifted at once.
  - claim #8 (booking 152): Local Cooks pays the kitchen $25 → a platform-balance transfer; the chef was never contacted.
  - All support_actions show as `verified`.
- **Bug found live + fixed (lead):** the chef could see Local Cooks' first-review message to the kitchen ("Send to chef" note), the info request and the kitchen's reply, both in the booking-page card and in the chef notice. `publicClaim(…, 'chef')` now hides the review request/kitchen reply and shows the admin message only when the last admin decision isn't first-review; the chef notice drops kitchen-only messages. Test: `damage-claim-privacy.test.ts`.
- **Also fixed:**
  - chef status labels ("Waiting for your answer", "Paid · thank you", not "Sent to chef"/"Chef paid");
  - "Local Cooks approved $70.00 of the $83.50 requested";
  - the kitchen sees "You reported…";
  - the filing copy says "The visit's photos";
  - the admin queue `?` separators.
  - These ship with the design build (shared files with WP-C).
- **Polish noted for later:**
  - the admin case Money block uses kitchen wording ("Your payout"), and the policy block uses chef wording ("If you cancel now");
  - the admin claim "Reason" is free text (fine for the pilot);
  - "Report damage" is still offered after a claim exists (allowed: one claim per visit is not enforced in the UI).
- **Design consolidation build started:** WP-A booking page (Opus), WP-B visit + inspection pages (Sonnet), WP-C settings previews + notification consolidation (Codex Sol). Common brief `.phase0-harness/consolidation-brief-common.md`.
- **WP-C (Codex) finished its code, then hit the usage limit (resets Oct 20)** before writing its checkpoint.
  - Its final evidence on disk (`.phase0-harness/consolidation-c-*`): tsc clean, client failures = the 9 known ICU entries only, server failing set = baseline (+ inngest/bounded-smtp, which are network-only).
  - The lead reviewed the payout notice batching: the after-closeout path only; the notice moves to a post-commit flush keyed on a release tick with an advisory lock; replay-safe via `payoutSent.noticeQueued`; at_capture is untouched. OK.
  - WP-C acceptance is to be verified in the lead's screenshot pass together with WP-A/B.

## 2026-10-15 — Design consolidation: rounds finished, lead verification, Codex server review

- WP-A round 3 and WP-B round 2 (sent 2026-10-15 00:58, stopped by the Claude session limit) were resumed and finished in the morning. No work was redone; both agents continued their own transcripts. The owner stopped both agents once the code was in and the lead took over verification.
- WP-A: the payment card now says "Card hold" before capture. The total includes extensions, extra time and paid damage claims through a read-only `additionalCharges` field (`server/services/booking-additional-charges.ts`, chef + manager details routes). Booking 159 shows $166.00 = 30.50 + 30.50 + 15.00 + 90.00, matching `payment_transactions`.
- WP-B: calmer in-session panel (outline buttons, neutral progress, one link row), inspection header = chef identity + one-sentence deadline, no year on times, single check-in-code heading.
- Codex (GPT-6.1 Sol) read-only server review found 2 real bugs; Codex then fixed both, with tests:
  1. HIGH: the kitchen's private ask-info reply leaked to the chef through `damageEvidence.description`. Fix: reply attachments store no description; historical reply descriptions are redacted for chefs (files stay visible).
  2. MED: concurrent payout-notice flushes could permanently drop later lines (extensions) under one release tick. Fix: queue an idempotent supplemental notice for unrepresented transaction IDs; mark only represented rows.
  Codex confirmed one-claim-per-visit cannot race: filing holds the booking row `FOR UPDATE`.
- Lead fixes from live screenshots:
  - after checkout, the chef visit page no longer shows the pre-arrival "What to expect" card;
  - no duplicate departure instructions in session;
  - the collapsed check-in code uses an inline "Show code" link;
  - the chef pill after checkout reads "Checked out".
- Verification: tsc clean. Client suite = baseline (KitchenHero passes alone; load flake). Server suite = baseline (14 files / 48 tests). 44 screens × fold re-shot on fresh synthetic bookings 163/164/165 with no horizontal overflow.
- Noted, not changed: synthetic $0 bookings read "Total paid $0.00" (real bookings always carry an hourly price). In session, the sentence and the timer both state the end time when the chef checked in late (intentional: late arrival doesn't move the end).
- Pending: owner approval of screenshots → commit (explicit paths) → deploy to dev → live-check claim #7's chef evidence redaction and one-claim-per-visit.

## 2026-10-15 — Live dev walkthrough (build 1889ff01 → fed57042) and owner policy decisions

- Lead walked the full flow live on dev in the shared browser: discover → book (Stripe sandbox, equipment add-on) → kitchen accepts (per-item) → check-in with staff code → paid extra time (final-hour rule) → checkout → damage claim → Local Cooks ask-info → kitchen reply with file → send reduced → chef pays → inspection → payout. Booking #166 was time-shifted with the guarded `.phase0-harness/shift-booking.mjs` (synthetic chef 380 / kitchen 54 only; updates start/end, slots and the closeout snapshot).
- Money reconciled against Stripe sandbox: chef paid $61.00 + $15.26 + $70.00 = $146.26; transfers $54.94 + $13.52 (one notice tick) + $70.00 claim (Local Cooks absorbed the claim fee).
- Live-verified: claim privacy (kitchen-only reply text and admin kitchen message absent from chef page AND chef API), one-claim-per-visit (server 409), cancellation refund ($29.07 = $30.50 − actual $1.43 fee; one merged chef notice).
- 51 findings logged in `.phase0-harness/walkthrough-findings.md`. Batch A (Codex) shipped in fed57042: settings Save no longer blocked by the impact count (critical), honest "booking total" cancellation wording, claim-aware completed sentence, overnight list dates, manager claim policy wording, real check-in method, listing tour removed (owner request).
- Lead fixes (uncommitted at time of writing): manager payout headline double-counted extension money ($82.84 vs true $68.46) — extra lines now net of their own processing fee and never added to the payout snapshot.
- **Owner decisions:**
  - Kitchen response deadline: the kitchen must answer at least 1 hour before the chef's free cancellation ends (when that still leaves ≥30 minutes to respond); otherwise the 24-hour window / start buffer applies as before. The admin-controlled buffer and the card-authorization limit still cap it.
  - No post-confirmation free-cancel grace for last-minute requests (owner: startup, Stripe fees; matches The Food Corridor, which has only the kitchen's penalty window). Lead noted Turo gives 1 hour for trips booked within 24 h and Airbnb a 24-hour cooling-off for bookings ≥7 days out; not adopted. Last-minute and near-deadline requests rely on explicit checkout disclosure (`cpShort`, new `cpNearDeadline`).
  - Astra unavailable: Opus builds the booking-list redesign, Codex reviews; Code Buddy may use any of its models.
- **Lead correction (Oct 15):** chef extension requests were limited to the last hour of the booking (`session-extensions.ts` `finalHour`). This was never an owner decision (Oct 14: "the chef asks for more time with one tap"; The Food Corridor and Turo let guests extend an ongoing booking at any time) and it made "Need more time?" look broken live. Removed: chefs can ask any time while checked in; the kitchen still approves (or instant mode), and only free time is offered. Tests updated (36 pass).
- **Owner (Oct 15), legal identity:** brand "Local Cooks" everywhere; registered entity Jawrophi Delivery Inc. named only where legally needed ("Local Cooks, the operating name of Jawrophi Delivery Inc."); address 4 Priscilla Place, Paradise, NL. The public site's "Local Cooks Inc. / 14 Suez Street / localcook.shop" legal pages are wrong and must be replaced. Gap review: `policy-gap-review.md`; facts register: `policy-facts-booking.md`.
- **Owner (Oct 15), admin notifications:** admins must keep being notified of major events (startup control), in Local Cooks wording — not copies of the chef/kitchen message (test_admin had received "You cancelled your booking…"). Email only to admins with the email toggle on (dev: test_admin; prod: the admin address; any admin who turns it on). Tracked list (`server/services/admin-booking-notice.ts` `ADMIN_BOOKING_KINDS`): bookings & money — requested, confirmed, cancelled (who + refunded + fee kept + kitchen keeps), cancellation reviewed (incl. storage), refund issued, payout sent, payout on hold, payment recovery needed; problems — attendance/no-show reported, issue reported at checkout; plus the existing support/feedback/recovery/claim/licence notices (unchanged). Not tracked: reminders, check-in/checkout/inspection/visit-closed milestones, running late, instruction/code changes. Existing admin recovery alerts (booking, outcome, tour, reminder) were restored to their original recipients.
- **Refund wording (owner question, Oct 15):** after research (Airbnb: "full refund (minus service fees)" in the policy, fee as a receipt line; Peerspace: "minus a processing fee" in the policy), the chef's cancellation notice/email now leads with the refund ("Your refund of $29.07 is on its way. Banks usually show it within 5–10 business days."); the fee sentence is removed from notices. The cancel dialog (pre-consent) keeps the exact deduction: "Refund: $29.07 (your payment minus the $1.43 card processing fee)." Consistent with the earlier decision "emails show the total only".
- **Live verification of 12d639a2 (Oct 15, dev):** settings Save works on a fresh session ("Your 9 upcoming bookings keep their current terms"); chef/manager lists correct (Needs action 4, each with its action); booking form shows Stripe-matching lines (Kitchen time $25 · HST (15%) $3.75 · Service fee $1.75 · Total $30.50) and "· Booked" slots; Stripe button "Book" + card-hold note; response-deadline cap live (#168: "kitchen has until Oct 15, 4:00 p.m." vs free cancel 5:00 p.m., same in both server emails); admin emails only to toggled test_admin in Local Cooks wording (request / confirmed / cancelled with "Refunded $29.07. Processing fee kept: $1.43."); chef refund email "Booking cancelled · $29.07 refund on its way"; kitchen "TestSprite chef cancelled · Oct 16, 5:00 p.m. — that time is open again".
- Fix after live check: admin/kitchen "Booking confirmed" email estimated payout ignored the processing fee before Stripe reports it ($28.75 vs actual $27.32) → uses the same display estimate as the kitchen page until the actual fee is known.
- Owner request: chef booking page kitchen card now shows the full address, a small Leaflet map preview (coordinates from the cached geocoder, never blocking the page > 1.5 s) and "Get directions" (Google Maps directions) — Airbnb pattern.

## 2026-10-15 (evening) — Automatic triggers, WP-X review, integrity package

- **Automatic triggers (owner request):** V2 #176's inspection window auto-closed at the 18:00 tick and the kitchen was paid automatically ($27.32, Stripe transfer; kitchen/admin/chef notices; feedback requested). Request expiry (#173) and retained payout (#174) passed earlier. Found and fixed a scheduler lag: the 3-per-tick keyset cursor only wrapped after an empty page, so a due booking could wait an extra 30 minutes (#175). Short pages now wrap immediately (`server/services/worker-context.ts`).
- **WP-X (Codex) delivered:** declined saved card on extra time → inline "Your saved card was declined. Nothing was charged." + "Pay with another card" (Stripe Checkout for that one extension; manual capture for requests; late/unfit payments refunded automatically; new card saved for this booking only); visit page shows kitchen offers/charges. Migration 0085 applied to dev. Lead additions: receipts issued after extension payment/refund; open offers/requests withdrawn at chef check-out (#69).
- **Receipts (WP-R):** migration 0086 applied to dev (immutable `booking_documents`; GST/HST number setting left empty until the owner provides it).
- **Dead-end audit (Codex, read-only):** `.phase0-harness/dead-end-audit.md`, 32 scenarios, 9 High. Next package after WP-I.
- **External review triage:** webhook replay/out-of-order un-refund, decline-vs-webhook race, support console gate after completion, Book button during renewal, equipment-listing delete cascade — all confirmed in code → WP-I (Cursor Sonnet 5.5). Test-suite claim partly confirmed (47 failing server tests are pre-existing; split pending).
- **C8 early start (live, #178):** kitchen offered a paid 30-min early start → chef accepted → $15.26 charged (pi_3UQwRC…), booking moved to 8:30–10:00, check-in 8:15, total $45.76, clear notices. Client didn't refresh until reload (#93, verify visibly). Synthetic #163 moved to Oct 17 20:00 to free the slot.
- Handover written: `.phase0-harness/HANDOVER-2026-10-15.md`.
- **Owner decision (Oct 15), no-shows:** no-shows aren't refunded at any kitchen (including 50% late-charge kitchens), and checkout discloses it ("No-shows aren't refunded."); the chef's "I was there" path goes to Local Cooks review. Research: Turo's help article "Guest trip start failures" cancels a no-show trip with only a partial refund (minus 75% of a day / two days' cost), so a no-show costs more than a late cancel. Peerspace's official cancellation policy has no no-show rule, so the last tier applies (<24 h non-refundable). The Food Corridor's kitchens set their own terms (example: full charge under 48 h notice). Airbnb has no official no-show article; the community says the payout stands under the policy. Rationale: a no-show is never better than a late cancel, chefs are pushed to cancel (which frees the slot), and the kitchen's attendance report can't move money (no incentive to misreport). Supersedes finding #99's "apply policy %" suggestion.
- **WP-N delivered (Opus):** "No check-in recorded" end state for both roles (booking page, chef list, kitchen agenda); kitchen "Did they come? They came / They didn't come" within the inspection window; chef "I was there" → problem report; role notices replace "Visit finished"; rating only after a recorded arrival; checkout + booking page disclose "No-shows aren't refunded." (disclosure `food-corridor-v2`, server accepts v1 and v2). Money unchanged (payout eligibility never reads attendance). Lead follow-up #101: don't relabel legacy bookings.
- **WP-I delivered (Cursor Sonnet 5.5):** Stripe event ledger (`stripe_webhook_events`, migration 0087 applied on dev), monotonic paid status, `paid_at` never moved by replays; canceled-webhook leaves decisions to their owner; dead-end decisions surface in the support console with executable actions; support console keeps checkout/inspection actions while the inspection window is open; Book→"Renew documents" when blocked; equipment listings archive instead of delete (FK RESTRICT).
- **WP-U delivered (Sonnet):** 12 polish rows (#53 decline message to chef, #54, #62, #63, #70 extra-time history, #78/#79 booking rules scope + toast, #82–#86 claim UX/notices).
- **Test plan addition (owner, Oct 15):** kitchen offers extra time and the chef never responds → offer must expire automatically at the booked end with no charge, both sides told, no stale "Accept & pay". Run on #178 after G2 (request expiry); one open extension at a time.
- **WP-D round 1 (Codex, partial):** checkout paid-but-no-booking recovery (session-bound success page, `kitchen_checkout_incidents`, migration 0088 applied on dev); contextual support partially adopted. Round 2 (Sonnet) took the rest, deletion safety first: the dev schema cascades users→locations→kitchens→kitchen_bookings (plus chef_id, add-ons, extensions, claims), so deleting an account or kitchen erases booking/payment history (#110). This is a pre-deploy blocker.
- **G2 live (#178):** the chef's request for more time wasn't answered. The server refuses late approvals, but the request, the card hold and the time hold linger until the next 30-min tick, and the chef's page flip-flops (#109). WP-T (Cursor Sonnet 5.5) adds Inngest exact-deadline timers (`sleepUntil`) and a client closed state at the deadline.
- **WP-T delivered (Cursor Sonnet 5.5):** Inngest `deadline-timer` (event `localcooks/deadline.scheduled`, `sleepUntil(dueAt+5s)`) runs the worker's own idempotent expiry for one extension / booking request / closeout. Lazy-on-write expiry before a new extension. The client judges deadlines on server time: "{kitchen} didn't answer in time…" with Ask again / Message, no Accept & pay after expiry, the manager banner closes at the deadline. The worker tick stays the backstop. Deadlines more than 6 days out are left to the tick (Inngest sleep limit). Post-deploy: sync the Inngest app (`/api/inngest`) and confirm timer events arrive (send is fire-and-forget, same as notice delivery, which works on dev).
- **Pre-deploy review (Codex, read-only):** no Critical, 7 High, 2 Med (`.phase0-harness/predeploy-review.md`), lead-verified. Lead fixed #5 (own bug: short-page cursor wrap reset the cursor before rows were processed, which could starve recovery rows; it now wraps only at the short page's last record; test added). #2 went to WP-D round 2. Codex is fixing #1 (late failure webhook re-binds an old intent and blocks "Pay with another card"), #3 (atomic monotonic success), #4 (stale payment_failed demotes a captured payment), #6 (immutable original transfer amount for documents), #8 (late extension charge/refund receipts), #9 (arm timers entering the 6-day horizon). #7 (overstay obligation ledger duplicates) is pre-existing and storage-side, so deferred.
- **WP-D round 2 delivered (Sonnet):** deletion safety. Kitchens, locations and accounts are blocked while upcoming bookings, open claims or money in flight exist; otherwise kitchens/locations are archived and accounts anonymized, with history never deleted, an audited admin override, and `account_deletion_audit`. Migration 0089 is applied on dev, and no cascades remain on booking/claim tables. Also: goodwill latch recovery (#13); kitchen-caused cancellation commits first, then refund recovery (#12); aged claim-intent discovery (#18); at-capture transfer recovery worker (#14); amount-mismatch dead end; a separate captured-before-release action; review finding #2 fixed. Open: auto-refund on amount mismatch (kept detect-and-notify), an admin "start over" for claim payments under review, no self-serve account deletion endpoint exists, `user-deletion.postgres.check.ts` is outdated.
- **Checkout wording (owner reminder):** before confirmation it's a card hold, so withdrawal is 100% free (live #179). After confirmation the refund deducts the card fee, so the headline reads "Cancel for a refund until …", not "Free cancellation", and Details opens with the free-before-confirmation line.
- **Offer expiry live (owner request):** passed (#122). **Overstay grace:** no extra-time charge within the booking's saved 15-min service-end grace (Turo: free up to 29 min; Peerspace: 30-min blocks); past it, 30-min blocks from the booked end (#123). Pre-deploy review fixes (Codex) landed with negative-control proofs for findings 1, 3, 4, 6, 8, 9.
- **Batch committed and pushed (Oct 15, ~22:15):** `d5fd349f` on `development` (WP-I, WP-T, WP-X, WP-R, WP-N, WP-U, WP-D r1+r2, #52, pre-deploy review fixes, lead fixes). Pre-push: tsc clean. Server suite: 39 failures, all pre-existing at HEAD cb865fe9 (verified in a clean worktree: tour mail, decision-ordering, delivery-visibility, booking-conversation) after fixing two stale mocks (consecutive-bookings `db.update`; retired confirm-checkin 410). Client suite: 5 failures, pre-existing (TourChatButton, ManagerInspectionPage #118). Migrations 0084–0089 applied on dev before the push; prod needs the owner's go-ahead.
- **Live verification after deploys d5fd349f / f5945dfb (Oct 15, 22:15–23:05), visible tab:** exact deadline (request closed 5 s after its deadline by the Inngest timer, one notice each side, chef "didn't answer in time … hold released"), withdraw-at-checkout, visit-page offers, extension history rows, check-in method "code", new checkout consent, session-bound success page, receipts list (#175 net $19.76), and the **declined saved card → Pay with another card → Stripe Checkout → time added, new card saved on the booking only, receipts LC-R-000009/10** (#134). Fixes from these checks: statement waits for the 72-h claim window (#125), "View receipts" label (#126), CTA overflow (#124), declined message shown once (#135), "charged to your card" (#136), "Billed as 30 minutes" note for sub-30-min picks (#137).
- Incident (lead, ~22:40): removing a temp HEAD worktree whose node_modules was a junction emptied the main node_modules; restored with `npm ci` (no source/data loss). Memory note added.
- **Oct 16, 00:20 — handover refreshed** (`.phase0-harness/HANDOVER-2026-10-15.md`). Since the big batch: worker fixes (1a6334b7: due closeouts never wait behind timer arming; chat digests back off and give up), kitchen refund notices in plain words (cd552556), inspection-closed copy (99b972c5), offer-open state + KB reference on success page (11fedb0e). Pending at handover: confirm the 00:30 tick cleared #161/#178/#182 and run the #182 no-show flow live.

## 2026-10-16 (early) — Section 5 checks, no-show live, reschedule decisions

- **Worker (section 5):** the 00:00 NDT tick still failed on chat because `1a6334b7` was pushed 36 s after it started (old build). The **00:30 tick passed**: `clockCloseout processed 2 / changed 2 / armed 21`, `taskFailures: []`. #178/#182 closed out (#161 earlier). #142/#143 verified live.
- **#182 no-show live:** role notices instead of "Visit finished", no rating request, kitchen "They didn't come" → chef "PHASE0 Main Kitchen reported you didn't arrive. No-shows aren't refunded…". Fixes `3863a3dc` (findings #150–#155): raw "bdContactSupport" label (owner spotted it), chef "I was there" now opens the problem report framed for the dispute, equal "They came / They didn't come" pair, payout line, "No-shows aren't refunded" in the kitchen dialog (owner rule), named notices, admins told about no-show reports. Verified live: dispute report #11 reaches kitchen, admins and chef.
- **Owner (Oct 16), admin notices:** in-app goes to every admin; email only to admins with the email toggle (`admin_email_notifications`). Bounce-recovery alerts: keep as is. Contact emails on booking pages: keep (transparency).
- **Owner (Oct 16), changing bookings — build it (finding #161).** Today "Cancel or change" only cancels; the change engine's opener was never wired and the server has refused changes since Oct 5. Research (help pages): The Food Corridor (pencil → "Update"/"Request Change"; before the kitchen's cancellation window: move/extend/shorten/equipment; inside it: extend/add only, or request anything with manual approval; declined = booking stays), Peerspace "Update Booking" (until 1 h before; host has 2 business days; lapsed = original stays), Airbnb trip change request (both totals shown; difference charged on acceptance), Turo "Change trip".
  - Confirmed bookings: the chef can request a new date/time/length **until the kitchen's free-cancellation deadline**; **the kitchen always approves**; response deadline = the new-request rule (≤24 h and ≥1 h before the chef's free-cancel deadline), every edge case covered; declined/expired = booking unchanged, both told. Money (Oct 13 rule): price up = charge the difference; price down = refund the difference minus the non-returned card fee on it; same price = nothing moves.
  - **Free-cancel deadline follows the new time** (owner: keep it simple). Lead agrees because every move needs the kitchen's approval and moves stop at the cancellation window; the kitchen's approval shows "Their free cancellation would move to {date}". (Lead correction: Food Corridor's article doesn't state which deadline applies after a change; earlier remark was an inference.)
  - **Single-visit bookings first**; multi-visit shows "To change these dates, message the kitchen or contact Local Cooks."
  - **Pending requests: rebook first, old closes after** (Airbnb "Withdraw request" and Peerspace withdraw-at-no-cost both mean withdraw + rebook; none edits in place). "Change request" opens booking pre-filled; the old request is withdrawn automatically only once the new one is sent; history on both sides; the kitchen gets one "changed their request" notice; the second card hold is explained.
- **Owner (Oct 16), cancel dialog money line:** headline + breakdown ("You'll get $29.07 back" · See breakdown: Paid · Card processing fee, not refundable · Refund) + policy link; the deduction stays visible before consent.
- **Owner (Oct 16), refund-deadline wording:** "After that, there's no refund" read abrupt. Lead pushed back on implying a refund is always possible (Peerspace: "not refundable" inside 24 h; Airbnb shows a non-refundable date; terms must be clear before booking), but agreed on tone. Now: "Cancel by {deadline} for a refund, minus the {fee} card processing fee. After that, this booking isn't refundable." (no exception line — owner). Also dropped "full refund minus" (contradictory) and "free-cancellation deadline" in late/past lines ("The refund deadline passed on {deadline}…"), en/fr/uk, chef + admin variants.
- **Owner (Oct 16), inspection button:** "All good — finish and send my payout" → neutral "Finish inspection" with one line under it (Turo uses neutral "Report Damage"/"Report Issue"). Shipped a939a341 with the cancel headline + breakdown (verified live on #185: "You'll get $29.07 back", refund LC-RF-000023 −$29.07).
- **Owner (Oct 16), kitchen debt after a payout was sent:** record + notify only for launch (the chef is refunded from Local Cooks' balance; the kitchen's share is recorded as owed; kitchen and admins notified; Local Cooks recovers manually). Netting from the next payout (Airbnb/Turo pattern) deferred.
- **Lead correction (Oct 16):** add-on removal follows the booking's own late tier after the refund deadline (50% kitchens refund 50% of the add-on minus its card-fee share; 100% kitchens refund nothing). The WP-AO brief had wrongly said "not refundable" for all; fixed in the review round. Admin support console must get "Retry refund" / "Mark refunded after checking Stripe" for failed automatic refunds (owner requirement).
- **Status (Oct 16, ~03:40):** WP-RB built → Codex review (2 High, 7 Med/Low; High #1 lead-verified) → Codex fix round running. WP-RS built → Codex review (9 High, 5 Med; #4 lead-verified, #14 rejected — the sk_test guard is for scripts, not product code) → Codex fix round running (+ carry per-session equipment when moving). WP-AO built on branch `t3/addon-cancellation` → Codex review running. Lead built the change UI (`KitchenBookingChanges.tsx`: dialog + Now-card rows; "Change date or time" / "Cancel booking" split), claim-pause banner with amount, `?changing=` slot exclusion. Webhook replay passed (#181).
- **Oct 16, ~04:15 — session paused by the owner.** Shipped tonight: 3863a3dc, a939a341, 0f99fab9, 32482f91, 56042453 (rebook-first). WP-RS and WP-AO fix rounds were cut off by the Codex usage limit (resets 7:00 AM); state and exact resume steps are in the handover §7c.

## 2026-10-16 (day) — Rebook-first live, "can't get in" end to end, 8A findings, WP-RS/WP-AO fix rounds

- **Rebook-first live (#187 → #188):** change request, 4242 checkout, old hold canceled in Stripe, new $61.00 hold, one kitchen "changed their request" notice, histories linked (#182). Fixed the replaced request's page/notices (8da9cd9d: "Changed", links, chef notice opens the new request, deadlines name the zone). Build break from a `-U0` partial stage fixed in 34bbd40b (lesson saved: esbuild the staged blob, watch the Vercel commit status).
- **Race edge cases live:** kitchen accepts the original while the chef pays — same hours → "That time is no longer available", new hold canceled at once (#189); different hours → "You now have two bookings…" (#190/#191). The checkout result no longer shows Stripe session ids to chefs (c08398ce).
- **"Can't get in" end to end (#189 shifted to now):** report → kitchen + all admins (email only toggle-on admin) + chef; per-reader translated notices with the real reference; "Message kitchen" with a ready message on the check-in screen; top-of-booking alert (ends at check-in; safety stays); admin claim → acknowledge → resolve lifted the payout hold; kitchen finished the inspection → $27.32 transfer (Stripe tr_…Z08 = 3050 − 143 − 175) (c08398ce, f07bac88).
- **8A findings closed:** #170/#171 claim pause up front (booking page "New bookings are paused", dashboard "Pay $X to book again", paused wording, upheld notice has the pay-by date); #159 "I was there" = attendance category (migration 0090, **applied to dev; production needs it before deploy**); #160/#167/#168 labels; #96 kitchen name on message notices (functions redeployed to the staging trigger, verified live); #128 the real "no extra time" reason; #172 friendly delete-guard references; #144 lead decision (deliver later notices even without a recovery owner; test updated); #98 already resolved by the settings rework. New-request kitchen notice names the chef/time/deadline (verified live).
- **WP-D leftover:** support "Start the chef's payment over" for a claim payment held for review (88a02620).
- **Open for the owner:** #119 pending-request chat (recommend allow), #77 goodwill across extra-time payments (recommend later), WP-D auto-refund on capture mismatch (kept detect-and-notify), self-serve account deletion, lead decision on change refunds that can't be applied (Local Cooks absorbs; owner may override), 8B scope.
- **WP-RS / WP-AO:** Codex re-review of WP-RS (10 fixed, 3 partial, 2 High + 2 Med new) → Codex fix round 2 hit the usage limit → finished by Cursor (gpt-5.6-sol): compensation-refund retry, admin `close_keep_refund`, no 20-adjustment payout cap, change-destination refund receipts; 280 connected tests pass (lead-run). WP-AO fix round finished by Cursor in its worktree (6bfae2cd, 12 findings; 195 server + 55 client tests).

## 2026-10-16 (afternoon) — Invitations + Customers merged and live, chargebacks end to end, storage decisions and plan

- **Invitations (WP-INV) merged** (cf5d6226 + a34de4eb). Lead review fixed the Cursor server before merge: Back-from-Stripe restart (old checkout closed, fresh one), per-hold Stripe idempotency key, no "new request to review" notices for a paid invitation, per-reader translated notices (admins see "Invitation sent" with the listed price when discounted; a paid-but-taken checkout reaches chef + admins through the checkout safety net), the same cancellation summary + consent line as normal checkout, **equipment add-ons before paying** (quote + checkout take equipmentIds; no add-ons keeps the exact offered total), event-driven invitation notice delivery (`invitation-notice-delivery`, debounced; Inngest app synced), payment page "Your booking is confirmed" for invitations, "not available" instead of a $1 price error. Migration 0091 applied on dev.
  - **Live (dev, sandbox):** kitchen invited chef 380 for Thu Oct 22 1–3 p.m. at $45 (list $50) → chef added the $25 oven → Stripe Checkout $85.40 (kitchen $45 + oven $25 + tax $10.50 + fee $4.90) → booking **#194 KB-7J9SX6 confirmed + captured**, invitation accepted, payout after closeout; notices: chef "invited you to book", 5 admins "Invitation sent … listed $50", admins "Booked through the kitchen's invitation", kitchen "TestSprite chef paid. The booking is confirmed."
  - Bug found live: the onboarding context strips any `?locationId=` from manager URLs → invite link now `?location=`.
- **Customers v1 (WP-CU, Sonnet) merged** (5626c505); migration 0092 applied on dev; 67 server + 9 real-SQL + client tests green; mobile 390 px checked live (no overflow); contrast fixed in the shared Badge (success/warning/info text) and the active filter chips.
- **#195 change-engine errors translated** (DeepSeek, 72 keys) merged (ce7503c1) + a type fix it missed.
- **Codex money review** of invitations + WP-AO/WP-RS merge: 3 P1 (stale expiry webhook invalidates a newer checkout; eligibility loss strands the hold; a successful support refund retry can't reconcile) + 3 P2 (acceptance continuation, invitation completion retry, policy version not sent) → Codex fix round running.
- **Chargebacks end to end (owner pilot policy: Local Cooks absorbs; answer in the Stripe Dashboard)** (1293d185): test card 4000000000000259 on **#195 KB-DJGQMP $30.50** → dispute "fraudulent" (+$15 Stripe fee) → booking flagged, refunds paused, admins notified with amount/reason/deadline/link; kitchen payout no longer held by a chargeback; sandbox "losing_evidence" → **lost** → flag closed automatically, admins: "Chargeback lost · KB-DJGQMP … Local Cooks absorbs $30.50 plus the $15.00 dispute fee; the kitchen's payout is unaffected." Policy register §5a.
- **Storage: research (3 rounds) + owner decisions + plan** — `research-storage-lifecycle-2026-10.md`, `research-storage-money-notice-2026-10.md` (Stripe 90-day hold for Canada verified; RPAA needs counsel), `research-storage-policy-ux-2026-10.md`, `plan-storage-rentals-2026-10.md` §7: standalone rentals, 30-day platform max (kitchen may lower), daily price only, chef taps to extend (no auto-renew), 5-day grace then accruing holdover the kitchen raises or waives, removal review at 15 days, kitchen disposal after LC notice (48 h / 7 days, toggle until counsel), reclaim 7 days' notice (≤7-day rentals not reclaimable), no deposit, before-start cancellation reuses the kitchen's booking policy, never-moved-in = no-show, **kitchen paid at the end of each paid term**, no new cron (Vercel Hobby CPU).
  - Build started: WP-ST1 (Opus: migration 0093 + shared rules), WP-ST3 (DeepSeek: notices + `storage` i18n). Cursor Grok: user-deletion check + new tables.
- **Open for the owner:** brand button contrast (white on #F51042 ≈ 4.0:1, below 4.5:1 for normal text; #E00A38 passes); a test inbox for dev emails (dev `.test` addresses bounce → "delivery recovery" notices).
- **Overnight hours verified live (owner request):** kitchen 54 Monday set to 09:00–01:00 (restored to 06:00–23:00 after). Chef UI offered 11 p.m.–12 a.m. and 12–1 a.m.; booked **#196 KB-SHKDJ3** Mon Oct 26 11:00 p.m.–1:00 a.m. ($50 + $7.50 HST + $3.50 fee = $61.00); stored as operating day Oct 26, slots 23–00 + 00–01, window start 09:00; refund deadline Sun Oct 25 11:00 p.m.; kitchen review/approve read the same; captured; chef page "Mon, Oct 26 · 11:00 p.m.–1:00 a.m. · 2 hrs · Newfoundland Time", arrival details "Oct 24 at 11:00 p.m." (48 h), receipt $61.00. Found and fixed: the invitation form had a fixed 6 a.m.–10 p.m. start list (2e8d4e6e: kitchen's real hours per day, overnight included, booked hours marked) — verified live.

## 2026-10-16/17 (night) — Storage WPs merged (ST5–ST11 + listing form), live storage walkthrough on dev

- **Merged to development:** ST5 extensions (4fadeca5), ST7 lifecycle (ea2fd360), ST6 term payouts (bdca8afa — Codex fixed a PGlite deadlock: transfer helpers read global `db` inside a transaction), ST10 chef screens (e372d87e), ST11 kitchen board (b74c44a1), ST8 move-in/out + problems + claims (60649ec5, Codex high), simplified listing form (79d939b4, Sonnet; owner item 11), ST9 kitchen/admin tools + per-unit out of service (Codex medium; merging). Every merge: targeted tsc + PGlite (88) + server/client files one at a time.
- **Migrations on dev:** 0095 storage `size_label`, 0096 unit service state (both additive; prod pending owner go-ahead).
- **Garbled translations found + fixed:** an earlier Codex write saved fr-CA/uk (and 2 en-CA) storage strings through a non-UTF-8 shell (`?` for ’ · and all Cyrillic; e.g. uk "?? ?? ???? ..."). DeepSeek re-translated 87 keys (placeholders verified) and `scripts/i18n-lint.mjs` now fails on garbled text.
- **Live walkthrough (dev, sandbox), rental #43 SB-KH3ZBQ on listing #53:** chef request page (dates, 1–30 days, total $12.82, owner disclosure verbatim) → Stripe 4242 hold → kitchen + all admins notified → kitchen board (summary strip, request card, every unit) → Approve sheet with amount → captured $12.82, payout $12.08 scheduled Oct 23 (end of term) → chef move-in → active, kitchen notified.
  - Fixed from the walkthrough (c3bda391): chef page said "Extend to keep your unit" with no Extend button (server never offered `extend`); kitchen page showed the chef's $12.82 as its payout (now its net); move-in dialog showed Oct 15 for Oct 16 (date-only parsed as UTC); storage page now says the kitchen's booking cancellation policy applies to storage (owner); kitchen request notice shows the total; "0 photos added" → "no photos added"; chef approval said "1 at {kitchen}".
  - Still to polish: board title "My Storage Bookings" (title case) and the legacy "Storage Check-In / Check-Out" section still mounted (ST12 removes); chef "answers by" time lacks the zone in the notice.

## 2026-10-17 (early) — ST9/ST12 merged and live; storage rehearsal continues

- **Merged + live:** ST9 kitchen/admin tools (007ef0d0, migration 0096 on dev), ST12 server cutover (Codex WIP stopped at its usage limit → finished/verified by Claude Opus; restored a dropped import that would have broken every kitchen booking request; old clients sending storage get 400; 0094 written, not applied), ST12 client cutover (DeepSeek; −9.6k lines legacy UI), 4 stale test fixtures fixed (Sonnet).
- **Live checks (dev):** one-tap extend with the saved card ($12.82, second term pays out at its own end); listing full → board 2/2, chef "Available from Oct 28", full dates now greyed; unit out of service → chef "Full right now", put back; kitchen booking with oven still $61.00 hold (KB-CUM9TY), no storage step, confirmation offers "Need storage too? Add storage"; move-out → kitchen Clear → ended/cleared, payout eligible at once (kitchen inspected); holdover (shift-storage.mjs −20 d): chef "3 days past your paid time … up to $5.18", kitchen Charge holdover → $5.18 request, chef + admins notified; chef paid via Stripe.
- **Fixed from the rehearsal:** Clear move-out returned 400 (operationKey vs strict schema); chef could not pay a holdover (legacy "removal confirmed" gate); payout shown to the kitchen was the chef total; saved-card disclosure added; summary excludes out-of-service units.
- **In progress:** holdover paid/failed notices (legacy ones leaked `pi_…` ids to chef/kitchen, wrong amount without tax, duplicates, no admin notice) + Stripe line item/return URL — Claude Opus; chef copy for move-in/out dialogs + holdover box — Claude Sonnet (DeepSeek returned empty twice).
- **Owner Q&A:** one-tap extend = Stripe card on file (`setup_future_usage: on_session`), charged only when the chef taps, 3-D Secure on the spot, decline → "Pay with another card" (Airbnb/Turo/Neighbor pattern). Kitchen session + equipment book together; storage is rented on its own (Food Corridor pattern) with pointers on the kitchen page and booking confirmation. Kitchen clear releases the payout at once; a claim is still possible within 72 h of move-out and is paid by the chef.
- **Holdover verified end to end (dev, #43, record #4):** kitchen Charge holdover → chef box "PHASE0 Main Kitchen asked you to pay $8.63 for 5 extra days after Wed, Oct 7 · Pay or dispute by …" → Stripe "Holdover · Dry shelf (live test) CA$8.63" → back on /storage/43 → ONE payment row (175), ONE translated notice each to chef, kitchen ("sent to your Stripe account now, less the card fee and the Local Cooks commission") and all admins; no Stripe ids. Owner (Oct 17): holdover money goes to the kitchen at once. Fixed on the way: chef box showed pre-tax $7.50 and the day after paid-through; duplicate payment rows on obligation payments (advisory-locked find-or-create by intent); dev row 174 is a leftover duplicate of 173 (left as is).
- **Owner (Oct 17):** nothing touches production until the lead says both bookings and storage are end to end at parity AND the owner's team has tested on dev. Harnesses now: Cursor Auto, Code Buddy Step 5 preview (DeepSeek at limit), Claude sparingly; Codex back Oct 22.
- **Reclaim verified (#45 SB-3MDRGW, 14 days):** "Ask to move out by" preview → Oct 24 (7 days' notice), 6 unused days, chef refunded $10.98 at once (kitchen-funded $10.35 + LC fee share $0.63), chef/kitchen/admins notified. Fixed: kitchen page still showed the pre-refund payout (now net of kitchen-funded refunds, like the transfer).
- **Problem holds payout verified (#45):** storage problem reports all failed (500) — 0093 left commitment_problems' booking-or-tour CHECK → **migration 0097** (one of booking/tour/storage; applied to dev). Then report → payout "On hold: problem open". Audit: support_actions/booking_flags already allow storage; storage end reasons all allowed. Lesson: PGlite tests build from the Drizzle schema, so DB-only CHECKs are invisible to them.
- **Storage chargeback verified (#46 SB-AW94FH, $102.48, card 4000000000000259):** flag + 5 admin notices (bank reason, Stripe deadline); kitchen not told; payout not held (LC absorbs, pilot).
- **Found, being built (Cursor Auto):** no screen lets the kitchen file a storage damage claim (server routes exist) or shows claims on the rental. Polish noted: problem dialog says "Booking #45" instead of the storage reference.
- **Damage claim after clear verified (#44 → DC-89XE7K, $40, receipt):** kitchen "Report damage or extra cleaning" (new screen, Cursor Auto) with "No move-in photos were taken."; claim in Local Cooks review; chef sees nothing until reviewed; payout already sent is untouched.
- **Payout promise fixed:** approval notice said "You'll be paid $12.08" but the kitchen got $11.31 (actual card fee $0.77, kitchen-borne per policy §5) → notice now says "less the card processing fee"; the rental page already showed the net.
- **Removal review + final notice verified (#43):** worker moved it to removal review at ≥15 holdover days (chef, kitchen, admins told); admin "Send final notice" (reason, photo links, items with perishable flag) → chef told perishables after 48 h, others after 7 days; kitchen told when it may act; disposal toggle stays off until counsel.
- **Polish batch 2 → Cursor Auto:** storage reference in problem dialog, move-in/out wording in claim form, admin status labels + actions filtered by state, removal-review/final-notice wording, time zones in notice times, kitchen extension payout line, stale "extend before" line during holdover.
- **Kitchen-booking final pass (dev, #197 KB-CUM9TY):** kitchen accept → $61.00 captured; chef removed the oven → $29.22 refunded at once, kitchen "payout −$27.47", admins see card fee kept $1.28 (WP-AO verified). Change to 8–10 a.m. (WP-RS): preview "You'll pay $30.50 more", hold, kitchen approve → **failed after capture**: DB trigger `protect_booking_cancellation_snapshot` refused any snapshot edit, but a change moves the snapshot's session time → **migration 0098** (terms immutable, sessions movable; applied to dev, proven: sessions OK, version/NULL refused). Stuck change finished via the admin recovery endpoint → booking now 8–10 a.m. Found: no admin screen for change recovery (Cursor building); change quote still counts a removed add-on (total_price 7500 instead of 5000) and the chef page shows "Total paid $61.00" ignoring the $30.50 change payment (Codex high fixing). Also: silent form when a length no longer fits a later start → hint added. Booking copy no longer calls storage a booking add-on.
- Codex back (Oct 17).
- **Booking final pass closed (Oct 17):** Codex fixed the change quote after an add-on removal (only active add-ons) and the chef payment summary (#197 now "Total paid $91.50 · Refunded $29.22"); #197 total_price corrected on dev to 5000. Admin change-recovery screen merged. Policy register rows (add-on removal, change confirmed, change pending) → verified. Team test plan written: `team-test-plan-2026-10.md`. **Heads-up given to the owner: both bookings and storage are end to end on dev and ready for the team test.** Production still untouched (migrations pending owner go-ahead after the team test: 0084–0093, 0095–0098, then 0094).
