# Build plan: arrival communication + instruction release (parent-authored, 2026-10-13)

Source research: `design-arrival-communication.md` (Codex). **Owner decisions override it where they differ** (PHASE0_LOG, "Oct13 night owner decisions"):
- Detailed arrival/departure instructions are **released at preparation time** (`preparation_reminder_hours`, product default **48 h**), on the platform AND in email, in sync. Before release the chef sees only an overview.
- Instructions **are included in the email body** once released (design §3 "link, not text" is NOT adopted).
- Self check-in needs **no extra readiness block** (listings already require instructions; phone is required at registration).
- Visit codes never appear in any email, notification, toast, log or chef API (unchanged).

## Contract shared by both packages

Server helper (package S owns): `shared/instruction-release.ts`
```ts
export function instructionReleaseAt(startInstant: Date, preparationHours: number): Date // start − hours
export function isInstructionReleased(now: Date, startInstant: Date, preparationHours: number): boolean
```
- `startInstant` is the visit's absolute start (location timezone already applied). For split visits use **each visit's own start**; a booking-level answer uses the **earliest unfinished** visit.
- Managers, admins and the internal duty/evidence code are never gated.
- Cancelled/completed bookings: no live instructions for the chef (existing rule).

Chef API changes (S implements, C consumes). Every chef-facing payload that today carries instruction text gets two fields, and the text fields become `null` until release:
- `GET /chef/bookings/:id` (location block at `server/routes/bookings.ts` ~1642: `arrivalInstructions`, `departureInstructions`) → add `instructionsReleased: boolean`, `instructionsReleaseAt: string` (ISO).
- `GET /chef/bookings/:id/checkin-status` (~2398, duties from `visit-duties.ts`) → same two fields at top level and per `visits[]` entry; null-out instruction text inside the returned duties when not released. **Required tasks/photo requirements stay visible** (the chef must know them to plan); only the free-text instructions are gated.
- Arrival/check-in itself is never blocked by the gate (window rules unchanged). If somehow check-in opens before release (e.g. tiny prep setting), the gate is treated as released: `released = now >= min(releaseAt, checkinOpensAt)`.
- Add `arrivalMode: 'staffed' | 'self' | 'mixed' | 'legacy'` to the chef booking payload (from the redacted visit-code projection; `legacy` = no challenge rows). Never digits.

## Package S — server (Codex GPT-6.1 Sol, high)

Owns: `shared/instruction-release.ts` (+test), `server/services/lifecycle-settings.ts`, `server/routes/bookings.ts` (chef GET payloads only), `server/services/visit-duties.ts` (only if needed for the gate), `server/email.ts`, `server/services/advance-reminders.ts`, `server/services/booking-lifecycle-delivery.ts`, `server/services/kitchen-instructions-updated.ts`, `server/services/visit-code-challenge.ts`, `server/services/commitment-problems*` email copy, `shared/i18n/locales/{en-CA,fr-CA,uk}/email.json`, and their tests. Do NOT edit client files.

1. **Default:** `preparationReminderHours.defaultValue` 24 → 48 (keep min/max and the prep > arrival validation). Dev DB already set to 48/2/30.
2. **Gate** (contract above) in every chef read path that returns instruction text. Grep `checkinInstructions|checkoutInstructions|arrivalInstructions|departureInstructions` across `server/` and confirm each chef-reachable path; list them in the checkpoint.
3. **Confirmation email** (`generateBookingConfirmationEmail` and the lifecycle `confirmed` producer):
   - If NOT released at send time: "what to expect" overview only — kitchen, address, local date/time + zone, arrival mode line (below), "Full arrival and departure instructions arrive {releaseAt local}, {N} hours before your visit", contact, Open booking. No instruction text.
   - If already released (confirmed inside the prep window): include the full instructions in the confirmation, and **mark the preparation reminder as satisfied** so no separate prep email follows. If also inside the arrival window (T−2h), the confirmation is the single consolidated message: also suppress that arrival reminder. Reuse the existing late-consolidation path in `advance-reminders.ts` (around lines 278/431); acknowledge equivalent content, don't just skip.
   - Fix the renderer's hard-coded `DEFAULT_TIMEZONE`: use the location timezone passed by the producer.
4. **Preparation email/in-app** (T−prep): subject "Get ready for your kitchen visit · {kitchen}". Body: mode line, full arrival instructions, full departure instructions, required tasks/photos summary, kitchen contact, "Open your visit" → `/booking/{id}/visit` (`?visitId=` for split). This is the moment the details are released, so say so plainly: no "see the app" indirection.
5. **Arrival reminder** (T−2h): short action line per mode + "Open your visit". Don't repeat the full instructions (they already have them); include one line "Arrival instructions: see your preparation email or open your visit".
6. **Mode lines** (from design §2; en-CA, translate fr-CA/uk):
   - STAFFED: "When you arrive, meet kitchen staff and ask for your 6-digit visit code. Enter it in Local Cooks to confirm arrival. The visit code is for the app; it does not open the door."
   - SELF: "Self check-in is on for this visit. Follow the kitchen's instructions to get in, then confirm arrival in Local Cooks. No visit code needed."
   - MIXED: "Arrival method varies by visit. Open each visit for details."
   - LEGACY: "Follow the arrival instructions and confirm arrival in Local Cooks when you're there."
7. **Mode-change / code-reissue notices** (design §2 "Changes after confirmation", B): queue inside the existing `setMode`/`issueNewCode` transactions via `queueBookingLifecycleEvent`, kinds `arrival_mode_changed` and `arrival_code_reissued`, metadata = targets + revision + mode only. Chef email for mode changes always; for reissue only if inside T−2h / window open / after failed attempts; in-app always. Re-read state at dispatch; skip superseded/cancelled/consumed targets. No-op same-mode = no event. One event per bulk change.
8. **Instructions updated** (`kitchen-instructions-updated.ts`): if the visit is NOT yet released, send nothing (they'll get the current text at release). If released, current behavior (include updated text) stays.
9. **Manager reminders:** T−2h manager email + in-app per visit: "{chef} arrives at {time} · {kitchen}". STAFFED: "Have the visit code ready and give it to {chef} in person. It is not a door code." SELF: "Self check-in is on. Make sure {chef} can get in and reach you." Link `/manager/booking/{id}`. No digits. No T−24h manager email (skip the in-app prep notice too, to keep it lean).
10. **Problem-report email** (found in live test): subject "{Category} problem reported · Booking #{id}" (Safety → "Safety issue reported — urgent"), include category label, kitchen, local time, the text, and the link. Replace the bare "Support request #10: Awaiting response." copy.
11. **Tests:** unit-test the gate incl. split visits, DST/Newfoundland, late confirmation inside 48 h and inside 2 h (exactly one message, no duplicates), instructions-updated before/after release, mode-change no-op and bulk, a synthetic secret string never appears in any email/notification before release, and no visit-code digits anywhere. Run `npx tsc --noEmit` and the touched test files. Report pre-existing failures separately from new ones.

Checkpoint: `.phase0-harness/arrival-comms-server-checkpoint.md` (files touched, every gated path, test output, open questions).

## Package C — client (Claude Sonnet)

Owns: `client/src/components/booking/{BookingPreparation,KitchenCheckinTracker,VisitCodeField,InSessionPanel}.tsx`, `client/src/hooks/use-kitchen-checkin.ts`, `client/src/pages/{BookingDetailsPage,KitchenVisitPage}.tsx`, `client/src/components/manager/bookings/VisitCodePanel.tsx`, `shared/i18n/locales/{en-CA,fr-CA,uk}/{chef,manager}.json`, and their tests. Do NOT edit server files.

1. **Before release** (`instructionsReleased=false`): `BookingPreparation` and the visit page show the overview card: mode line (same copy as S §6), address, local date/time, contact, required tasks/photos list, and "Arrival and departure instructions will appear here on {releaseAt local} ({N} hours before your visit). We'll email them to you too." No empty "Arrival instructions" headings.
2. **After release:** current instruction display, with the mode summary above it.
3. **Locked-code screen refresh** (live-test bug): while the chef is locked, keep polling checkin-status (reuse the existing 30 s actionable refetch; it currently stops when locked) and refetch on `visibilitychange`; when the server shows a new revision/unlocked, clear the code/error and show the field again, keeping evidence drafts.
4. **Manager `VisitCodePanel` refresh** (live-test bug): bounded 30 s refetch while the target is active (window open, not consumed/revoked), plus `visibilitychange`; stops otherwise.
5. **Manager booking page:** the visit record shows the chef sentence "Check in when you arrive and check out when you leave." on the manager view; use a manager line ("The chef checks in on arrival and checks out when they leave.") when `isManagerView`.
6. Recovery copy at the door (design §2 "At-door recovery copy") for wrong/locked/network/mode-changed, reusing existing keys where they fit.
7. Never put a code in URL, storage, toast or analytics. Tests: before/after release rendering, split visits, mixed/legacy modes, locked→unlocked refresh without losing drafts, manager panel polling stops when consumed. Run `npx vitest run` on touched tests and `npx tsc --noEmit`.

Checkpoint: `.phase0-harness/arrival-comms-client-checkpoint.md`.

## After both return (parent)
Review diffs, then live local test with mail capture: a booking > 48 h out (overview only on page + email), one confirmed inside 48 h (single confirmation with instructions, no prep email), one inside 2 h (one consolidated message), a mode switch, a reissue, a problem report. Then ask the owner about the Vercel deploy + `VISIT_CODE_HMAC_SECRET`.
