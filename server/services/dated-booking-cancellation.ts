/**
 * CP6: day-scoped cancellations and refunds on a dated (multi-day) booking.
 *
 * One refund deadline: the frozen notice period before the FIRST originally booked day (a drop never moves it).
 * Every refund is priced from the CP4 day allocations with the existing engine (`quoteCancellation`): the chef gets
 * percent x (paid share - actual card-fee share); a kitchen cancellation refunds the full share including its card fee
 * (the kitchen is debited its share, Local Cooks absorbs the card fee). An unsent day installment is reduced by the
 * kitchen debit; a sent one is reversed by exactly that day's share (or recorded as kitchen debt). Never another day.
 * The decision commits first (inventory, ledger, reservation, notices); the provider refund runs after, under the
 * reservation's operation key, through the same retry/reconcile engine as single-day cancellations.
 * A paid change (CP7) is its own card payment with its own day ledger: each payment ("charge") is priced on its own and a
 * day's refund comes from every charge that paid for it, one reservation per charge under the same operation key.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchenBookingDayAllocations, kitchenBookingDayPayouts, paymentTransactions,
  equipmentBookings, equipmentListings, kitchens, locations, kitchenBookingChanges } from '@shared/schema';
import { allocateCents, quoteCancellation, roundRatio, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { cancellationSourceQuote } from '@shared/cancellation-refund';
import { getCancellationPaymentFacts } from './stripe-service';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { addPaymentHistory } from './payment-transactions-service';
import { revokeForVisit } from './visit-code-challenge';
import { cancelLinkedBookingDates } from './booking-linked-cancellation';
import { BookingItemCancellationError } from './booking-item-cancellation';
import { OPEN_KITCHEN_CHANGE_STATES } from '@shared/kitchen-booking-change';
import { hasUnreconciledChangeRefund } from './kitchen-day-payouts';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Allocation = typeof kitchenBookingDayAllocations.$inferSelect;
type Visit = typeof kitchenBookingVisits.$inferSelect;
type Facts = Awaited<ReturnType<typeof getCancellationPaymentFacts>>;
export type DayMode = 'chef' | 'chef_offer' | 'kitchen';
export type DayTarget = { visitIds?: number[]; equipmentIds?: number[] };
export type DayActor = { role: 'chef' | 'manager'; id: number };
/** #10: after the kitchen cancels a day, the chef may drop these remaining days without the late charge until expiry. */
export type DayCancellationOffer = { id: string; cancelledVisitIds: number[]; eligibleVisitIds: number[]; createdAt: string; expiresAt: string };
export type DayRefundLine = { allocationId: number; visitId: number; componentKey: string; kind: 'kitchen' | 'equipment'; itemId: number;
  paidCents: number; grossCents: number; feeCents: number; customerCents: number; kitchenCents: number; platformCents: number; absorbedFeeCents: number;
  refundPercent: number; funding: 'entitlement' | 'reversal'; installmentId: number | null; transferId: string | null;
  creditCents?: { platform: number; absorbed: number; kitchen: number } };

const fail = (message: string, status = 409) => new BookingItemCancellationError(message, status);
export const isDatedBooking = (booking: { scheduleRevision?: number | null }) => (booking.scheduleRevision ?? 0) > 0;
export const datedOperationId = (bookingId: number, operationKey: string, sourceId: number) => `kitchen-day-refund:${bookingId}:${operationKey}:${sourceId}`;
const FEE_PENDING = 'We’re still confirming the card processing fee for this booking. Try again in a few minutes.';
const metadata = (row: { metadata?: unknown }) => (row.metadata || {}) as Record<string, any>;
const evidence = (row: Allocation) => (row.evidence || {}) as Record<string, any>;
const componentId = (row: Allocation) => `${row.componentKey}@${row.visitId}`;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const dayLabel = (date: string | null) => date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
  .format(new Date(`${date}T12:00:00Z`)) : 'that day';
const operations = (source: { metadata?: unknown }) => [...(metadata(source).cancellationRefundOperations || []), metadata(source).cancellationRefundOperation].filter(Boolean);

/** Source -> booking -> visits -> installments, the CP5 payout lock order. Reads take no locks. */
async function load(tx: Tx, bookingId: number, lock: boolean) {
  if (lock) await lockBookingMoneySources(tx, bookingId);
  const [row] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId, timezone: locations.timezone, kitchenName: kitchens.name })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row) throw fail('Booking not found or access denied', 404);
  const booking = lock ? (await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).for('update'))[0] : row.booking;
  const sources = await tx.select().from(paymentTransactions).where(and(inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']),
    eq(paymentTransactions.bookingId, bookingId))).orderBy(asc(paymentTransactions.id));
  const perDay = sources.filter(item => item.payoutPartition === 'per_day' && !!item.paymentIntentId);
  const source = perDay.find(item => item.paymentIntentId === booking.paymentIntentId);
  // Paid changes (a fully refunded one still holds its refund records); extra time is never refunded by a cancellation.
  const changes = source ? perDay.filter(item => item.id !== source.id && metadata(item).kitchenChangeId && ['succeeded', 'partially_refunded', 'refunded'].includes(item.status)) : [];
  const visitQuery = tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.id));
  const visits = lock ? await visitQuery.for('update') : await visitQuery;
  const charges: Charge[] = [];
  for (const item of source ? [source, ...changes] : []) {
    const allocations = await tx.select().from(kitchenBookingDayAllocations).where(eq(kitchenBookingDayAllocations.sourceId, item.id)).orderBy(asc(kitchenBookingDayAllocations.id));
    const installmentQuery = tx.select().from(kitchenBookingDayPayouts).where(eq(kitchenBookingDayPayouts.sourceId, item.id)).orderBy(asc(kitchenBookingDayPayouts.id));
    charges.push({ source: item, allocations, installments: lock ? await installmentQuery.for('update') : await installmentQuery });
  }
  const equipment = await tx.select({ row: equipmentBookings, name: equipmentListings.equipmentType }).from(equipmentBookings)
    .innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId)).where(eq(equipmentBookings.kitchenBookingId, bookingId));
  const openChanges = await tx.select({ id: kitchenBookingChanges.id }).from(kitchenBookingChanges).where(and(
    eq(kitchenBookingChanges.bookingId, bookingId), inArray(kitchenBookingChanges.state, OPEN_KITCHEN_CHANGE_STATES)));
  const unreconciledChangeRefund = sources.some(hasUnreconciledChangeRefund);
  // `source`/`allocations`/`installments` are the charge being priced (the booking's own charge unless `on` picks another);
  // `dayRows` is always the booking's own ledger, which has a row for every part of every current day.
  const own = charges[0] ?? { source: undefined, allocations: [], installments: [] };
  return { booking, managerId: row.managerId!, timezone: row.timezone || 'America/St_Johns', kitchenName: row.kitchenName, source: own.source,
    visits, allocations: own.allocations, installments: own.installments, dayRows: own.allocations, charges, equipment, openChanges, unreconciledChangeRefund };
}
type Charge = { source: typeof paymentTransactions.$inferSelect; allocations: Allocation[]; installments: Array<typeof kitchenBookingDayPayouts.$inferSelect> };
type Context = Awaited<ReturnType<typeof load>>;
/** A charge that can still give money back: the booking's own (it carries every reservation) or a change not fully refunded. */
const refundable = (ctx: Context) => ctx.charges.filter((charge, index) => !index || charge.source.status !== 'refunded');
const on = (ctx: Context, charge: Charge): Context => ({ ...ctx, source: charge.source, allocations: charge.allocations, installments: charge.installments });
/** One provider read per charge. */
async function chargeFacts(ctx: Context) {
  const facts = new Map<number, Facts>();
  for (const charge of ctx.charges) facts.set(charge.source.id, await getCancellationPaymentFacts(charge.source.paymentIntentId!));
  return facts;
}

function assertActor(ctx: Context, actor: DayActor) {
  if ((actor.role === 'chef' ? ctx.booking.chefId : ctx.managerId) !== actor.id) throw fail('Booking not found or access denied', 404);
}

/** What the booking's day set looks like at `at`: frozen session start per visit, and whether it can still be cancelled. */
function schedule(ctx: Context, at: Date) {
  const snapshot = ctx.booking.cancellationPolicySnapshot as CancellationPolicySnapshot | null;
  if (snapshot?.deadlineBasis !== 'booking_first_day' || !snapshot.sessions?.length) throw fail('This booking’s accepted terms need Local Cooks review before a refund can be quoted.');
  const firstStart = Math.min(...snapshot.sessions.map(session => Date.parse(session.startAt)));
  const deadlineAt = new Date(firstStart - snapshot.noticeHours * 3600_000);
  // A day the kitchen declined when it accepted was never booked or paid: it has no ledger and is not part of the booking.
  const current = ctx.visits.filter(visit => visit.scheduleRevision === ctx.booking.scheduleRevision
    && (visit.cancellationPlan as { mode?: string } | null)?.mode !== 'declined_at_acceptance');
  const days = current.map(visit => {
    const kitchen = ctx.dayRows.find(row => row.visitId === visit.id && row.componentKey === 'kitchen');
    const sessionIndex = Number(kitchen ? evidence(kitchen).sessionIndex : NaN), session = snapshot.sessions[sessionIndex];
    if (!session) throw fail('This booking’s day allocations need Local Cooks review before a refund can be quoted.');
    const startAt = new Date(session.startAt);
    const started = !!visit.checkedInAt || (visit.checkinStatus ?? 'not_checked_in') !== 'not_checked_in' || at >= startAt;
    return { visit, startAt, sessionIndex, active: visit.scheduleState === 'active', started };
  });
  return { snapshot, deadlineAt, days };
}

/** One refund applied to one allocation; the allocation's ledger is the list of these (cumulative, never rewritten). */
export type RefundRecord = { operationId: string; mode: DayMode | 'extra' | 'outside'; at: string; customerCents: number; kitchenCents: number;
  platformCents: number; absorbedFeeCents: number; feeCents: number; refundPercent: number; funding: 'entitlement' | 'reversal'; installmentId: number | null;
  /** Earlier Local Cooks goodwill counted toward this refund (it reduced what was sent now). */ creditCents?: Credit;
  /** Chef-policy refunds: percent x pool before rounding, so later drops round cumulatively with this one. */ policyNumerator?: number; policyCents?: number };
type Credit = { platform: number; absorbed: number; kitchen: number };
const records = (row: Allocation): RefundRecord[] => evidence(row).refunds || [];
/** What this allocation already returned to the chef, by funder (goodwill credited against it counts as returned). */
function settledOn(row: Allocation) {
  const total = { kitchen: 0, platform: 0, absorbed: 0, policy: false, kitchenMode: false, numerator: 0, policyCents: 0 };
  for (const record of records(row)) {
    const credit = record.creditCents || { platform: 0, absorbed: 0, kitchen: 0 };
    total.kitchen += record.kitchenCents + credit.kitchen; total.platform += record.platformCents + credit.platform;
    total.absorbed += record.absorbedFeeCents + credit.absorbed;
    if (record.mode === 'kitchen') total.kitchenMode = true;
    if (record.policyNumerator !== undefined) { total.policy = true; total.numerator += record.policyNumerator; total.policyCents += record.policyCents ?? 0; }
  }
  return { ...total, customer: total.kitchen + total.platform + total.absorbed };
}
const paidOf = (row: Allocation) => row.subtotalCents + row.taxCents + row.serviceFeeCents;
type Draft = { row: Allocation; kitchen: number; platform: number; absorbed: number; percent: number; credit: Credit; policyNumerator?: number; policyCents?: number };

/** The checks every day-refund path shares: captured charge, frozen allocations, actual fee, provider agreement. */
function verifiedSource(ctx: Context, facts: Facts, statuses: string[]) {
  const { booking, source } = ctx;
  if (ctx.unreconciledChangeRefund) throw fail('This booking needs Local Cooks review before a refund can be quoted.');
  if (!source || !['succeeded', 'partially_refunded'].includes(source.status) || !source.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  if (!statuses.includes(booking.status) || !['paid', 'partially_refunded', 'refunded'].includes(booking.paymentStatus || '')
    || (booking.paymentDecision as { state?: string } | null)?.state === 'pending') throw fail('This booking can’t be changed in its current state.');
  const { days } = schedule(ctx, new Date(0));
  // CP7: parts an approved change moved to new days are history; the live ledger is the current days plus settled parts of
  // earlier schedules (dropped days, a change's refunded part), which still count toward the source's captured cents.
  const live = ctx.allocations.filter(row => !evidence(row).supersededBy);
  const rows = live.filter(row => days.some(day => day.visit.id === row.visitId));
  const earlier = (row: Allocation) => ctx.visits.some(visit => visit.id === row.visitId && visit.scheduleRevision !== ctx.booking.scheduleRevision);
  if (!rows.length || live.some(row => !rows.includes(row) && !earlier(row)) || new Set(rows.map(row => row.allocationRevision)).size !== 1)
    throw fail('This booking’s day allocations need Local Cooks review before a refund can be quoted.');
  if (live.some(row => row.stripeFeeCents === null)) return null;
  const captured = Number(source.amount), fee = live.reduce((sum, row) => sum + row.stripeFeeCents!, 0);
  if (live.reduce((sum, row) => sum + paidOf(row), 0) !== captured || fee !== facts.processingCost
    || facts.captured !== captured || facts.currency !== source.currency.toLowerCase() || facts.refunded !== Number(source.refundAmount || 0))
    throw fail('The booking payment changed or needs review. Refresh and try again.');
  const verified = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts: metadata(source).refunds });
  return { source, rows, captured, fee, verified };
}

/** Local Cooks goodwill not yet counted toward a later refund: it counts exactly as on a one-day booking (floor 0). */
function unusedGoodwill(ctx: Context, receipts: Array<{ customerReceived: number; managerDebited: number; platformServiceFeeReturned: number; platformGoodwillCents?: number }>) {
  const given = receipts.filter(row => row.customerReceived > 0 && row.managerDebited === 0 && row.platformServiceFeeReturned === 0
    && (row.platformGoodwillCents || 0) === row.customerReceived).reduce((sum, row) => sum + row.customerReceived, 0);
  return Math.max(0, given - operations(ctx.source!).reduce((sum, op) => sum + Number(op.goodwillAppliedCents || 0), 0));
}

/** Turn drafts into ledger lines: count unused goodwill (Local Cooks' parts first, then the kitchen's), then fund each day. */
function finish(ctx: Context, verified: NonNullable<ReturnType<typeof verifiedSource>>, facts: Facts, drafts: Draft[], mode: DayMode | 'extra', goodwill: boolean) {
  let credit = goodwill ? Math.min(unusedGoodwill(ctx, verified.verified.receipts), drafts.reduce((t, d) => t + d.kitchen + d.platform + d.absorbed, 0)) : 0;
  const goodwillAppliedCents = credit;
  for (const key of ['platform', 'absorbed', 'kitchen'] as const) {
    const take = Math.min(credit, drafts.reduce((t, d) => t + d[key], 0));
    const parts = allocateCents(take, drafts.map(d => d[key]));
    drafts.forEach((d, i) => { d[key] -= parts[i]; d.credit[key] += parts[i]; });
    credit -= take;
  }
  const lines: Array<DayRefundLine & { record: Omit<RefundRecord, 'operationId' | 'at'> }> = drafts.map(d => {
    const { row } = d, gross = row.subtotalCents + row.taxCents, share = row.stripeFeeCents!;
    const installment = ctx.installments.find(item => item.visitId === row.visitId && item.allocationRevision === row.allocationRevision);
    // A day transfer frozen for release but not yet confirmed: the payout must settle first (the money guard also refuses).
    if (installment && !installment.transferId && (installment.evidence as { state?: string }).state === 'pending')
      throw fail('A payout for this booking is being sent. Try again in a few minutes.');
    const funding = installment?.transferId ? 'reversal' as const : 'entitlement' as const;
    const line = { allocationId: row.id, visitId: row.visitId, componentKey: row.componentKey, kind: row.componentKey === 'kitchen' ? 'kitchen' as const : 'equipment' as const,
      itemId: row.componentKey === 'kitchen' ? ctx.booking.id : Number(row.componentKey.slice('equipment:'.length)),
      paidCents: paidOf(row), grossCents: gross, feeCents: share, customerCents: d.kitchen + d.platform + d.absorbed, kitchenCents: d.kitchen,
      platformCents: d.platform, absorbedFeeCents: d.absorbed, refundPercent: d.percent, funding, installmentId: installment?.id ?? null,
      transferId: installment?.transferId ?? null, creditCents: d.credit };
    return { ...line, record: { mode, customerCents: line.customerCents, kitchenCents: d.kitchen, platformCents: d.platform, absorbedFeeCents: d.absorbed,
      feeCents: share, refundPercent: d.percent, funding, installmentId: line.installmentId, creditCents: d.credit,
      ...(d.policyNumerator !== undefined ? { policyNumerator: d.policyNumerator, policyCents: d.policyCents } : {}) } };
  });
  const sum = (key: 'customerCents' | 'kitchenCents' | 'platformCents' | 'absorbedFeeCents') => lines.reduce((total, line) => total + line[key], 0);
  // Each allocation can never return more than it was paid, by funder; together never more than the charge has left.
  if (lines.some(line => { const s = settledOn(ctx.allocations.find(row => row.id === line.allocationId)!), c = line.creditCents!;
    return [line.kitchenCents, line.platformCents, line.absorbedFeeCents].some(n => !Number.isSafeInteger(n) || n < 0)
      || s.kitchen + line.kitchenCents + c.kitchen > line.grossCents - line.feeCents || s.platform + line.platformCents + c.platform > line.paidCents - line.grossCents
      || s.absorbed + line.absorbedFeeCents + c.absorbed > line.feeCents; })
    || sum('customerCents') > facts.captured - facts.refunded || sum('kitchenCents') > verified.verified.managerRefund || sum('platformCents') > verified.verified.serviceFeeReview)
    throw fail('The remaining payment cannot fund this refund. Local Cooks must review it.');
  return { lines, goodwillAppliedCents, sum };
}

/** Exact cents for the selected days/items; nothing is written. Throws a 409 the caller can show as-is. */
function assertNoOpenChange(ctx: Context, requested: DayMode) {
  if (ctx.openChanges.length) throw fail(requested === 'kitchen'
    ? 'This booking has a change request waiting for your answer. Approve or decline it first.'
    : "You have a change request waiting for the kitchen. Withdraw it first, or wait for the kitchen's answer.");
}

function price(ctx: Context, facts: Facts, target: DayTarget, requested: DayMode, at: Date, change = false) {
  const { booking } = ctx;
  assertNoOpenChange(ctx, requested);
  const checked = verifiedSource(ctx, facts, ['confirmed']);
  if (!checked) return { quoteReady: false as const, reasonCode: 'processing_fee_pending' as const, message: FEE_PENDING };
  // The engine sees the current days only: their own paid cents and card-fee shares (equal to the source before any change).
  const { rows } = checked, captured = rows.reduce((sum, row) => sum + paidOf(row), 0), fee = rows.reduce((sum, row) => sum + row.stripeFeeCents!, 0);
  const { snapshot, deadlineAt, days } = schedule(ctx, at);
  const dayOf = (visitId: number) => days.find(day => day.visit.id === visitId);
  const visitIds = Array.from(new Set(target.visitIds || [])), equipmentIds = Array.from(new Set(target.equipmentIds || []));
  if (!!visitIds.length === !!equipmentIds.length) throw fail('Choose the days or the equipment to cancel.', 400);
  // A chef's policy refund settles an allocation once (an item removed earlier stays as paid); the kitchen tops every part up to the full share.
  const open = (row: Allocation) => { const s = settledOn(row); return requested === 'kitchen' ? s.customer < paidOf(row) : !s.policy && !s.kitchenMode; };
  const selected: Allocation[] = [];
  for (const visitId of visitIds) {
    const day = dayOf(visitId);
    if (!day?.active) throw fail('That day is no longer part of this booking.');
    if (day.started) throw fail(`${dayLabel(day.visit.visitDate)} has already started, so it can’t be cancelled.`);
    selected.push(...rows.filter(row => row.visitId === visitId && open(row)));
  }
  for (const id of equipmentIds) {
    const item = ctx.equipment.find(entry => entry.row.id === id)?.row;
    const row = rows.find(entry => entry.componentKey === `equipment:${id}`);
    const day = item?.kitchenBookingVisitId ? dayOf(item.kitchenBookingVisitId) : undefined;
    // A change charge pays only for what its change added; the booking's own ledger has a part for every item.
    if (change) { if (row && row.visitId === item?.kitchenBookingVisitId && open(row)) selected.push(row); continue; }
    // A part with nothing paid on this charge (an item a change added) comes off here with no money.
    if (!item || item.status !== 'confirmed' || !row || row.visitId !== item.kitchenBookingVisitId || !open(row) && paidOf(row) > 0 || !day?.active) throw fail('This equipment is no longer booked.');
    if (day.started) throw fail('That day has already started, so its equipment can’t be removed now.');
    if (open(row)) selected.push(row);
  }
  // #10: while the kitchen's offer is open, the chef drops its remaining days without the late charge.
  const offer = booking.kitchenDayCancellationOffer as DayCancellationOffer | null;
  const offerOpen = !!offer && at < new Date(offer.expiresAt) && Date.now() < Date.parse(offer.expiresAt);
  const mode: DayMode = requested === 'chef' && visitIds.length && offerOpen && visitIds.every(id => offer!.eligibleVisitIds.includes(id)) ? 'chef_offer' : requested;

  const index = new Map(rows.map((row, i) => [row.id, i]));
  const engine = quoteCancellation(mode === 'chef_offer' ? { ...snapshot, tiers: [{ minHoursBeforeStart: 0, refundPercent: 100 }] } : snapshot, {
    cancelAt: at, confirmedAt: booking.createdAt || at, capturedCents: captured, processingFeeCents: fee, cause: 'chef',
    components: rows.map(row => ({ id: componentId(row), kind: row.componentKey === 'kitchen' ? 'kitchen' as const : 'equipment' as const,
      sessionIndex: dayOf(row.visitId)!.sessionIndex, kitchenCents: row.subtotalCents + row.taxCents, platformCents: row.serviceFeeCents })),
    settledComponents: Object.fromEntries(rows.filter(row => !selected.includes(row)).map(row => [componentId(row), { refundCents: 0, kitchenRefundCents: 0 }])) });
  if (!engine.quoteReady) return { quoteReady: false as const, reasonCode: 'processing_fee_pending' as const, message: FEE_PENDING };
  // The engine's fee split must be the frozen actual fee share on each allocation; anything else is not that part's fee.
  if (rows.some((row, i) => engine.perComponent[i].feeCents !== row.stripeFeeCents)) throw fail('This booking’s card-fee shares need Local Cooks review.');
  const credit = () => ({ platform: 0, absorbed: 0, kitchen: 0 });
  let drafts: Draft[];
  if (mode === 'kitchen') drafts = selected.map(row => {
    const s = settledOn(row), gross = row.subtotalCents + row.taxCents, share = row.stripeFeeCents!;
    return { row, kitchen: gross - share - s.kitchen, platform: row.serviceFeeCents - s.platform, absorbed: share - s.absorbed, percent: 100, credit: credit() };
  });
  else {
    // The existing late-charge arithmetic, rounded once over every chef-policy drop of this charge (so one at a time never pays more).
    const pools = selected.map(row => row.subtotalCents + row.taxCents - row.stripeFeeCents! + row.serviceFeeCents);
    const numerators = selected.map((row, i) => pools[i] * engine.perComponent[index.get(row.id)!].refundPercent);
    const prior = rows.map(settledOn).filter(s => s.policy);
    const target = Math.floor((prior.reduce((t, s) => t + s.numerator, 0) + numerators.reduce((t, n) => t + n, 0) + 50) / 100)
      - prior.reduce((t, s) => t + s.policyCents, 0);
    const refunds = numerators.map(n => Math.floor(n / 100));
    let left = target - refunds.reduce((t, n) => t + n, 0);
    if (left < 0 || left > refunds.length) throw fail('This booking’s earlier refunds need Local Cooks review.');
    for (const i of numerators.map((n, i) => i).sort((a, b) => numerators[b] % 100 - numerators[a] % 100 || a - b)) { if (!left) break; refunds[i]++; left--; }
    drafts = selected.map((row, i) => {
      const s = settledOn(row), kitchenTarget = roundRatio(refunds[i], row.subtotalCents + row.taxCents - row.stripeFeeCents!, pools[i]);
      // An earlier kitchen-paid extra on this part counts toward the policy refund, as on a one-day booking.
      const customer = Math.max(0, refunds[i] - s.customer), kitchen = Math.min(customer, Math.max(0, kitchenTarget - s.kitchen));
      return { row, kitchen, platform: customer - kitchen, absorbed: 0, percent: engine.perComponent[index.get(row.id)!].refundPercent, credit: credit(),
        policyNumerator: numerators[i], policyCents: refunds[i] };
    });
  }
  const { lines, goodwillAppliedCents, sum } = finish(ctx, checked, facts, drafts, mode, true);
  const remaining = days.filter(day => day.active && !visitIds.includes(day.visit.id));
  const perDay = Array.from(new Set(lines.map(line => line.visitId))).map(visitId => {
    const own = lines.filter(line => line.visitId === visitId), day = dayOf(visitId)!;
    const allocations = rows.filter(row => row.visitId === visitId && own.some(line => line.allocationId === row.id));
    return { visitId, date: day.visit.visitDate, startTime: day.visit.startTime, endTime: day.visit.endTime, startAt: day.startAt.toISOString(), refundCents: own.reduce((t, l) => t + l.customerCents, 0),
      feeCents: mode === 'kitchen' ? 0 : own.reduce((t, l) => t + l.feeCents, 0), refundPercent: own[0].refundPercent,
      kitchenKeepsCents: allocations.reduce((t, row) => { const line = own.find(l => l.allocationId === row.id)!;
        return t + line.grossCents - line.feeCents - settledOn(row).kitchen - line.kitchenCents - line.creditCents!.kitchen; }, 0),
      items: own.map(line => ({ componentKey: line.componentKey, refundCents: line.customerCents })) };
  });
  return { quoteReady: true as const, bookingId: booking.id, sourceId: ctx.source!.id, mode: mode as DayMode | 'extra', cancelAt: at.toISOString(), deadlineAt: deadlineAt.toISOString(), beforeDeadline: at < deadlineAt,
    refundPercent: lines.length && lines.every(line => line.refundPercent === lines[0].refundPercent) ? lines[0].refundPercent : null,
    chefRefundCents: sum('customerCents'), feeRetainedCents: mode === 'kitchen' ? 0 : lines.reduce((t, l) => t + l.feeCents, 0),
    retainedCents: lines.reduce((t, l) => t + l.paidCents, 0) - sum('customerCents'), goodwillAppliedCents,
    kitchenShareRetainedCents: perDay.reduce((t, d) => t + d.kitchenKeepsCents, 0), kitchenPaysCents: sum('kitchenCents'),
    localCooksPaysCents: sum('platformCents') + sum('absorbedFeeCents'), processingCostAbsorbedCents: sum('absorbedFeeCents'), days: perDay, lines, visitIds, equipmentIds,
    cancelsBooking: !!visitIds.length && !remaining.length, remainingDays: remaining.length,
    offer: offerOpen ? { expiresAt: offer!.expiresAt, eligibleVisitIds: offer!.eligibleVisitIds.filter(id => remaining.some(day => day.visit.id === id) || visitIds.includes(id)) } : null,
    receipts: checked.verified.receipts };
}
type Quote = Extract<ReturnType<typeof price>, { quoteReady: true }>;

/** A day's parts across charges, added up. */
function mergeDays(list: Quote['days']) {
  const days = new Map<number, Quote['days'][number]>();
  for (const day of list) {
    const seen = days.get(day.visitId);
    if (!seen) { days.set(day.visitId, { ...day, items: day.items.map(item => ({ ...item })) }); continue; }
    seen.refundCents += day.refundCents; seen.feeCents += day.feeCents; seen.kitchenKeepsCents += day.kitchenKeepsCents;
    for (const item of day.items) {
      const same = seen.items.find(entry => entry.componentKey === item.componentKey);
      if (same) same.refundCents += item.refundCents; else seen.items.push({ ...item });
    }
  }
  return Array.from(days.values()).sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** The booking's charges' quotes as one: what the chef and kitchen see; `charges` is what each payment reserves. */
function combine(quotes: Quote[]) {
  const [own] = quotes, lines = quotes.flatMap(quote => quote.lines);
  const total = (key: 'chefRefundCents' | 'feeRetainedCents' | 'retainedCents' | 'goodwillAppliedCents' | 'kitchenShareRetainedCents' | 'kitchenPaysCents'
    | 'localCooksPaysCents' | 'processingCostAbsorbedCents') => quotes.reduce((sum, quote) => sum + quote[key], 0);
  return { ...own, refundPercent: lines.length && lines.every(line => line.refundPercent === lines[0].refundPercent) ? lines[0].refundPercent : null,
    chefRefundCents: total('chefRefundCents'), feeRetainedCents: total('feeRetainedCents'), retainedCents: total('retainedCents'), goodwillAppliedCents: total('goodwillAppliedCents'),
    kitchenShareRetainedCents: total('kitchenShareRetainedCents'), kitchenPaysCents: total('kitchenPaysCents'), localCooksPaysCents: total('localCooksPaysCents'),
    processingCostAbsorbedCents: total('processingCostAbsorbedCents'), days: mergeDays(quotes.flatMap(quote => quote.days)), lines, charges: quotes };
}

/** Each charge priced on its own policy arithmetic, then added up. The booking's own charge always carries a reservation. */
function priceAll(ctx: Context, facts: Map<number, Facts>, target: DayTarget, requested: DayMode, at: Date) {
  const quotes: Quote[] = [];
  for (const [index, charge] of Array.from(refundable(ctx).entries())) {
    // A change charge not yet split over its days: its card fee isn't confirmed.
    if (!charge.allocations.length) return { quoteReady: false as const, reasonCode: 'processing_fee_pending' as const, message: FEE_PENDING };
    const quoted = price(on(ctx, charge), facts.get(charge.source.id)!, target, requested, at, index > 0);
    if (!quoted.quoteReady) return quoted;
    if (!index || quoted.lines.some(line => line.paidCents > 0)) quotes.push(quoted);
  }
  return combine(quotes);
}
type Priced = ReturnType<typeof priceAll>;

/**
 * Spec row 7, "the kitchen may refund more": a kitchen-paid refund scoped to one day, as a one-day booking's kitchen refund
 * (no card fee or service fee comes back with it). Never more than that day's remaining kitchen share or the charge has left.
 */
function extraRoom(ctx: Context, facts: Facts, visitId: number, at: Date) {
  const checked = verifiedSource(ctx, facts, ['confirmed', 'completed', 'cancelled']);
  if (!checked) throw fail(FEE_PENDING);
  const { deadlineAt, days } = schedule(ctx, at);
  const day = days.find(item => item.visit.id === visitId);
  if (!day) throw fail('That day is not part of this booking.', 404);
  const own = checked.rows.filter(row => row.visitId === visitId);
  const open = own.map(row => Math.max(0, row.subtotalCents + row.taxCents - row.stripeFeeCents! - settledOn(row).kitchen));
  return { checked, deadlineAt, days, day, own, open, cap: Math.min(open.reduce((t, n) => t + n, 0), facts.captured - facts.refunded) };
}
function priceExtra(ctx: Context, facts: Facts, visitId: number, amountCents: number, at: Date): Quote {
  const { checked, deadlineAt, days, day, own, open, cap } = extraRoom(ctx, facts, visitId, at);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw fail('Enter the amount to refund.', 400);
  if (amountCents > cap) throw fail(`The most the kitchen can refund for ${dayLabel(day.visit.visitDate)} is ${dollars(cap)}.`);
  const shares = allocateCents(amountCents, open);
  const drafts = own.map((row, i) => ({ row, kitchen: shares[i], platform: 0, absorbed: 0, percent: 0, credit: { platform: 0, absorbed: 0, kitchen: 0 } })).filter(d => d.kitchen > 0);
  const { lines, sum } = finish(ctx, checked, facts, drafts, 'extra', false);
  return { quoteReady: true as const, bookingId: ctx.booking.id, sourceId: ctx.source!.id, mode: 'extra' as const, cancelAt: at.toISOString(), deadlineAt: deadlineAt.toISOString(), beforeDeadline: at < deadlineAt,
    refundPercent: null, chefRefundCents: sum('customerCents'), feeRetainedCents: 0, retainedCents: 0, goodwillAppliedCents: 0, kitchenShareRetainedCents: 0,
    kitchenPaysCents: sum('kitchenCents'), localCooksPaysCents: 0, processingCostAbsorbedCents: 0,
    days: [{ visitId, date: day.visit.visitDate, startTime: day.visit.startTime, endTime: day.visit.endTime, startAt: day.startAt.toISOString(), refundCents: amountCents, feeCents: 0, refundPercent: 0,
      kitchenKeepsCents: open.reduce((t, n) => t + n, 0) - amountCents, items: lines.map(line => ({ componentKey: line.componentKey, refundCents: line.customerCents })) }],
    lines, visitIds: [], equipmentIds: [], cancelsBooking: false, remainingDays: days.filter(item => item.active).length, offer: null, receipts: checked.verified.receipts };
}

/** The kitchen's extra refund for a day, shared across the charges that paid for that day by what each can still give back. */
function priceExtraAll(ctx: Context, facts: Map<number, Facts>, visitId: number, amountCents: number, at: Date) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw fail('Enter the amount to refund.', 400);
  const charges = refundable(ctx);
  const rooms = charges.map((charge, index) => charge.allocations.length || !index ? extraRoom(on(ctx, charge), facts.get(charge.source.id)!, visitId, at).cap : 0);
  const cap = rooms.reduce((sum, room) => sum + room, 0);
  if (amountCents > cap) throw fail(`The most the kitchen can refund for ${dayLabel(ctx.visits.find(visit => visit.id === visitId)?.visitDate ?? null)} is ${dollars(cap)}.`);
  const shares = allocateCents(amountCents, rooms);
  return combine(charges.flatMap((charge, index) => shares[index] ? [priceExtra(on(ctx, charge), facts.get(charge.source.id)!, visitId, shares[index], at)] : []));
}

/** Every active day that has not started: what "cancel all" means once a day has been used. */
export async function remainingDayIds(bookingId: number, at = new Date(), tx: Tx = db as unknown as Tx) {
  const ctx = await load(tx, bookingId, false);
  return schedule(ctx, at).days.filter(day => day.active && !day.started).map(day => day.visit.id);
}

/** The exact dollars before confirming. Defaults to every remaining day. */
export async function readDatedCancellationQuote(bookingId: number, actor: DayActor, target: DayTarget = {}, at = new Date()) {
  const ctx = await load(db as unknown as Tx, bookingId, false);
  assertActor(ctx, actor);
  assertNoOpenChange(ctx, actor.role === 'manager' ? 'kitchen' : 'chef');
  if (!ctx.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  const chosen = target.visitIds?.length || target.equipmentIds?.length ? target : { visitIds: schedule(ctx, at).days.filter(day => day.active && !day.started).map(day => day.visit.id) };
  if (!chosen.visitIds?.length && !chosen.equipmentIds?.length) throw fail('There are no upcoming days left to cancel.');
  try { await assertBookingMoneyWritable({ bookingId }); } catch { throw fail('Local Cooks is reviewing this booking’s payment. Contact Local Cooks to change it.'); }
  const quoted = priceAll(ctx, await chargeFacts(ctx), chosen, actor.role === 'manager' ? 'kitchen' : 'chef', at);
  if (!quoted.quoteReady) return quoted;
  const { charges: _charges, ...quote } = quoted;
  return quote;
}

/** Support's preview: each remaining day (and all of them together) priced for the chef and for the kitchen, from one provider read. */
export async function readDatedDayPreviews(bookingId: number, at = new Date()) {
  const ctx = await load(db as unknown as Tx, bookingId, false);
  if (!ctx.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  const facts = await chargeFacts(ctx);
  const remaining = schedule(ctx, at).days.filter(day => day.active && !day.started).map(day => day.visit.id);
  const both = (visitIds: number[]) => Object.fromEntries((['chef', 'kitchen'] as const).map(mode => {
    const quoted = priceAll(ctx, facts, { visitIds }, mode, at);
    return [mode === 'chef' ? 'forChef' : 'byKitchen', quoted.quoteReady ? { chefReceivesCents: quoted.chefRefundCents, feeRetainedCents: quoted.feeRetainedCents,
      managerPaysCents: quoted.kitchenPaysCents, localCooksPaysCents: quoted.localCooksPaysCents, kitchenKeepsCents: quoted.kitchenShareRetainedCents,
      refundPercent: quoted.refundPercent, mode: quoted.mode } : null];
  }));
  return { remainingVisitIds: remaining, all: remaining.length ? both(remaining) : null,
    days: remaining.map(visitId => ({ visitId, date: ctx.visits.find(visit => visit.id === visitId)?.visitDate ?? null, ...both([visitId]) })),
    offer: (ctx.booking.kitchenDayCancellationOffer as DayCancellationOffer | null) ?? null };
}

export type DayCancellationInput = { target: DayTarget; operationKey: string; expectedRefundCents?: number; reason?: string;
  /** Local Cooks acting for the party; recorded on the reservation for the support audit. */ supportActorId?: number };

/** Commit the drop and its exact refund reservation, then send the refund once under the reservation's key. */
export async function cancelDatedDays(bookingId: number, actor: DayActor, input: DayCancellationInput) {
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(input.operationKey || '')) throw fail('A cancellation operation key is required.', 400);
  const before = await load(db as unknown as Tx, bookingId, false);
  assertActor(before, actor);
  assertNoOpenChange(before, actor.role === 'manager' ? 'kitchen' : 'chef');
  if (!before.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  return execute(bookingId, actor, before, input, facts => {
    const target = input.target.visitIds?.length || input.target.equipmentIds?.length ? input.target
      : { visitIds: schedule(before, new Date()).days.filter(day => day.active && !day.started).map(day => day.visit.id) };
    if (!target.visitIds?.length && !target.equipmentIds?.length) throw fail('There are no upcoming days left to cancel.');
    return (ctx, at) => priceAll(ctx, facts, target, actor.role === 'manager' ? 'kitchen' : 'chef', at);
  });
}

/** Spec row 7: the kitchen refunds more for one day, out of that day's payout. Same reservation, retry and reconcile path. */
export async function refundDatedDay(bookingId: number, managerId: number, input: { visitId: number; amountCents: number; reason?: string; operationKey: string; supportActorId?: number }) {
  if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(input.operationKey || '')) throw fail('A refund operation key is required.', 400);
  const actor: DayActor = { role: 'manager', id: managerId };
  const before = await load(db as unknown as Tx, bookingId, false);
  assertActor(before, actor);
  if (!before.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  return execute(bookingId, actor, before, { target: {}, operationKey: input.operationKey, reason: input.reason, supportActorId: input.supportActorId },
    facts => (ctx, at) => priceExtraAll(ctx, facts, input.visitId, input.amountCents, at));
}

/** This operation's reservation on each charge it touched (the booking's own charge first). */
const reservations = (ctx: Context, operationKey: string) => ctx.charges.flatMap(charge =>
  operations(charge.source).filter(op => op.id === datedOperationId(ctx.booking.id, operationKey, charge.source.id)));

async function execute(bookingId: number, actor: DayActor, before: Context, input: DayCancellationInput,
  plan: (facts: Map<number, Facts>) => (ctx: Context, at: Date) => Priced) {
  const prior = reservations(before, input.operationKey).length > 0;
  if (!prior) {
    const build = plan(await chargeFacts(before));
    await db.transaction(tx => commit(tx, bookingId, actor, input, build));
  }
  const after = await load(db as unknown as Tx, bookingId, false);
  if (reservations(after, input.operationKey).some(op => op.status !== 'succeeded')) {
    try { await (await import('./booking-cancellation-refund')).retryCancellationRefund(bookingId, after.managerId); }
    catch (error) { logger.warn('[DayCancellation] Refund will be retried', { bookingId, error: error instanceof Error ? error.message : String(error) }); }
  }
  return readDatedOperation(bookingId, input.operationKey, prior ? true : undefined);
}

/** The result the chef or kitchen sees: every charge's reservation for this operation, added up. */
export async function readDatedOperation(bookingId: number, operationKey: string, replayed?: boolean) {
  const ctx = await load(db as unknown as Tx, bookingId, false);
  const ops = reservations(ctx, operationKey);
  if (!ops.length) throw fail('The cancellation was not saved. Refresh and try again.');
  const [operation] = ops, total = (key: string) => ops.reduce((sum, op) => sum + Number(op[key] || 0), 0);
  const state = ops.every(op => op.status === 'succeeded') ? 'refunded' : 'processing';
  return { success: true, action: operation.mode === 'extra' ? 'refunded' : operation.cancelsBooking ? 'cancelled' : operation.equipmentIds?.length ? 'removed' : 'days_cancelled', state,
    operationId: operation.id as string, refundCents: total('customerRefund'), feeRetainedCents: total('feeRetainedCents'), kitchenShareRetainedCents: total('kitchenShareRetainedCents'),
    managerPaysCents: total('managerRefund'), localCooksPaysCents: total('platformRefund') + total('platformProcessingCost'),
    processingCostAbsorbedCents: total('platformProcessingCost'), amountCents: total('customerRefund'), paymentIntentId: operation.intentId,
    refundId: operation.refundId ?? null, visitIds: operation.visitIds, equipmentIds: operation.equipmentIds, days: mergeDays(ops.flatMap(op => op.days)),
    itemName: operation.itemName as string, refundPercent: ops.every(op => op.refundPercent === operation.refundPercent) ? operation.refundPercent as number | null : null,
    paidCents: ops.flatMap(op => op.lines as DayRefundLine[]).reduce((sum, line) => sum + line.paidCents, 0),
    offer: (ctx.booking.kitchenDayCancellationOffer as DayCancellationOffer | null) ?? null, ...(replayed ? { replayed } : {}) };
}

async function commit(tx: Tx, bookingId: number, actor: DayActor, input: DayCancellationInput, build: (ctx: Context, at: Date) => Priced) {
  const ctx = await load(tx, bookingId, true);
  assertActor(ctx, actor);
  if (reservations(ctx, input.operationKey).length) return;
  // The caller's own support action key (if any) is exempt, as in every cancellation command.
  await assertBookingMoneyWritable({ bookingId, operationKey: input.operationKey }, tx);
  for (const { source } of refundable(ctx)) {
    const current = metadata(source).cancellationRefundOperation;
    // One refund operation per booking charge at a time: a later drop waits for the earlier refund to finish.
    if (current && current.status !== 'succeeded') throw fail('An earlier refund on this booking is still being processed. Try again in a few minutes.');
    if (metadata(source).refundRecovery && metadata(source).refundRecovery.status !== 'succeeded' || metadata(source).fullRefundRequest?.status === 'pending')
      throw fail('An earlier refund needs Local Cooks review first.');
  }
  const at = new Date();
  const quoted = build(ctx, at);
  if (!quoted.quoteReady) throw fail(FEE_PENDING);
  const operationId = datedOperationId(bookingId, input.operationKey, quoted.charges[0].sourceId);
  const extra = quoted.mode === 'extra';
  if (input.expectedRefundCents !== undefined && input.expectedRefundCents !== quoted.chefRefundCents)
    throw fail('The refund changed. Review the refreshed amount before cancelling.');
  const cause = quoted.mode === 'kitchen' || extra ? 'kitchen' as const : 'chef' as const, reason = input.reason?.trim().slice(0, 500) || null;
  const visitIds = quoted.visitIds, dropped = new Set(visitIds);
  const equipmentIds = [...quoted.equipmentIds, ...ctx.equipment.filter(entry => entry.row.kitchenBookingVisitId && dropped.has(entry.row.kitchenBookingVisitId)
    && !['cancelled', 'completed'].includes(entry.row.status)).map(entry => entry.row.id)];

  // Inventory: the day (or item) leaves occupancy, its code and its reminders (reminders read active visits only).
  for (const visitId of visitIds) {
    const day = quoted.days.find(row => row.visitId === visitId);
    await tx.update(kitchenBookingVisits).set({ scheduleState: 'cancelled', updatedAt: at, cancellationPlan: { operationId, cause, mode: quoted.mode,
      cancelledAt: at.toISOString(), actorId: input.supportActorId ?? actor.id, reason, refundCents: day?.refundCents ?? 0 } }).where(eq(kitchenBookingVisits.id, visitId));
    await revokeForVisit(tx, bookingId, visitId, 'day_cancelled');
  }
  if (equipmentIds.length && !extra) await tx.update(equipmentBookings).set({ status: 'cancelled', updatedAt: at }).where(inArray(equipmentBookings.id, equipmentIds));
  const { days } = schedule(ctx, at);
  const remaining = days.filter(day => day.active && !dropped.has(day.visit.id));
  const equipmentItems = ((ctx.booking.equipmentItems as Array<Record<string, any>> | null) || []).map(entry => equipmentIds.includes(entry.equipmentBookingId ?? entry.id)
    ? { ...entry, status: 'cancelled', cancelledAt: at.toISOString(), cancelledBy: cause } : entry);
  let offer = ctx.booking.kitchenDayCancellationOffer as DayCancellationOffer | null;
  if (cause === 'kitchen' && visitIds.length && !extra) {
    const eligible = remaining.filter(day => !day.started).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    offer = eligible.length ? { id: operationId, cancelledVisitIds: visitIds, eligibleVisitIds: eligible.map(day => day.visit.id),
      createdAt: at.toISOString(), expiresAt: eligible[0].startAt.toISOString() } : null;
  }
  if (extra) { /* A kitchen-paid extra refund changes no day, item or offer. */ }
  else if (quoted.cancelsBooking) {
    await tx.update(kitchenBookings).set({ status: 'cancelled', cancellationEffectiveAt: at, cancellationOperationKey: input.operationKey, cancellationCause: cause,
      cancellationRequestReason: reason, kitchenDayCancellationOffer: null, updatedAt: at }).where(eq(kitchenBookings.id, bookingId));
    await cancelLinkedBookingDates(tx, bookingId);
  } else {
    const selectedSlots = remaining.sort((a, b) => a.visit.visitDate!.localeCompare(b.visit.visitDate!)).flatMap(day => ((day.visit.selectedSlots as Array<{ startTime: string; endTime: string }> | null) || [])
      .map(slot => ({ ...slot, date: day.visit.visitDate, windowStartTime: day.visit.operatingWindowStartTime })));
    await tx.update(kitchenBookings).set({ selectedSlots, equipmentItems, kitchenDayCancellationOffer: offer, updatedAt: at }).where(eq(kitchenBookings.id, bookingId));
  }

  const names = Object.fromEntries(ctx.equipment.map(entry => [entry.row.id, entry.name || 'Equipment']));
  const itemName = extra ? `an extra refund for ${dayLabel(quoted.days[0].date)}` : quoted.equipmentIds.length ? quoted.equipmentIds.map(id => names[id]).join(', ')
    : quoted.days.map(day => dayLabel(day.date)).join(', ');
  // Each charge reserves its own part: its ledger lines, its day reversals and one refund on its own payment.
  for (const part of quoted.charges) {
    const charge = ctx.charges.find(item => item.source.id === part.sourceId)!, source = charge.source;
    const partId = datedOperationId(bookingId, input.operationKey, source.id);
    // Ledger: each refunded allocation records its exact cents; an unsent day's payout drops by its kitchen debit.
    for (const line of part.lines) {
      const row = charge.allocations.find(item => item.id === line.allocationId)!, saved = evidence(row);
      const record: RefundRecord = { ...line.record, operationId: partId, at: at.toISOString() };
      await tx.update(kitchenBookingDayAllocations).set({ evidence: { ...saved, refunds: [...records(row), record],
        ...(line.funding === 'entitlement' ? { managerDebitedCents: Number(saved.managerDebitedCents || 0) + line.kitchenCents } : {}) } })
        .where(eq(kitchenBookingDayAllocations.id, row.id));
    }
    const reversals = Array.from(new Set(part.lines.filter(line => line.funding === 'reversal' && line.kitchenCents > 0).map(line => line.installmentId!)))
      .map(installmentId => { const own = part.lines.filter(line => line.installmentId === installmentId);
        return { installmentId, visitId: own[0].visitId, transferId: own[0].transferId!, amountCents: own.reduce((t, l) => t + l.kitchenCents, 0) }; });
    const saved = metadata(source);
    const operation = { id: partId, dated: true, policyEngine: true, intentId: source.paymentIntentId, bookingId, managerId: ctx.managerId, chefId: ctx.booking.chefId,
      operationKey: input.operationKey, mode: part.mode, cause, reason, status: part.chefRefundCents ? 'pending' : 'succeeded', acceptedAt: at.toISOString(),
      customerRefund: part.chefRefundCents, managerRefund: part.kitchenPaysCents, platformRefund: part.lines.reduce((t, l) => t + l.platformCents, 0),
      platformProcessingCost: part.processingCostAbsorbedCents, feeRetainedCents: part.feeRetainedCents, kitchenShareRetainedCents: part.kitchenShareRetainedCents,
      refundPercent: part.refundPercent, beforeDeadline: part.beforeDeadline, deadlineAt: part.deadlineAt, cancelsBooking: quoted.cancelsBooking,
      goodwillAppliedCents: part.goodwillAppliedCents, ...(extra ? { extraVisitId: quoted.days[0].visitId } : {}),
      visitIds, equipmentIds: quoted.equipmentIds, cancelledEquipmentIds: extra ? [] : equipmentIds, days: part.days, lines: part.lines.map(({ record, ...line }) => line), reversals, itemName,
      cancellationNoticeIncludesRefund: true, ...(input.supportActorId ? { supportOperationKey: input.operationKey, supportActorId: input.supportActorId } : {}) };
    await tx.update(paymentTransactions).set({ metadata: { ...saved, refunds: part.receipts,
      cancellationRefundOperations: [...(saved.cancellationRefundOperations || []), ...(saved.cancellationRefundOperation ? [saved.cancellationRefundOperation] : [])],
      cancellationRefundOperation: operation }, updatedAt: at }).where(eq(paymentTransactions.id, source.id));
    await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: source.status, eventType: 'dated_refund_reserved',
      description: extra ? `Kitchen refunded ${itemName}; reserved before provider work` : `${cause === 'kitchen' ? 'Kitchen' : 'Chef'} cancelled ${itemName}; exact day refund reserved before provider work`,
      createdBy: input.supportActorId ?? actor.id, metadata: operation }, tx);
  }
  await notify(tx, ctx, quoted, { cause, reason, itemName, offer: cause === 'kitchen' ? offer : null, actorId: input.supportActorId ?? actor.id, operationId });
}

async function notify(tx: Tx, ctx: Context, quoted: Quote, facts: { cause: 'chef' | 'kitchen'; reason: string | null; itemName: string;
  offer: DayCancellationOffer | null; actorId: number; operationId: string }) {
  const bookingId = ctx.booking.id, reference = ctx.booking.referenceCode || `#${bookingId}`, refund = dollars(quoted.chefRefundCents);
  const zone = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const offerLine = facts.offer ? ` You can also cancel your other remaining days without the late charge until ${zone.format(new Date(facts.offer.expiresAt))}; each is refunded minus its card processing fee.` : '';
  const first = quoted.days[0];
  // The notice names the affected day, not the booking's first date.
  const shared = { operationId: facts.operationId, ...(first?.date ? { noticeDay: { date: first.date, startTime: first.startTime, endTime: first.endTime } } : {}), dayCancellation: { cause: facts.cause, visitIds: quoted.visitIds, equipmentIds: quoted.equipmentIds,
    refundCents: quoted.chefRefundCents, feeCents: quoted.feeRetainedCents, kitchenShareRetainedCents: quoted.kitchenShareRetainedCents,
    processingCostAbsorbedCents: quoted.processingCostAbsorbedCents, offerExpiresAt: facts.offer?.expiresAt ?? null } };
  if (quoted.mode === 'extra') {
    const day = dayLabel(first.date);
    await queueBookingLifecycleEvent(tx, bookingId, 'refund_issued', `The kitchen refunded you ${refund}`,
      `${ctx.kitchenName} refunded ${refund} for ${day}${facts.reason ? `: ${facts.reason}` : ''}. Kitchen payout −${refund}.`, facts.actorId,
      { ...shared, roleText: { chef: { title: `The kitchen refunded you ${refund}`, message: `${ctx.kitchenName} sent you a refund of ${refund} for ${day}${facts.reason ? `: ${facts.reason}` : ''}. Banks usually show it within 5–10 business days.` },
        manager: { title: `You refunded ${refund}`, message: `You refunded the customer ${refund} for ${day}. It comes out of your payout for that day.` } } });
    return;
  }
  if (quoted.equipmentIds.length) {
    await queueBookingLifecycleEvent(tx, bookingId, 'addon_removed', `${facts.itemName} removed`, `${facts.itemName} removed.`, facts.actorId,
      { ...shared, itemKind: 'equipment', itemId: quoted.equipmentIds[0], addonRemoval: { state: quoted.chefRefundCents ? 'processing' : 'removed', itemName: facts.itemName,
        free: quoted.lines.every(line => line.paidCents === 0), afterDeadline: !quoted.beforeDeadline && facts.cause === 'chef', refundCents: quoted.chefRefundCents,
        kitchenRefundCents: quoted.kitchenPaysCents, feeCents: quoted.feeRetainedCents, ...(facts.reason ? { reason: facts.reason } : {}) } });
    return;
  }
  if (quoted.cancelsBooking) {
    await queueBookingLifecycleEvent(tx, bookingId, 'cancelled', 'Booking cancelled', facts.cause === 'kitchen'
      ? `We’re sorry, the kitchen needs to cancel: ${facts.reason || 'Kitchen unavailable'}. Your payment of ${refund} is being refunded, including the card processing fee. Reference ${reference}.`
      : quoted.chefRefundCents ? `You cancelled your booking. Your refund is ${refund}; the ${dollars(quoted.feeRetainedCents)} card processing fee is kept.` : 'You cancelled your booking. There is no refund under your booking’s saved policy.',
      facts.actorId, { ...shared, ...(facts.cause === 'kitchen' ? { kitchenCaused: true } : {}),
        cancellationNotice: { cause: facts.cause, refundCents: quoted.chefRefundCents, feeCents: quoted.feeRetainedCents, kitchenShareRetainedCents: quoted.kitchenShareRetainedCents,
          ...(facts.reason && facts.cause === 'kitchen' ? { reason: facts.reason } : {}), reference } });
    return;
  }
  const days = facts.itemName;
  const chef = facts.cause === 'kitchen'
    ? { title: `The kitchen can’t host you on ${days}`, message: `We’re sorry, the kitchen needs to cancel ${days}${facts.reason ? `: ${facts.reason}` : ''}. Your payment for ${quoted.days.length === 1 ? 'that day' : 'those days'}, ${refund}, is being refunded in full, including the card processing fee. Your other days stay booked.${offerLine}` }
    : { title: `${days} cancelled`, message: quoted.chefRefundCents ? `You cancelled ${days}. Your refund is ${refund}; the ${dollars(quoted.feeRetainedCents)} card processing fee is kept. Your other days stay booked.`
      : `You cancelled ${days}. There is no refund under your booking’s saved policy. Your other days stay booked.` };
  const manager = facts.cause === 'kitchen'
    ? { title: `You cancelled ${days}`, message: `The customer receives a full refund of ${refund} for ${days}. Your payout for ${quoted.days.length === 1 ? 'that day' : 'those days'} is $0.00. Their other days stay booked.` }
    : { title: `The customer cancelled ${days}`, message: `Your payout for ${quoted.days.length === 1 ? 'that day' : 'those days'} is ${dollars(quoted.kitchenShareRetainedCents)}. Their other days stay booked.` };
  // Local Cooks' copy is factual (admin-booking-notice uses this message).
  const admin = facts.cause === 'kitchen'
    ? `${ctx.kitchenName} cancelled ${days}. Refunded ${refund} including the card fee; Local Cooks absorbs ${dollars(quoted.processingCostAbsorbedCents)}; kitchen payout −${dollars(quoted.kitchenPaysCents)}.${facts.offer ? ` Chef may drop the remaining days without the late charge until ${zone.format(new Date(facts.offer.expiresAt))}.` : ''}`
    : `The chef cancelled ${days}. Refunded ${refund}; card fee kept ${dollars(quoted.feeRetainedCents)}; kitchen keeps ${dollars(quoted.kitchenShareRetainedCents)}.`;
  await queueBookingLifecycleEvent(tx, bookingId, 'day_cancelled', chef.title, admin, facts.actorId, { ...shared, roleText: { chef, manager } });
}

/**
 * A refund made outside the app (e.g. in the Stripe dashboard) holds every day payout until Local Cooks says who paid it:
 * one day's kitchen share (debited from that day only) or nobody's (Local Cooks-funded, counted like goodwill). Audited.
 */
export async function assignOutsideRefund(bookingId: number, actorId: number, input: { refundId: string; visitId?: number; kitchenDebitCents?: number; note?: string }) {
  const before = await load(db as unknown as Tx, bookingId, false);
  if (!before.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  // The refund belongs to one of the booking's charges (its own payment or a paid change).
  const all = await chargeFacts(before);
  const charge = before.charges.find(item => all.get(item.source.id)!.refunds.some(row => row.id === input.refundId)) ?? before.charges[0];
  const facts = all.get(charge.source.id)!;
  const provider = facts.refunds.find(row => row.id === input.refundId);
  if (provider?.status !== 'succeeded') throw fail('Choose a refund the payment provider shows as sent.');
  if (operations(charge.source).some(op => op.id === provider.metadata?.refund_operation_id || op.refundId === provider.id))
    throw fail('This refund belongs to a booking cancellation already.');
  return db.transaction(async tx => {
    const locked = await load(tx, bookingId, true), mine = locked.charges.find(item => item.source.id === charge.source.id);
    if (!mine) throw fail('The booking payment changed or needs review. Refresh and try again.');
    const ctx = on(locked, mine), source = ctx.source!, saved = metadata(source);
    if ((saved.outsideRefunds || []).some((row: any) => row.refundId === provider.id)) return { success: true, replayed: true, refundId: provider.id };
    if (saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded') throw fail('An earlier refund on this booking is still being processed.');
    const allocated = provider.metadata?.customer_receives !== undefined;
    // A refund that already says how it was funded keeps that split; otherwise Local Cooks chooses the kitchen's part (default none).
    const kitchenDebit = allocated ? Number(provider.metadata!.manager_debited || 0) : input.kitchenDebitCents ?? 0;
    if (!Number.isSafeInteger(kitchenDebit) || kitchenDebit < 0 || kitchenDebit > provider.amount) throw fail('The kitchen’s part must be between $0 and the refund.', 400);
    if (kitchenDebit && !input.visitId) throw fail('Choose the day this refund came out of.', 400);
    const at = new Date();
    if (kitchenDebit) {
      const rows = ctx.allocations.filter(row => row.visitId === input.visitId);
      const open = rows.map(row => Math.max(0, row.subtotalCents + row.taxCents - (row.stripeFeeCents ?? 0) - settledOn(row).kitchen));
      if (!rows.length || rows.some(row => row.stripeFeeCents === null) || kitchenDebit > open.reduce((t, n) => t + n, 0))
        throw fail('That day’s kitchen share can’t fund this refund. Choose another day or Local Cooks.');
      const shares = allocateCents(kitchenDebit, open);
      for (const [i, row] of Array.from(rows.entries())) {
        if (!shares[i]) continue;
        const installment = ctx.installments.find(item => item.visitId === row.visitId && item.allocationRevision === row.allocationRevision);
        const funding = installment?.transferId ? 'reversal' as const : 'entitlement' as const;
        const record: RefundRecord = { operationId: `outside:${provider.id}`, mode: 'outside', at: at.toISOString(), customerCents: shares[i], kitchenCents: shares[i],
          platformCents: 0, absorbedFeeCents: 0, feeCents: row.stripeFeeCents!, refundPercent: 0, funding, installmentId: installment?.id ?? null };
        await tx.update(kitchenBookingDayAllocations).set({ evidence: { ...evidence(row), refunds: [...records(row), record],
          ...(funding === 'entitlement' ? { managerDebitedCents: Number(evidence(row).managerDebitedCents || 0) + shares[i] } : {}) } })
          .where(eq(kitchenBookingDayAllocations.id, row.id));
      }
    }
    // A paid day can't be reduced any more: its part becomes recorded kitchen debt, as for any day refund that can't be reversed.
    const sentDay = !!kitchenDebit && ctx.installments.some(item => item.visitId === input.visitId && item.transferId);
    const receipt = { id: provider.id, customerReceived: provider.amount, managerDebited: kitchenDebit, platformServiceFeeReturned: 0, platformGoodwillCents: provider.amount - kitchenDebit };
    const assignment = { refundId: provider.id, visitId: input.visitId ?? null, kitchenDebitCents: kitchenDebit, actorId, at: at.toISOString(), note: input.note?.slice(0, 500) ?? null };
    await tx.update(paymentTransactions).set({ metadata: { ...saved, refunds: allocated ? saved.refunds : [...(saved.refunds || []).filter((row: any) => row.id !== provider.id), receipt],
      outsideRefunds: [...(saved.outsideRefunds || []), assignment],
      ...(sentDay ? { kitchenRefundDebts: [...(saved.kitchenRefundDebts || []), { operationId: `outside:${provider.id}`, bookingId, visitId: input.visitId,
        amountCents: kitchenDebit, refundId: provider.id, status: 'open', recordedAt: at.toISOString() }] } : {}) }, updatedAt: at })
      .where(eq(paymentTransactions.id, source.id));
    await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(source.paymentIntentId!, tx, facts);
    await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: source.status, eventType: 'outside_refund_assigned', createdBy: actorId,
      description: kitchenDebit ? `Refund made outside the app assigned to ${dayLabel(ctx.visits.find(v => v.id === input.visitId)?.visitDate ?? null)} (kitchen ${dollars(kitchenDebit)})`
        : 'Refund made outside the app reviewed: Local Cooks-funded, no day debited', metadata: assignment }, tx);
    return { success: true, refundId: provider.id, amountCents: provider.amount, managerPaysCents: kitchenDebit, localCooksPaysCents: provider.amount - kitchenDebit };
  });
}

/** After the receipt is verified: a reversed paid day records its reversed amount, so revenue and payout evidence show it (once per operation). */
export async function finalizeDatedRefund(tx: Tx, operation: Record<string, any>) {
  for (const reversal of (operation.reversals || []) as Array<{ installmentId: number; amountCents: number; debt?: boolean }>) {
    if (reversal.debt) continue;
    const [row] = await tx.select().from(kitchenBookingDayPayouts).where(eq(kitchenBookingDayPayouts.id, reversal.installmentId)).for('update');
    if (!row) continue;
    const saved = (row.evidence || {}) as Record<string, any>, applied = { ...(saved.reversals || {}), [operation.id]: reversal.amountCents };
    await tx.update(kitchenBookingDayPayouts).set({ evidence: { ...saved, reversals: applied,
      reversedCents: Object.values(applied).reduce((t: number, n) => t + Number(n), 0) }, updatedAt: new Date() }).where(eq(kitchenBookingDayPayouts.id, row.id));
  }
}
