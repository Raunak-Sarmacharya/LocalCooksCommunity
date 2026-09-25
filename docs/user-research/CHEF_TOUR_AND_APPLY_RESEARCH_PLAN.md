# Chef Kitchen Tour & Request-to-Apply — User Research Plan

**Scope:** the chef-side journey from discovering a kitchen on the preview page, through
*Request a tour* and *Request to apply*, including guest → registered conversion and the
experience of chefs who already have an account.

**Status:** plan ready for execution. No fieldwork has been run yet.

---

## 1. Why this research, and what changed

The functionality of both journeys works end to end. The known problem is not correctness
but **perceived responsiveness and sequencing**: there are no intermediate loaders between a
click and a server-resolved outcome, and the acceptance-of-terms step sits in a place that
forces the chef to read it before they have finished the form.

This work is therefore framed as **two research tracks running together**:

| Track | Question it answers | Primary method |
|---|---|---|
| **A. Journey & friction audit** | Where exactly does the flow lose people, and why? | Instrumented funnel analysis + moderated usability sessions |
| **B. Needs & mental-model discovery** | What are chefs actually trying to achieve, and what do they believe is happening? | Semi-structured interviews + diary study |

Track A tells us *where*. Track B tells us *why*, and prevents us from solving the wrong
friction. A loader is a fix for a *perceived* stall; it is only the right fix if chefs
experience the stall as "the app is broken/waiting", not as "I don't know what a tour even
gets me".

### The specific hypotheses under test

Each is falsifiable and maps to a measurable signal.

- **H1 — Unlabelled waits read as breakage.** When the preview page resolves application
  state or tour availability, the chef cannot tell the app is working. Predicts: rage-clicks
  on the CTA, repeat navigations, early abandonment on the dock CTA.
- **H2 — The CTA changing label/state without a transition feels like a glitch.** A button
  that appears, disappears, or silently swaps its label between "Request a tour" and "Tour
  pending" is read as a rendering error rather than a state change.
- **H3 — Terms placement interrupts a value-building moment.** Requiring a checkbox
  acknowledgement before the form is complete asks for a commitment before the chef has
  seen what they are committing to, lowering submit confidence.
- **H4 — Guests abandon at the account wall because the *why* is unclear.** The requirement
  to create an account / verify email is understood as a barrier to information, not as a
  step toward booking.
- **H5 — Existing chefs' biggest pain is loss of context on return.** A chef who already
  applied does not reliably understand whether they should tour, apply, or wait.

---

## 2. Research questions

Ordered so that the cheap, high-signal questions are answered first.

### Journey mechanics (Track A)

1. At which screen and which click does a chef stop, in each of: guest → tour, guest → apply,
   registered → tour, registered → apply?
2. How long is the observable "dead" interval between a click and a visible response, per
   surface (dock CTA, sticky card, tour fact card, date-gate jump)?
3. Which CTA state changes (appear / disappear / relabel / disable) provoke a corrective
   action such as a second click, a scroll, a back-navigation, or a page reload?
4. Where does the date-gate interaction ("pick a date first") get mistaken for an error?

### Meaning and motivation (Track B)

5. What does a chef believe a "kitchen tour" is, what does it accomplish, and what happens
   after they request one?
6. What does "request to apply" mean to them, versus "apply", versus "book"? Where do these
   collapse into a single idea?
7. What do they expect to happen between submitting a request and hearing back, and how do
   they judge whether anything is happening at all?
8. What makes a kitchen feel worth the effort of touring or applying — and at what point
   do they decide to commit?
9. For an existing chef, what do they need to see on returning to a kitchen they already
   engaged with?

### Trust and consent (Track B, secondary)

10. Do chefs read the terms before accepting, and what do they look for in them?
11. Does the placement of the terms acknowledgement change whether it feels like a formality
    or a genuine agreement?

---

## 3. Participants and screening

The research must separate **guests** from **existing users**, because they face different
decision points. Recruit into four cells:

| Cell | Definition | Target n (interviews) | Target n (sessions) |
|---|---|---:|---:|
| G-T | Guest who has never toured or applied | 4 | 5 |
| G-A | Guest who has started an apply but not submitted | 4 | 5 |
| E-T | Registered chef, has or had an active tour | 4 | 4 |
| E-A | Registered chef, has an application (any status) | 4 | 4 |

**Screener essentials**

- Must be a chef / food-business operator who has used or considered a commercial kitchen
  rental platform.
- Cell G-T and G-A: must **not** hold a Local Cooks account.
- Cell E-* : must hold a Local Cooks account; capture the application status verbatim
  (`new | pending | inReview | approved | rejected | cancelled`) so quota-monitoring can
  balance the sample.
- Exclude anyone who works on this product, and anyone who has already given feedback on
  this specific flow (to avoid priming).

**Incentive**

- Interviews: modest gift card, tiered down for shorter sessions.
- Diary study: higher incentive reflecting multi-day participation.

**Anti-bias measures**

- At least 2 sessions in each cell must be run on a **mid-tier mobile device**, since the
  dock CTA and date picker are the mobile-critical surfaces.
- Every session must begin from the **published app**, never a local dev build — local
  builds do not reproduce production latency or auth gating, which is exactly the variable
  under study.

---

## 4. Methods

### 4.1 Instrumented funnel analysis — Track A, quantitative

The backbone. Use the existing app plus targeted instrumentation. Because the observed
complaint is about *waits*, the instrument must record timestamps, not just events.

**Instrument this event chain, with a timestamp on each:**

```
preview_cta_visible        { surface: dock|sticky|fact_card, cta: apply|tour, state }
preview_cta_click          { surface, cta, state_at_click, dates_ok }
application_state_request  { started_at }
application_state_resolved { resolved_at, resulting_kind }
tour_state_request         { started_at }
tour_state_resolved        { resolved_at, resulting_kind }
date_gate_invoked          { scrolled: bool }
date_picker_opened
request_to_apply_started   { step: plan|details, authenticated: bool }
terms_checkbox_first_seen
terms_checkbox_checked     { ms_after_first_seen }
apply_submitted            { tier }
tour_submitted
apply_abandoned            { last_step }
tour_abandoned             { last_step }
```

**Metrics to compute**

| Metric | Definition | Why it matters |
|---|---|---|
| Time-to-first-response | `resolved_at − request_at` per state query | The literal "no loader" interval |
| Click-to-feedback gap | `preview_cta_click → next visible state change` | H1: dead time the chef can perceive |
| Rage-click rate | clicks on a CTA already in a pending/disabled state | H1 |
| CTA relabel bounce | click within 2s of a label/state swap | H2 |
| Terms dwell | `terms_checkbox_first_seen → checked` | H3 |
| Drop-off by step | started → submitted, per step | Where the funnel leaks |
| Return-session confusion | re-entry to a preview with an existing app, followed by a second request attempt | H5 |

**Analysis:** funnel conversion per cell, plus a **p50/p90** distribution of the wait
intervals. Do not report only the mean — waits are long-tailed and the p90 is the felt
experience.

### 4.2 Moderated usability sessions — Track A, qualitative

Task-based, think-aloud, recorded. Roughly 45–60 minutes.

**Core tasks** (full script in the companion instrument doc):

1. Find a kitchen and decide whether it is worth touring.
2. Request a tour from the preview page.
3. Request to apply from the preview page.
4. Since the date-gate requires a date first, complete that and continue.
5. (E-cells only) Return to a kitchen you already engaged with — decide what to do next.

**The key probe**, repeated after each task: *"What is the app doing right now?"* and
*"How do you know?"* This converts an unlabelled wait into explicit evidence rather than
an inference from silence.

**Follow-up probe for H2:** *"Did that button just change? What did the change mean?"*

### 4.3 Semi-structured interviews — Track B, discovery

45 minutes, no product on screen for the first half. Ask about the real-world analogue —
how they currently find and vet a kitchen — before showing them anything. Full guide in the
companion instrument doc.

### 4.4 Diary study — Track B, longitudinal (optional but high value for H4/H5)

Over 7–10 days, chefs who have just submitted a request log short entries whenever they
think about the request: what they did, what they expected, whether they checked for a
response. This captures the *silence after submission*, which no lab session can reproduce.

**Ethical guardrails for all methods**

- Explicit consent to record; state the retention period.
- No PII in the analysis files — pseudonymise, and keep the mapping separate.
- Participants may stop any task at any time without losing the incentive.
- Never test on a real chef's live application data; use seeded test accounts.

---

## 5. Analysis framework

### 5.1 Coding scheme for qualitative data

Two passes, applied to session transcripts and interview notes.

**Pass 1 — open coding.** Free-form tags on each observation.

**Pass 2 — axial coding into four fixed buckets.** Every finding must land in exactly one,
which forces a decision about what kind of problem it is:

| Bucket | Definition | Typical fix class |
|---|---|---|
| **Perceived stall** | The app *is* working; the chef cannot tell | Loader / skeleton / progress copy |
| **State ambiguity** | The app changed state; the chef misreads it | Transition, explicit label, explanatory copy |
| **Sequencing friction** | The step order fights the chef's intent | Reorder (e.g. the terms checkbox) |
| **Meaning gap** | The chef does not understand the concept | Onboarding copy, glossary, inline explainer |

This is what keeps the whole exercise honest: a "meaning gap" cannot be fixed by adding a
spinner, and treating every complaint as a stall would produce a page of loaders that solves
nothing.

### 5.2 Triangulation

A finding is only promoted to a **recommendation** when it appears in at least two of:
instrumented data, session observation, interview statement. Single-source findings are
logged as *candidates* and flagged for verification.

### 5.3 Severity scoring

Rate each confirmed finding on **impact × frequency × confidence** (1–5 each). The composite
drives the prioritisation table in the results document. Full scales are in the analysis
template.

---

## 6. Deliverables

| Deliverable | Contents |
|---|---|
| This plan | Method, RQs, sample, instruments index |
| `CHEF_TOUR_AND_APPLY_INSTRUMENTS.md` | Screener, session script, interview guide, diary prompts |
| `CHEF_TOUR_AND_APPLY_ANALYSIS_TEMPLATE.md` | Funnel table, coding sheet, severity matrix, results skeleton |
| Results document *(produced after fieldwork)* | Findings by bucket, severities, prioritised recommendations |

---

## 7. Sequencing

The research is designed so the **first usable signal arrives early** and directly informs
the in-flight UI work.

1. **Instrumentation first.** Ship the events listed in §4.1. Until this exists, the funnel
   is guesswork.
2. **Baseline capture** on the current build, before the loader and terms-placement changes
   land — this gives a genuine before/after comparison rather than a retrofitted one.
3. **Run usability sessions** on the *current* build to capture the raw friction.
4. **Ship the fixes** (loaders + terms placement).
5. **Re-measure** the same metrics and re-run a smaller session set on the fixed build.
6. **Interviews and diary study** run in parallel with steps 2–5; they need no build.

> **Practical note.** Steps 2 and 3 depend on the current behaviour still being observable.
> If the fixes ship first, capture the baseline from session recordings and instrumented
> data already collected, and be explicit in the results that the comparison is
> quasi-experimental rather than controlled.

---

## 8. What this plan deliberately does not cover

- **Manager-side expectations.** Whether the manager's experience of receiving a tour or
  application shapes the chef's wait is a separate study.
- **Pricing and payment.** Out of scope; different decision model.
- **Visual design critique.** This is behavioural research; aesthetic preference is not a
  finding.
