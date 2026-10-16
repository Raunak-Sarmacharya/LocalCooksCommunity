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
| A4 | Booking window | dates beyond the kitchen window disabled; server rejects | ⏳ after WP-W deploy |
| A5 | Turnover buffer | with toggle on, adjacent hour unavailable; server rejects | ⏳ after WP-W deploy |
| A6 | Request pending | chef: hold + deadline, one cancel entry, no calendar; kitchen: Review request + deadline; admin: summary | ✅ #166/#168 |

## B. Kitchen response
| B1 | Approve all | charged; confirmed notices (chef, kitchen, admin) | ✅ #166/#168 |
| B2 | Approve some, decline an add-on | partial charge = approved items; chef told what was declined | ✅ #169 after fixes 461a4f3d (charged $30.50, oven 'Not charged'; kitchen share was inflated $57.50 → fixed; chef now told 'Not included') — add-on can't be approved without the session (UI lock + server cascade) |
| B3 | Decline the request | hold released; chef "find another time"; admin summary | ✅ #171 after f01268d9/17f2a028 (chef 'couldn’t take your request' + Find another time; kitchen 'You declined…'; admin 'Request declined'). Open: optional decline reason (#53) |
| B4 | Request expires (no response) | hold released at deadline; chef + kitchen told; admin "Request expired" | ⏳ |
| B5 | Chef withdraws pending | hold released, no charge; kitchen + admin told | ✅ #172 (one cancel entry, no calendar; 'Request withdrawn' / 'TestSprite chef withdrew…' / admin). Wording tidy cb865fe9 |

## C. Before the visit
| C1 | Chef cancels before deadline | refund = paid − actual fee; chef/kitchen/admin wording | ✅ #167/#168 |
| C2 | Chef cancels after deadline | per policy (100%/50% of total); kitchen payout per policy; wording | ✅ #174 (booked inside window: short-notice warning at checkout; refund $0; kitchen keeps $27.32; admin facts). Copy fixed in batch: 'saved policy' jargon, dialog reason, admin '$0 refunded' noise. ⏳ kitchen payout release at booked end |
| C3 | Kitchen cancels (kitchen-caused) | full refund incl. fee; chef apology + reason + "find another time" | ✅ #169 money ($30.50 back incl. fee) + chef apology with reason; ❌→fixed in batch: kitchen told 'The chef cancelled' (#61); data label #62 open |
| C4 | Settings change (cancellation policy) | preview, applies to new bookings only, existing keep terms | ✅ Save works; ⏳ change + new booking terms |
| C5 | Change booking (kitchen) | proposal → chef accepts/declines; money delta | ⏳ |
| C6 | Messages chef ↔ kitchen | thread on booking, notices | ⏳ |
| C7 | Running late | chef reports; kitchen told; no-show alert deferred | ⏳ |
| C8 | Early start granted by kitchen | free ≤30 min / paid offer | ⏳ |

## D. Visit
| D1 | Check-in with staff code | recorded as code; kitchen sees "with the check-in code" | ✅ #166 (method fix deployed later; ⏳ re-verify text) |
| D2 | Can't get in / kitchen not ready | report from check-in opening → kitchen + Local Cooks; admin resolves (cancel kitchen-caused or goodwill amount) | ⏳ after WP-W |
| D3 | Extra time requested (any time in session) | options, hold, kitchen approve charge/free/decline | ✅ paid #166; ⏳ any-time + free + decline |
| D4 | Kitchen offers more time | chef accepts/pays | ⏳ |
| D5 | Early checkout | confirmation "unused time not refunded" | ⏳ |
| D6 | Overstay | Past end time; kitchen records departure; extra-time charge; chef pays or disputes | ⏳ |
| D7 | No-show | no check-in → kitchen alert; no-show outcome; money per policy | ⏳ |

## E. After the visit
| E1 | Inspection all good | payout released immediately (one notice) | ⏳ (#166 had a claim) |
| E2 | Inspection auto-closes after 24 h | payout automatically | ✅ earlier sweep |
| E3 | Damage claim → paid | Local Cooks review, ask info, reply privacy, send reduced, chef pays, transfer | ✅ #166 |
| E4 | Damage claim → chef disputes → final decision | reduce/uphold/reject; 7-day hold if unpaid | ⏳ |
| E5 | Local Cooks pays the kitchen | chef never contacted | ✅ earlier (#152) |
| E6 | Feedback / rating | chef rates; kitchen private feedback | ⏳ |
| E7 | Receipt / invoice / payout statement | chef receipt incl. extras; kitchen statement | ⏳ |
| E8 | Admin goodwill refund (custom amount) | amount ≤ remaining; > $25 needs reason; chef notified | ⏳ |

## F. Cross-cutting
| F1 | Lists (chef cards, kitchen agenda) match the booking page in every state above | ⏳ checked per row |
| F2 | Notifications per recipient (no wrong-audience text; admin = Local Cooks summary; toggle-only emails) | per row |
| F3 | Mobile (390) on booking page, visit page, lists | spot-check |
