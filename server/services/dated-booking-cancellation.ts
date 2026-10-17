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
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchenBookingDayAllocations, kitchenBookingDayPayouts, paymentTransactions,
  equipmentBookings, equipmentListings, kitchens, locations } from '@shared/schema';
import { quoteCancellation, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { cancellationSourceQuote } from '@shared/cancellation-refund';
import { getCancellationPaymentFacts } from './stripe-service';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { addPaymentHistory } from './payment-transactions-service';
import { revokeForVisit } from './visit-code-challenge';
import { cancelLinkedBookingDates } from './booking-linked-cancellation';
import { BookingItemCancellationError } from './booking-item-cancellation';
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
  refundPercent: number; funding: 'entitlement' | 'reversal'; installmentId: number | null; transferId: string | null };

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
  const source = sources.find(item => item.payoutPartition === 'per_day' && !!item.paymentIntentId && item.paymentIntentId === booking.paymentIntentId);
  const visitQuery = tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.id));
  const visits = lock ? await visitQuery.for('update') : await visitQuery;
  const rows = source ? await tx.select().from(kitchenBookingDayAllocations).where(eq(kitchenBookingDayAllocations.sourceId, source.id)).orderBy(asc(kitchenBookingDayAllocations.id)) : [];
  const installmentQuery = source ? tx.select().from(kitchenBookingDayPayouts).where(eq(kitchenBookingDayPayouts.sourceId, source.id)).orderBy(asc(kitchenBookingDayPayouts.id)) : undefined;
  const installments = installmentQuery ? lock ? await installmentQuery.for('update') : await installmentQuery : [];
  const equipment = await tx.select({ row: equipmentBookings, name: equipmentListings.equipmentType }).from(equipmentBookings)
    .innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId)).where(eq(equipmentBookings.kitchenBookingId, bookingId));
  // Supplemental change charges are allocated by CP7; until then a captured one makes this booking support-only.
  const supplemental = sources.filter(item => item.id !== source?.id && metadata(item).kitchenChangeId && ['succeeded', 'partially_refunded'].includes(item.status));
  return { booking, managerId: row.managerId!, timezone: row.timezone || 'America/St_Johns', kitchenName: row.kitchenName, source, supplemental,
    visits, allocations: rows, installments, equipment };
}
type Context = Awaited<ReturnType<typeof load>>;

function assertActor(ctx: Context, actor: DayActor) {
  if ((actor.role === 'chef' ? ctx.booking.chefId : ctx.managerId) !== actor.id) throw fail('Booking not found or access denied', 404);
}

/** What the booking's day set looks like at `at`: frozen session start per visit, and whether it can still be cancelled. */
function schedule(ctx: Context, at: Date) {
  const snapshot = ctx.booking.cancellationPolicySnapshot as CancellationPolicySnapshot | null;
  if (snapshot?.deadlineBasis !== 'booking_first_day' || !snapshot.sessions?.length) throw fail('This booking’s accepted terms need Local Cooks review before a refund can be quoted.');
  const firstStart = Math.min(...snapshot.sessions.map(session => Date.parse(session.startAt)));
  const deadlineAt = new Date(firstStart - snapshot.noticeHours * 3600_000);
  const current = ctx.visits.filter(visit => visit.scheduleRevision === ctx.booking.scheduleRevision);
  const days = current.map(visit => {
    const kitchen = ctx.allocations.find(row => row.visitId === visit.id && row.componentKey === 'kitchen');
    const session = kitchen ? snapshot.sessions[Number(evidence(kitchen).sessionIndex)] : undefined;
    if (!session) throw fail('This booking’s day allocations need Local Cooks review before a refund can be quoted.');
    const startAt = new Date(session.startAt);
    const started = !!visit.checkedInAt || (visit.checkinStatus ?? 'not_checked_in') !== 'not_checked_in' || at >= startAt;
    return { visit, startAt, active: visit.scheduleState === 'active', started };
  });
  return { snapshot, deadlineAt, days };
}

/** Exact cents for the selected components; nothing is written. Throws a 409 the caller can show as-is. */
function price(ctx: Context, facts: Facts, target: DayTarget, requested: DayMode, at: Date) {
  const { booking, source } = ctx;
  if (!source || !['succeeded', 'partially_refunded'].includes(source.status) || !source.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  if (booking.status !== 'confirmed' || !['paid', 'partially_refunded'].includes(booking.paymentStatus || '')
    || (booking.paymentDecision as { state?: string } | null)?.state === 'pending') throw fail('This booking can’t be changed in its current state.');
  if (ctx.supplemental.length) throw fail('This booking has a separate change payment. Contact Local Cooks to cancel days.');
  const { snapshot, deadlineAt, days } = schedule(ctx, at);
  const rows = ctx.allocations.filter(row => days.some(day => day.visit.id === row.visitId));
  if (!rows.length || rows.length !== ctx.allocations.length || new Set(rows.map(row => row.allocationRevision)).size !== 1)
    throw fail('This booking’s day allocations need Local Cooks review before a refund can be quoted.');
  if (rows.some(row => row.stripeFeeCents === null)) return { quoteReady: false as const, reasonCode: 'processing_fee_pending' as const, message: FEE_PENDING };
  const captured = Number(source.amount), fee = rows.reduce((sum, row) => sum + row.stripeFeeCents!, 0);
  if (rows.reduce((sum, row) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0) !== captured || fee !== facts.processingCost
    || facts.captured !== captured || facts.currency !== source.currency.toLowerCase() || facts.refunded !== Number(source.refundAmount || 0))
    throw fail('The booking payment changed or needs review. Refresh and try again.');
  const verified = cancellationSourceQuote({ ...facts, serviceFee: Number(source.serviceFee), localReceipts: metadata(source).refunds });

  // The selection: whole days (every component not already refunded) or single equipment items.
  const refunded = (row: Allocation) => !!evidence(row).refund;
  const dayOf = (visitId: number) => days.find(day => day.visit.id === visitId);
  let selected: Allocation[] = [];
  const visitIds = Array.from(new Set(target.visitIds || [])), equipmentIds = Array.from(new Set(target.equipmentIds || []));
  if (!!visitIds.length === !!equipmentIds.length) throw fail('Choose the days or the equipment to cancel.', 400);
  for (const visitId of visitIds) {
    const day = dayOf(visitId);
    if (!day?.active) throw fail('That day is no longer part of this booking.');
    if (day.started) throw fail(`${dayLabel(day.visit.visitDate)} has already started, so it can’t be cancelled.`);
    selected.push(...rows.filter(row => row.visitId === visitId && !refunded(row)));
  }
  for (const id of equipmentIds) {
    const item = ctx.equipment.find(entry => entry.row.id === id)?.row;
    const row = rows.find(entry => entry.componentKey === `equipment:${id}`);
    const day = item?.kitchenBookingVisitId ? dayOf(item.kitchenBookingVisitId) : undefined;
    if (!item || item.status !== 'confirmed' || !row || row.visitId !== item.kitchenBookingVisitId || refunded(row) || !day?.active) throw fail('This equipment is no longer booked.');
    if (day.started) throw fail('That day has already started, so its equipment can’t be removed now.');
    selected.push(row);
  }
  // #10: while the kitchen's offer is open, the chef drops its remaining days without the late charge.
  const offer = booking.kitchenDayCancellationOffer as DayCancellationOffer | null;
  const offerOpen = !!offer && at < new Date(offer.expiresAt) && Date.now() < Date.parse(offer.expiresAt);
  const mode: DayMode = requested === 'chef' && visitIds.length && offerOpen && visitIds.every(id => offer!.eligibleVisitIds.includes(id)) ? 'chef_offer' : requested;

  const index = new Map(rows.map((row, i) => [row.id, i]));
  const engine = quoteCancellation(mode === 'chef_offer' ? { ...snapshot, tiers: [{ minHoursBeforeStart: 0, refundPercent: 100 }] } : snapshot, {
    cancelAt: at, confirmedAt: booking.createdAt || at, capturedCents: captured, processingFeeCents: fee, cause: 'chef',
    components: rows.map(row => ({ id: componentId(row), kind: row.componentKey === 'kitchen' ? 'kitchen' as const : 'equipment' as const,
      sessionIndex: Number(evidence(row).sessionIndex), kitchenCents: row.subtotalCents + row.taxCents, platformCents: row.serviceFeeCents })),
    settledComponents: Object.fromEntries(rows.filter(row => !selected.includes(row)).map(row => [componentId(row), { refundCents: 0, kitchenRefundCents: 0 }])) });
  // The engine's fee split must be the frozen actual fee share on each allocation; anything else is not that part's fee.
  if (rows.some((row, i) => engine.perComponent[i].feeCents !== row.stripeFeeCents)) throw fail('This booking’s card-fee shares need Local Cooks review.');
  const lines: DayRefundLine[] = selected.map(row => {
    const part = engine.perComponent[index.get(row.id)!], gross = row.subtotalCents + row.taxCents, share = row.stripeFeeCents!;
    const installment = ctx.installments.find(item => item.visitId === row.visitId && item.allocationRevision === row.allocationRevision);
    // A day transfer frozen for release but not yet confirmed: the payout must settle first (the money guard also refuses).
    if (installment && !installment.transferId && (installment.evidence as { state?: string }).state === 'pending')
      throw fail('A payout for this booking is being sent. Try again in a few minutes.');
    const kitchen = mode === 'kitchen' ? { customerCents: gross + row.serviceFeeCents, kitchenCents: gross - share, platformCents: row.serviceFeeCents, absorbedFeeCents: share, refundPercent: 100 }
      : { customerCents: part.refundCents, kitchenCents: part.kitchenRefundCents, platformCents: part.platformRefundCents, absorbedFeeCents: 0, refundPercent: part.refundPercent };
    return { allocationId: row.id, visitId: row.visitId, componentKey: row.componentKey, kind: row.componentKey === 'kitchen' ? 'kitchen' : 'equipment',
      itemId: row.componentKey === 'kitchen' ? booking.id : Number(row.componentKey.slice('equipment:'.length)),
      paidCents: gross + row.serviceFeeCents, grossCents: gross, feeCents: share, ...kitchen, funding: installment?.transferId ? 'reversal' : 'entitlement',
      installmentId: installment?.id ?? null, transferId: installment?.transferId ?? null };
  });
  const sum = (key: keyof DayRefundLine) => lines.reduce((total, line) => total + Number(line[key]), 0);
  const customer = sum('customerCents'), kitchen = sum('kitchenCents'), platform = sum('platformCents'), absorbed = sum('absorbedFeeCents');
  if (lines.some(line => line.customerCents !== line.kitchenCents + line.platformCents + line.absorbedFeeCents || line.kitchenCents > line.grossCents - line.feeCents || line.platformCents > line.paidCents - line.grossCents)
    || customer > facts.captured - facts.refunded || kitchen > verified.managerRefund || platform > verified.serviceFeeReview)
    throw fail('The remaining payment cannot fund this refund. Local Cooks must review it.');
  const remaining = days.filter(day => day.active && !visitIds.includes(day.visit.id));
  const perDay = Array.from(new Set(lines.map(line => line.visitId))).map(visitId => {
    const own = lines.filter(line => line.visitId === visitId), day = dayOf(visitId)!;
    return { visitId, date: day.visit.visitDate, startAt: day.startAt.toISOString(), refundCents: own.reduce((t, l) => t + l.customerCents, 0),
      feeCents: mode === 'kitchen' ? 0 : own.reduce((t, l) => t + l.feeCents, 0), refundPercent: own[0].refundPercent,
      kitchenKeepsCents: own.reduce((t, l) => t + l.grossCents - l.feeCents - l.kitchenCents, 0),
      items: own.map(line => ({ componentKey: line.componentKey, refundCents: line.customerCents })) };
  });
  return { quoteReady: true as const, bookingId: booking.id, mode, cancelAt: at.toISOString(), deadlineAt: deadlineAt.toISOString(), beforeDeadline: at < deadlineAt,
    refundPercent: lines.length && lines.every(line => line.refundPercent === lines[0].refundPercent) ? lines[0].refundPercent : null,
    chefRefundCents: customer, feeRetainedCents: mode === 'kitchen' ? 0 : sum('feeCents'), retainedCents: sum('paidCents') - customer,
    kitchenShareRetainedCents: perDay.reduce((t, d) => t + d.kitchenKeepsCents, 0), kitchenPaysCents: kitchen, localCooksPaysCents: platform + absorbed,
    processingCostAbsorbedCents: absorbed, days: perDay, lines, visitIds, equipmentIds,
    cancelsBooking: !!visitIds.length && !remaining.length, remainingDays: remaining.length,
    offer: offerOpen ? { expiresAt: offer!.expiresAt, eligibleVisitIds: offer!.eligibleVisitIds.filter(id => remaining.some(day => day.visit.id === id) || visitIds.includes(id)) } : null,
    receipts: verified.receipts };
}
type Quote = Extract<ReturnType<typeof price>, { quoteReady: true }>;

/** Every active day that has not started: what "cancel all" means once a day has been used. */
export async function remainingDayIds(bookingId: number, at = new Date(), tx: Tx = db as unknown as Tx) {
  const ctx = await load(tx, bookingId, false);
  return schedule(ctx, at).days.filter(day => day.active && !day.started).map(day => day.visit.id);
}

/** The exact dollars before confirming. Defaults to every remaining day. */
export async function readDatedCancellationQuote(bookingId: number, actor: DayActor, target: DayTarget = {}, at = new Date()) {
  const ctx = await load(db as unknown as Tx, bookingId, false);
  assertActor(ctx, actor);
  if (!ctx.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  const chosen = target.visitIds?.length || target.equipmentIds?.length ? target : { visitIds: schedule(ctx, at).days.filter(day => day.active && !day.started).map(day => day.visit.id) };
  if (!chosen.visitIds?.length && !chosen.equipmentIds?.length) throw fail('There are no upcoming days left to cancel.');
  try { await assertBookingMoneyWritable({ bookingId }); } catch { throw fail('Local Cooks is reviewing this booking’s payment. Contact Local Cooks to change it.'); }
  return price(ctx, await getCancellationPaymentFacts(ctx.source.paymentIntentId), chosen, actor.role === 'manager' ? 'kitchen' : 'chef', at);
}

/** Support's preview: each remaining day (and all of them together) priced for the chef and for the kitchen, from one provider read. */
export async function readDatedDayPreviews(bookingId: number, at = new Date()) {
  const ctx = await load(db as unknown as Tx, bookingId, false);
  if (!ctx.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  const facts = await getCancellationPaymentFacts(ctx.source.paymentIntentId);
  const remaining = schedule(ctx, at).days.filter(day => day.active && !day.started).map(day => day.visit.id);
  const both = (visitIds: number[]) => Object.fromEntries((['chef', 'kitchen'] as const).map(mode => {
    const quoted = price(ctx, facts, { visitIds }, mode, at);
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
  if (!before.source?.paymentIntentId) throw fail('A verified captured payment is needed for a refund.');
  const operationId = datedOperationId(bookingId, input.operationKey, before.source.id);
  const prior = operations(before.source).find(op => op.id === operationId);
  if (!prior) {
    const facts = await getCancellationPaymentFacts(before.source.paymentIntentId);
    const target = input.target.visitIds?.length || input.target.equipmentIds?.length ? input.target
      : { visitIds: schedule(before, new Date()).days.filter(day => day.active && !day.started).map(day => day.visit.id) };
    if (!target.visitIds?.length && !target.equipmentIds?.length) throw fail('There are no upcoming days left to cancel.');
    await db.transaction(tx => commit(tx, bookingId, actor, { ...input, target }, operationId, facts));
  }
  const after = await load(db as unknown as Tx, bookingId, false);
  const operation = operations(after.source!).find(op => op.id === operationId);
  if (operation && operation.status !== 'succeeded') {
    try { await (await import('./booking-cancellation-refund')).retryCancellationRefund(bookingId, after.managerId); }
    catch (error) { logger.warn('[DayCancellation] Refund will be retried', { bookingId, error: error instanceof Error ? error.message : String(error) }); }
  }
  return readDatedOperation(bookingId, operationId, prior ? true : undefined);
}

export async function readDatedOperation(bookingId: number, operationId: string, replayed?: boolean) {
  const ctx = await load(db as unknown as Tx, bookingId, false);
  const operation = operations(ctx.source!).find(op => op.id === operationId);
  if (!operation) throw fail('The cancellation was not saved. Refresh and try again.');
  const state = operation.status === 'succeeded' ? 'refunded' : 'processing';
  return { success: true, action: operation.cancelsBooking ? 'cancelled' : operation.equipmentIds?.length ? 'removed' : 'days_cancelled', state, operationId,
    refundCents: operation.customerRefund, feeRetainedCents: operation.feeRetainedCents, kitchenShareRetainedCents: operation.kitchenShareRetainedCents,
    managerPaysCents: operation.managerRefund, localCooksPaysCents: operation.platformRefund + operation.platformProcessingCost,
    processingCostAbsorbedCents: operation.platformProcessingCost, amountCents: operation.customerRefund, paymentIntentId: operation.intentId,
    refundId: operation.refundId ?? null, visitIds: operation.visitIds, equipmentIds: operation.equipmentIds, days: operation.days,
    itemName: operation.itemName as string, refundPercent: operation.refundPercent as number | null,
    paidCents: (operation.lines as DayRefundLine[]).reduce((total, line) => total + line.paidCents, 0),
    offer: (ctx.booking.kitchenDayCancellationOffer as DayCancellationOffer | null) ?? null, ...(replayed ? { replayed } : {}) };
}

async function commit(tx: Tx, bookingId: number, actor: DayActor, input: DayCancellationInput & { target: DayTarget }, operationId: string, facts: Facts) {
  const ctx = await load(tx, bookingId, true);
  assertActor(ctx, actor);
  const source = ctx.source!;
  if (operations(source).some(op => op.id === operationId)) return;
  // The caller's own support action key (if any) is exempt, as in every cancellation command.
  await assertBookingMoneyWritable({ bookingId, operationKey: input.operationKey }, tx);
  const current = metadata(source).cancellationRefundOperation;
  // One refund operation per booking charge at a time: a later drop waits for the earlier refund to finish.
  if (current && current.status !== 'succeeded') throw fail('An earlier refund on this booking is still being processed. Try again in a few minutes.');
  if (metadata(source).refundRecovery && metadata(source).refundRecovery.status !== 'succeeded' || metadata(source).fullRefundRequest?.status === 'pending')
    throw fail('An earlier refund needs Local Cooks review first.');
  const at = new Date();
  const quoted = price(ctx, facts, input.target, actor.role === 'manager' ? 'kitchen' : 'chef', at);
  if (!quoted.quoteReady) throw fail(FEE_PENDING);
  if (input.expectedRefundCents !== undefined && input.expectedRefundCents !== quoted.chefRefundCents)
    throw fail('The refund changed. Review the refreshed amount before cancelling.');
  const cause = quoted.mode === 'kitchen' ? 'kitchen' as const : 'chef' as const, reason = input.reason?.trim().slice(0, 500) || null;
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
  if (equipmentIds.length) await tx.update(equipmentBookings).set({ status: 'cancelled', updatedAt: at }).where(inArray(equipmentBookings.id, equipmentIds));
  const { days } = schedule(ctx, at);
  const remaining = days.filter(day => day.active && !dropped.has(day.visit.id));
  const equipmentItems = ((ctx.booking.equipmentItems as Array<Record<string, any>> | null) || []).map(entry => equipmentIds.includes(entry.equipmentBookingId ?? entry.id)
    ? { ...entry, status: 'cancelled', cancelledAt: at.toISOString(), cancelledBy: cause } : entry);
  let offer = ctx.booking.kitchenDayCancellationOffer as DayCancellationOffer | null;
  if (cause === 'kitchen' && visitIds.length) {
    const eligible = remaining.filter(day => !day.started).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    offer = eligible.length ? { id: operationId, cancelledVisitIds: visitIds, eligibleVisitIds: eligible.map(day => day.visit.id),
      createdAt: at.toISOString(), expiresAt: eligible[0].startAt.toISOString() } : null;
  }
  if (quoted.cancelsBooking) {
    await tx.update(kitchenBookings).set({ status: 'cancelled', cancellationEffectiveAt: at, cancellationOperationKey: input.operationKey, cancellationCause: cause,
      cancellationRequestReason: reason, kitchenDayCancellationOffer: null, updatedAt: at }).where(eq(kitchenBookings.id, bookingId));
    await cancelLinkedBookingDates(tx, bookingId);
  } else {
    const selectedSlots = remaining.sort((a, b) => a.visit.visitDate!.localeCompare(b.visit.visitDate!)).flatMap(day => ((day.visit.selectedSlots as Array<{ startTime: string; endTime: string }> | null) || [])
      .map(slot => ({ ...slot, date: day.visit.visitDate, windowStartTime: day.visit.operatingWindowStartTime })));
    await tx.update(kitchenBookings).set({ selectedSlots, equipmentItems, kitchenDayCancellationOffer: offer, updatedAt: at }).where(eq(kitchenBookings.id, bookingId));
  }

  // Ledger: each refunded allocation records its exact cents; an unsent day's payout drops by its kitchen debit.
  for (const line of quoted.lines) {
    const row = ctx.allocations.find(item => item.id === line.allocationId)!, saved = evidence(row);
    await tx.update(kitchenBookingDayAllocations).set({ evidence: { ...saved, refund: { operationId, mode: quoted.mode, at: at.toISOString(),
      customerCents: line.customerCents, kitchenCents: line.kitchenCents, platformCents: line.platformCents, feeCents: line.feeCents,
      absorbedFeeCents: line.absorbedFeeCents, refundPercent: line.refundPercent, funding: line.funding, installmentId: line.installmentId },
      ...(line.funding === 'entitlement' ? { managerDebitedCents: Number(saved.managerDebitedCents || 0) + line.kitchenCents } : {}) } })
      .where(eq(kitchenBookingDayAllocations.id, row.id));
  }
  const reversals = Array.from(new Set(quoted.lines.filter(line => line.funding === 'reversal' && line.kitchenCents > 0).map(line => line.installmentId!)))
    .map(installmentId => { const own = quoted.lines.filter(line => line.installmentId === installmentId);
      return { installmentId, visitId: own[0].visitId, transferId: own[0].transferId!, amountCents: own.reduce((t, l) => t + l.kitchenCents, 0) }; });
  const names = Object.fromEntries(ctx.equipment.map(entry => [entry.row.id, entry.name || 'Equipment']));
  const itemName = quoted.equipmentIds.length ? quoted.equipmentIds.map(id => names[id]).join(', ')
    : quoted.days.map(day => dayLabel(day.date)).join(', ');
  const saved = metadata(source);
  const operation = { id: operationId, dated: true, policyEngine: true, intentId: source.paymentIntentId, bookingId, managerId: ctx.managerId, chefId: ctx.booking.chefId,
    operationKey: input.operationKey, mode: quoted.mode, cause, reason, status: quoted.chefRefundCents ? 'pending' : 'succeeded', acceptedAt: at.toISOString(),
    customerRefund: quoted.chefRefundCents, managerRefund: quoted.kitchenPaysCents, platformRefund: quoted.lines.reduce((t, l) => t + l.platformCents, 0),
    platformProcessingCost: quoted.processingCostAbsorbedCents, feeRetainedCents: quoted.feeRetainedCents, kitchenShareRetainedCents: quoted.kitchenShareRetainedCents,
    refundPercent: quoted.refundPercent, beforeDeadline: quoted.beforeDeadline, deadlineAt: quoted.deadlineAt, cancelsBooking: quoted.cancelsBooking,
    visitIds, equipmentIds: quoted.equipmentIds, cancelledEquipmentIds: equipmentIds, days: quoted.days, lines: quoted.lines, reversals, itemName,
    cancellationNoticeIncludesRefund: true, ...(input.supportActorId ? { supportOperationKey: input.operationKey, supportActorId: input.supportActorId } : {}) };
  await tx.update(paymentTransactions).set({ metadata: { ...saved, refunds: quoted.receipts,
    cancellationRefundOperations: [...(saved.cancellationRefundOperations || []), ...(saved.cancellationRefundOperation ? [saved.cancellationRefundOperation] : [])],
    cancellationRefundOperation: operation }, updatedAt: at }).where(eq(paymentTransactions.id, source.id));
  await addPaymentHistory(source.id, { previousStatus: source.status, newStatus: source.status, eventType: 'dated_refund_reserved',
    description: `${cause === 'kitchen' ? 'Kitchen' : 'Chef'} cancelled ${itemName}; exact day refund reserved before provider work`,
    createdBy: input.supportActorId ?? actor.id, metadata: operation }, tx);
  await notify(tx, ctx, quoted, { cause, reason, itemName, offer: cause === 'kitchen' ? offer : null, actorId: input.supportActorId ?? actor.id, operationId });
}

async function notify(tx: Tx, ctx: Context, quoted: Quote, facts: { cause: 'chef' | 'kitchen'; reason: string | null; itemName: string;
  offer: DayCancellationOffer | null; actorId: number; operationId: string }) {
  const bookingId = ctx.booking.id, reference = ctx.booking.referenceCode || `#${bookingId}`, refund = dollars(quoted.chefRefundCents);
  const zone = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const offerLine = facts.offer ? ` You can also cancel your other remaining days without the late charge until ${zone.format(new Date(facts.offer.expiresAt))}; each is refunded minus its card processing fee.` : '';
  const shared = { operationId: facts.operationId, dayCancellation: { cause: facts.cause, visitIds: quoted.visitIds, equipmentIds: quoted.equipmentIds,
    refundCents: quoted.chefRefundCents, feeCents: quoted.feeRetainedCents, kitchenShareRetainedCents: quoted.kitchenShareRetainedCents,
    processingCostAbsorbedCents: quoted.processingCostAbsorbedCents, offerExpiresAt: facts.offer?.expiresAt ?? null } };
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
    ? { title: `You cancelled ${days}`, message: `The chef receives a full refund of ${refund} for ${days}. Your payout for ${quoted.days.length === 1 ? 'that day' : 'those days'} is $0.00. Their other days stay booked.` }
    : { title: `The chef cancelled ${days}`, message: `Your payout for ${quoted.days.length === 1 ? 'that day' : 'those days'} is ${dollars(quoted.kitchenShareRetainedCents)}. Their other days stay booked.` };
  // Local Cooks' copy is factual (admin-booking-notice uses this message).
  const admin = facts.cause === 'kitchen'
    ? `${ctx.kitchenName} cancelled ${days}. Refunded ${refund} including the card fee; Local Cooks absorbs ${dollars(quoted.processingCostAbsorbedCents)}; kitchen payout −${dollars(quoted.kitchenPaysCents)}.${facts.offer ? ` Chef may drop the remaining days without the late charge until ${zone.format(new Date(facts.offer.expiresAt))}.` : ''}`
    : `The chef cancelled ${days}. Refunded ${refund}; card fee kept ${dollars(quoted.feeRetainedCents)}; kitchen keeps ${dollars(quoted.kitchenShareRetainedCents)}.`;
  await queueBookingLifecycleEvent(tx, bookingId, 'day_cancelled', chef.title, admin, facts.actorId, { ...shared, roleText: { chef, manager } });
}
