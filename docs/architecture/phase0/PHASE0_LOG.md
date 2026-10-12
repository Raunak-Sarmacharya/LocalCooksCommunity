# Phase 0 master log (kitchen booking redesign)

Single source of truth for everything done, decided and pending in Phase 0. Read this first when resuming.
Last updated: 2026-10-12.

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
- Bookings 114 (paid → cancelled → refunded), 115 (voided by the C1 race), 116 (pending → cancelled by the chef).
- Outbox events 20–25 (these bookings; undeliverable `.test` recipients), two R2 objects, APPLICATION-67.
- Local harness files.

## 4. Owner decisions (final unless reopened)
| # | Topic | Decision | Date |
|---|---|---|---|
| D1 | Klarna/BNPL | Off for kitchen bookings (`payment_method_types: ['card']`, both checkout paths). Stripe also bars Klarna for B2B. **Done.** | 10-11 |
| D2 | Service fee | Admin-configurable; **0% in pilots and must not surface anywhere when 0**. Local Cooks is GST/HST-registered, so HST on the fee applies when > 0. | 10-11 |
| D3 | Kitchen tax | Set by the manager and passed to the manager. Local Cooks doesn't collect kitchen tax on its own account. | 10-11 |
| D4 | Before confirmation | Card hold only; chef cancel releases it, 100% back, nothing charged. | 10-11 |
| D5 | After confirmation, before the window | **Self-serve**, instant cancellation with an automatic refund. No manager approval. The **actual Stripe processing fee is non-refundable** and must be disclosed before payment and shown as an exact amount on the cancel screen. Research supports this: Peerspace retains fees "in all cancellations". | 10-12 |
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

## 8. Open questions for the owner
1. Short-notice requests: make the manager's deadline the earlier of 24 h or a fixed lead before start (structural; recommended), versus raising the default minimum notice.
2. Platform service fee inside the window when > 0: refund it proportionally to the manager's discretionary refund? (Moot while it's 0%.)
3. Deliverable mock inboxes for dev testing (e.g. plus-addresses on a Local Cooks mailbox), or keep the local SMTP sink plus `test_admin`?

## 9. Next steps
1. Commit and push the worker, email-retry, deposit and Klarna changes to `development`; measure worker timings on Inngest.
2. Continue the scenarios in §5 ("not yet exercised") with the local harness (`NO_STRIPE_LISTEN=1`).
3. Review the Codex policy design; turn it into the Phase 1 plan.
4. Fold §7 into the evidence pack and backlog.
