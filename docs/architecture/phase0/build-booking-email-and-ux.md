# Build plan: one email design for every booking email + dev walkthrough UX fixes (parent-authored, 2026-10-13)

Inputs: `map-booking-emails.md` (DeepSeek inventory; trust its file:line anchors but re-verify), the parent's dev walkthrough on KB-143 (below), and owner decisions:
- Every booking email must look like the tour emails (same platform), mobile-first, Airbnb-level clarity.
- **Emails show the total only. No fee/tax breakdown and no fee rate in email bodies.** The itemized breakdown lives in an attached PDF receipt. The service-fee rate is admin-configurable (pilot may be 0% or 7%); nothing may hard-code or print a rate in email copy.
- Sender: dev `Local Cooks <test_automated@localcooks.ca>`, prod `automated@localcooks.ca` (env `EMAIL_FROM`). Support inbox: `support@localcooks.ca` for both (`getSupportEmail()` now returns `SUPPORT_EMAIL` or that default; already changed by parent).
- Research basis: Airbnb request costs nothing until the host accepts, host has 24 h; confirmation carries address, host contact and that reservation's cancellation policy; receipts are separate.

## Package E — emails (server) — Codex GPT-6.1 Sol high

Owns: `server/email.ts`, `server/services/booking-lifecycle-delivery.ts`, `server/services/advance-reminders.ts` (render only), `server/services/commitment-problems.ts` (render only), `server/services/location-access-notices.ts` (render only), `server/routes/manager.ts` (only the storage-extension double-send), `server/services/stripe-checkout-service.ts` (line-item name only), invoice/receipt PDF service (find it: the chef "Download invoice" + manager "Download payout statement" endpoints), `shared/i18n/locales/*/email.json`, related tests. No client files.

1. **One shell.** Move every LIVE booking-related email in the inventory (19 uniform + 5 bare + 2 text-only) onto `renderTransactionalEmail` (the tour/notice layout). Keep each email's plain-text part. Keep the ICS attachment on confirmations.
2. **Delete the 16 dead uniform generators** (no production callers; verify with grep first) and their preview-script references.
3. **Fix the double sends** for storage-extension approved/declined in `routes/manager.ts` (one email each).
4. **Content pattern** for every booking email (en-CA copy; fr-CA/uk via `tEmail`):
   - Heading = what happened, in plain words.
   - One or two sentences: what it means plus the next step.
   - One primary button.
   - "Details": kitchen, address, visit date + time range in 12-hour a.m./p.m. with the friendly zone ("Newfoundland Time", via `Intl` `timeZoneName: 'longGeneric'`), reference (`KB-…`).
   - Never IANA ids; never 24-hour times.
5. **Specific emails:**
   - **Request sent (chef):** "Request sent to {kitchen}". "{Kitchen} has until {deadline local} to respond. Your card is on hold and you're only charged if they accept." Button: View request. Details plus "Total on hold: $X".
   - **New request (manager):** "New booking request · {chef}". "Respond by {deadline}. If you don't, the request expires and the chef's hold is released." Button: Review request.
   - The deadline comes from the existing 24 h response deadline (`auth-expiry-service.ts`); use the stored value, don't recompute differently.
   - **Confirmed (chef):** "Your kitchen booking is confirmed". Then: what to expect (mode line + instruction release, or the full instructions when already released, from the arrival-comms work; keep that logic intact); "Cancellation: free until {deadline}; after that {policy one-liner from the saved policy}"; "Total paid $X". Attach the **PDF receipt** with the itemized breakdown. Calendar: ICS attachment + "Add to Google Calendar" secondary link. Kitchen contact.
   - **Confirmed (manager):** "Booking confirmed · {chef}". "Plan who will welcome {chef}; the visit code is on the booking page; give it in person." (self mode: matching self line). "Estimated payout $X". Attach the payout statement PDF if one exists at that point; otherwise link it.
   - **Admin copies:** same shell, factual.
   - **Lifecycle notices** (cancelled, cancellation requested/reviewed, check-in recorded, checkout requested/cleared, assisted visit, no-show report, refunds, access/renewal, problem reports, storage): each gets heading + sentence + button + details. Refund emails state the refund amount and where it goes ("to your original card; banks usually take 5–10 business days"). No fee math in bodies.
   - Remove the two robotic confirmation lines ("Check in for each visit when the action opens…", "Request checkout… Manager inspection remains pending…") and the duplicated "Saved calendar events…" boilerplate.
6. **PDF receipt:** reuse the existing invoice generator. Attach it to the chef confirmation and the refund emails if the generator is synchronous and cheap; if it is too heavy for the Vercel Hobby CPU budget, link to it instead and say so in the checkpoint.
7. **Stripe Checkout line item:** "Kitchen session · {kitchen} · {date} {time range}" instead of "Kitchen Session (2 hrs)".
8. **No fee rate or breakdown text in any email body.** Add a test that renders every booking email with a non-zero fee and asserts the body has no "Service fee", "%", "HST", "Tax" lines (receipt attachment excluded).
9. **Tests:** snapshot-ish assertions per email (heading, button, details, plain-text), the mobile breakpoint present, no IANA zone strings, no 24-hour times, sender/support values. Run tsc and the touched tests. Report pre-existing failures separately.
10. **Checkpoint** at `.phase0-harness/booking-email-checkpoint.md`: a table of each email → new heading/button, removed generators, attachments, open questions.

## Package U — chef/manager UI fixes from the dev walkthrough — Claude Sonnet

Owns: `client/src/pages/BookingDetailsPage.tsx`, `client/src/components/booking/*` (except files Package E needs; none), manager booking components (`client/src/components/manager/bookings/*`, the review/approve dialog), `client/src/pages/ManagerBookingDashboard.tsx` / dashboard activity component, the chef dashboard page, the kitchen-subdomain auth routing in `client/src/App.tsx`, `shared/i18n/locales/*/{chef,manager,booking}.json`, related tests. No server files. If an API field is missing, use what exists and list the gap.

1. **Chef pending request:**
   - Banner: "Request sent. {Kitchen} has until {deadline} to respond. Your card is on hold; you're only charged if they accept." Use the response deadline already on the booking payload (find it: `paymentDecision`/auth-expiry fields); list the gap if it's absent.
   - Hide "Arrival not recorded" and arrival UI before confirmation.
   - Merge the two cancellation sentences into one.
2. **Header date:** label it "Booked {date}", so it can't be read as the visit date.
3. **Checkout review step:** add "What happens next": (1) the kitchen reviews within 24 h; (2) you're charged only if they accept; (3) arrival details 48 h before. Add one line on cancellation after confirmation (from the kitchen's saved policy hours). Keep the existing info-icon breakdown; that is pre-payment, where an itemized total is expected.
4. **Time format:** the summary card shows "10:00 AM - 12:00 PM" while slots show "10:00 a.m." Use one locale-aware formatter; on the manager dashboard and lists, use 12-hour a.m./p.m. too.
5. **Manager pending booking:**
   - "Respond by {deadline}" banner with the consequence.
   - "The chef's payment is on hold" (not "Your payment").
   - Payout breakdown shows the HST collected line (managers remit it).
   - After Approve/Decline succeeds: close the dialog and refetch the booking (verify; the walkthrough saw it stay open in a background tab, possibly a test artifact; make the success path explicit either way).
6. **Visit-code panel wording:** "Customer" → "Chef" everywhere ("Give this code to the chef in person").
7. **Chef dashboard:** skeletons while loading instead of the empty "Not started / None" state (it flashed for ~8 s on dev).
8. **Manager dashboard Recent activity:** de-duplicate "Booking requested" + "Kitchen booking requested" for the same event.
9. **Kitchen subdomain `/auth`:** redirect to `/manager/login` on the kitchen subdomain (it currently shows the chef sign-in with chef marketing).
10. **Zone label:** "Times are shown in the kitchen's local time (America/St_Johns)" → friendly name.
11. **Tests** for each; run tsc and the touched tests plus `client/src/i18n/locales.test.ts`; report the known 10 pre-existing failures separately.

Checkpoint: `.phase0-harness/booking-ux-checkpoint.md`.

## Out of scope (already on the roadmap)
- The cancellation dialog's vague "may be retained" refund copy is fixed by the automatic cancellation-policy engine.
- Reschedule.
