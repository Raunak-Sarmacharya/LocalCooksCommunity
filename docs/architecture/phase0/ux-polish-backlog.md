# UX / UI polish backlog (running log)

Every rough edge found while walking the product, including small ones. Bar: it should feel as finished as Airbnb.
Severity: **P1** blocks trust or correctness · **P2** clearly unprofessional · **P3** polish.
Status: open unless marked. "Seen" = where it was observed during Phase 0 testing (2026-10-11/12, local harness on the dev DB).

Continuation precedence: [continuation-handoff.md](continuation-handoff.md) qualifies historical owner decisions and deployed-version observations below. Universal pilot 0% and tax-registration/agency assertions are not established by the recovered owner messages. Full pages are preferred for substantial booking tasks; dialogs are reserved for focused confirmations, alerts and short actions.

## Decisions already made by the owner (apply everywhere)
- Refer to the person booking by **name** ("Hi Priya", "Priya requested…"), never "Chef" as a greeting or generic noun in user-facing copy.
- The company is **Local Cooks** ("we") in user-facing copy, never "admin".
- Platform service fee is admin-configurable; **0% during pilots and must not surface anywhere when 0**. Local Cooks is GST/HST-registered, so when the fee is >0, HST on the fee applies.
- Kitchen HST is set by the manager and paid through to the manager; Local Cooks does not collect kitchen tax.
- Klarna is off for kitchen bookings (done: `payment_method_types: ['card']` in both kitchen Checkout paths).
- Manager response window: 24 h (already hard-coded `AUTH_EXPIRY_HOURS`; not admin-controlled).
- Cancellation (2026-10-12): self-serve after confirmation; the actual Stripe processing fee is non-refundable once confirmed (disclosed before payment, exact amount on the cancel screen); inside the kitchen's window the manager decides any discretionary refund, up to total minus the Stripe fee. The policy is structured, versioned and snapshotted per booking.
- Damage deposits removed for now (done 2026-10-12).

## Manager onboarding
| # | Sev | Issue | Seen |
|---|---|---|---|
| O1 | P1 | **Stripe return lands in the wrong place.** "Connect with Stripe" opens a new tab. Stripe's return URL (`/manager/stripe-connect/return?...&from=setup`) loads in that new tab, which drops the manager back on step 1 ("Business details & licence" review) instead of the payout step or "Setup complete". The original tab is left stale on "Complete Stripe Setup to Continue". Expected: same-tab redirect (or the opener tab auto-advances), landing on the payout step with a "Payouts connected" confirmation. | manager setup |
| O2 | P2 | "Setup Complete" is shown while the listing still has 2 required blockers (kitchen and storage arrival/departure setup) that onboarding never asked for. Either collect them in onboarding or say "1 step left before you can list". | dashboard |
| O3 | P2 | Re-entering setup restarts at step 1 rather than resuming where the manager left. | /manager/setup |
| O4 | P2 | Kitchen tax rate (HST) is never asked during onboarding; it's empty by default although payout copy talks about "the HST you charge". | Details & Pricing |
| O5 | P3 | Equipment dialog "Create your own" subtitle says "Start from a blank **storage** listing". | equipment step |
| O6 | — | ~~Damage deposit set per item but never shown~~ **Resolved:** deposits removed (form field, list badge, legacy charge path, marketing claim). | equipment step |
| O7 | P2 | Two separate controls for one requirement: arrival/departure notes live on one page, the per-kitchen "tracking" switch on another. The listing checklist says "Fix" but doesn't lead to a single place. | listing review |
| O8 | P3 | Name shown is the auth display name ("Welcome back, TestSprite"), not the person's name captured in onboarding. | dashboard |
| O9 | P2 | Payout explainer: "your payout is your rate plus the HST you charge, minus that fee". Needs to match the actual model and say when money arrives. | payment step |

| O10 | P2 | Login defaults to a passwordless email link; when it can't be sent the only message is "Sign In Failed — Unable to sign in at this time. Please try again later." Say what failed and offer the other method. Password lives under "Try another way". | chef + kitchen login |
| O11 | P2 | Login showcase panels show fabricated figures and claims ("12 nearby", "$4,286.40 revenue", "5.0 · 124 reviews", "Chef support 24/7", "Every kitchen certified"). Use real or clearly illustrative content; don't promise 24/7 support unless staffed. | /auth, /manager/login |

## Admin
| # | Sev | Issue | Seen |
|---|---|---|---|
| A1 | P1 | Date-only values show one day early (licence expiry 2027-10-15 shows 10/14/2027). | Kitchen Licenses |
| A2 | P2 | Licence card shows "View License" next to "No document"; other kitchens show "Error loading document" twice (R2 off locally; check on dev). | Kitchen Licenses |
| A3 | P2 | No record of which admin approved a licence (`kitchen_license_approved_by` null). | DB |
| A4 | P3 | Application review lists raw keys ("BusinessName", "UsageFrequency few-times-month"). | Review Application dialog |

## Chef discovery and application
| # | Sev | Issue | Seen |
|---|---|---|---|
| C1 | P1 | Price shown as "$25/hr" before mandatory fees (drip-pricing rule). Show the all-in price when the fee is >0. | Discover, listing |
| C2 | P1 | Listing cancellation summary says "100% refund before confirmation" and the policy text is hedged ("may be retained", "review your outcome"). Needs exact, structured policy. | listing, booking page |
| C3 | P2 | Expiry date pickers are month-by-month only (8 clicks to reach next year); add month/year selects or typed input. | document upload |
| C4 | P1 | Chef-chosen expiry 2027-06-15 shows 6/14/2027 to the manager (same date bug as A1). | manager request detail |
| C5 | P3 | Kitchen tours aren't offered on the listing when the manager hasn't set them up; no hint that tours exist. | listing |

## Booking and checkout
| # | Sev | Issue | Seen |
|---|---|---|---|
| B1 | P1 | "Taxes & non-govt. fees" lumps HST with the service fee. Show "HST (15%)" and "Service fee" separately, and hide the fee row when 0. | booking summary |
| B2 | P2 | Equipment dialog arithmetic: "Booking total $61.00 + Equipment $25.00", then "TOTAL $91.50" (tax/fee on add-on hidden). | equipment dialog |
| B3 | — | ~~Damage deposit never disclosed/collected~~ **Resolved** by removal. The legacy `/payments/create-intent` would have charged it inside the payment total; also fixed. | equipment step/checkout |
| B4 | P2 | Slot picker has no time-zone label; the booking page says "Newfoundland time". Inconsistent. | time step |
| B5 | P3 | Time formats mix "10:00 AM" and "10:00 a.m." across summary and slots. | booking flow |
| B6 | P1 | Card is saved for "future payments" (Stripe consent text) but the app never explains why (damage/overstay) before checkout. | Stripe Checkout |
| B7 | P2 | No explicit terms acceptance on the review step; the cancellation deadline isn't restated before paying. | review & pay |
| B8 | P2 | Checkout merchant name shows "Kitchen.LocalCooks Test" (sandbox); confirm production shows "Local Cooks" and a clear statement descriptor. | Stripe Checkout |

## Booking management (chef)
| # | Sev | Issue | Seen |
|---|---|---|---|
| M1 | P1 | Cancel sheet shows the deadline but not the refund amount; chef can only "request" even outside the window. | cancel sheet |
| M6 | P1 | Inside the window the chef can't cancel at all (`bookings.ts` ~2229 returns 400 "cannot be cancelled within {hours} hours"). Owner decision: they can cancel, and the manager decides any refund. | API |
| M8 | P1 | A booking made inside the penalty window shows "Cancellation deadline: Oct 11, 5:00 p.m." (before it existed); the cancel button is disabled with "deadline has passed". Nothing at checkout warned. (Booking 117.) | booking page |
| M9 | P2 | Confirmed page says "Your reservation remains valid when arrival tracking is off" while also saying "Check In Required". | booking page |
| M7 | P1 | A request can still be pending after its start time: auth expiry is `created_at + 24 h` (`auth-expiry-service.ts:77`) and ignores start; minimum notice defaults to 1 h. | manager window |
| M2 | P2 | Status badge shows raw enum `cancellation_requested`. | chef + manager booking page |
| M3 | P2 | Header date "KB-SUASYC · Oct 11, 2026" is the created date, easily mistaken for the booking date. | booking page |
| M4 | P1 | Chef cancels a pending request and the badge says **"Expired · Authorization Voided"**. Should read "Cancelled by you · No charge". | booking 116 |
| M5 | P2 | Pending-request copy says "100% refund of any amount paid" when nothing was charged. Should say "Cancel now and the hold on your card is released, so you won't be charged." | booking 116 |

## Booking management (manager)
| # | Sev | Issue | Seen |
|---|---|---|---|
| G1 | P2 | "Total charged $91.50" while funds are only on hold; after refund shows both "Amount Charged $75.00" and "Total charged $91.50". | manager booking page |
| G2 | P2 | HST the manager must remit isn't shown on the manager money panel. | manager booking page |
| G3 | P1 | Refund review dialog is accounting jargon ("Payment source #91", "Customer refund / manager debit", "Service fee requiring admin approval", "Bank receipt is not confirmed"). | cancellation review |
| G4 | P2 | Fee-bearer copy contradicts itself: "The customer absorbs the Stripe processing fee" vs payout copy saying the manager does. | Manage Booking dialog |
| G5 | P2 | Activity feed says "Access request · Approved" while the request still awaits the manager's own review. | manager dashboard |
| G6 | P2 | "Delete Kitchen" permanently removes the kitchen's bookings (financial records). Should archive/unlist instead. | Details & Pricing |
| G8 | P1 | Manager sees "Your payout $55.43" and "Download payout statement" right after confirming, hours/weeks before the session (money is transferred at capture). | manager booking page |
| G9 | P1 | No "respond by" deadline on a pending request; short-notice requests can expire after start. | manager booking page |
| G10 | P2 | Approval dialog: "Approving charges the chef…" (use the person's name). | review dialog |
| G7 | P3 | Processing-fee estimate ($2.95) vs actual ($3.69, US card) with no explanation of why. | approval dialog |

## Emails and notifications
| # | Sev | Issue | Seen |
|---|---|---|---|
| E1 | P1 | All booking emails except "confirmed" are unstyled `<h2>title</h2><p>message</p>` with the same internal text to chef, manager and Local Cooks. | captured .eml |
| E2 | P1 | Request/cancellation/refund emails wait for a manager action or the cron; the manager isn't told a request is waiting. | outbox |
| E3 | P2 | Confirmation greets "Hi Chef"; time shows raw "America/St_Johns"; "Payment captured" jargon; no free-cancellation deadline. | confirmation email |
| E4 | P2 | `email_logs.recipient_role` = `chef` for the Local Cooks admin inbox. | DB |

## Platform / engineering hygiene seen while testing
| # | Sev | Issue |
|---|---|---|
| H1 | P1 | File URLs carry the Firebase ID token in the query string. |
| H2 | P2 | SMTP `rejectUnauthorized: false` in production. |
| H3 | P1 | Lifecycle cron every 2 min exceeded Vercel Fluid CPU; delivery should be event-driven with a lean, less frequent backstop. |
| H4 | P2 | Dev and local harness share one Stripe sandbox and DB; local listeners double-process events. |
| H5 | P1 | **Fixed locally:** a permanent SMTP rejection (554) was retried every 60 s forever; a later event was blocked only until recovery was raised. Now: a refused address stops worker retries, other failures back off (1 min doubling to 6 h) and park after 8 attempts, and the admin Email Log Retry still re-attempts. Inline delivery inside user requests was also draining other bookings' backlog; now scoped to the booking. |
| H6 | P1 | Worker ticks took 7.5–12.8 s even when idle (about 75 sequential DB round trips: per-task checkpoint saves plus queries). Now: cadence configurable via `LIFECYCLE_CRON`, default 5 min; per-task timings in run output. Next: fewer checkpoint writes, skip idle tasks cheaply. |
| H10 | P1 | Check-in/out time maths hard-code `America/St_Johns` (`kitchen-visit-lifecycle.ts:81,115,127`) despite the location zone being loaded. |
| H11 | P1 | A booking never reaches `completed` unless the chef checks out; otherwise it stays "Confirmed · Not Checked In" indefinitely (no-show detection off; staff historical review records attendance only). |
| H9 | P2 | 23 server tests already fail on `development` (21 tour copy assertions, 2 decision-ordering) plus 1 checkout-cancel fixture. The suite isn't green, so regressions hide. |
| H7 | P1 | Terms say Local Cooks does not collect HST on owners' behalf (`TermsContent.tsx:736,740`), but checkout charges kitchen HST and passes it to the manager. Legal text and money flow disagree. A code comment also says Local Cooks isn't GST/HST-registered (`shared/booking-pricing-breakdown.ts:11`), which is wrong. |
| H8 | P2 | Fee fallbacks default to 5% in places (`pricing-service.ts:157,167`, `payout-statement-service.ts:28`); the configured rate default is 0. A pilot could show an accidental 5% estimate. |

## Continuation: visit tasks and manager decision feedback (2026-10-12)

Owner direction: use full pages for substantial booking tasks; reserve dialogs for focused confirmations/alerts and short actions. Show arrival/departure instructions prominently and separately from configurable actionable evidence. Test both participant roles and support exits before declaring a checkpoint complete.

| # | Sev | Issue / current evidence | Checkpoint |
|---|---|---|---|
| V1 | P1 | **Fixed locally:** both chef callers open `/booking/:id/visit`, with kitchen/date/zone/back navigation. Real authenticated fixture 124 verifies arrival/departure and returned detail states. | First visit UX repair |
| V2 | P1 | **Locally separated:** arrival and departure instruction headings are distinct from evidence/actions; generic Before your visit wording removed. Completed/historical summary still needs its own state-aware polish. | Instructions and state-specific summary |
| V3 | P1 | **Fixed locally:** generic photos say Optional; saved Required items/photos still gate submission. Fixture 124 submitted arrival and departure without evidence; configured task/photo payloads have mocked coverage. Live R2 uploads/deployed bundle still require their own check. | Configured evidence contract |
| V4 | P1 | **Fixed locally:** phase-specific page title, status details collapsed, success refreshes before returning, inline error with retained drafts and manual refresh. Real pending-state HTTP 400/retry on 124; 13 visit tests. Drafts do not survive route departure/reload or visit switch. | Success/error feedback |
| G11 | P1 | **Fixed locally:** review parses the agreed calendar day instead of shifting midnight UTC into the browser's previous day. Two manager-review regressions (date-only/ISO); all 10 review tests pass. | Shared booking date/zone rendering |
| G12 | P1 | **Fixed and replayed locally:** verified decision/replay response includes `authorizationVoided`. Real sandbox 123 immediately showed released hold/no estimate; Stripe canceled/received 0/capturable 0, canceled ledger/no transfer. Eight decision tests pass. | Manager decline completion |
| G13 | P2 | **Misleading expiry inference removed locally:** cancelled state now says Cancelled, with its separate Authorization Voided chip. Actor/cause-specific labels remain open; failed payment alone is not expiry proof. | Cancellation outcome labels |
| G14 | P2 | A manager-declined uncaptured booking still offers View cancellation and refund outcomes; its quote returns `500: No cancellation request awaits a decision`. Distinguish released authorization from captured cancellation/refund review. No refund attempted. | Cancellation outcome/recovery checkpoint |

Updated H11 evidence: attendance-only fixtures 118 (no taps) and 119 (no departure) remain confirmed past their end; fixture 120 completes only because checkout was already submitted. GET `checkin-status` performs auto-clear, so a read changes state. These are staged, no-payment fixtures, not proof of a paid settlement fallback. Current 60-minute review window is an observed setting, not an approved target clock.

Baseline retention: 119 later moved to checkout requested during a labelled other-device diagnostic; its initial missing-departure result above remains valid. Fixture 124 currently verifies the repaired arrival/departure flow and manager view. 121 was cleared before scheduled end at 18:47:24 UTC; current HEAD already uses native clear confirmation. Older no-confirmation observations require deployed-version comparison. Next inspection checkpoint must expose the saved deadline, direct clear/issue choices, comparison evidence and shared notes, preserving service-end/customer-remedy/settlement separation. Screenshot-based visual QA remains incomplete because capture tools timed out.

Owner visual review, Oct12 continuation:

- Chef booking/visit “Visit status” is too narrow and resembles an unclear dropdown. Show essential state and next action at a glance; retain secondary/history disclosure only where useful. Opus High visual checkpoint `phase0-chef-status-ux-opus-r1-20261012` is active; not complete yet.
- Manager kitchen check-in/out setup instructions are clearer but page remains cluttered. Simplify Save duplication, nested panels, repeated explanation, spacing/typography and timing/review order. Opus High checkpoint `phase0-setup-visual-opus-r3-20261012` is active with a bounded primary-source research/visual QA brief. Preserve required instructions, optional-added required tasks, saved legacy flags and explicit save behavior.
- Manager inspection functionality now has real synthetic fixture125 confirmation-dismissal/stale-preflight/success-clear/SQL/chef-view proof. Claim creation remains unavailable pending consequential claim-boundary review. Product architecture-heavy deadline/confirmation/success copy was shortened locally;24 inspection tests pass. Screenshot compositor still gives stale/duplicated frames; DOM dimensions do not complete aesthetic sign-off.
