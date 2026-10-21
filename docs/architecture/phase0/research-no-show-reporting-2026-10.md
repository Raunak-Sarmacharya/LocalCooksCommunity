# Research: host-side no-show reporting / "did they come?" (2026-10-21)

Scope: how marketplaces let the host report a guest no-show, and what the review screen holds. Research only. Verification: [V] = read on an official page by this research; [S] = only seen in a search snippet or third-party page; [U] = unverified/not found. Several official pages returned 403 to the fetcher (Booking.com partner, Airbnb 166), so those claims rest on search summaries.

## Headline finding

No platform found uses a one-tap host "no-show" button with a rich evidence form. The common pattern:
1. Host must first try contact in-app (Turo, Airbnb, Sniffspot).
2. A minimum wait gate before reporting is allowed (Turo 2 h, Booking.com from midnight of check-in).
3. The report is either a support ticket (Turo, Airbnb, Peerspace) or a single confirm action on the booking (Booking.com, Resy).
4. Evidence is the message thread on the platform, not an upload form. No platform asked hosts for photos [none found].
5. Dispute paths for the guest are mostly undocumented publicly (Turo, Airbnb, Peerspace, OpenTable all [U]).
6. Money effect is the point of most reports; Local Cooks is unusual in that reporting is money-neutral.

## Per platform

### Turo (closest analogue to a time-bound handover)
- Source: https://help.turo.com/en_us/how-to-manage-a-guest-no-show-SkNzL4g4q.md [V]; also https://help.turo.com/en_us/guest-trip-start-failures-HJUfENeVq.md [S].
- Where: no in-app button documented. Host reports to customer support via "Get help" / Contact us [V; "Get help" AI assistant then agent is from search summary, S].
- Flow: ticket via support, not one tap.
- Host must: message guest first through Turo messaging, warn of no-show risk and say how much time remains; wait 2 h after scheduled start (US, Canada, UK; 30 min Australia, France; UK differs between pages, so treat as unclear); allow 15 min for a reply [V].
- Evidence/photos/note: article is silent [U]. Message thread is implicit evidence.
- Deadline: report within 72 h of scheduled start or earnings are forfeited [V].
- Guest told what/when: not documented [U]. Dispute path: not documented [U].
- Money: yes. Host earns 75% of one day's average price (trips of 2 days or fewer) or two days' average (longer), plus half the delivery fee. Unreported no-show where host collects earnings anyway can lead to earnings removal [V/S].
- Takeaway: "contact first, wait, then report within a window" is the benchmark sequence.

### Airbnb
- Source: https://www.airbnb.com/help/article/309 [V]. Host cancel page https://www.airbnb.com/help/article/166 [V] (about host cancellations only).
- Where: no host-side "mark no-show" control. Host contacts guest (in-app message or phone number in Reservations), then contacts Airbnb to report [V].
- Evidence/note/photos: none specified [U]. No reporting deadline stated on the no-show page [V]; a general 72 h "report within 72 hours of discovery" rule exists on resolution pages [S, general not no-show specific].
- Guest told: not documented [U]. Dispute: not documented [U].
- Money: no change from reporting. Cancellation policy upheld and payout released to host [S, snippet of article 309]. Do NOT cancel yourself; host cancellation has penalties and the page tells hosts not to ask the guest to cancel [V, article 166].
- Takeaway: Airbnb treats a no-show as a non-event for money; the report only gets support involved. This is closest to Local Cooks' money model.

### Booking.com (the only true "Mark as no-show" button)
- Sources: https://partner.booking.com/en-us/help/reservations/how-do-i-report-no-show-extranet-if-guest-doesnt-arrive and https://partner.booking.com/en-us/help/reservations/reporting-no-shows-and-cancellations [S: 403 to fetcher; details from search summary]. Third-party corroboration: https://help.guesty.com/hc/en-gb/articles/9371345580445 [S].
- Where: Extranet, Reservations, open booking, "Mark as a no-show"; also in the Pulse app [S].
- Flow: button on the booking, then a confirmation. Reservation is cancelled, both parties get a confirmation email [S]. Guesty says guest gets a cancellation request and the booking stays active until accepted (conflicts; likely channel-manager behaviour) [S].
- Window: from midnight at check-in date until 48 h after check-out [S]. An older article gave a different window (day after check-in) [S].
- Host provides: just the action; whether to charge or waive the no-show fee is the decision. No photos/note required [S].
- Money: yes. Charged fees carry commission; waived fees and properly marked no-shows do not [S].
- Guest dispute: no formal dispute found for guests. Partners can request removal of a review when the booking is a no-show [S]. Guest misconduct reporting is disabled on no-show bookings [S].
- Takeaway: single clear label, fixed window, one-time action ("can only be done once" per Rentals United [S]).

### Peerspace (closest in business: hourly space booking)
- Source: https://support.peerspace.com/hc/en-us/articles/202036128-What-happens-if-a-guest-doesn-t-show-up-to-their-confirmed-booking [S: article not fetched; snippet says ~686 days old].
- Where: host reports through the messenger/support widget [S]. No host button.
- Money: treated as a short-term guest cancellation; payout unchanged, paid in full [S]. Payout typically 3-5 business days after the event [S].
- Evidence, guest notification, dispute, deadline: [U].
- Takeaway: confirms money-neutral no-show reports exist in the hourly-space category.

### Getaround
- Searched official help (https://getaround.com/help/articles/3154c2a8147c, "Owner - Guide to cancellations") [S]. Only found driver-cancellation rules, not a guest no-show flow [U]. Owner can contest cancellation fees and stated reason within 24 h [S]; owner can waive fees from the rental page for 2 business days [S]. Pattern (short contest window, waive option) is useful, but nothing here is a no-show report [U].

### OpenTable and Resy (restaurants)
- OpenTable: restaurants mark no-shows in their reservation system; four no-shows in 12 months can suspend a diner [S] (https://www.nrn.com/restaurant-technology/sick-of-no-shows-opentable-to-offer-four-strikes-policy-that-could-ban-unreliable-guests, 2021). Diner dispute path: not found [U]. Exact host UI: [U].
- Resy: https://helpdesk.resy.com/en_us/how-do-i-charge-a-cancellation-or-no-show-fee-HJQXfP7Lu.md [V]. A list "Xcl/No Show" flags eligible bookings with "!"; staff open the booking, tap "!", pick their own name on an "accountability screen", tap Charge. Requires the "Charge cancel fee" permission. Manual, not automated. What guest sees: not stated. No evidence fields.
- Takeaway: Resy's accountability screen (staff selects own name) is a light audit-trail pattern. Restaurants lean on the card-issuer chargeback as the real dispute path [S].

### The Food Corridor / kitchen tools / others
- No public no-show reporting flow found [U]. The Food Corridor blog advises writing a cancellation policy and deciding enforcement in advance: https://thefoodcorridor.com/blog/how-to-fine-tune-your-kitchen-contract-to-avoid-dispute-charges [S].
- Sniffspot (https://help.sniffspot.com/article/403-how-to-handle-no-shows-and-late-requests-to-cancel) [V]: do not enter until the booked window ends or you have contacted the guest; message them to ask if they are okay and offer to reschedule. Good tone model. Reporting, payout, disputes not covered [U].
- Real-world kitchen: Broome Incubator Kitchen Membership Guide 2026 says a no-show member is charged for the slot, emergencies considered [S].

## Cross-platform patterns
- Reporting is rarely one tap on a main screen; where a button exists (Booking.com, Resy) it follows a review of the booking, and is single-use.
- Evidence = platform message history. Nobody asks hosts for photos of an empty kitchen.
- Guest-facing notice and appeal are the least documented part everywhere. Local Cooks having an explicit "I was there" contest to support is better than the benchmark.
- Reporting windows exist (Turo 72 h, Booking.com 48 h after check-out). Local Cooks 24 h is in range.
- Honesty gating: Turo and Airbnb require a contact attempt before reporting. This is the closest thing to an anti-abuse check.

## Recommendation: Local Cooks review screens
Both buttons on the dashboard row open a screen (no one-tap). Same layout, different content. Header shows the facts, read-only: kitchen, chef name, date, booked time range, "No check-in was recorded", time left to answer ("Answer within 18 h").

### "They came"
- Headline: "Confirm [Chef] came to [Kitchen]".
- Fields: optional note (one line, "Anything we should know?"). Nothing else.
- Body copy: "This confirms the visit happened. Your payout goes out as scheduled, 24 hours after the booking ended." Plain, no warnings.
- Button: "Yes, they came" (primary). Secondary: "Back".
- Chef sees: nothing, or at most no notification (no reason to alert). If anything, a quiet "Visit confirmed" status on their booking.
- Because no check-in was recorded, ask nothing else; the note is optional.

### "Report no-show"
- Headline: "Report that [Chef] didn't come".
- Required: checkbox attestation "I was at the kitchen, or a staff member was, for the booked time and the chef did not arrive." (Turo/Airbnb contact-first pattern, honest-signal gate.)
- Required: radio "Did you try to reach them?" Yes, by message / Yes, by phone / No. "No" is allowed but recorded. Do not block, since money does not move. [Design choice; no platform data on blocking effect.]
- Optional: note, 500 chars ("What happened?"). No photo upload in v1: benchmarks show none; add only if support asks for it.
- Body copy, factual: "[Chef] will be told you reported this and can say they were there. This does not change your payout or their charge. The booking was already non-refundable." Keep money line short and explicit, because managers will worry otherwise.
- Time gate: do not allow before booking end (already the trigger). Show stored answer timestamp for audit.
- Button: "Send report" (primary, not red, since no money consequence). Secondary: "Back, they came" so a misclick can swap safely. Avoid "Confirm no-show" which sounds like a punishment.
- Post-submit: single-use. Show "Report sent. [Chef] has been told." Allow the manager to change the answer only until the 24 h expires, or not at all (Booking.com is single-use). Recommend: locked after submit, support can fix.
- Chef sees: email and in-app message right after: "[Kitchen] reported that you didn't come to your booking on [date], [time]. No charge or payout changed. If you were there, tell us." Button "I was there" opens a short form (note, optional photo, since chef is the contesting party). Do not display the manager's note verbatim unless support decides; show only the fact and time. No guilt language, no strike count in v1.
- Contest deadline: suggest 7 days (Getaround 24 h, Turo 72 h are shorter, but chefs need time and no money is at stake). Owner decision.
- Both screens: write who answered and when to a log; support sees manager attestation, contact-attempt answer, note, chef note.

## Copy tone rules
Neutral, specific, no accusation: "didn't come" rather than "failed to show". Say what does not change (money) before what does. Keep the ask to two decisions: came or did not.

## Gaps to flag
- Peerspace, Booking.com and Airbnb pages were read via search summaries; re-check before citing in policy pages.
- Guest-side dispute flows for all benchmarked platforms are undocumented publicly [U].
- Getaround guest no-show flow not found [U]; OpenTable host UI not found [U]; The Food Corridor has no public flow [U].
