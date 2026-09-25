# Chef Tour & Apply — Analysis Template

Fill in during and after fieldwork. Companion to `CHEF_TOUR_AND_APPLY_RESEARCH_PLAN.md`.

---

## 1. Study log

| Field | Value |
|---|---|
| Build tested (commit / deploy) | |
| Baseline captured? | yes / no — if no, explain why |
| Sessions run | G-T __ / G-A __ / E-T __ / E-A __ |
| Interviews run | __ |
| Diary participants / days | __ / __ |
| Devices covered | desktop __ · tablet __ · mobile __ |
| Date range | |

**Known confounds** — record anything that weakens comparisons (e.g. fixes shipped mid-study,
one cell under-recruited, a deploy during capture):

-

---

## 2. Funnel

### 2.1 Stage counts

| Stage | G-T | G-A | E-T | E-A |
|---|---:|---:|---:|---:|
| Preview page viewed | | | | |
| CTA visible (apply) | | | | |
| CTA visible (tour) | | | | |
| Apply CTA clicked | | | | |
| Tour CTA clicked | | | | |
| Date gate fired | | | | |
| Date picker opened | | | | |
| Apply form started | | | | |
| Terms seen | | | | |
| Terms checked | | | | |
| Submitted | | | | |

### 2.2 Wait intervals — report p50 **and** p90, never just the mean

| Interval | p50 | p90 | max | n |
|---|---:|---:|---:|---:|
| `application_state_request → resolved` | | | | |
| `tour_state_request → resolved` | | | | |
| CTA click → next visible state change | | | | |
| `date_gate_invoked → date_picker_opened` | | | | |
| Terms seen → terms checked | | | | |

> Interpretation rule: any interval whose **p90 exceeds ~1s with no visible feedback** is a
> perceived stall by definition (H1), regardless of what the p50 says.

### 2.3 Corrective-action rates

| Signal | Rate | Interpretation |
|---|---:|---|
| Rage-click on pending/disabled CTA | | H1 |
| Repeat navigation to the same CTA | | H1 |
| Click within 2s of a state/label swap | | H2 |
| Back-navigation during a wait | | H1 |

---

## 3. Qualitative coding sheet

One row per observation, session, or interview statement. **Every row must be assigned a
bucket** — this is the discipline that stops a meaning gap being "fixed" with a spinner.

```
ID | Source (S#/I#/D#) | Bucket | Observation (verbatim where possible) | Severity | Conf.
```

**Bucket legend**

- **PS** Perceived stall — app working, chef can't tell
- **SA** State ambiguity — state changed, chef misread it
- **SF** Sequencing friction — step order fights intent
- **MG** Meaning gap — chef doesn't understand the concept

**Confidence column** — how many of the three sources corroborate:

- `3` = instrumented + session + interview (promote to recommendation)
- `2` = two sources (promote, note the gap)
- `1` = single source (log as candidate, needs verification)

---

## 4. Severity scoring

Score each finding 1–5 on each axis.

| Axis | 1 | 3 | 5 |
|---|---|---|---|
| **Impact** | cosmetic annoyance | blocks the task but recoverable | task cannot be completed |
| **Frequency** | one participant, once | several participants, sometimes | most participants, most attempts |
| **Confidence** | single source, unverified | two sources agree | instrumented + observed + reported |

**Priority = Impact × Frequency × Confidence** (max 125).

| Finding | Bucket | I | F | C | Priority | Suggested fix class |
|---|---|---:|---:|---:|---:|---|
| | | | | | | |

---

## 5. Results skeleton

Write this only after the severity table is complete. Sections map to the four buckets so
that each finding family gets one coherent set of recommendations.

### 5.1 Headline

One paragraph: the single most important thing we learned, and the one change that follows.

### 5.2 Perceived stalls (PS)

**Finding.** …
**Evidence.** Instrumented p50/p90 for ________; observed in __ / __ sessions; corroborated
by __ interviews.
**Recommendation.** …

### 5.3 State ambiguity (SA)

**Finding.** …
**Evidence.** …
**Recommendation.** …

### 5.4 Sequencing friction (SF)

**Finding.** …
**Evidence.** …
**Recommendation.** …

### 5.5 Meaning gaps (MG)

**Finding.** …
**Evidence.** …
**Recommendation.** …

### 5.6 Hypotheses verdict

| Hypothesis | Verdict | Evidence summary |
|---|---|---|
| H1 Unlabelled waits read as breakage | supported / rejected / mixed | |
| H2 Silent state swaps feel like glitches | | |
| H3 Terms placement interrupts commitment | | |
| H4 Guests abandon at an unexplained account wall | | |
| H5 Returning chefs lack context | | |

### 5.7 Before / after

Only meaningful if a baseline was captured. State plainly whether this is a controlled
comparison or quasi-experimental.

| Metric | Baseline | After fixes | Change | Caveats |
|---|---:|---:|---:|---|
| | | | | |

### 5.8 What we still don't know

List the open questions and what study would close each one. This section is mandatory —
the absence of it is how a research programme quietly becomes advocacy.
