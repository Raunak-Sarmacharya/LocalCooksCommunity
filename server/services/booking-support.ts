import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db';
import { bookingFlags, supportActions, kitchenBookings, kitchenBookingVisits, kitchens, locations, users,
  paymentTransactions, paymentHistory, bookingLifecycleEvents, emailLogs, commitmentProblems, storageBookings, equipmentBookings } from '@shared/schema';
import { supportActionInput, type AvailableSupportAction, type SupportActionInput, type SupportActionType } from '@shared/booking-support';
import { verifiedReservedRefund } from '@shared/cancellation-refund';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { bookingChangeSchedule, kitchenRescheduleCutoff } from '@shared/kitchen-booking-change';
import { bookingAttendanceEnd, visitAttendanceEnd } from '@shared/booking-attendance';
import { chefVisitCodes, ensureChallengesForBooking, issueNewCode, setMode, resolveArrivalTarget } from './visit-code-challenge';
import { queueBookingLifecycleEvent, requeueBookingNotice } from './booking-lifecycle-delivery';
import { decideAuthorizedBooking, reconcileBookingDecision } from './booking-payment-decision';
import { acceptCancellationRefund, readCancellationRefund, requestChefCancellation, refundSupportGoodwill, cancelKitchenCausedBooking, retryCancellationRefund } from './booking-cancellation-refund';
import { assertLegacyCancellation } from './dated-booking-refund-guard';
import { getBookingPaymentIntent, getCancellationPaymentFacts, getBookingCheckoutSession, getPaymentIntentRefunds } from './stripe-service';
import { bookingCaptureTerms } from '@shared/booking-capture-terms';
import { assistKitchenVisit } from './visit-assistance';
import { recordBookingAttendance } from './booking-attendance-service';
import { recordKitchenInspection, projectBookingCloseout } from './clock-closeout';
import { claimKitchenVisit } from './kitchen-visit-lifecycle';
import { changeBookingFlag } from './booking-support-flags';
import { kitchenPayout, type PayoutSource } from '@shared/kitchen-payout';
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
  // The same closeout projection the booking page uses; it says whether each visit's inspection window is still open.
  // An unreadable snapshot must not block unrelated support actions (readBookingSupport reports it on its own path).
  const closeout = await projectBookingCloseout(row.booking, row.location.timezone || DEFAULT_TIMEZONE, visits, undefined, tx).catch(() => undefined);
  return { ...row, storage, equipment, payments, visits, flags, actions, responseDeadlineAt, closeout };
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
  resolve_money_attempt: 'Check the earlier refund attempt',
  retry_refund: 'Retry refund', mark_refunded: 'Mark refunded after checking Stripe',
  finish_kitchen_refund: 'Finish the kitchen cancellation refund', refund_captured_request: 'Refund the charge and close the request',
};
const cents = (value: unknown) => value == null ? 0 : Number(value);
/** Refund attempts whose provider outcome can be read back by their operation key. */
const MONEY_ATTEMPT_TYPES: string[] = ['goodwill_refund', 'cancel_kitchen_caused', 'refund_captured_request', 'finish_kitchen_refund'];
/** Actions that refund the chef in full for the kitchen: Local Cooks bears the processing cost. */
const KITCHEN_REFUND_TYPES: string[] = ['cancel_kitchen_caused', 'refund_captured_request', 'finish_kitchen_refund'];
/** A failed attempt older than this has no request still running at the provider, so an empty refund list is conclusive. */
export const MONEY_ATTEMPT_SETTLE_MS = 10 * 60 * 1000;
type MoneyAttemptState =
  | { kind: 'succeeded' }
  | { kind: 'closed'; message: string; evidence: 'provider_refund_failed' | 'no_refund_found' }
  | { kind: 'waiting'; message: string };

/**
 * Where an earlier refund attempt really stands, from the provider's own refund list for that payment (a consistent list,
 * not an eventually-consistent search). A refund created by the attempt carries its operation key in its metadata.
 * - succeeded: complete the rest of the booking from that receipt (never create another refund).
 * - pending: wait. - failed/canceled at the provider, or none found after the settle window: nothing was sent; close it.
 * - more than one match, or a list that cannot be read: leave it for review. A failed lookup is never read as "not executed".
 */
export function judgeMoneyAttempt(receipts: Array<{ status?: string | null; metadata?: Record<string, string> | null }>, operationKey: string,
  attempt: { completedAt: Date | null; createdAt: Date }, now = new Date()): MoneyAttemptState {
  const original = receipts.filter(row => row.metadata?.refund_operation_id === operationKey);
  if (original.length > 1) return { kind: 'waiting', message: 'More than one refund matches this attempt. Review the refunds in the payment provider before doing anything else.' };
  if (original.length === 1) {
    const status = original[0].status;
    if (status === 'succeeded') return { kind: 'succeeded' };
    if (status === 'failed' || status === 'canceled') return { kind: 'closed', evidence: 'provider_refund_failed',
      message: 'The payment provider reports that this refund failed, so nothing was sent. Start a new attempt if the refund is still needed.' };
    return { kind: 'waiting', message: 'The refund was created and is still pending at the payment provider. Check again once it shows as sent.' };
  }
  const since = (attempt.completedAt ?? attempt.createdAt).getTime();
  if (now.getTime() - since < MONEY_ATTEMPT_SETTLE_MS)
    return { kind: 'waiting', message: 'No refund has been found yet. Local Cooks waits 10 minutes after a failed attempt before closing it. Check again shortly.' };
  return { kind: 'closed', evidence: 'no_refund_found',
    message: 'No refund was created for this attempt (checked with the payment provider). Nothing was sent. Start a new attempt if the refund is still needed.' };
}
/** Admin transfer line: what Stripe actually moved once sent (payoutSent / transfer metadata), else the expected net (revenue minus processing fee). */
export function supportTransferLine(row: Context['payments'][number]) {
  const payout = kitchenPayout(row as unknown as PayoutSource);
  const sent = !!row.transferId || payout.status === 'sent';
  const expected = Math.max(0, cents(row.managerRevenue) - cents(row.stripeProcessingFee));
  return { transactionId: row.id, transferId: row.transferId, status: sent ? 'recorded' : 'not_recorded',
    managerRevenueCents: cents(row.managerRevenue), sent, sentAt: sent ? payout.sentAt : null,
    amountCents: sent ? payout.amountCents : expected };
}
function money(ctx: Pick<Context, 'booking' | 'payments'>) {
  const captured = ctx.payments.filter(row => ['succeeded', 'partially_refunded', 'refunded'].includes(row.status));
  return { capturedCents: captured.reduce((sum, row) => sum + cents(row.amount), 0),
    refundedCents: captured.reduce((sum, row) => sum + cents(row.refundAmount), 0),
    platformFeeCents: captured.reduce((sum, row) => sum + cents(row.serviceFee), 0),
    processingFeeCents: captured.reduce((sum, row) => sum + cents(row.stripeProcessingFee), 0), currency: ctx.booking.currency,
    providerVerified: false as const, transfers: ctx.payments.filter(p => p.payoutPartition !== 'per_day').map(supportTransferLine) };
}
const AUTOMATIC_REFUND_ACTIONS = ['retry_refund', 'mark_refunded'];
/** Separately charged add-ons are included; selectors never fall back to the parent payment. */
function automaticRefundOperations(payments: Payment[]) {
  return payments.flatMap(source => {
    const operation = (source.metadata as Record<string, any> | null)?.cancellationRefundOperation;
    return operation && ['pending', 'recovery_required', 'failed', 'fee_pending'].includes(operation.status)
      ? [{ source, operation }] : [];
  });
}
type RefundEvidence = Map<number, Awaited<ReturnType<typeof getCancellationPaymentFacts>>>;
async function readAutomaticRefundEvidence(payments: Payment[]) {
  const evidence: RefundEvidence = new Map();
  await Promise.all(automaticRefundOperations(payments).map(async ({ source }) => {
    try { evidence.set(source.id, await getCancellationPaymentFacts(source.paymentIntentId!)); } catch { /* Unreadable is never proof. */ }
  }));
  return evidence;
}
function hasReservedReceipt(source: Payment, operation: Record<string, any>, evidence?: RefundEvidence) {
  const facts = evidence?.get(source.id);
  if (!facts) return false;
  try { verifiedReservedRefund(source, operation, facts); return true; } catch { return false; }
}

export function availableSupportActions(ctx: Pick<Context, 'booking' | 'payments' | 'visits' | 'flags' | 'actions' | 'storage' | 'equipment'> & Partial<Pick<Context, 'responseDeadlineAt' | 'location' | 'closeout'>>, now = new Date(), refundEvidence?: RefundEvidence): AvailableSupportAction[] {
  const booking = ctx.booking, decision = booking.paymentDecision as { state?: string; target?: string; deadEnd?: { kind?: string } } | null;
  const result: SupportActionType[] = ['open_flag', 'resend_notice'];
  if (ctx.flags.length) result.push('resolve_flag');
  const busy = ctx.actions.some(row => ['executing', 'recovery_required'].includes(row.status));
  const recovering = decision?.state === 'pending';
  if (recovering) result.push('replay_payment_decision');
  const flags = ctx.flags.length > 0;
  const automatic = automaticRefundOperations(ctx.payments);
  const unrelatedBusy = ctx.actions.some(row => row.status === 'executing' || row.status === 'recovery_required' && !AUTOMATIC_REFUND_ACTIONS.includes(row.actionType));
  const unrelatedReview = ctx.payments.some(source => {
    const m = source.metadata as Record<string, any> | null;
    return m?.refundRecovery && m.refundRecovery.status !== 'succeeded' || m?.fullRefundRequest?.status === 'pending' || m?.kitchenCancellationRefund?.status === 'pending';
  });
  if (!flags && !recovering && !unrelatedBusy && !unrelatedReview && automatic.length) {
    result.push('retry_refund');
    if (automatic.some(({ source, operation }) => hasReservedReceipt(source, operation, refundEvidence))) result.push('mark_refunded');
  }
  const priorGoodwill = ctx.actions.some(action => action.actionType === 'goodwill_refund' && action.status !== 'failed')
    || ctx.payments.some(source => ((source.metadata as { refunds?: Array<{ platformGoodwillCents?: number }> } | null)?.refunds || []).some(receipt => (receipt.platformGoodwillCents || 0) > 0));
  const moneyNeedsReview = ctx.payments.some(source => {
    const metadata = source.metadata as { refundRecovery?: { status?: string }; cancellationRefundOperation?: { status?: string }; fullRefundRequest?: { status?: string } } | null;
    return metadata?.refundRecovery && metadata.refundRecovery.status !== 'succeeded'
      || metadata?.cancellationRefundOperation && metadata.cancellationRefundOperation.status !== 'succeeded'
      || metadata?.fullRefundRequest?.status === 'pending'
      || (source.metadata as { kitchenCancellationRefund?: { status?: string } } | null)?.kitchenCancellationRefund?.status === 'pending';
  });
  // Dead ends (replay can never finish them) get their own way out here instead of an endless retry:
  // a confirmation whose card hold was released can be closed as a release (no money moved)...
  const holdReleased = recovering && decision?.target === 'confirmed' && decision.deadEnd?.kind === 'hold_canceled' && ['pending', 'cancelled'].includes(booking.status);
  // ...and a cancellation that lost the race to a capture is refunded in full and then closed.
  const capturedBeforeRelease = recovering && decision?.target === 'cancelled' && decision.deadEnd?.kind === 'captured_before_release'
    && booking.status === 'pending' && booking.paymentStatus === 'paid';
  // No money is involved and the command is state-checked, so a failed earlier attempt may be retried under a new key.
  if (holdReleased && !ctx.actions.some(row => row.status === 'executing')) result.push('decline_for_manager', 'release_hold_for_chef');
  if (!busy && !recovering && booking.status === 'pending' && booking.paymentStatus === 'authorized' && !decision && booking.chefId && booking.paymentIntentId) {
    if (!flags && now < (ctx.responseDeadlineAt ?? responseDeadlineForBooking(booking, ctx.location?.timezone || DEFAULT_TIMEZONE))) result.push('confirm_for_manager');
    result.push('decline_for_manager', 'release_hold_for_chef');
  }
  if (!busy && !recovering && booking.status === 'confirmed' && ['paid', 'partially_refunded'].includes(booking.paymentStatus || '')) {
    if (!flags && !moneyNeedsReview) result.push('request_cancellation_for_chef');
    if (!flags && !moneyNeedsReview && !priorGoodwill && ctx.payments.length === 1 && !ctx.storage.some(item => item.status === 'completed' || item.checkinStatus === 'checkin_completed')
      && !ctx.equipment.some(item => item.status === 'completed')) result.push('cancel_kitchen_caused');
  }
  // Its own action and wording: the request was never accepted, the card was simply charged before the hold could be released.
  if (!busy && capturedBeforeRelease && !flags && !moneyNeedsReview && !priorGoodwill && ctx.payments.length === 1 && !ctx.storage.some(item => item.status === 'completed')
    && !ctx.equipment.some(item => item.status === 'completed')) result.push('refund_captured_request');
  // The kitchen's cancellation is committed but its full refund is not finished: retry it, or have Local Cooks fund it.
  if (!busy && !flags && booking.status === 'cancelled' && booking.cancellationCause === 'kitchen'
    && ctx.payments.some(source => (source.metadata as { kitchenCancellationRefund?: { status?: string } } | null)?.kitchenCancellationRefund?.status === 'pending')) result.push('finish_kitchen_refund');
  if (!busy && !recovering && !flags && booking.status === 'cancellation_requested'
    && now.getTime() < kitchenRescheduleCutoff(bookingChangeSchedule(booking), booking.cancellationPolicyHours ?? 24)) result.push('accept_cancellation_for_manager');
  const targets = ctx.visits.length ? ctx.visits : [booking];
  if (!busy && !recovering && booking.status === 'confirmed') {
    if (targets.some(row => [null, 'not_checked_in'].includes(row.checkinStatus))) result.push('issue_visit_code', 'set_arrival_mode', 'record_assisted_arrival');
  }
  // Inspection: a visit becomes "completed" shortly after it ends while the kitchen's inspection window is still open, so
  // the checkout actions stay available then, judged by the same closeout projection the kitchen itself sees.
  const inspectable = (row: (typeof targets)[number]) => row.checkinStatus === 'checkout_requested' && (booking.status === 'confirmed'
    || booking.status === 'completed' && !!ctx.closeout?.closeout.visits.some(visit => visit.inspection.canRespond
      && (ctx.visits.length ? visit.visitId === (row as Visit).id : true)));
  if (!busy && !recovering) {
    if (targets.some(inspectable)) result.push('clear_checkout_for_manager');
    if (ctx.visits.some(inspectable)) result.push('report_issue_for_manager');
  }
  if (!busy && ['confirmed', 'completed'].includes(booking.status)
    && (ctx.visits.length ? ctx.visits.some(visit => now >= visitAttendanceEnd(booking, visit)) : now >= bookingAttendanceEnd(booking))) result.push('correct_attendance');
  const original = ctx.payments.find(row => row.paymentIntentId === booking.paymentIntentId);
  // Payout after closeout: support can release over a reported-issue hold. An open flag still blocks (resolve it first).
  // A refund attempt that failed before Local Cooks could tell whether money moved freezes the case. This re-checks it with the
  // provider and either completes it from the original receipt or closes it as never executed, so it can never stay stuck.
  if (ctx.actions.some(row => row.status === 'recovery_required' && MONEY_ATTEMPT_TYPES.includes(row.actionType)) && !ctx.actions.some(row => row.status === 'executing'))
    result.push('resolve_money_attempt');
  if (!busy && !recovering && ctx.flags.every(f => f.kind === 'chargeback') && !moneyNeedsReview && original?.payoutTiming === 'after_closeout'
    && !original.transferId && (original.payoutHoldReason === 'reported_issue' || original.payoutPartition === 'per_day')) result.push('release_payout');
  if (!busy && !recovering && !flags && !moneyNeedsReview && original && ['succeeded', 'partially_refunded'].includes(original.status)
    && cents(original.amount) > cents(original.refundAmount)) result.push('goodwill_refund');
  const summary = money(ctx), goodwill = ctx.actions.filter(row => row.actionType === 'goodwill_refund' && row.status !== 'failed').reduce((sum, row) => sum + (row.amountCents || 0), 0);
  return result.map(type => ({ type, label: labels[type], moneyPreview: {
    currency: booking.currency, chefReceivesCents: KITCHEN_REFUND_TYPES.includes(type) ? summary.capturedCents - summary.refundedCents : type === 'goodwill_refund' || type === 'accept_cancellation_for_manager' ? null : 0,
    chefPaysCents: type === 'confirm_for_manager' ? ctx.payments.reduce((sum, row) => sum + cents(row.amount), 0) : 0,
    managerPaysCents: [...KITCHEN_REFUND_TYPES, 'accept_cancellation_for_manager'].includes(type) ? null : 0,
    localCooksPaysCents: type === 'goodwill_refund' || KITCHEN_REFUND_TYPES.includes(type) ? null : 0,
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
  const dayPayouts = ctx.booking.scheduleRevision ? await (await import('./kitchen-day-payouts')).readDayPayouts([id]) : [];
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
  const refundEvidence = await readAutomaticRefundEvidence(ctx.payments);
  const availableActions = availableSupportActions(ctx, new Date(), refundEvidence).filter(action =>
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
    if (KITCHEN_REFUND_TYPES.includes(action.type) && paymentEvidence?.refundedCents != null && paymentEvidence.processingFeeCents != null) {
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
    // The kitchen's cancellation is committed separately from its refund; support sees the refund's state and any problem.
    kitchenRefund: (() => {
      const plan = ctx.payments.map(source => (source.metadata as { kitchenCancellationRefund?: { status: string; expectedCents: number; error?: string; failedAt?: string; attempts: number; refundId?: string } } | null)?.kitchenCancellationRefund).find(Boolean);
      return plan ? { status: plan.status, amountCents: plan.expectedCents, error: plan.error ?? null, failedAt: plan.failedAt ?? null, attempts: plan.attempts, refundId: plan.refundId ?? null } : null;
    })(),
    refundOperations: automaticRefundOperations(ctx.payments).map(({ source, operation }) => ({ transactionId: source.id, refundOperationId: operation.id,
      itemName: operation.itemName || 'Booking cancellation', amountCents: operation.customerRefund ?? operation.managerRefund ?? null, status: operation.status,
      acceptedAt: operation.acceptedAt || source.updatedAt?.toISOString?.() || new Date(0).toISOString(), hasReceipt: hasReservedReceipt(source, operation, refundEvidence) })),
    kitchenRefundDebts: ctx.payments.flatMap(source => ((source.metadata as Record<string, any> | null)?.kitchenRefundDebts || []).map((debt: any) => ({ ...debt, transactionId: source.id }))),
    payout: await (await import('./kitchen-payout-service')).readKitchenPayout(id),
    money: { ...money(ctx), dayPayouts }, paymentEvidence, evidenceUnavailable, cancellationQuote: cancellationQuote && 'quoteHash' in cancellationQuote ? {
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
  retry_refund: 'local_cooks', mark_refunded: 'local_cooks', resolve_money_attempt: 'local_cooks', finish_kitchen_refund: 'manager', refund_captured_request: 'manager',
};
function validateDetails(input: SupportActionInput) {
  const d = input.details || {};
  if (requiredActingFor[input.type] && requiredActingFor[input.type] !== input.actingFor) throw new BookingSupportError('Choose the party this action is for.', 400);
  const require = (ok: unknown, message: string) => { if (!ok) throw new BookingSupportError(message, 400); };
  if (AUTOMATIC_REFUND_ACTIONS.includes(input.type)) require(d.transactionId && d.refundOperationId, 'Choose the original refund operation.');
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
    // Support may also close a confirmation whose card hold was released (verified with Stripe inside); nothing was charged.
    case 'decline_for_manager': case 'release_hold_for_chef': return decideAuthorizedBooking(id, 'cancelled', [], [], actorId, undefined, { supersedeDeadEnd: true });
    case 'replay_payment_decision': return reconcileBookingDecision(id);
    case 'cancel_kitchen_caused': case 'refund_captured_request': return cancelKitchenCausedBooking(id, managerId!, actorId, input.operationKey);
    case 'finish_kitchen_refund': return cancelKitchenCausedBooking(id, managerId!, actorId, input.operationKey, undefined, { fundedByLocalCooks: d.fundedByLocalCooks === true });
    case 'request_cancellation_for_chef': return requestChefCancellation(id, ctx.booking.chefId!, actorId, d.publicMessage, input.operationKey);
    case 'accept_cancellation_for_manager': return acceptCancellationRefund(id, managerId!, d.quoteHash!, undefined, input.operationKey);
    case 'retry_refund': case 'mark_refunded': {
      if (!managerId) throw Error('The kitchen contact needs review.');
      const result = await retryCancellationRefund(id, managerId, { selector: { transactionId: d.transactionId!, refundOperationId: d.refundOperationId! },
        receiptOnly: input.type === 'mark_refunded', supportOperationKey: input.operationKey });
      const target = result.sources.find((row: any) => row.transactionId === d.transactionId && row.operation?.id === d.refundOperationId) as any;
      if (target?.operation?.status !== 'succeeded') throw Error('The original refund is not verified yet.');
      return { ...result, refundId: target.operation.refundId, paymentIntentId: target.operation.intentId, amountCents: target.operation.refunded, success: true };
    }
    case 'resolve_money_attempt': return resolveMoneyAttempts(ctx);
    case 'goodwill_refund': return refundSupportGoodwill(id, managerId!, actorId, input.amountCents!, input.operationKey);
    case 'release_payout': {
      // Verified once the payout is sent (or nothing is owed), or support's release is saved for when the visits close.
      const release = ctx.booking.scheduleRevision
        ? await (await import('./kitchen-day-payouts')).releaseBookingDayPayouts(id, new Date(), undefined, input.details?.installmentId)
        : await (await import('./kitchen-payout-service')).releaseKitchenPayout(id, `support:${input.operationKey}`, new Date(), { override: true });
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
/** Re-runs the same-key recovery for every stalled refund attempt; each one completes, closes, or stays with a reason. */
async function resolveMoneyAttempts(ctx: Context): Promise<Record<string, unknown>> {
  const attempts: Array<{ operationKey: string; status: string }> = [];
  for (const row of ctx.actions.filter(action => action.status === 'recovery_required' && MONEY_ATTEMPT_TYPES.includes(action.actionType))) {
    const saved = (row.beforeState as { requestInput?: unknown } | null)?.requestInput;
    // Older attempts did not save their request: rebuild the same request from the saved action row.
    const input = saved ?? { type: row.actionType, actingFor: row.actingFor, requestSource: row.requestSource, sourceRef: row.sourceRef ?? undefined,
      reasonCode: row.reasonCode, note: row.internalNote, operationKey: row.operationKey, amountCents: row.actionType === 'goodwill_refund' ? row.amountCents ?? undefined : undefined,
      confirmException: row.exception ? true : undefined };
    try {
      const result = await executeBookingSupportAction(ctx.booking.id, row.actorUserId, input);
      attempts.push({ operationKey: row.operationKey, status: result.action.status });
    } catch {
      attempts.push({ operationKey: row.operationKey, status: 'needs_review' });
    }
  }
  return { success: true, attempts };
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
  if ([...MONEY_ATTEMPT_TYPES, ...AUTOMATIC_REFUND_ACTIONS, 'request_cancellation_for_chef', 'accept_cancellation_for_manager'].includes(input.type)) {
    const ctx = await loadContext(id);
    assertLegacyCancellation(ctx.booking, ctx.payments);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ id, actorId, input })).digest('hex');
  const refundEvidence = input.type === 'mark_refunded' ? await readAutomaticRefundEvidence((await loadContext(id)).payments) : undefined;
  const reserved = await db.transaction(async tx => {
    // Lock sources before the parent, matching refund and transfer writers.
    const storageIds = (await tx.select({ id: storageBookings.id }).from(storageBookings).where(eq(storageBookings.kitchenBookingId, id))).map(row => row.id);
    const equipmentIds = (await tx.select({ id: equipmentBookings.id }).from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, id))).map(row => row.id);
    await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(or(
      and(inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(paymentTransactions.bookingId, id)),
      ...(storageIds.length ? [and(eq(paymentTransactions.bookingType, 'storage'), inArray(paymentTransactions.bookingId, storageIds))] : []),
      ...(equipmentIds.length ? [and(eq(paymentTransactions.bookingType, 'equipment'), inArray(paymentTransactions.bookingId, equipmentIds))] : []),
    )).orderBy(asc(paymentTransactions.id)).for('update');
    await tx.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.id, id)).for('update');
    const [existing] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey)).limit(1);
    if (existing) {
      if (existing.bookingId !== id || (existing.beforeState as { requestFingerprint?: string }).requestFingerprint !== fingerprint) throw new BookingSupportError('This operation key belongs to a different support request.');
      return { action: existing, ctx: existing.status === 'recovery_required' ? await loadContext(id, tx) : null };
    }
    const ctx = await loadContext(id, tx);
    if (!availableSupportActions(ctx, new Date(), refundEvidence).some(action => action.type === input.type)) throw new BookingSupportError('This action is unavailable in the booking’s current state. Refresh the case before choosing the next step.');
    if (AUTOMATIC_REFUND_ACTIONS.includes(input.type) && !automaticRefundOperations(ctx.payments).some(({ source, operation }) => source.id === input.details?.transactionId && operation.id === input.details?.refundOperationId
      && (input.type !== 'mark_refunded' || hasReservedReceipt(source, operation, refundEvidence)))) throw new BookingSupportError('The selected refund is unavailable. Refresh the case.');
    const goodwill = ctx.actions.filter(action => action.actionType === 'goodwill_refund' && action.status !== 'failed').reduce((sum, action) => sum + (action.amountCents || 0), 0);
    const exception = input.type === 'goodwill_refund' && goodwill + input.amountCents! > 2500;
    if (exception && input.confirmException !== true) throw new BookingSupportError('Goodwill above $25 for this booking needs your explicit exception confirmation.');
    if (input.type === 'goodwill_refund' && ctx.booking.currency.toUpperCase() !== 'CAD') throw new BookingSupportError('This goodwill allowance is set in Canadian dollars. Review other currencies separately.');
    const [action] = await tx.insert(supportActions).values({ bookingId: id, caseRef: ctx.booking.referenceCode || `#${id}`, actionType: input.type,
      actorUserId: actorId, actingFor: input.actingFor, requestSource: input.requestSource, sourceRef: input.sourceRef,
      reasonCode: input.reasonCode, internalNote: input.note, amountCents: input.amountCents ?? (KITCHEN_REFUND_TYPES.includes(input.type) ? money(ctx).capturedCents - money(ctx).refundedCents : null), currency: ctx.booking.currency,
      fundedBy: input.type === 'goodwill_refund' || KITCHEN_REFUND_TYPES.includes(input.type) ? 'local_cooks' : input.type === 'accept_cancellation_for_manager' ? 'manager' : 'none',
      exception, beforeState: { ...snapshot(ctx.booking), requestFingerprint: fingerprint, requestInput: input }, status: 'executing', operationKey: input.operationKey }).returning();
    return { action, ctx };
  });
  if (!reserved.ctx) return { action: { id: reserved.action.id, operationKey: input.operationKey, status: reserved.action.status, exception: reserved.action.exception }, case: await readBookingSupport(id), replayed: true };
  if (reserved.action.status === 'recovery_required') {
    // Recover a verified original receipt; absence/pending evidence cannot authorize another money operation.
    let verified = false;
    try {
      if (AUTOMATIC_REFUND_ACTIONS.includes(input.type)) {
        verified = true; // Dispatch rechecks the same reservation and receipt; a support replay never changes its provider key.
      } else if (MONEY_ATTEMPT_TYPES.includes(input.type) && reserved.ctx.booking.paymentIntentId) {
        const receipts = await getPaymentIntentRefunds(reserved.ctx.booking.paymentIntentId);
        // A retry of an already committed cancellation reuses the refund's original operation key, which is not this request's key.
        const planKey = input.type === 'finish_kitchen_refund' ? reserved.ctx.payments.map(source => (source.metadata as { kitchenCancellationRefund?: { id?: string } } | null)?.kitchenCancellationRefund?.id).find(Boolean) : undefined;
        const state = judgeMoneyAttempt(receipts, planKey ?? input.operationKey, reserved.action);
        if (state.kind === 'succeeded') verified = true;
        else {
          // Never started or failed at the provider: close it so it cannot freeze the case. Otherwise say why it is still waiting.
          const closed = state.kind === 'closed';
          await db.update(supportActions).set(closed
            ? { status: 'failed', error: state.message, completedAt: new Date(), providerRefs: { attempt: { evidence: state.evidence, checkedAt: new Date().toISOString(), refundsOnPayment: receipts.length } } }
            : { error: state.message })
            .where(and(eq(supportActions.id, reserved.action.id), eq(supportActions.status, 'recovery_required')));
          return { action: { id: reserved.action.id, operationKey: input.operationKey, status: closed ? 'failed' : reserved.action.status, exception: reserved.action.exception },
            case: await readBookingSupport(id), replayed: true };
        }
      } else if (['confirm_for_manager', 'decline_for_manager', 'release_hold_for_chef', 'replay_payment_decision'].includes(input.type)) {
        const decision = reserved.ctx.booking.paymentDecision as { intentId?: string; target?: string; amount?: number } | null;
        if (decision?.intentId) {
          const intent = await getBookingPaymentIntent(decision.intentId);
          verified = decision.target === 'confirmed' ? intent.status === 'succeeded' && intent.amount_received === decision.amount : intent.status === 'canceled';
        }
      } else if (input.type === 'release_payout') {
        // The release is idempotent: a retry finds the committed decision and recovers the same transfer.
        const release = reserved.ctx.booking.scheduleRevision
        ? await (await import('./kitchen-day-payouts')).releaseBookingDayPayouts(id, new Date(), undefined, input.details?.installmentId)
        : await (await import('./kitchen-payout-service')).releaseKitchenPayout(id, `support:${input.operationKey}`, new Date(), { override: true });
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
    outcome = ['confirm_for_manager', 'decline_for_manager', 'release_hold_for_chef', 'replay_payment_decision', 'goodwill_refund', 'cancel_kitchen_caused', 'refund_captured_request', 'finish_kitchen_refund', 'accept_cancellation_for_manager', 'release_payout', 'retry_refund', 'mark_refunded'].includes(input.type) ? 'recovery_required' : 'failed';
    error = outcome === 'recovery_required' ? 'Local Cooks needs to verify this original payment operation before another attempt.' : 'The update could not be completed. Refresh the booking and review the next step.';
  }
  await db.transaction(async tx => {
    const [currentAction] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey)).for('update');
    if (currentAction?.status === 'verified') return;
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, id)).limit(1);
    // Every other action runs the same service a chef or kitchen would, and that service already tells each side in its own
    // words (confirmed, cancelled, payout sent, arrival changed…). A goodwill refund has no such notice: tell the chef only —
    // the kitchen's payout is untouched. Unverified attempts stay internal; Local Cooks sees them on the case.
    if (outcome === 'verified' && input.type === 'goodwill_refund') {
      const amount = new Intl.NumberFormat('en-CA', { style: 'currency', currency: (booking?.currency || 'CAD').toUpperCase() }).format(input.amountCents! / 100);
      const kitchen = reserved.ctx?.kitchen?.name || 'the kitchen';
      await queueBookingLifecycleEvent(tx, id, 'support_updated', `Local Cooks refunded you ${amount}`,
        `Local Cooks sent you a refund of ${amount} for your booking at ${kitchen}. Banks usually show it within 5–10 business days.`, actorId,
        { recipientPolicy: 'chef', supportActionId: reserved.action.id });
    }
    const events = await tx.select({ id: bookingLifecycleEvents.id }).from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, id), sql`${bookingLifecycleEvents.metadata}->>'supportActionId' = ${String(reserved.action.id)}`));
    await tx.update(supportActions).set({ status: outcome, afterState: booking ? { ...snapshot(booking),
      ...Object.fromEntries(['amountCents', 'managerPaysCents', 'localCooksPaysCents', 'processingCostAbsorbedCents'].flatMap(key =>
        typeof result[key] === 'number' ? [[key, result[key]]] : [])) } : null, providerRefs: providerRefs(result),
      error, completedAt: new Date(), notifiedEventIds: events.map(event => event.id) }).where(and(eq(supportActions.id, reserved.action.id), inArray(supportActions.status, ['executing', 'recovery_required'])));
  });
  // Money moved (goodwill, cancellation, payout release…): issue the receipt/remittance now, after the commit.
  if (outcome === 'verified') await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(id, `support:${input.type}`)).catch(() => undefined);
  return { action: { id: reserved.action.id, operationKey: input.operationKey, status: outcome, exception: reserved.action.exception }, case: await readBookingSupport(id), replayed: false };
}
