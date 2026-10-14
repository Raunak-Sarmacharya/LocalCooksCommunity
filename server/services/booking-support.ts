import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db';
import { bookingFlags, supportActions, kitchenBookings, kitchenBookingVisits, kitchens, locations, users,
  paymentTransactions, paymentHistory, bookingLifecycleEvents, emailLogs, commitmentProblems, storageBookings, equipmentBookings } from '@shared/schema';
import { supportActionInput, type AvailableSupportAction, type SupportActionInput, type SupportActionType } from '@shared/booking-support';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { bookingChangeSchedule, kitchenRescheduleCutoff } from '@shared/kitchen-booking-change';
import { bookingAttendanceEnd, visitAttendanceEnd } from '@shared/booking-attendance';
import { chefVisitCodes, ensureChallengesForBooking, issueNewCode, setMode, resolveArrivalTarget } from './visit-code-challenge';
import { queueBookingLifecycleEvent, requeueBookingNotice } from './booking-lifecycle-delivery';
import { decideAuthorizedBooking, reconcileBookingDecision } from './booking-payment-decision';
import { acceptCancellationRefund, readCancellationRefund, requestChefCancellation, refundSupportGoodwill, cancelKitchenCausedBooking } from './booking-cancellation-refund';
import { getBookingPaymentIntent, getCancellationPaymentFacts, getBookingCheckoutSession, getPaymentIntentRefunds } from './stripe-service';
import { bookingCaptureTerms } from '@shared/booking-capture-terms';
import { assistKitchenVisit } from './visit-assistance';
import { recordBookingAttendance } from './booking-attendance-service';
import { recordKitchenInspection, projectBookingCloseout } from './clock-closeout';
import { claimKitchenVisit } from './kitchen-visit-lifecycle';
import { changeBookingFlag } from './booking-support-flags';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';
import { getBookingResponseDeadline } from './booking-response-deadline';
import { getUserDisplayName } from '../utils/user-display';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Claim decisions share the booking desk and support_actions audit, with their own capped money decisions. */
export async function executeDamageClaimSupportAction(bookingId: number, actorId: number, input: unknown) {
  return (await import('./damage-claims-v2')).decideDamageClaim(bookingId, actorId, input);
}
type Booking = typeof kitchenBookings.$inferSelect;
type Payment = typeof paymentTransactions.$inferSelect;
type Visit = typeof kitchenBookingVisits.$inferSelect;
export class BookingSupportError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const chef = alias(users, 'support_chef'), manager = alias(users, 'support_manager');
const chefName = sql<string>`COALESCE(${chef.managerProfileData}->>'fullName', ${chef.managerProfileData}->>'displayName',
  (SELECT a.full_name FROM applications a WHERE a.user_id = ${chef.id} AND a.status = 'approved' ORDER BY a.id DESC LIMIT 1),
  (SELECT a.full_name FROM chef_kitchen_applications a WHERE a.chef_id = ${chef.id} ORDER BY a.id DESC LIMIT 1))`;
const managerName = sql<string>`COALESCE(${manager.managerProfileData}->>'fullName', ${manager.managerProfileData}->>'displayName')`;
const contextFields = { booking: kitchenBookings, kitchen: { id: kitchens.id, name: kitchens.name },
  location: { id: locations.id, name: locations.name, address: locations.address, timezone: locations.timezone },
  chef: { id: chef.id, name: chefName, email: chef.username, phone: chef.phoneNumber },
  manager: { id: manager.id, name: managerName, email: manager.username, phone: manager.phoneNumber } };
/**
 * A real person name or null. getUserDisplayName ends in the email's local part or a role word
 * ("Manager", "A chef"); neither is a name, so the staff view shows "Name not set" instead.
 */
async function partyName(party: { id: number | null; email: string | null } | null, role: 'chef' | 'manager'): Promise<string | null> {
  if (!party?.id) return null;
  const name = (await getUserDisplayName(party.id, role)).trim();
  if (!name || name.includes('@') || name === party.email?.split('@')[0] || ['Manager', 'A chef'].includes(name)) return null;
  return name;
}
function contextQuery(tx: Tx) {
  return tx.select(contextFields).from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).leftJoin(chef, eq(chef.id, kitchenBookings.chefId))
    .leftJoin(manager, eq(manager.id, locations.managerId));
}
export async function searchBookingSupport(q: string) {
  const query = q.trim().slice(0, 150);
  if (!query) return { results: [] };
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await contextQuery(db as unknown as Tx).where(or(eq(kitchenBookings.id, /^\d+$/.test(query) && Number.isSafeInteger(Number(query)) ? Number(query) : -1),
    sql`${kitchenBookings.referenceCode} ILIKE ${pattern}`, sql`${chef.username} ILIKE ${pattern}`, sql`${manager.username} ILIKE ${pattern}`,
    sql`${chefName} ILIKE ${pattern}`, sql`${managerName} ILIKE ${pattern}`)).orderBy(desc(kitchenBookings.id)).limit(50);
  return { results: rows.map(row => ({ bookingId: row.booking.id, referenceCode: row.booking.referenceCode || `#${row.booking.id}`,
    status: row.booking.status, paymentStatus: row.booking.paymentStatus, chefName: row.chef?.name || null,
    managerName: row.manager?.name || null, kitchenName: row.kitchen.name, bookingDate: row.booking.bookingDate.toISOString(),
    startTime: row.booking.startTime, endTime: row.booking.endTime, timezone: row.location.timezone || DEFAULT_TIMEZONE })) };
}
async function loadContext(id: number, tx: Tx = db as unknown as Tx) {
  const [row] = await contextQuery(tx).where(eq(kitchenBookings.id, id)).limit(1);
  if (!row) throw new BookingSupportError('Booking not found.', 404);
  const storage = await tx.select().from(storageBookings).where(eq(storageBookings.kitchenBookingId, id));
  const equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, id));
  const payments = await tx.select().from(paymentTransactions).where(or(
    and(inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(paymentTransactions.bookingId, id)),
    storage.length ? and(eq(paymentTransactions.bookingType, 'storage'), inArray(paymentTransactions.bookingId, storage.map(item => item.id))) : undefined,
    equipment.length ? and(eq(paymentTransactions.bookingType, 'equipment'), inArray(paymentTransactions.bookingId, equipment.map(item => item.id))) : undefined)).orderBy(asc(paymentTransactions.id));
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, id)).orderBy(asc(kitchenBookingVisits.blockIndex));
  const flags = await tx.select().from(bookingFlags).where(and(eq(bookingFlags.bookingId, id), isNull(bookingFlags.resolvedAt)));
  const actions = await tx.select().from(supportActions).where(eq(supportActions.bookingId, id)).orderBy(desc(supportActions.id));
  const responseDeadlineAt = row.booking.status === 'pending' ? await getBookingResponseDeadline(row.booking, tx, row.location.timezone) : null;
  return { ...row, storage, equipment, payments, visits, flags, actions, responseDeadlineAt };
}
type Context = Awaited<ReturnType<typeof loadContext>>;
const labels: Record<SupportActionType, string> = {
  confirm_for_manager: 'Confirm for the kitchen', decline_for_manager: 'Decline for the kitchen', release_hold_for_chef: 'Release the card hold',
  replay_payment_decision: 'Check the saved payment decision', cancel_kitchen_caused: 'Cancel because the kitchen cannot host',
  request_cancellation_for_chef: 'Cancel the booking for the chef', accept_cancellation_for_manager: 'Accept the cancellation for the kitchen',
  issue_visit_code: 'Get a new check-in code', set_arrival_mode: 'Change how arrival is recorded', record_assisted_arrival: 'Add a reported arrival',
  correct_attendance: 'Fix the visit record', clear_checkout_for_manager: 'Clear the kitchen inspection', report_issue_for_manager: 'Report a visit concern',
  goodwill_refund: 'Send a Local Cooks goodwill refund', resend_notice: 'Send a booking notice again', open_flag: 'Pause refunds and kitchen payments', resolve_flag: 'Resolve a support flag',
  release_payout: 'Release payout',
};
const updates: Record<SupportActionType, string> = {
  confirm_for_manager: 'the kitchen has confirmed your booking', decline_for_manager: 'the kitchen request was declined and the card hold was released',
  release_hold_for_chef: 'your booking request was withdrawn and the card hold was released', replay_payment_decision: 'the saved payment decision has been checked',
  cancel_kitchen_caused: 'the kitchen could not host this booking, so it has been cancelled and the remaining payment has been refunded',
  request_cancellation_for_chef: 'your booking has been cancelled under its saved terms', accept_cancellation_for_manager: 'the kitchen has accepted the cancellation and the refund has been checked',
  issue_visit_code: 'the arrival details have been updated; ask kitchen staff for the current check-in code', set_arrival_mode: 'the arrival method has been updated',
  record_assisted_arrival: 'a reported arrival time has been added', correct_attendance: 'the visit record has been corrected',
  clear_checkout_for_manager: 'the kitchen inspection is complete', report_issue_for_manager: 'a visit concern has been recorded for review; no new charge has been made',
  goodwill_refund: 'a goodwill refund has been sent by Local Cooks', resend_notice: 'a booking notice has been queued to send again',
  open_flag: 'refunds and kitchen payments are paused while we review a payment issue', resolve_flag: 'a payment support flag has been resolved',
  release_payout: 'the kitchen payout has been released',
};
const cents = (value: unknown) => value == null ? 0 : Number(value);
function money(ctx: Pick<Context, 'booking' | 'payments'>) {
  const captured = ctx.payments.filter(row => ['succeeded', 'partially_refunded', 'refunded'].includes(row.status));
  return { capturedCents: captured.reduce((sum, row) => sum + cents(row.amount), 0),
    refundedCents: captured.reduce((sum, row) => sum + cents(row.refundAmount), 0),
    platformFeeCents: captured.reduce((sum, row) => sum + cents(row.serviceFee), 0),
    processingFeeCents: captured.reduce((sum, row) => sum + cents(row.stripeProcessingFee), 0), currency: ctx.booking.currency,
    providerVerified: false as const, transfers: ctx.payments.map(row => ({ transactionId: row.id, transferId: row.transferId,
      status: row.transferId ? 'recorded' : 'not_recorded', managerRevenueCents: cents(row.managerRevenue) })) };
}
export function availableSupportActions(ctx: Pick<Context, 'booking' | 'payments' | 'visits' | 'flags' | 'actions' | 'storage' | 'equipment'> & Partial<Pick<Context, 'responseDeadlineAt' | 'location'>>, now = new Date()): AvailableSupportAction[] {
  const booking = ctx.booking, decision = booking.paymentDecision as { state?: string; target?: string } | null;
  const result: SupportActionType[] = ['open_flag', 'resend_notice'];
  if (ctx.flags.length) result.push('resolve_flag');
  const busy = ctx.actions.some(row => ['executing', 'recovery_required'].includes(row.status));
  const recovering = decision?.state === 'pending';
  if (recovering) result.push('replay_payment_decision');
  const flags = ctx.flags.length > 0;
  const priorGoodwill = ctx.actions.some(action => action.actionType === 'goodwill_refund' && action.status !== 'failed')
    || ctx.payments.some(source => ((source.metadata as { refunds?: Array<{ platformGoodwillCents?: number }> } | null)?.refunds || []).some(receipt => (receipt.platformGoodwillCents || 0) > 0));
  const moneyNeedsReview = ctx.payments.some(source => {
    const metadata = source.metadata as { refundRecovery?: { status?: string }; cancellationRefundOperation?: { status?: string }; fullRefundRequest?: { status?: string } } | null;
    return metadata?.refundRecovery && metadata.refundRecovery.status !== 'succeeded'
      || metadata?.cancellationRefundOperation && metadata.cancellationRefundOperation.status !== 'succeeded'
      || metadata?.fullRefundRequest?.status === 'pending';
  });
  if (!busy && !recovering && booking.status === 'pending' && booking.paymentStatus === 'authorized' && !decision && booking.chefId && booking.paymentIntentId) {
    if (!flags && now < (ctx.responseDeadlineAt ?? responseDeadlineForBooking(booking, ctx.location?.timezone || DEFAULT_TIMEZONE))) result.push('confirm_for_manager');
    result.push('decline_for_manager', 'release_hold_for_chef');
  }
  if (!busy && !recovering && booking.status === 'confirmed' && ['paid', 'partially_refunded'].includes(booking.paymentStatus || '')) {
    if (!flags && !moneyNeedsReview) result.push('request_cancellation_for_chef');
    if (!flags && !moneyNeedsReview && !priorGoodwill && ctx.payments.length === 1 && !ctx.storage.some(item => item.status === 'completed' || item.checkinStatus === 'checkin_completed')
      && !ctx.equipment.some(item => item.status === 'completed')) result.push('cancel_kitchen_caused');
  }
  if (!busy && !recovering && !flags && booking.status === 'cancellation_requested'
    && now.getTime() < kitchenRescheduleCutoff(bookingChangeSchedule(booking), booking.cancellationPolicyHours ?? 24)) result.push('accept_cancellation_for_manager');
  if (!busy && !recovering && booking.status === 'confirmed') {
    const targets = ctx.visits.length ? ctx.visits : [booking];
    if (targets.some(row => [null, 'not_checked_in'].includes(row.checkinStatus))) result.push('issue_visit_code', 'set_arrival_mode', 'record_assisted_arrival');
    if (targets.some(row => row.checkinStatus === 'checkout_requested')) result.push('clear_checkout_for_manager');
    if (ctx.visits.some(row => row.checkinStatus === 'checkout_requested')) result.push('report_issue_for_manager');
  }
  if (!busy && ['confirmed', 'completed'].includes(booking.status)
    && (ctx.visits.length ? ctx.visits.some(visit => now >= visitAttendanceEnd(booking, visit)) : now >= bookingAttendanceEnd(booking))) result.push('correct_attendance');
  const original = ctx.payments.find(row => row.paymentIntentId === booking.paymentIntentId);
  // Payout after closeout: support can release over a reported-issue hold. An open flag still blocks (resolve it first).
  if (!busy && !recovering && !flags && !moneyNeedsReview && original?.payoutTiming === 'after_closeout'
    && !original.transferId && original.payoutHoldReason === 'reported_issue') result.push('release_payout');
  if (!busy && !recovering && !flags && !moneyNeedsReview && original && ['succeeded', 'partially_refunded'].includes(original.status)
    && cents(original.amount) > cents(original.refundAmount)) result.push('goodwill_refund');
  const summary = money(ctx), goodwill = ctx.actions.filter(row => row.actionType === 'goodwill_refund' && row.status !== 'failed').reduce((sum, row) => sum + (row.amountCents || 0), 0);
  return result.map(type => ({ type, label: labels[type], moneyPreview: {
    currency: booking.currency, chefReceivesCents: type === 'cancel_kitchen_caused' ? summary.capturedCents - summary.refundedCents : type === 'goodwill_refund' || type === 'accept_cancellation_for_manager' ? null : 0,
    chefPaysCents: type === 'confirm_for_manager' ? ctx.payments.reduce((sum, row) => sum + cents(row.amount), 0) : 0,
    managerPaysCents: ['cancel_kitchen_caused', 'accept_cancellation_for_manager'].includes(type) ? null : 0,
    localCooksPaysCents: type === 'goodwill_refund' || type === 'cancel_kitchen_caused' ? null : 0,
    processingFeeCents: summary.processingFeeCents, maximumCents: type === 'goodwill_refund' && original ? cents(original.amount) - cents(original.refundAmount) : null,
    requiresExceptionAboveCents: type === 'goodwill_refund' ? Math.max(0, 2500 - goodwill) : null, providerVerified: false,
  } }));
}
function snapshot(booking: Booking) {
  return { status: booking.status, paymentStatus: booking.paymentStatus, checkinStatus: booking.checkinStatus,
    cancellationPolicySnapshot: booking.cancellationPolicySnapshot ?? null,
    updatedAt: booking.updatedAt.toISOString(), paymentIntentId: booking.paymentIntentId };
}
/** Only selected fields cross the staff API; never return challenge rows, email bodies or arbitrary metadata. */
export async function readBookingSupport(id: number) {
  const ctx = await loadContext(id), timezone = ctx.location.timezone || DEFAULT_TIMEZONE;
  const codes = await chefVisitCodes(id);
  const closeout = await projectBookingCloseout(ctx.booking, timezone, ctx.visits);
  let paymentEvidence: { id: string; status: string; authorizedCents: number; capturedCents: number; refundedCents: number | null; processingFeeCents: number | null; termsVerified: boolean;
    captureTerms: ReturnType<typeof bookingCaptureTerms> | null } | null = null;
  let cancellationQuote: Awaited<ReturnType<typeof readCancellationRefund>> | null = null;
  let evidenceUnavailable = false;
  if (ctx.booking.paymentIntentId) try {
    const intent = await getBookingPaymentIntent(ctx.booking.paymentIntentId);
    let termsVerified = false;
    let captureTerms: ReturnType<typeof bookingCaptureTerms> | null = null;
    if (intent.status === 'requires_capture') {
      const session = await getBookingCheckoutSession(intent.id);
      if (session?.status === 'complete' && session.currency === 'cad' && session.amount_total === intent.amount
        && session.metadata?.type === 'kitchen_booking' && session.metadata.chef_id === String(ctx.booking.chefId)
        && session.metadata.kitchen_id === String(ctx.booking.kitchenId)) {
        captureTerms = bookingCaptureTerms(session.metadata, intent.amount); termsVerified = true;
      }
    }
    const facts = intent.status === 'succeeded' ? await getCancellationPaymentFacts(intent.id) : null;
    paymentEvidence = { id: intent.id, status: intent.status, authorizedCents: intent.amount, capturedCents: intent.amount_received,
      refundedCents: facts?.refunded ?? null, processingFeeCents: facts?.processingCost ?? null, termsVerified, captureTerms };
    if (ctx.booking.status === 'cancellation_requested' && ctx.manager?.id) cancellationQuote = await readCancellationRefund(id, ctx.manager.id, 'manager');
  } catch { evidenceUnavailable = true; }
  const availableActions = availableSupportActions(ctx).filter(action =>
    (action.type !== 'accept_cancellation_for_manager' || cancellationQuote && 'quoteHash' in cancellationQuote)
    && (action.type !== 'issue_visit_code' || !codes.length || codes.some(code => code.mode === 'staffed' && !code.consumed && !code.revoked))
    && (action.type !== 'set_arrival_mode' || codes.some(code => !code.consumed && !code.revoked)));
  for (const action of availableActions) {
    const p = action.moneyPreview;
    if (paymentEvidence) p.processingFeeCents = paymentEvidence.processingFeeCents;
    if (action.type === 'confirm_for_manager' && paymentEvidence?.termsVerified) { p.chefPaysCents = paymentEvidence.authorizedCents; p.providerVerified = true; }
    if (action.type === 'goodwill_refund' && paymentEvidence?.refundedCents != null) {
      p.maximumCents = paymentEvidence.capturedCents - paymentEvidence.refundedCents; p.providerVerified = true;
    }
    if (action.type === 'cancel_kitchen_caused' && paymentEvidence?.refundedCents != null && paymentEvidence.processingFeeCents != null) {
      p.chefReceivesCents = paymentEvidence.capturedCents - paymentEvidence.refundedCents;
      const source = ctx.payments[0], receipts = (source.metadata as { refunds?: Array<{ managerDebited: number; platformServiceFeeReturned: number }> } | null)?.refunds || [];
      p.managerPaysCents = Math.max(0, paymentEvidence.capturedCents - paymentEvidence.processingFeeCents - cents(source.serviceFee) - receipts.reduce((sum, receipt) => sum + receipt.managerDebited, 0));
      p.localCooksPaysCents = Math.max(0, p.chefReceivesCents - p.managerPaysCents); p.providerVerified = true;
    }
    if (action.type === 'accept_cancellation_for_manager' && cancellationQuote && 'quoteHash' in cancellationQuote) {
      const sources = cancellationQuote.sources;
      p.chefReceivesCents = sources.reduce((sum, row) => sum + row.managerRefund, 0);
      p.managerPaysCents = p.chefReceivesCents; p.localCooksPaysCents = 0; p.providerVerified = true;
    }
  }
  const lifecycle = await db.select({ id: bookingLifecycleEvents.id, kind: bookingLifecycleEvents.kind, title: bookingLifecycleEvents.title,
    createdAt: bookingLifecycleEvents.createdAt, completedAt: bookingLifecycleEvents.completedAt }).from(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, id));
  const histories = ctx.payments.length ? await db.select({ id: paymentHistory.id, kind: paymentHistory.eventType,
    title: paymentHistory.description, createdAt: paymentHistory.createdAt }).from(paymentHistory).where(inArray(paymentHistory.transactionId, ctx.payments.map(row => row.id))) : [];
  const logs = lifecycle.length ? await db.select({ id: emailLogs.id, title: emailLogs.subject, status: emailLogs.status,
    recipientEmail: emailLogs.recipientEmail, trackingId: emailLogs.trackingId, createdAt: emailLogs.createdAt }).from(emailLogs)
    .where(or(...lifecycle.map(event => sql`${emailLogs.trackingId} LIKE ${`booking-event:${event.id}:%`}`))) : [];
  const problems = await db.select({ id: commitmentProblems.id, title: commitmentProblems.category, status: commitmentProblems.status,
    createdAt: commitmentProblems.createdAt }).from(commitmentProblems).where(eq(commitmentProblems.bookingId, id));
  const actionRows = ctx.actions.map(row => ({ id: row.id, type: row.actionType, actorUserId: row.actorUserId, actingFor: row.actingFor,
    requestSource: row.requestSource, sourceRef: row.sourceRef, reasonCode: row.reasonCode, amountCents: row.amountCents, currency: row.currency,
    fundedBy: row.fundedBy, exception: row.exception, operationKey: row.operationKey, status: row.status,
    createdAt: row.createdAt, completedAt: row.completedAt, notifiedEventIds: row.notifiedEventIds }));
  const chronology = [...lifecycle.map(row => ({ source: 'lifecycle', ...row })), ...histories.map(row => ({ source: 'payment', ...row })),
    ...logs.map(row => ({ source: 'email', ...row })), ...problems.map(row => ({ source: 'problem', ...row })),
    ...actionRows.map(row => ({ source: 'support', title: labels[row.type as SupportActionType] || 'Support update', ...row }))]
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  const zoneLabel = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, timeZoneName: 'longGeneric' }).formatToParts(ctx.booking.bookingDate).find(part => part.type === 'timeZoneName')?.value || timezone;
  const schedule = (await import('./advance-reminders')).reminderVisitTimes(ctx.booking, timezone).map(row => ({
    startAt: row.start.toISOString(), endAt: row.end.toISOString(), localStart: format.format(row.start), localEnd: format.format(row.end) }));
  return { bookingId: id, referenceCode: ctx.booking.referenceCode || `#${id}`, ...snapshot(ctx.booking),
    parties: { chef: ctx.chef && { ...ctx.chef, name: await partyName(ctx.chef, 'chef') },
      manager: ctx.manager && { ...ctx.manager, name: await partyName(ctx.manager, 'manager') } }, kitchen: ctx.kitchen, location: ctx.location,
    schedule: { timezone, zoneLabel, blocks: schedule }, decision: ctx.booking.paymentDecision ? {
      state: (ctx.booking.paymentDecision as { state: string }).state, target: (ctx.booking.paymentDecision as { target: string }).target } : null,
    deadlines: { responseAt: ctx.booking.status === 'pending' ? ctx.responseDeadlineAt?.toISOString() ?? null : null,
      inspectionAt: closeout.checkoutReviewDeadline || null, closeoutAt: closeout.closeout.serviceEndedAt, closeout: closeout.closeout },
    visits: ctx.visits.map(visit => ({ id: visit.id, blockIndex: visit.blockIndex, checkinStatus: visit.checkinStatus,
      updatedAt: visit.updatedAt, checkedInAt: visit.checkedInAt, checkoutRequestedAt: visit.checkoutRequestedAt,
      checkoutApprovedAt: visit.checkoutApprovedAt })),
    visitCodes: codes.map(code => ({ targetKey: code.targetKey, visitId: code.visitId, mode: code.mode, codeRequired: code.codeRequired,
      locked: code.locked, consumed: code.consumed, consumedAt: code.consumedAt, consumedMethod: code.consumedMethod, revoked: code.revoked })),
    items: { storage: ctx.storage.map(item => ({ id: item.id, status: item.status, paymentStatus: item.paymentStatus, totalPriceCents: cents(item.totalPrice) })),
      equipment: ctx.equipment.map(item => ({ id: item.id, status: item.status, paymentStatus: item.paymentStatus, totalPriceCents: cents(item.totalPrice) })) },
    payout: await (await import('./kitchen-payout-service')).readKitchenPayout(id),
    money: money(ctx), paymentEvidence, evidenceUnavailable, cancellationQuote: cancellationQuote && 'quoteHash' in cancellationQuote ? {
      quoteHash: cancellationQuote.quoteHash, chefReceivesCents: cancellationQuote.sources.reduce((sum, row) => sum + row.managerRefund, 0),
      parentVersion: cancellationQuote.parentVersion } : null,
    flags: ctx.flags.map(flag => ({ id: flag.id, kind: flag.kind, providerRef: flag.providerRef, openedAt: flag.openedAt })),
    chronology, supportActions: actionRows, availableActions };
}

const requiredActingFor: Partial<Record<SupportActionType, SupportActionInput['actingFor']>> = {
  confirm_for_manager: 'manager', decline_for_manager: 'manager', release_hold_for_chef: 'chef',
  cancel_kitchen_caused: 'manager', request_cancellation_for_chef: 'chef', accept_cancellation_for_manager: 'manager',
  issue_visit_code: 'manager', set_arrival_mode: 'manager', record_assisted_arrival: 'manager',
  clear_checkout_for_manager: 'manager', report_issue_for_manager: 'manager', goodwill_refund: 'local_cooks', release_payout: 'local_cooks',
};
function validateDetails(input: SupportActionInput) {
  const d = input.details || {};
  if (requiredActingFor[input.type] && requiredActingFor[input.type] !== input.actingFor) throw new BookingSupportError('Choose the party this action is for.', 400);
  const require = (ok: unknown, message: string) => { if (!ok) throw new BookingSupportError(message, 400); };
  if (input.type === 'goodwill_refund') require(input.amountCents, 'Enter a goodwill refund amount.');
  if (input.type === 'set_arrival_mode') require(d.mode && (d.targetKey || d.all) && (d.mode !== 'self' || d.publicMessage && d.publicMessage.length <= 500), 'Choose the arrival mode and visit, with a shared explanation for self check-in.');
  if (input.type === 'record_assisted_arrival') require(d.actualAt && d.publicMessage && d.expectedUpdatedAt && d.expectedBookingUpdatedAt, 'Enter the actual arrival time, shared explanation and current record versions.');
  if (input.type === 'correct_attendance') require(d.attendanceAction && d.expectedUpdatedAt && d.expectedBookingUpdatedAt
    && (d.attendanceAction !== 'report_no_show' || d.confirmsChefAbsent), 'Choose the correction and current record versions; confirm absence for a no-show.');
  if (input.type === 'accept_cancellation_for_manager') require(d.quoteHash, 'Review the current cancellation quote first.');
  if (input.type === 'report_issue_for_manager') require(d.visitId && d.claimTitle && d.claimDescription && d.claimedAmountCents, 'Choose a visit and describe the concern and claimed amount.');
  if (input.type === 'resend_notice') require(d.eventId && d.recipientId, 'Choose the original notice and recipient.');
  if (input.type === 'resolve_flag') require(d.flagId, 'Choose the support flag to resolve.');
}
async function dispatch(ctx: Context, actorId: number, input: SupportActionInput): Promise<Record<string, unknown>> {
  const id = ctx.booking.id, d = input.details || {}, managerId = ctx.manager?.id;
  if (requiredActingFor[input.type] === 'manager' && !managerId) throw Error('The kitchen contact needs review.');
  switch (input.type) {
    case 'confirm_for_manager': return decideAuthorizedBooking(id, 'confirmed', (d.storageActions || []).map(item => ({ storageBookingId: item.id, action: item.action })), (d.equipmentActions || []).map(item => ({ equipmentBookingId: item.id, action: item.action })), actorId);
    case 'decline_for_manager': case 'release_hold_for_chef': return decideAuthorizedBooking(id, 'cancelled', [], [], actorId);
    case 'replay_payment_decision': return reconcileBookingDecision(id);
    case 'cancel_kitchen_caused': return cancelKitchenCausedBooking(id, managerId!, actorId, input.operationKey);
    case 'request_cancellation_for_chef': return requestChefCancellation(id, ctx.booking.chefId!, actorId, d.publicMessage, input.operationKey);
    case 'accept_cancellation_for_manager': return acceptCancellationRefund(id, managerId!, d.quoteHash!, undefined, input.operationKey);
    case 'goodwill_refund': return refundSupportGoodwill(id, managerId!, actorId, input.amountCents!, input.operationKey);
    case 'release_payout': {
      // Verified once the payout is sent (or nothing is owed), or support's release is saved for when the visits close.
      const release = await (await import('./kitchen-payout-service')).releaseKitchenPayout(id, `support:${input.operationKey}`, new Date(), { override: true });
      return { ...release, success: release.success || release.overrideRecorded === true };
    }
    case 'issue_visit_code': {
      if (!(await chefVisitCodes(id)).length) await db.transaction(async tx => {
        const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, id)).for('update');
        if (booking?.status !== 'confirmed') throw Error('The booking changed before its arrival details could be issued.');
        return ensureChallengesForBooking(tx, id, actorId);
      });
      if (!d.targetKey && ctx.visits.length && !ctx.visits.some(visit => visit.id === d.visitId)) throw Error('Choose a visit belonging to this booking.');
      const target = d.targetKey || resolveArrivalTarget({ bookingId: id, visitId: d.visitId }).targetKey;
      await issueNewCode(id, managerId!, target); return { success: true };
    }
    case 'set_arrival_mode': await setMode(id, managerId!, { targetKey: d.targetKey, all: d.all, mode: d.mode!, reason: d.publicMessage }); return { success: true };
    case 'record_assisted_arrival': return assistKitchenVisit(id, managerId!, { action: 'arrival', visitId: d.visitId, actualAt: d.actualAt!, reason: d.publicMessage!, expectedUpdatedAt: d.expectedUpdatedAt!, expectedBookingUpdatedAt: d.expectedBookingUpdatedAt! });
    case 'correct_attendance': await recordBookingAttendance(id, { id: actorId, role: 'admin' }, { action: d.attendanceAction!, visitId: d.visitId,
      expectedUpdatedAt: d.expectedUpdatedAt!, expectedBookingUpdatedAt: d.expectedBookingUpdatedAt!, internalNotes: input.note,
      sharedMessage: d.publicMessage, confirmsChefAbsent: d.confirmsChefAbsent }); return { success: true };
    case 'clear_checkout_for_manager': return recordKitchenInspection(id, managerId!, d.visitId, d.publicMessage);
    case 'report_issue_for_manager': return claimKitchenVisit(id, d.visitId!, managerId!, { claimTitle: d.claimTitle!, claimDescription: d.claimDescription!, claimedAmountCents: d.claimedAmountCents!, managerNotes: d.publicMessage });
    case 'resend_notice': return requeueBookingNotice(id, d.eventId!, d.recipientId!, !!d.force, input.reasonCode, actorId, input.operationKey);
    case 'open_flag': await changeBookingFlag(id, 'manual_hold', input.operationKey, false, actorId, input.note); return { success: true };
    case 'resolve_flag': {
      const flag = ctx.flags.find(flag => flag.id === d.flagId);
      if (!flag?.providerRef) throw Error('This flag has already changed or needs a separate review.');
      await changeBookingFlag(id, flag.kind as 'chargeback' | 'payout_failed' | 'transfer_failed' | 'manual_hold', flag.providerRef, true, actorId); return { success: true };
    }
  }
}
function providerRefs(result: Record<string, unknown>) {
  const refs: Record<string, unknown> = Object.fromEntries(['refundId', 'transferId', 'transferReversalId', 'paymentIntentId'].flatMap(key => typeof result[key] === 'string' ? [[key, result[key]]] : []));
  if (Array.isArray(result.sources)) refs.sources = result.sources.flatMap((row: { operation?: { refundId?: string; intentId?: string } }) =>
    row.operation?.refundId ? [{ refundId: row.operation.refundId, paymentIntentId: row.operation.intentId }] : []);
  return refs;
}
export async function executeBookingSupportAction(id: number, actorId: number, rawInput: unknown) {
  const parsed = supportActionInput.safeParse(rawInput);
  if (!parsed.success) throw new BookingSupportError('Choose an action and include its source, reason, a note of at least 10 characters, and an operation key.', 400);
  const input = parsed.data;
  validateDetails(input);
  const fingerprint = createHash('sha256').update(JSON.stringify({ id, actorId, input })).digest('hex');
  const reserved = await db.transaction(async tx => {
    // Lock sources before the parent, matching refund and transfer writers.
    await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(paymentTransactions.bookingId, id))).orderBy(asc(paymentTransactions.id)).for('update');
    await tx.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.id, id)).for('update');
    const [existing] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey)).limit(1);
    if (existing) {
      if (existing.bookingId !== id || (existing.beforeState as { requestFingerprint?: string }).requestFingerprint !== fingerprint) throw new BookingSupportError('This operation key belongs to a different support request.');
      return { action: existing, ctx: existing.status === 'recovery_required' ? await loadContext(id, tx) : null };
    }
    const ctx = await loadContext(id, tx);
    if (!availableSupportActions(ctx).some(action => action.type === input.type)) throw new BookingSupportError('This action is unavailable in the booking’s current state. Refresh the case before choosing the next step.');
    const goodwill = ctx.actions.filter(action => action.actionType === 'goodwill_refund' && action.status !== 'failed').reduce((sum, action) => sum + (action.amountCents || 0), 0);
    const exception = input.type === 'goodwill_refund' && goodwill + input.amountCents! > 2500;
    if (exception && input.confirmException !== true) throw new BookingSupportError('Goodwill above $25 for this booking needs your explicit exception confirmation.');
    if (input.type === 'goodwill_refund' && ctx.booking.currency.toUpperCase() !== 'CAD') throw new BookingSupportError('This goodwill allowance is set in Canadian dollars. Review other currencies separately.');
    const [action] = await tx.insert(supportActions).values({ bookingId: id, caseRef: ctx.booking.referenceCode || `#${id}`, actionType: input.type,
      actorUserId: actorId, actingFor: input.actingFor, requestSource: input.requestSource, sourceRef: input.sourceRef,
      reasonCode: input.reasonCode, internalNote: input.note, amountCents: input.amountCents ?? (input.type === 'cancel_kitchen_caused' ? money(ctx).capturedCents - money(ctx).refundedCents : null), currency: ctx.booking.currency,
      fundedBy: input.type === 'goodwill_refund' || input.type === 'cancel_kitchen_caused' ? 'local_cooks' : input.type === 'accept_cancellation_for_manager' ? 'manager' : 'none',
      exception, beforeState: { ...snapshot(ctx.booking), requestFingerprint: fingerprint }, status: 'executing', operationKey: input.operationKey }).returning();
    return { action, ctx };
  });
  if (!reserved.ctx) return { action: { id: reserved.action.id, operationKey: input.operationKey, status: reserved.action.status, exception: reserved.action.exception }, case: await readBookingSupport(id), replayed: true };
  if (reserved.action.status === 'recovery_required') {
    // Recover a verified original receipt; absence/pending evidence cannot authorize another money operation.
    let verified = false;
    try {
      if (['goodwill_refund', 'cancel_kitchen_caused'].includes(input.type) && reserved.ctx.booking.paymentIntentId) {
        const receipts = await getPaymentIntentRefunds(reserved.ctx.booking.paymentIntentId);
        const original = receipts.filter(row => row.metadata?.refund_operation_id === input.operationKey);
        verified = original.length === 1 && original[0].status === 'succeeded';
      } else if (['confirm_for_manager', 'decline_for_manager', 'release_hold_for_chef', 'replay_payment_decision'].includes(input.type)) {
        const decision = reserved.ctx.booking.paymentDecision as { intentId?: string; target?: string; amount?: number } | null;
        if (decision?.intentId) {
          const intent = await getBookingPaymentIntent(decision.intentId);
          verified = decision.target === 'confirmed' ? intent.status === 'succeeded' && intent.amount_received === decision.amount : intent.status === 'canceled';
        }
      } else if (input.type === 'release_payout') {
        // The release is idempotent: a retry finds the committed decision and recovers the same transfer.
        const release = await (await import('./kitchen-payout-service')).releaseKitchenPayout(id, `support:${input.operationKey}`, new Date(), { override: true });
        verified = release.success || release.overrideRecorded === true;
      } else if (input.type === 'accept_cancellation_for_manager') {
        const operations = reserved.ctx.payments.flatMap(source => {
          const operation = (source.metadata as { cancellationRefundOperation?: { supportOperationKey?: string; id: string; managerRefund: number } } | null)?.cancellationRefundOperation;
          return operation?.supportOperationKey === input.operationKey ? [{ source, operation }] : [];
        });
        verified = operations.length > 0;
        for (const { source, operation } of operations) {
          if (!operation.managerRefund) continue;
          const receipts = source.paymentIntentId ? await getPaymentIntentRefunds(source.paymentIntentId) : [];
          const matches = receipts.filter(row => row.metadata?.refund_operation_id === operation.id);
          verified &&= matches.length === 1 && matches[0].status === 'succeeded' && matches[0].amount === operation.managerRefund;
        }
      }
    } catch { /* Preserve recovery state until original evidence is available. */ }
    if (!verified) return { action: { id: reserved.action.id, operationKey: input.operationKey, status: reserved.action.status, exception: reserved.action.exception }, case: await readBookingSupport(id), replayed: true };
  }
  let result: Record<string, unknown> = {}, outcome = 'verified', error: string | null = null;
  try {
    result = await dispatch(reserved.ctx, actorId, input);
    if (result.success === false) throw Error('The requested update was not completed.');
    if (input.type === 'accept_cancellation_for_manager') {
      const sources = result.sources as Array<{ operation?: { status?: string } }> | undefined;
      if (!sources?.length || sources.some(source => source.operation?.status !== 'succeeded')) throw Error('The cancellation refund still needs review.');
    }
  } catch {
    // A rejected/unknown provider response is never evidence that no money moved.
    outcome = ['confirm_for_manager', 'decline_for_manager', 'release_hold_for_chef', 'replay_payment_decision', 'goodwill_refund', 'cancel_kitchen_caused', 'accept_cancellation_for_manager', 'release_payout'].includes(input.type) ? 'recovery_required' : 'failed';
    error = outcome === 'recovery_required' ? 'Local Cooks needs to verify this original payment operation before another attempt.' : 'The update could not be completed. Refresh the booking and review the next step.';
  }
  await db.transaction(async tx => {
    const [currentAction] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey)).for('update');
    if (currentAction?.status === 'verified') return;
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, id)).limit(1);
    const message = outcome === 'verified' ? `Local Cooks support updated your booking: ${updates[input.type]}.${input.type === 'goodwill_refund' ? ` The refund is $${(input.amountCents! / 100).toFixed(2)}. Your bank may take a few days to show it.` : ''}`
      : 'Local Cooks support is checking an update to your booking. We’ll confirm the next step once it has been reviewed.';
    await queueBookingLifecycleEvent(tx, id, 'support_updated', 'Local Cooks support updated your booking', message, actorId,
      { recipientPolicy: input.type === 'release_payout' ? 'manager' : 'participants', supportActionId: reserved.action.id });
    const events = await tx.select({ id: bookingLifecycleEvents.id }).from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, id), sql`${bookingLifecycleEvents.metadata}->>'supportActionId' = ${String(reserved.action.id)}`));
    await tx.update(supportActions).set({ status: outcome, afterState: booking ? { ...snapshot(booking),
      ...Object.fromEntries(['amountCents', 'managerPaysCents', 'localCooksPaysCents', 'processingCostAbsorbedCents'].flatMap(key =>
        typeof result[key] === 'number' ? [[key, result[key]]] : [])) } : null, providerRefs: providerRefs(result),
      error, completedAt: new Date(), notifiedEventIds: events.map(event => event.id) }).where(and(eq(supportActions.id, reserved.action.id), inArray(supportActions.status, ['executing', 'recovery_required'])));
  });
  return { action: { id: reserved.action.id, operationKey: input.operationKey, status: outcome, exception: reserved.action.exception }, case: await readBookingSupport(id), replayed: false };
}
