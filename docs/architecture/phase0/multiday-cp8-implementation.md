# CP8: chef multi-day booking

Built against all sections of the Oct 17 owner spec, build plan §7 and §8 CP8, and the CP3/CP4 implementation contracts.
Scope is the requested chef picker and booking reader. Kitchen/admin screens remain CP9; CP6 refund commands and CP7
confirmed schedule changes are separate work. Existing selected-visit fulfilment and task screens remain CP2’s readers.

## What the chef sees

1. **Date:** the existing calendar and stepper. Multiple selection appears only when the authenticated kitchen policy
   returns both `allowMultiDayBookings: true` and `multidayCreationEnabled: true`. The kitchen/platform count cap and
   first +14 calendar-day span apply independently. Days are individual selections, including gaps; changing the first
   date never trims the other selections. Count and date-specific refusal reasons are announced in a live region.
   Unavailable dates are `aria-disabled`, focusable buttons with full localized date/reason names and visible tap/focus
   feedback. The DayPicker focus/selection handlers remain in use for available dates. Genuine unavailability takes
   precedence over a count/span explanation. Partially occupied dates still offer hourly time; Full day is disabled with
   its own reason.
2. **Time:** today’s hour buttons, consecutive-hour validation and hourly/Full day controls. “Same hours every day” edits
   the shared default. “Change one day” opens that same picker against that date’s opening hours and availability; its
   override survives other edits and calendar changes. Full days use each date’s own complete operating window and keep
   the hourly-cap exemption. The review gate validates every date, rather than only the visible editor. Returning to one
   selected date retains that remaining day’s hours/mode/equipment and resumes the legacy single-day flow.
3. **Equipment:** the existing included/rental inventory and inline Add/Remove controls choose for all dates. Dated
   fieldsets below them permit individual exclusions. Only that date’s available equipment IDs can be checked or sent;
   included equipment is selected by default. CP3’s inventory contract is exclusive kitchen occupancy plus active,
   non-archived kitchen equipment, rather than an independent equipment occupancy scan.
4. **Confirm:** the same price-summary component lists date, hourly interval or Full day, equipment names and the day’s
   subtotal. It then rounds HST once over the combined subtotal, service fee once, and displays the whole total. Mobile
   uses the same rows, without a second expandable confirmation summary. One cancellation headline names the first-day
   deadline and the policy’s actual late percentage for every day. The hold disclosure says the card is held for the
   whole booking and charged only when all days are accepted.
5. **Booking page:** the header shows the date span and count; the chronological list shows hours/Full day and
   upcoming/today/done/cancelled states in the kitchen zone. Only today’s noncancelled visit gets its own
   `/booking/:id/visit?visitId=:visitId` link. The header timing/primary visit action follows the current/next active day,
   so completing day one does not make day two read as ended. Payment remains the existing whole-booking card.
   Cancellation uses the saved policy’s original first session, including after an earlier day is cancelled.

## Contracts and compatibility

- Two or more dates send `days: [{date, pricingMode, slots: [{startTime,endTime}], equipmentIds}]` to the existing checkout
  endpoint with `food-corridor-booking-first-day-v1`, accepted policy version and notes. The server remains authoritative
  for occupancy, combined weekly quota, policy and money. Checkout failures retain its explanatory message.
- One date sends exactly the existing scalar checkout fields and `food-corridor-v3`; there is no dated disclosure or
  per-day UI in that path. The global creation setting was not enabled.
- A versioned, validated `kitchen_booking_days_<id>` session draft preserves the whole selection, shared/default hours,
  overrides, equipment exclusions and notes across refresh. Scalar preferences/URL restore remain unchanged. Cancel
  clears both draft formats. Pending-request replacement reads the original dated visits/equipment through the existing
  source query instead of treating aggregate parent hours as a single date.
- Calendar download produces separate events with stable visit UIDs, schedule revision/SEQUENCE and cancellation status;
  gaps confer no continuous possession. The legacy single-event generator remains unchanged.
- New copy is present in en-CA, fr-CA and uk, written by an uncommitted UTF-8 Python script in the OS temporary directory.

## Screenshots described in words

The real React flow was exercised in an isolated local Vite fixture with mocked HTTP/auth, using the T3 collaborative
browser. It made no application-database or payment-provider connection. The temporary fixture is not part of the change.

- **Empty/one-day calendar:** the familiar four-step rail, kitchen context and booking summary. With rollout off, the
  original single-date picker remains. With rollout on, helper text explains the day limit/span; one selection still
  leads to the original hour/equipment/confirmation controls.
- **Several dates selected:** October 19/21/23 are separate outlined circular selections, with “3 days” below. Closed
  October 20 reads “Kitchen closed”; October 22 reads “Booked by someone else.” Focus on October 20 shows its full date
  and reason below the calendar. Enter toggles a selected date; ArrowRight skips the closed date and reaches the next
  available date. Available day targets are 44 px tall. Deselecting days announces “2 days”, then “1 day”.
- **Shared/per-day hours:** the standard hourly buttons sit below “Same hours every day” and the “Change one day” select.
  October 23 can show Full day while October 19/21 retain 9–10 a.m.; a partly booked date disables Full day and still
  exposes its free hourly slots. The regular min/max and setup/cleanup text stays beside the picker.
- **Equipment:** the same rental list and Add control, followed by date-labelled checkboxes. Choosing Mixer applies it
  across available dates; unticking one date changes only that date’s row and subtotal. Equipment absent from a date’s
  response has no checkbox on that date.
- **Mobile confirm (390×844):** a single column with editable choices, three day rows and the normal tax/fee/total rows.
  The inspected example has $12.50, $12.50 and $42.50 day subtotals, $10.13 HST, $4.73 service fee and $82.36 CAD total.
  Notes and “What happens next” follow; cancellation and checkout are below, reachable by vertical scroll. No horizontal
  overflow was observed. Exactly one cancellation headline was present.
- **Desktop confirm (1440×900):** the unchanged left kitchen/summary rail and right confirmation panel. The same three
  day rows appear in the summary, with normal internal scrolling for long content and the existing checkout footer.
  One dated refund deadline appears immediately above checkout. No horizontal overflow was observed.
- **Dated booking page (component fixture):** January 15–19 and “3 days” in the header; January 15 Done, January 17 Today
  with its selected-visit link, January 19 Upcoming. A cancelled-day fixture reads Cancelled and has no visit link. The
  payment card still displays the full $300 payment and the refund line still names January 14 before the original first
  visit, rather than the current day’s cutoff.

## Verification

`npm ci` installed this worktree’s dependencies normally, without links or manifest edits. Implementation was committed
in small checkpoints before final checks. Results and the final single TypeScript invocation are recorded below when
complete. No push, deployment, migration application, live Stripe operation or rollout-setting change was performed.
