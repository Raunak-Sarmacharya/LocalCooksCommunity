# CP9: kitchen operations, Local Cooks support, notices and documents

Built from `development` cd58b19b against the Oct 17 owner spec, build plan §7/§8 CP9 and the CP2–CP6/CP8 contracts.
The `booking_multiday_enabled` creation gate stays off. No migration, deployment, push, provider payment or live database
operation was performed. Dependencies were installed with `npm ci` in this worktree, without links or junctions.

## What the kitchen sees

- **Request review:** the existing request dialog and payment panel. Its summary names the selected dates. Chronological
  day rows show the date, that day's hours or Full day, equipment, and saved day subtotal. One kitchen decision covers
  all dates. Equipment decisions are still made against each equipment-booking row, with its date beside its name;
  declining equipment uses the existing chef-confirmed proposal, new-total disclosure and last-minute guard. The money
  panel continues to price the entire request, including tax and fees. The compatibility approval dialog also has the
  day list. Legacy requests do not render the new rows or change their decision flow.
- **Waiting for the chef:** the existing proposal card/list state remains authoritative. The kitchen has no second
  approval to make; nothing is captured before the chef agrees. The existing deadline and full-request decline remain.
- **Bookings agenda:** a dated row follows its checkout awaiting review, otherwise its current/next unfinished day,
  otherwise its last active day. A parent beginning last week therefore remains in Today/Upcoming when a later visit
  belongs there. The row says Day N of M and its action targets that visit. Payment is still the booking's aggregate.
- **Today board:** each current active dated visit keeps its own date, time, evidence, inspection URL and Day N of M
  context. Cancelled/superseded visits stay off the board. CP6's later-day discovery query remains in use.
- **Booking page:** the familiar header follows the current/next dated visit for the kitchen as well as the chef. A
  Booking days section adds dated rows with hours, day allocation, completed refunds and refunds still processing.
  Each day's inspection link includes its stable visit ID. A sent installment says Paid out $X on its actual sent date;
  a scheduled installment says Pays out after this day's inspection. Held/not-applicable payouts use the existing
  payout-state component. The ordinary payment card continues to describe the whole booking.
- **Arrival codes:** the existing manager code panel remains on a confirmed dated booking after an earlier day has
  checked in. Every code uses its own visit date and operating-window anchor for timing, polling and its date label.
  The panel labels chronological days rather than treating a global block index as a day number. The existing per-target
  code/self-check-in controls and all-days self-check-in action are reused; staffed secrets never enter the chef reader.
- **Inspection:** the selector identifies each dated visit by date and day ordinal. The selected day's saved clock,
  date and overnight anchor govern the schedule and timestamps. Cancelled/nonactive dated targets cannot be selected
  for an inspection action. Confirmation/success copy uses that day's payout installment, not the sum of later payouts.
- **Cancel a day:** an unstarted active day opens a small dialog for that date. The CP6 server quote shows the exact chef
  refund, kitchen debit and Local Cooks contribution before confirmation; an unavailable/unverified quote disables the
  action. Confirmation sends only that visit ID, the reviewed refund cents, reason and operation key. The service checks
  the amount again under its existing locks. A changed amount must be reviewed again.
- **Refund more for a day:** also available on a dropped day with a retained kitchen share. The dialog names the date,
  explains kitchen-only funding, labels the maximum, and shows the chef refund/kitchen debit as dollars are entered.
  It refuses invalid/excess amounts and calls CP6 M4. A missing actual fee leaves the ceiling unknown and hides the action.
  An uncertain attempt retains its key and frozen inputs when its dialog is reopened on the same page. Reserved refunds
  remain labelled processing until the original operation is verified; they already reduce the remaining refund ceiling.

## What Local Cooks sees

- **Support case:** current-revision dated visits show Day N of M, date, hours, schedule state, original allocated cents,
  completed and processing refunds, and that day's payout/transfer status. The existing parent money totals and chronology
  stay visible. Only whitelisted day money, dates, refund IDs and provider amounts cross the support API.
- **Cancel for the chef / kitchen cannot host:** the existing action dialog has an All remaining days / individual-day
  selector. Its funding preview switches to the exact CP6 quote for that selection, and sends the reviewed refund cents
  with the selected visit. The party, source, private note, operation-key and audit requirements are unchanged.
- **Kitchen-paid day refund:** a support action selects the day and dollar amount, then invokes the same M4 command as
  the kitchen with the support actor recorded. Pending/unknown refunds stay in recovery. A replay runs the same original
  reservation and operation key; it cannot create a second refund under a fresh key.
- **Refund made outside the app:** the former API-only action now has a verified provider-refund picker, day picker and
  kitchen-share dollar field. Zero means Local Cooks funds the refund; a positive share must fit both the refund and the
  selected day's remaining kitchen share. The funding preview shows each party's exact amount. The existing assignment
  command handles ledger assignment, paid-day debt and reconciliation; no new refund is issued by this action.
- **Arrival, attendance, inspection and payout retry:** existing actions retain their visit/installment selectors, now
  with dated visit labels. Release payout continues to use CP5's day installment command and holds.

## Notices, calendars and money evidence

- Dated lifecycle notifications append the selected dates and explicitly labelled whole-booking total. A day event uses
  its affected day; it does not label the entire payment as that day's price. Structured emails include the itinerary
  facts. Request/confirmation email inputs freeze those days in the lifecycle transaction. Legacy messages take their
  existing path and retain their existing sentences.
- Email calendar attachments contain one event per dated visit, with the same `booking-{id}-visit-{id}@localcooks.ca`
  identity as chef downloads. Each event uses its own overnight anchor. Dropped dates retain their UID with CANCELLED
  status and an advanced sequence; remaining dates stay separate busy events. Request, confirmation, day/whole
  cancellation and change notices attach the saved itinerary. Existing outbox reservation/delivery deduplication remains.
- Payment receipts use the immutable dated checkout manifest and captured component allocations to print every date,
  hours/Full day and per-day kitchen/equipment subtotal. There is still one receipt for the one captured source.
- Refund receipts name each affected day/item from the original dated operation and conserve its customer refund.
  Daily remittances use that transfer's date and hours; verified per-day reversals produce distinct payout adjustments
  referencing the affected day transfer, including when one refund reverses several installments.
- Revenue history retains one row per payment source. A dated row exposes its whole-booking total, each day allocation,
  individual transfer and transfer reversal in a disclosure. CSV keeps the ordinary accounting columns and adds explicit
  booking/day/transfer columns for dated exports. Parent amounts occur once; continuation rows contain only day/transfer
  evidence. Legacy-only CSV retains its original format.
- New UI/email copy is in en-CA, fr-CA and uk, written with uncommitted UTF-8 Python scripts in the OS temporary directory.

## Visual verification

An isolated Vite fixture rendered the real request/day components with local HTTP/auth substitutes, without a database
or payment connection. The fixture and its server were removed/stopped after checking.

- **390 × 844 request:** familiar rounded request dialog, dated rows above the standard item decisions/payment panel,
  pinned existing footer and vertical scrolling. The header names both selected dates. Exactly one kitchen decision
  group and one equipment decision group are present. No horizontal page overflow.
- **1440 × 900 request:** the same day list above the established two-column item/payment layout and footer. No
  horizontal overflow. Equipment remains dated and individually decidable while all days share one kitchen decision.
- **390 × 844 day list:** a single rounded Booking days panel; each date's allocation/refund and payout sentences remain
  beside its own inspection/cancellation/refund controls. Buttons wrap to the next line with 44 px minimum targets.
- **390 × 844 cancellation preview:** a date-specific modal with the chef amount, kitchen debit and Local Cooks amount
  on separate lines, followed by the reason and disabled-until-valid confirmation. The inspected preview was $122.00,
  $110.00 and $12.00 respectively. No horizontal overflow; this was mocked UI evidence, not a live refund.

## Verification and limits

Final command results are recorded below after the requested checks finish.

Live provider/database acceptance, migration parity and rollout activation remain the authorized later checkpoints.
CP7's dated confirmed schedule changes remain gated; CP9 supplies their communication/calendar reader rather than
enabling that checkpoint. This work did not run live Stripe, migrations, push or deployment commands.
