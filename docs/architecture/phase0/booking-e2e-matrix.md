# Kitchen booking — end-to-end test matrix (live on dev, synthetic accounts, Stripe sandbox)

Owner goal (2026-10-15): the booking cycle (storage excluded) at parity with The Food Corridor / Kitchen Door, Peerspace, Airbnb, Turo;
tested end to end without assumptions. Every row is run live on dev with: booking id, what each side saw (page + notice/email),
money checked against `payment_transactions` and Stripe, and the result. Status: ✅ pass · ❌ fail (→ finding) · ⏳ not yet run.

Accounts: chef 380 (phase0-chef), kitchen manager 379 (phase0-manager), kitchen 54 / location 47, admin (test_admin, email toggle on).
Time control: `.phase0-harness/shift-booking.mjs` (synthetic bookings only) to bring a visit to "now" when a path needs it.

## A. Discover and request
| # | Path | Expect | Status / evidence |
|---|---|---|---|
| A1 | Listing page | photos/placeholder, hours, price + "HST and service fee" hint, map, cancellation summary, Book | ✅ Oct 15 (tour removed, map, hint) |
| A2 | Booking form | slots with "Booked", Stripe-matching lines, add-on inline, policy + near-deadline warning, deadline line | ✅ #168 (lines, Booked, deadline cap) |
| A3 | Stripe Checkout | "Book" + card-hold note; manual capture | ✅ #168 |
| A4 | Booking window | dates beyond the kitchen window disabled; server rejects | ✅ Oct 23: 45-day window → Dec 7 bookable, Dec 8+ disabled "Beyond how far ahead you can book"; server rejection covered by booking-availability tests. Month arrows now stop at the last bookable month |
| A5 | Turnover buffer | with toggle on, adjacent hour unavailable; server rejects | ✅ Oct 23: 1 h buffer around #232 (1–2), #195 (3–4) and #209's day (5–6) → 1–7 p.m. taken, 7–11 free; server covered by booking-buffers tests |
| A6 | Request pending | chef: hold + deadline, one cancel entry, no calendar; kitchen: Review request + deadline; admin: summary | ✅ #166/#168 |

## B. Kitchen response
| B1 | Approve all | charged; confirmed notices (chef, kitchen, admin) | ✅ #166/#168 |
| B2 | Approve some, decline an add-on | partial charge = approved items; chef told what was declined | ✅ #169 after fixes 461a4f3d (charged $30.50, oven 'Not charged'; kitchen share was inflated $57.50 → fixed; chef now told 'Not included') — add-on can't be approved without the session (UI lock + server cascade) |
| B3 | Decline the request | hold released; chef "find another time"; admin summary | ✅ #171 after f01268d9/17f2a028 (chef 'couldn’t take your request' + Find another time; kitchen 'You declined…'; admin 'Request declined'). Open: optional decline reason (#53) |
| B4 | Request expires (no response) | hold released at deadline; chef + kitchen told; admin "Request expired" | ✅ #230 (9:00:18 p.m., Stripe cancelled same second) and #227 (11:35:39 p.m., $61 released); both sides + admins told |
| B5 | Chef withdraws pending | hold released, no charge; kitchen + admin told | ✅ #172 (one cancel entry, no calendar; 'Request withdrawn' / 'TestSprite chef withdrew…' / admin). Wording tidy cb865fe9 |

## C. Before the visit
| C1 | Chef cancels before deadline | refund = paid − actual fee; chef/kitchen/admin wording | ✅ #167/#168 |
| C2 | Chef cancels after deadline | per policy (100%/50% of total); kitchen payout per policy; wording | ✅ #174 (booked inside window: short-notice warning at checkout; refund $0; kitchen keeps $27.32; admin facts). Copy fixed in batch: 'saved policy' jargon, dialog reason, admin '$0 refunded' noise. kitchen payout released at the first tick after the booked end (✅ #174 3:30 p.m., #188 11:30 a.m. Oct 23) |
| C3 | Kitchen cancels (kitchen-caused) | full refund incl. fee; chef apology + reason + "find another time" | ✅ #169 money ($30.50 back incl. fee) + chef apology with reason; ❌→fixed in batch: kitchen told 'The chef cancelled' (#61); data label #62 open |
| C4 | Settings change (cancellation policy) | preview, applies to new bookings only, existing keep terms | ✅ Oct 23: 24→48 h with preview + "I understand" confirm; #190 kept "Cancel by Oct 24 11:00 a.m." (24 h), new checkout for Oct 28 6:00 a.m. showed Oct 26 6:00 a.m. (48 h); restored to 24 h |
| C5 | Change booking (kitchen) | proposal → chef accepts/declines; money delta | ✅ as designed: kitchen side = accept some / suggest other times (policy rows 16–18; #231 partial acceptance, $372.10 captured, $91.50 released); confirmed-booking changes are chef-requested (#190 approved +$30.50, #221 declined) |
| C6 | Messages chef ↔ kitchen | thread on booking, notices | ✅ Oct 23 #195 (chef on phone → kitchen reply). Fixed: 24-hour times → app clock, day dividers, translated "You" |
| C7 | Running late | chef reports; kitchen told; no-show alert deferred | ✅ Oct 23 #195: phone report 2:31 (opens 30 min before) → kitchen bell + activity; kitchen booking page line + note (was missing: details route lacked it, fixed) |
| C8 | Early start granted by kitchen | free ≤30 min / paid offer | ✅ #228 free early start 5:30 (Oct 22) |

## D. Visit
| D1 | Check-in with staff code | recorded as code; kitchen sees "with the check-in code" | ✅ #166; text re-verified Oct 23 on #229 ("checked in with the check-in code"). Self check-in ✅ #195: kitchen turns it on (reason + "I understand"), customer "I'm at the kitchen. Check in", kitchen sees "Checked in 2:59 p.m. on their own" |
| D2 | Can't get in / kitchen not ready | report from check-in opening → kitchen + Local Cooks; admin resolves (cancel kitchen-caused or goodwill amount) | ✅ #229: report → kitchen dashboard first item, banner, high-priority notices (admin email delayed → fixed); admin assign → acknowledge → resolve; $5 Local Cooks refund (kitchen payout unchanged) |
| D3 | Extra time requested (any time in session) | options, hold, kitchen approve charge/free/decline | ✅ paid #166, #186 approved+charged; free offer #186 |
| D4 | Kitchen offers more time | chef accepts/pays | ✅ #186 free offer |
| D5 | Early checkout | confirmation "unused time not refunded" | ✅ #186 |
| D6 | Overstay | Past end time; kitchen records departure; extra-time charge; chef pays or disputes | ✅ #194 charged+paid $13.73; #228 charge → withdraw → No charge; #229 charge $15.26 → dispute → Local Cooks reduced to $7.50 → paid (built Oct 22) |
| D7 | No-show | no check-in → kitchen alert; no-show outcome; money per policy | ✅ Oct 23 #232: check-in-open 12:45:11, kitchen "hasn't checked in" 1:15:18; after the 15-min end: "Did they come?" (dashboard + page, now aligned) → Report no-show (contact checkbox + note) → customer + admins told, no refund, payout unchanged → customer "I was there" → Local Cooks + kitchen; profile "1 no-show · 2 under review" |

## E. After the visit
| E1 | Inspection all good | payout released immediately (one notice) | ✅ Oct 23 #229: finish inspection → released; Stripe refused the charge-linked transfer after the $5 Local Cooks refund (fixed: platform-funded) → $27.32 + $6.49 extra time sent on the next ticks; "You've been paid" notices |
| E2 | Inspection auto-closes after 24 h | payout automatically | ✅ earlier sweep |
| E3 | Damage claim → paid | Local Cooks review, ask info, reply privacy, send reduced, chef pays, transfer | ✅ #166 |
| E4 | Damage claim → chef disputes → final decision | reduce/uphold/reject; 7-day hold if unpaid | ✅ #186: filed → admin sent → disputed → reduce & uphold $20 → paid → kitchen $20 |
| E5 | Local Cooks pays the kitchen | chef never contacted | ✅ earlier (#152) |
| E6 | Feedback / rating | chef rates; kitchen private feedback | ✅ Oct 23 #229: both sides 4★ + tags + note (phone sheet); private (neither sees the other); admin sees both, low tag flagged. Opens after inspection/close-out (owner) |
| E7 | Receipt / invoice / payout statement | chef receipt incl. extras; kitchen statement | ✅ Oct 23 #229: customer receipts (session $30.50, extra time $7.50, refund −$5.00) and kitchen remittances ($27.32, $6.49) as PDFs. Fixed: extra-time line printed an empty "10:00–10:00 p.m."; refund line said "Goodwill" |
| E8 | Admin goodwill refund (custom amount) | amount ≤ remaining; > $25 needs reason; chef notified | ✅ #229 $5 (cap shown $30.50, note required, chef told). Fixed: kitchen card showed "Refunded $5 of $38" (SQL bug) and the kitchen payout then failed in Stripe (charge-linked transfer above what was left) → platform-funded |

## F. Cross-cutting
| F1 | Lists (chef cards, kitchen agenda) match the booking page in every state above | ✅ spot-checked Oct 23 (today/needs action/answer needed); fixed dashboard vs page "Did they come?" timing and "In the kitchen now" before check-in |
| F2 | Notifications per recipient (no wrong-audience text; admin = Local Cooks summary; toggle-only emails) | per row |
| F3 | Mobile (390) on booking page, visit page, lists | spot-check |
