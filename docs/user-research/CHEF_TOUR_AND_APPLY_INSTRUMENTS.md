# Chef Tour & Apply — Research Instruments

Companion to `CHEF_TOUR_AND_APPLY_RESEARCH_PLAN.md`. These are ready-to-use, with
placeholders in `{{braces}}`.

---

## 1. Screener

Collect: name, email, phone, timezone, device, and the routing answers below.

```
S1. Do you currently run or work in a food business (catering, bakery, meal prep,
    packaged goods, etc.)?
    [ ] Yes  [ ] No  → No = screen out
S2. Have you ever rented, or tried to rent, a commercial kitchen space?
    [ ] Yes, currently renting
    [ ] Yes, in the past
    [ ] Considered it, never rented
    [ ] Never considered it          → screen out
S3. Do you have a Local Cooks account?
    [ ] No
    [ ] Yes
    [ ] Not sure
S4. (If S3 = Yes) Which best describes your most recent request on a kitchen?
    [ ] I requested a tour
    [ ] I requested to apply / applied
    [ ] Both
    [ ] I only browsed
    [ ] I'm not sure
S5. If you applied, what was the status the last time you checked?
    [ ] Just submitted / new
    [ ] In review
    [ ] Approved
    [ ] Rejected
    [ ] Cancelled
    [ ] I never applied
S6. What device would you use for a 45-minute session?
    [ ] Desktop/laptop   [ ] Tablet   [ ] Phone
S7. Do you work for or with Local Cooks in any capacity (e.g. engineering,
    design, support)?
    [ ] Yes  → screen out   [ ] No
```

**Routing:** S3 = No → cells **G-T / G-A**. S3 = Yes → cells **E-T / E-A**, using S4 to pick.

---

## 2. Moderated usability session script

**Length:** 45–60 min. **Setup:** published app, seeded test account matching the cell,
screen + audio recording, think-aloud priming.

### 2.1 Opening (5 min)

> "Thanks for helping. We're looking at how chefs find and get into kitchens on this site.
> There are no wrong answers — you can't break anything, and we're testing the product, not
> you. Please think out loud as you go: say what you're looking at and what you expect to
> happen. I won't answer questions about what to click; if you're unsure, do what you'd
> naturally do and tell me what you're thinking."

Confirm: consent to record ✓ · pseudonym use ✓ · may stop anytime ✓

### 2.2 Warm-up (5 min)

- Walk me through the last time you looked for a kitchen space. What were you trying to
  work out before committing?
- How did you decide a place was worth visiting?

### 2.3 Tasks

**T1 — Browse and evaluate** *(all cells)*

> "Have a look at this kitchen and tell me whether you'd want to work here."

Watch for: what they read first, whether they find rate/availability, whether trust cues
(the licence badge) register.

**T2 — Request a tour** *(all cells)*

> "Now request a tour of this kitchen."

Then, immediately after the click and *while the app is still working*:

> **"What is the app doing right now? How do you know?"**

Watch for: whether they notice a wait at all; whether they click again; whether the button
relabelling reads as a state change or a glitch.

**T3 — Request to apply** *(all cells)*

> "Now request to apply to this kitchen."

Watch for: the date-gate interaction — do they understand they must pick a date first, or
do they read it as a failure?

**T4 — The date gate** *(all cells; only if the gate fired in T3)*

> "That asked you for a date. Finish what it wanted and continue."

Probe: *"What did you think had gone wrong, if anything?"*

**T5 — Return to an engaged kitchen** *(E-cells only)*

> "Here's a kitchen you already got in touch with. What would you do next, and how do you
> know that's the right thing?"

Watch for: do they interpret "Tour pending" / "Application in progress" correctly?

**T6 — Terms** *(all cells reaching the apply form)*

> "Finish this form."

**Do not prompt them to read the terms.** After they submit, ask: *"Did you read the
agreement before continuing? What do you think you agreed to?"*

### 2.4 Closing (5 min)

- Throughout this, was there any moment you weren't sure the app was doing anything?
- If you could change one thing about this flow, what would it be?
- Anything you expected to see that wasn't there?

### 2.5 Observer tally sheet

```
Session: ____  Cell: ____  Device: ____  Date: ____

Per-task:
  T__  Completed? [Y/N]   Time to complete: ___   Clicks on pending CTA: ___
       Hesitations / backtrack: ______________________
       Verbatim "what is the app doing" answer: ______________________

Noticed a wait?        [ ] yes  [ ] no     Where: ____________
Second-click on a CTA? [ ] yes  [ ] no     Why:  ____________
Misread a state swap?  [ ] yes  [ ] no     Which: ____________
Terms dwell:           ___ s              Read fully? [ ] yes [ ] partially [ ] no
```

---

## 3. Semi-structured interview guide

**Length:** 45 min. First half is product-free; product only in the second half, if at all.

### 3.1 Current behaviour (no product)

1. Tell me about your food business right now — what are you selling, and where do you do
   the work?
2. Walk me through how you found your current (or last) kitchen space.
3. What were you trying to find out before you committed to a place?
4. What made you rule a place out?

### 3.2 Concepts (no product)

5. When someone says "kitchen tour", what does that mean to you?
6. What would you expect to happen after you ask for one?
7. If a place says "request to apply" rather than "book", what's the difference in your
   mind?
8. What do you expect a platform to check before letting you use a kitchen?

### 3.3 Experience with the flow (light product use)

9. Take me back to the last time you requested a tour or applied. What happened, step by step?
10. How did you know whether anything was progressing?
11. What did you do while you waited?
12. If you didn't finish, what stopped you?

### 3.4 Trust

13. What do you look for in the terms or policies before agreeing to something like this?
14. How much of it do you actually read?

### 3.5 Closing

15. If you were designing this for yourself, what's the one thing you'd insist on?

---

## 4. Diary study prompts

Delivered by email or SMS, once per day for 7–10 days after the participant submits a
request. Each entry takes under two minutes.

```
Day __ prompt:

1. Did you think about {{kitchenName}} or your request today?
   [ ] Yes  [ ] No
2. If yes — what were you wondering or trying to do?
3. Did you check the site or your email for an update?
   [ ] Yes  [ ] No
4. How confident are you that your request is being handled?
   (1 = certain nothing is happening … 5 = certain it's being handled)
5. Anything you wish the site had told you today?
```

**Analysis:** plot confidence over days per participant. A drop in confidence on days with
no outbound communication is direct evidence for the "silence after submission" problem,
which is the root cause behind several friction points observed in the lab.
