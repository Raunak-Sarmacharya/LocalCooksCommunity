# Kitchen tours — plan for an intuitive, end-to-end experience

**Status:** proposal. No code written.
**Scope:** the kitchen-tour (viewing) flow only — chef request → confirmation → visit → outcome →
application. Bookings, storage and tours-for-storage are out of scope.
**Author's stance:** written as an outside-in review. Where I disagree with the brief, I say so and
give the evidence. Every claim below is traceable to a file:line.

---

## 0. Summary

1. The tour engine is the **most engineered part of the platform** — and having now read it properly,
   it has **eight real problems** (§2B), not none. The delivery outbox is genuinely good; the
   attendance ledger, the state machine and the reason strings are not.
2. What is missing is the **conversion layer** and **truthful state communication**.
3. **The intake questionnaire is dead code** — the schema, the column and all three display surfaces
   exist, but nothing collects it and `/book` never sends it. That is the biggest single find here.
4. Admin-first triage **stays** (your call, and I agree for a startup). What it lacks is a **clock**.
5. Reconfirmation should be **soft** — nudge, flag, escalate to a human, never auto-release.
6. **The language needs as much work as the flow.** Our operational vocabulary — *attendance,
   evidence, assisted, disrupted, no-show, outcome* — is leaking into user copy, and one manager form
   asks for a **UTC offset**. §2A is the audit.
7. Nine phases: make the truth visible → fix the language *and its source* → fix the arrival path →
   wire up intake and add the clock → reconfirm and reschedule → convert → make the visit productive →
   correct the engine → verify.

---

## 1. Where I disagree with the brief

### 1.1 Tours are needed — agreed. But the goal should be a *productive* tour, not just an available one

Your reasoning is sound and I'm not going to argue it: this is a business-use space, not a stay. A
chef cannot judge whether their production flow fits from photographs — they need to see the
equipment, the power, the bench space, the cold storage, the loading access.

That actually makes your case *stronger* than the "add a video and you won't need tours" advice
Peerspace gives (that advice is written for a party venue). For a working kitchen, the visit is the
due-diligence step.

But it changes the design goal. If the visit is genuinely necessary, then the tour is not a gate to
be passed — it is **the sales step**, and it should be engineered to *produce a decision*. That means
the chef should arrive knowing exactly what to inspect, and leave with a recorded outcome that feeds
their application. Today they arrive cold. See Phase 6.

### 1.2 The Zillow analogy — corrected

**My first reading of this was wrong and the correction matters.** I originally said Zillow has no
intermediary. That is not right. Zillow's own documentation is explicit that there **is** a
confirmation loop between the platform side and the requester before a visit happens:

- The shopper selects a home, enters their contact information, and requests a date and time.
- Zillow calls Premier Agents to find one available to show the home.
- The agent then **"Contact[s] the shopper to confirm the tour."** If they can't confirm availability
  immediately: *"let them know you're checking and will follow up with a time or alternatives."*
- Critically: **"Accepting a tour connection does not confirm the tour."**
- If the agent can't make the requested time they decline, and Zillow tries the next agent.

So the control step you described is real. What differs is **who holds it**: at Zillow the control
sits with the *agent* — the party who owns the calendar and who must physically attend — not with
platform staff. There is no Local-Cooks-equivalent reviewer between the request and the agent.

**Your equivalent of the agent is the kitchen manager.** That is the right place for the primary
decision. But your second point stands and I under-weighted it: *if the manager misses it, nothing
catches it.* Zillow and Airbnb both solve that with a **response SLA**, which is the missing piece:

> **Airbnb: hosts have 24 hours to accept or decline a request, or it expires.**
> "Hosts must respond within 24 hours or the request expires." (`airbnb.com/help/article/75`)

That is the mechanism for "someone misses it" — not an open-ended wait, and not a blocking
pre-screen. It is a **clock plus an owner**.

### 1.2a What Airbnb does *not* do (relevant to §5.3)

I looked specifically for evidence that Airbnb auto-releases or auto-cancels a reservation because a
guest failed to reconfirm. **There is none, and I would not add it.** A confirmed reservation on
Airbnb is not conditional on the guest replying to a reminder; the host cancels if the guest doesn't
turn up. Auto-release on silence would punish exactly the person who missed a notification — the
failure mode you flagged.

So: apply the clock to the **approval** step (where a stalled request genuinely has no owner), and
**not** to the reconfirmation step (where silence does not mean absence).

### 1.3 The seriousness filter already exists — and it is switched off

This is the finding I'd most want you to act on.

You have a qualification questionnaire, and the code even calls it that — the schema comment reads
`// Intake data schema for pre-tour lead qualification` (`shared/schema.ts:2460`). It collects
intended use, estimated weekly hours, whether they hold a food handler licence, and target start
date (`shared/schema.ts:2461-2467`).

**Every field is `.optional()`, and the whole object is optional on the booking schema**
(`insertKitchenViewingSchema.intakeData`, `shared/schema.ts:2476`). So a chef can request a tour
having answered nothing, and nothing in `/book` rejects them for it — the only gates enforced there
are email verification, kitchen active/listed, manager assigned, no existing application, tours
enabled, and duration match (`server/routes/viewings.ts:1088-1148`).

In other words: **the platform's stated reason for the two-tier approval — filtering non-serious
people — is delegated to a human, while the instrument built to measure seriousness is not required
to be filled in.** Making those four questions mandatory is faster, free, scalable, and defensible.
It is also exactly what the intake form was built for.

### 1.4 Managers are already protected from direct contact

Also worth knowing before you weigh the gate's cost: a requester **cannot** reach a manager
directly, because contact details are withheld until the tour is confirmed —
`viewings.ts:1324-1325` returns `locationContactEmail` / `locationContactPhone` as `null` unless
`status === "confirmed"`. Arrival notes are gated the same way (`:1322`).

So "non-serious people reaching out to kitchens directly" is already structurally prevented by the
manager's own confirm step. The two-tier gate is not what protects them.

### 1.5 Recommendation — admin-first triage, but with a clock

**You chose to keep admin triage first, for control while the platform is small. I agree with the
reasoning and I'd keep it too** — a startup cannot afford a bad actor's first impression on a kitchen
it is trying to sign. So the *order* stays exactly as it is today.

What has to change is that the admin step currently has **no clock**, so a request can sit with nobody
accountable. That is the same failure in the other direction: not "the manager missed it", but
"nobody owns it".

| | Today | Proposed |
|---|---|---|
| Order | Admin triage → manager | **Unchanged** |
| Admin's clock | None | **A response window; breach escalates** |
| Manager's clock | None | **A response window; breach escalates back to admin** |
| If the manager stalls | Nothing happens | **Admin is prompted and can act on their behalf** |
| If nobody acts | Sits indefinitely | **Expires with a stated reason, before the tour** |
| Seriousness filter | Human judgement alone | Human judgement **plus** the required intake — which is built but never wired (G3) |
| Chef's visibility | One label for both stages | **Which stage, who holds it, and by when** |

Order preserved, accountability added. §1.6 decides the window; §5 lists what's still open.

### 1.6 The response window — decided: 12 hours per stage, capped against the tour

You asked me to decide and justify it. Here is the reasoning and the data behind it.

**The data.** Response speed is one of the best-evidenced levers in lead conversion:

- Leads contacted within 5 minutes are **100× more likely to be reached** and **21× more likely to
  qualify** than at 30 minutes (MIT/InsideSales).
- **7× more likely to qualify** within an hour than an hour later; **60× more likely** than at 24+
  hours (HBR).
- Close rate falls monotonically: **32%** under 5 min → **24%** at 5–30 min → **18%** at 30–60 min →
  **15%** at 1–24 h → **12%** at 24+ h.
- Firms with a **formal response SLA** hit a 15-minute standard **54.9%** of the time versus **29.5%**
  without one — a 25-point gap. That is the argument for a *written* window rather than a good intention.

**The decision: 12 hours per stage, with three guards.**

1. **12 hours, not 24.** Two stages at 12 hours give a 24-hour worst case — the same total as Airbnb's
   single 24-hour host window — while each stage stays on the right side of the 24-hour cliff. A single
   24-hour *admin* window would put the manager's clock at 48 hours worst case, past the point where
   the data says intent has gone cold.
2. **Capped against the tour.** `deadline = min(now + 12h, tourStart − 6h)`. A request must always
   resolve at least six hours before the visit, so no chef waits past the thing they are waiting for.
   With `advanceNoticeHours` defaulting to 24 this rarely binds — but it must exist, because advance
   notice is configurable down to zero, and a tour booked 5 hours out would otherwise breach the SLA
   *after* the visit had already happened.
3. **Quiet hours.** A 12-hour clock started at 9pm would breach at 9am. Breaches escalate only during
   waking hours — the reminder literature is consistent that nothing should send before 9am or after
   8pm local.

**On breach: escalate, don't expire.** Expiring a request because a manager was busy destroys a real
lead and costs nothing to avoid. Escalation costs one notification. The request only expires if
*nobody* acts before the tour is due — and then with a stated reason.

### 1.7 Reconfirmation — designed: soft, with an escalation that has an owner

Agreed on the soft nudge with no auto-release. Here is the design, and the evidence for the timing.

**The evidence.** Aggregated reminder studies put the no-show rate at:

| Pattern | No-show rate |
|---|---|
| No reminder | 18–25% |
| Day-before reminder | 11–15% |
| 24h + 2h reminders | 6–10% |
| 24h + 2h **+ explicit confirmation** | **4–7%** |

The confirmation step itself is worth another 2–3 points *on top of* the reminders — which is the
argument for **asking** rather than merely announcing. The 24-hour reminder "does most of the work";
it is the "oh right, that's tomorrow" moment. Best window **10am–2pm the day before**, never before
9am or after 8pm local. Most people find two reminders fine; three or more feels pushy.

**The design.**

1. **24 hours before** (sent 10am–2pm local): *"Are you still coming?"* with three one-tap actions —
   **Still coming** / **Reschedule** / **Can't make it**.
2. **If unanswered by 4 hours before**, notify **admin and the manager** — exactly the "make the extra
   effort to reach out" step you described. From that point the manager also sees an **Unconfirmed**
   flag on the tour.
3. **The existing 2-hour reminder still sends** — the "don't forget" nudge.
4. **Nothing is auto-cancelled.** Silence is recorded as *unconfirmed*, never as a no-show.

**Compression for short-notice bookings** (the literature is explicit that a 24-hour reminder is
meaningless when someone books inside 24 hours):

| Booked | Sequence |
|---|---|
| More than 48h out | 24h nudge + 2h reminder |
| 24–48h out | Confirmation at booking + 2h reminder |
| Under 24h out | Confirmation at booking only |

**Your reschedule question — yes, the manager should be able to propose a time.** It is standard, and
Zillow documents it: the agent "work[s] with them to find another time", and when availability can't be
confirmed immediately they "follow up with a time **or alternatives**". So the flow becomes symmetric:

- the chef can request a change (already exists), **and**
- the **manager can propose up to three specific alternative slots**, which the chef accepts or
  declines in one tap.

That converts "can't make it" into a rebooking rather than a cancellation — which is the single
cheapest conversion win in the whole flow.

### 1.8 The two decisions you asked me to make

**The reconfirmation escalation — "fewer than 12 hours of runway, in waking hours only".**

The point of the escalation is to give a human time to reach out *before* the visit. So the trigger
should be measured in **runway**, not in clock time:

- The manager sees an **Unconfirmed** flag on the tour from the moment the 24-hour nudge is sent.
- **If the chef hasn't answered when fewer than 12 hours of runway remain**, admin and the manager are
  notified — evaluated only between 8am and 8pm local, and deferred to the next 8am if the boundary
  falls overnight.
- The existing 2-hour reminder still sends.

Worked examples: a **7am** visit escalates at 7pm the evening before (a full 12 hours of runway). A
**2pm** visit escalates at 8am the same day (6 hours). A **9am** visit escalates at 8am (1 hour) —
deliberately late, because the 24-hour nudge already gave the chef a whole working day to answer, and
what the manager needs most is *to know*. If you want more runway, the lever is the threshold, not the
mechanism; I'd start at 12 and revisit once there is real data.

**The alternative slots — three, and they must be real availability.**

Three, not one and not five. One is take-it-or-leave-it; five becomes a decision rather than a choice.
Three is the standard choice architecture, and it matches Zillow's "a time **or alternatives**".

The number matters less than this, though: **the alternatives must be drawn from computed
availability**, reusing the same engine that powers booking (`calculateAvailableSlots`,
`server/routes/viewings.ts:200`). A free-text "suggest a time" creates a second round trip the moment
the chef picks a slot the kitchen can't do. Offering real slots makes acceptance a single tap.

---

## 2. The gaps

Ordered by impact, not by ease.

| # | Gap | Evidence |
|---|---|---|
| G1 | **The confirmation email carries the wrong field.** The chef's confirmation — the artefact they keep and put in their calendar — is filled from the one-off `sharedManagerNotes`, not the reusable `arrivalNotes` the manager writes once. So the arrival guidance never reaches the email or the `.ics`; it survives only in reminder emails. | `server/services/tour-delivery-service.ts:196` and `:167` pass `notes: after.sharedManagerNotes`; `generateTourConfirmedEmail` renders it as "Meeting instructions" (`server/email.ts:7846`); arrival notes reach only reminders (`advance-reminders.ts:181-182`) |
| G2 | **Two approval stages share one identical label.** The chef cannot tell whether Local Cooks or the manager is holding their request, or how long it has been there. | `client/src/lib/chef-viewing-display.ts:68-71` — both `pending_local_cooks` and `pending` return `defaultLabel: "Request sent"` |
| G3 | **The intake questionnaire is dead code — nothing ever writes it.** The schema (`shared/schema.ts:2461-2467`), the `intakeData` column, the manager labels (`ViewingsDashboard.tsx:132-138`), the admin view (`AdminTourRequestsSection.tsx:228-230`) and the chef's own "What you shared" (`ChefViewingsList.tsx:162-167`) **all exist**. But **no UI collects it and `/book` never sends it** — the request body is `{ locationId, targetedKitchenId, scheduledAt, chefNotes }` (`ScheduleViewingWidget.tsx:266-270`). The widget still carries a legacy coercion for a removed `"intake"` step (`:187-190`). The questionnaire was built and then removed on the input side, leaving the whole display path orphaned. **This is a build, not a flag** — but a cheap one, because only the input step and the POST field are missing. | as cited |
| G4 | **Nothing asks the chef to reconfirm.** Reminders announce the visit; none requests an active reply. This is the single highest-yield no-show tactic and it is absent. | `advance-reminders.ts:167-171` fires `preparation`/`arrival`/`departure` only |
| G5 | **Rescheduling is all-or-nothing.** One proposed time, accept or decline, no alternatives — a decline is a dead end. | `kitchenViewings.requestedRescheduleAt`; `PATCH /manager/:id/reschedule` (`viewings.ts:1561`) |
| G6 | **Nothing follows a completed tour.** The completion notification is *typed* `application_new` — someone intended a nudge toward applying — but the copy is only "recorded as completed". No CTA, no dated next step, no cadence. | `tour-delivery-service.ts:219-226` |
| G7 | **No pre-tour briefing for the manager.** The intake answers exist but aren't assembled into "here is who is coming and what they need". | `ViewingsDashboard.tsx` renders request details but no briefing |
| G8 | **No visit funnel.** The manager sees a list, not scheduled → confirmed → attended → applied → booked, with no-show and recovery rates. | — |
| G9 | **Timezone hardcoded in the chef's tour display.** The formatter ignores its own `timeZone` argument. | `chef-viewing-display.ts:92` uses `DEFAULT_TIMEZONE`; `:153` defaults to `America/St_Johns` |
| G10 | **Days of latency in a minutes-scale decision.** Chef → Local Cooks → manager, with no visible progress. | the two-tier flow; corroborated by the 2.5–3h Zillow floor in §1.2 |
| G11 | **No "what happens next" framing at request time.** The chef is never told what a tour is for, what to bring, or what follows it. | `ScheduleViewingWidget` success step |
| G12 | **No response SLA and no escalation trigger.** Neither tier has a deadline, nothing prompts anyone when a request stalls, and nothing surfaces "waiting on the manager for N hours" as an action. The only automatic action is expiry *after the scheduled time has already passed* — far too late to save the visit. | `server/services/tour-outcome-service.ts:25-44`; no request-age reminder in `advance-reminders.ts` |

**To verify before Phase 2 (do not assume):** whether the confirmation *PDF* (`GET /chef/:id/confirmation`,
`viewings.ts:1340`) also omits the arrival notes. If it does, it belongs in the same fix as G1.

---

## 2A. The language problem — and it is bigger than "attendance"

You flagged this, and you were right to. I audited every user-facing string in the tour and booking
surfaces.

**First, the precise fact:** the word *"Attendance"* never actually reaches a screen. It lives in i18n
**keys** (`bookingAttendance*`), component names (`BookingAttendancePanel`, `TourAttendancePanel`) and
the API path (`/attendance`). The visible heading is already "Visit record". So if you saw the word
"Attendance" on a booking page, it was a previous build — but that is beside the point.

**The real problem is wider:** our operational vocabulary is leaking into user copy, and in one place
an engineer's output is being rendered as a form field.

| Where | What the user sees today | Why it's wrong | Proposed |
|---|---|---|---|
| `TourAttendancePanel.tsx:79-80` | A field labelled **"Actual time with UTC offset"**, placeholder `2026-10-05T10:00:00-02:30` | This is a log line, not a form. A kitchen manager is being asked to type ISO 8601. | A normal date/time picker. No offset, ever. |
| `TourAttendancePanel.tsx:81` | "Evidence or missed-action reason (shared with visitor)" | "Evidence" is legal vocabulary. | "What happened?" |
| `TourAttendancePanel.tsx:84` | "Record assisted arrival" / "Record assisted departure" | "Assisted" describes *our* process, not their action. | "Add the arrival time" / "Add the departure time" |
| `TourAttendancePanel.tsx:88-89` | "Manager assisted · Actual: … Recorded: …" — shown **to the chef** | Internal provenance and audit timestamps shown to the other party. Reads as an accusation. | The chef sees only "Checked in at 9:04". Provenance is admin-only. |
| `BookingAttendancePanel.tsx:66` | A **"Visit record"** panel on the booking page with a "Manage visit" dialog | A separate operational panel competing with the booking itself. | Fold the manager's actions into the booking's own check-in row. |
| `BookingAttendancePanel.tsx:73,90` | "Report a no-show or correct a visit" / "Report chef no-show" | "No-show" used as both noun and verb is HR/school language. Airbnb says the guest "didn't arrive" and frames it as a reservation action. | "The chef didn't arrive" → confirm → "End this booking" |
| `BookingAttendancePanel.tsx:87` → `bookingAttendanceAbsent` | A checkbox reading *"I confirm the chef did not attend. Manager absence, denied access, missing checkout, and other disruptions are not chef no-shows."* | A legal disclaimer on a checkbox, using "disruptions" and "no-shows" as terms of art. | Drop the disclaimer; state the consequence in one plain sentence. |
| `manager.json` `noShowGraceLabel`, `arrivalTimingDescription`, `noShowGraceHelp` | "No-show grace period"; "…how long to wait before marking a no-show" | This sits on the manager's **setup** screen, before they have ever had a booking. Airbnb never makes a host learn this word. | "How long to hold the booking if the chef is running late" — or don't surface it at all. |
| `tour-delivery-service.ts:206,215,220` | "This tour was disrupted", "This is not a visitor no-show" | Internal status language in a customer email. | "This visit couldn't go ahead." |
| `KitchenCheckinTracker.tsx:316` | "The manager can record audited assistance; missing actions do not prove absence or a charge." | "Audited assistance" and "prove" — written to protect us, not to help them. | "If you miss a tap, message the manager — they can record it for you." |
| `KitchenCheckinTracker.tsx:309` | "Your evidence is retained." | Internal. | Remove. |
| `manager.json:1618` | "Please add at least 2 pieces of evidence" | "Evidence" again. | "Add photos and a receipt" |
| `TourAttendancePanel.tsx` | **No i18n at all** — every string hardcoded English | A French or Ukrainian user gets English in this panel alone. | Translate it. |
| `TourAttendancePanel.tsx:62`, `BookingAttendancePanel.tsx:18` | `'America/St_Johns'` hardcoded | Same class as G9. | Use the location's timezone. |

**The rule, in one sentence:**

> **Name the user's outcome, never our process.** A chef *checks in*. A manager *adds the arrival
> time*. If a word only makes sense to the person who built the system — attendance, evidence,
> assisted, disrupted, outcome, no-show — it does not belong on a screen.

**Structurally**, and this is the part that answers your complaint directly:

- The **audit trail** (who recorded what, when, actual vs recorded) is **admin-only**.
- The **manager's corrective actions** live *inside* the booking's own check-in row — not in a separate
  panel with its own vocabulary.
- The **chef** sees plain facts with no provenance: "Checked in at 9:04. Not checked out yet."

Keep the capability; remove the vocabulary and the surface.

---

## 2B. The engine: what I'd actually change

**First, a correction to my own earlier draft.** I listed "rebuilding the tour engine" under
"deliberately not doing" and claimed the delivery outbox, attendance ledger, outcome history and
reminders "are sound and should not be touched". **You never set that constraint** — I invented one,
and it let me skip the hardest part of the review. Having now read the engine properly, here is the
real assessment.

**The outbox is genuinely good, and I would not rewrite it.** It has lease-based claiming with
`skipLocked`; a per-tour FIFO constraint so an older event can never be overtaken by a newer one; real
idempotency through `emailLogs.trackingId`; **re-validation of current state before sending, with a
downgrade to a "recorded notice" when the facts have changed**; capped exponential backoff; and
recovery escalation to admins that de-duplicates itself. That is better than most production systems.

**The rest of the engine has eight things worth fixing.**

| # | Problem | Why it matters | What I'd do |
|---|---|---|---|
| **E1** | **Two sources of truth for one fact.** `checkedInAt` (a column) and `attendanceHistory` (jsonb) must agree, and `tourAttendance()` verifies this **at read time** — `evidenceMatches` requires *exactly one* history entry whose `actualAt` equals the column. | Nothing enforces the invariant, so the read path defensively re-checks it — and when it fails it **degrades the user's screen** with *"…has invalid evidence; contact the manager for review"*. A user should never see our consistency check fail. | Make the history the single source of truth and **derive** the scalars. Log a mismatch; never render one. |
| **E2** | **Attendance is write-once and cannot be corrected.** `canAssistArrival` goes false the moment an arrival exists ("Arrival already recorded"), and `evidenceMatches` assumes at most one entry ever. | A mis-typed arrival time can only be "fixed" by changing the *outcome* — the wrong lever, and it corrupts the outcome record. **For a feature whose entire purpose is dispute evidence, an uncorrectable timestamp is the worst possible property.** | Allow a correction that **appends** to the history and supersedes the prior entry, with the reason recorded. Then relax `evidenceMatches` to "the latest entry wins". |
| **E3** | **The domain module owns user-facing English.** `shared/tour-attendance.ts` returns `reason`, `safetyReason`, `checkOutReason`, `departureSafetyReason`, `assistArrivalReason` — hardcoded sentences like *"This tour has been disrupted"* and *"Historical confirmation evidence is required"*, rendered straight to users. | An i18n bug and a layering violation — **and the actual origin of §2A's language problem.** Fix the copy without fixing this and it comes straight back on the next string someone adds. | Return **codes** (`WINDOW_NOT_OPEN`, `ALREADY_RECORDED`, `EVIDENCE_MISMATCH`); let the client own the wording. |
| **E4** | **"Was this ever confirmed?" is answered by scanning a jsonb array** for the string `'confirmed'`. | O(n) on every attendance read, unindexable — and it exists only because the state machine is ambiguous (E5). | Add a `confirmedAt` timestamp column. O(1), indexable, and it removes a class of guard clauses. |
| **E5** | **The state machine has mutable terminal states.** `completed ↔ no_show ↔ cancelled`, with `cancelled → completed/no_show` permitted *only* when `disruptionReason` is set. | So "cancelled" means two different things depending on a nullable column — which is why the route needs `hasTourConfirmation` plus five guard clauses to stay coherent. | Split the concepts: **lifecycle** (`pending → confirmed → ended`) separate from **outcome** (`completed` / `didn't happen` / `disrupted`). Corrections append to events rather than mutating a status. |
| **E6** | **Two parallel history stores.** `attendanceHistory` and `outcomeHistory` as jsonb arrays here; `kitchen_booking_attendance_events` as a real table for bookings. | The same concept, stored two ways, in two features. jsonb arrays grow unbounded and can't be indexed — so no reporting, no "how often is arrival recorded late". | One events table per aggregate, matching the booking side. |
| **E7** | **Two delivery systems.** `tour-delivery-service` and `booking-lifecycle-delivery` implement the same outbox independently. | Duplicated hard problems — leasing, FIFO, idempotency, downgrade. The tour version is the better design. | Converge bookings **onto** the tour outbox, not the reverse. |
| **E8** | `selectedReminderPolicy.approval` holds the sentence *"User selections in the 2B chat, 3 October 2026; anomalous short-booking policy remains pending"*. | A code comment stored as configuration data. | Delete it — the policy should be data or a comment, never both. |

**Priority.** **E3 and E1** go in with Phase 1b, because E3 is what makes the language fix *durable* and
E1 is what currently puts a scary error in front of a user. **E2 is the most serious functional gap** —
an uncorrectable evidence timestamp. **E5 and E6** are the structural ones: worth doing properly, with
tests, as a deliberate refactor rather than a drive-by.

---

## 3. The target experience

### 3.1 Chef

| Stage | What they see | What's new |
|---|---|---|
| Discover | Kitchen page: what the space has, what a tour involves, clear CTA | "What a tour is" framing; equipment/layout detail so the visit is productive (Phase 6) |
| Request | Real availability, **4 required qualification questions**, notes | G3 — required, not optional |
| Wait | **Which stage, who holds it, expected timeframe**, and what happens if nothing happens | G2, G10 — replaces the single "Request sent" label |
| Confirmed | Email + `.ics` + in-app "Your visit" carrying **arrival notes**, who's meeting them, address, what to bring | G1 |
| Pre-visit | A reminder that asks **"are you still coming?"** — one tap; reschedule offers **two alternatives**; a "running late" signal | G4, G5 |
| On the day | Arrival notes, directions, check-in (exists), manager assistance (exists) | — |
| After | Outcome recorded, then a **dated next step** with an apply CTA and a follow-up cadence | G6 — the segue to booking you described |
| Convert | Tour → application → booking, measured | G8 |

### 3.2 Manager

Configure (exists) → **pre-tour briefing** (G7) → decide confirm/decline/**propose alternatives** (G5) →
prepare (space, access, greeter) → host and record attendance (exists) → record outcome (exists) →
**see the funnel** (G8).

### 3.3 Admin

Review queue becomes **exception-based** rather than universal (§1.5). Outcome correction, delivery
health and the support ledger all stay as they are.

### 3.4 The conversion link

The tour exists to produce an application. That path should be explicit, prompted and measured:
a completed tour creates a dated next step for the chef; a chef who doesn't act gets a follow-up;
and the manager can see how many tours became applications and how many applications became bookings.

---

## 4. Phased plan

Each phase is independently shippable and independently verifiable.

### Phase 1 — Make the truth visible
*No schema change. Highest impact per unit of risk.*
- G2: split the chef-facing label — "With Local Cooks" vs "With the kitchen" — and show how long it
  has been in that state.
- G11: add a "what happens next" block to the request success step.
- G9: fix the timezone handling in `chef-viewing-display.ts`.
- **Acceptance:** a chef can always tell which stage their request is in and what happens next.
- **Risk:** low.

### Phase 1b — The language pass, and its source
*Cheap mechanically, broad in surface area — and it is what makes the product stop feeling like an
internal tool.* §2A is the work list.
- **E3 first, because it is the root.** Change `shared/tour-attendance.ts` to return **reason codes**
  instead of English sentences, and move the wording to the client. Doing the copy pass *without* this
  just means the next string regresses.
- **E1 with it.** Stop rendering a consistency failure: derive the scalars from the history, log a
  mismatch, and keep serving a sane screen.
- Replace the ISO/UTC-offset field with a normal date-time picker.
- Move the audit trail to **admin-only**; strip provenance from the chef's view.
- Fold the manager's corrective actions into the booking's check-in row; retire the separate
  "Visit record" panel.
- Rename the i18n keys from `bookingAttendance*` to the vocabulary we actually want (`bookingVisit*`),
  so the next string someone adds does not inherit the wrong word.
- Translate `TourAttendancePanel` — it has no i18n today.
- **Acceptance:** `grep -i attendance` finds no user-facing string; no ISO timestamp appears in any
  form; no screen shows *evidence*, *assisted*, *disrupted*, *no-show* or *outcome* as a term of art;
  `shared/tour-attendance.ts` contains no user-facing prose at all.
- **Risk:** low.

### Phase 2 — Fix the arrival-information path
- G1: pass `arrivalNotes` into `generateTourConfirmedEmail` for the chef, and into the `.ics`.
  Keep `sharedManagerNotes` as a *separate* "message from the kitchen" fact so nothing is lost.
- Verify and fix the confirmation PDF if it has the same omission.
- G7: assemble a pre-tour briefing for the manager from `intakeData` + arrival notes.
- **Acceptance:** the confirmation email, calendar event and PDF each carry the arrival guidance the
  manager wrote once.
- **Risk:** low. Touches `tour-delivery-service.ts` and `email.ts`; the existing
  `email-tour-calendar.test.ts` suite covers this surface.

### Phase 3 — The request stage: intake, the clock, and the safety net

**3a — Wire up the intake questionnaire (G3).**
- Add the intake step to `ScheduleViewingWidget`. The legacy `"intake"` step name is already coerced at
  `:187-190`, so the step-enum change is small.
- Include `intakeData` in the POST body at `:266-270`.
- Make the four questions **required**.
- Keep them inside the existing 2-in-1 flow — information first, account created in the same step,
  exactly as today. The questions are not a new wall; they are the same wall with a purpose.
- **No display work needed:** `ViewingsDashboard.tsx:517-520` and `AdminTourRequestsSection.tsx:228-230`
  already render it, which is what makes this cheap.
- **Acceptance:** every request carries the four answers, and the manager sees them before the visit.

**3b — The response clock and the admin safety net (G12).**
- The 12-hour, tour-capped, quiet-hours-aware window from §1.6.
- On breach, **escalate to the next tier** — never expire on the first miss.
- Admin gets an explicit **takeover** action on a request the manager is sitting on.
- G2: the chef-facing label splits into *With Local Cooks* / *With the kitchen*, with who holds it and
  the expected response time.
- If nobody acts before the tour, expire with a stated reason — reusing the existing expiry path, but
  driven by the clock rather than by the scheduled time having already passed.
- **Acceptance:** no request can sit unowned; every request reaches a decision or a reasoned expiry;
  the chef always knows the stage and the expected response time.
- **Risk:** medium-high — touches the state machine.

### Phase 4 — Reconfirmation and rescheduling, without punishing silence
- G4: the soft reconfirmation from §1.7 — a 24-hour nudge (10am–2pm local) with one-tap *Still coming*
  / *Reschedule* / *Can't make it*; **no auto-release**; an **Unconfirmed** flag for the manager from
  four hours before; admin and manager notified when it goes unanswered.
- Short-notice compression per §1.7 — the 24-hour nudge is meaningless when someone books inside 24 hours.
- G5: **the manager can propose up to three alternative slots**, accepted or declined by the chef in one
  tap. This is the symmetric half of rescheduling and the cheapest conversion win in the flow.
- A "running late" signal from the chef.
- **Acceptance:** the chef can confirm or change in one tap; the manager can offer alternatives; nothing
  is ever auto-cancelled for silence.
- **Risk:** medium — new field(s) on the viewing record; needs a migration.

### Phase 5 — The conversion layer, with exactly one follow-up
- G6: **one** follow-up email after a completed tour, carrying the apply CTA and a dated next step.
  One — not a cadence. (Your call, and it is the right one for a small operator; more touches would
  read as pestering.)
- G8: the manager visit funnel — scheduled → confirmed → attended → applied → booked, plus no-show rate.
- **Acceptance:** every completed tour receives exactly one follow-up, and the funnel is visible to
  the manager.
- **Risk:** medium.

### Phase 6 — Make the tour productive
- A "what to inspect" checklist for the chef, derived from the kitchen's equipment and space, so the
  visit produces a decision rather than an impression.
- Tour outcome pre-fills the application, so the chef doesn't re-answer what they already told us.
- Optional: richer listing content so the visit is spent on the things photos can't convey.
- **Acceptance:** a chef arriving for a tour has a list of what to check; their tour outcome appears
  in their application.
- **Risk:** medium-high — the largest net-new surface.

### Phase 6b — Engine corrections (E2, E4, E5, E6, E7, E8)
*A deliberate refactor with its own migration and tests — not a drive-by.*
- **E2 — the most serious functional gap.** Let attendance be **corrected**: append a superseding entry
  with a reason, and relax `evidenceMatches` to "the latest entry wins". Today a mis-recorded arrival
  time cannot be fixed at all, and the only lever is to change the *outcome*, which corrupts it.
- **E4** — add `confirmedAt`, so "was this ever confirmed?" stops scanning a jsonb array.
- **E5** — split **lifecycle** (`pending → confirmed → ended`) from **outcome** (`completed` /
  `didn't happen` / `disrupted`), so "cancelled" stops meaning two different things.
- **E6** — move `attendanceHistory` / `outcomeHistory` onto a real events table, matching the booking
  side, so history becomes queryable and reportable.
- **E7** — converge bookings onto the tour outbox (the better of the two designs).
- **E8** — delete the hardcoded policy sentence.
- **Acceptance:** an attendance correction is possible and auditable; no read path scans a jsonb array
  to answer a boolean; the state machine has no mutable terminal states; both features share one
  delivery implementation.
- **Risk:** high — schema migration plus a state-machine change. Land it alone, with the full suite
  green before and after.

### Phase 7 — i18n, tests, verification
- All three locales in lockstep (`en-CA`, `fr-CA`, `uk`); `tsc --noEmit` after any change that
  introduces an identifier; the server test config; i18n lint.
- **Acceptance:** no new lint failures; locale parity intact.

---

## 5. Decisions

### Settled

| # | Decision | Outcome |
|---|---|---|
| 5.1 | Admin's role in the request flow | **Admin-first triage, kept as today.** Order unchanged; a clock and an escalation are added. |
| 5.2 | Response window | **Decided: 12 hours per stage, capped against the tour, quiet-hours-aware** (§1.6) |
| 5.3 | Reconfirmation hardness | **Soft nudge, no auto-release**, with an Unconfirmed flag and an owner for the escalation (§1.7) |
| 5.4 | Intake questions | **Required** — and they need *building*, not enabling (G3) |
| 5.5 | Follow-up | **One** email after a completed tour, carrying the apply CTA |

### Now settled too

| # | Decision | Outcome |
|---|---|---|
| 5.6 | Reconfirmation escalation | **Fewer than 12 hours of runway, waking hours only** (§1.8) |
| 5.7 | Alternative slots | **Three, drawn from real computed availability** (§1.8) |
| 5.8 | A fifth intake question | **No** — keep the four the schema defines |

**Nothing is open. The plan is ready to execute.**

### Terminology to fix while we're in here

You mentioned the labels are mangled. On the tour side specifically:

- The chef sees **"Request sent"** for two different stages — split it (G2).
- The manager writes **"Arrival notes" / "Departure notes"**, but the confirmation email calls the same
  content **"Meeting instructions"** — and currently fills it from an entirely different field (G1).
  One name, one source.
- `pending_local_cooks` is an internal identifier leaking into user-facing strings. Keep it in the
  database; give it a human label in the UI.

---

## 6. Deliberately not doing

- **Removing the two-tier approval.** You've made the trust case and I accept it; the plan reduces
  its cost rather than its existence.
- **A video tour as a tour substitute.** Peerspace recommends it, but it's the wrong goal here — your
  tour is due diligence, not a venue preview. Richer content makes the visit *better*, not unnecessary.
- **Charging for tours.** Peerspace permits it; it would suppress exactly the serious demand you want.
- **Rewriting the delivery outbox.** It is the strongest part of the engine — lease-based claiming,
  per-tour FIFO, idempotency, stale-event downgrade. Converge bookings *onto* it instead (E7).
- **A big-bang engine rewrite.** E5 and E6 are real problems, but they should land as a tested
  refactor with a migration, not as a rewrite bolted onto feature work.
- **Auto-releasing a slot when a chef doesn't reconfirm.** No comparable platform does this, and it
  punishes the person who missed a notification — the exact failure mode to avoid (§1.2a).
- **A follow-up cadence.** One email, not three to six touches.

---

## 7. Verification

Per the project's own rules: `tsc --noEmit` after any change that introduces a new identifier;
server tests via the server config; client tests attributed by file name against the recorded
baseline; `npm run i18n:lint` with parity across all three locales; and no commit or push — the
worktree stays with you.
