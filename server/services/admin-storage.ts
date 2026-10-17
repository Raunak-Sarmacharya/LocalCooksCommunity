import { and, asc, eq, isNotNull, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { bookingFlags, commitmentProblems, damageClaims, emailLogs, kitchens, locations, paymentTransactions, storageBookings, storageListings, storageOverstayRecords, supportActions } from '@shared/schema';
import { localToday } from '@shared/storage-rental';
import { decideRental, readRental, StorageRentalError } from './storage-rentals';
import { previewStorageTool, reclaimPreview, runStorageTool, storageToolContext, storageToolInput } from './storage-rental-actions';
import { openRemovalReview, recordRemoval, sendFinalNotice, waiveHoldover } from './storage-rental-lifecycle';
import { changeStorageFlag } from './booking-support-flags';
import { expectedStoragePayoutCents, releaseStorageTermPayout } from './storage-payouts';
import { recoverStorageRefund } from './storage-rental-money';
import { queueStorageRentalNotice } from './storage-rental-notices';

export const ADMIN_STORAGE_ACTIONS = ['approve_for_kitchen', 'decline_for_kitchen', 'end_rental', 'relocate', 'open_removal_review',
  'send_final_notice', 'record_removal_for_kitchen', 'waive_holdover', 'goodwill_refund', 'release_payout', 'open_flag', 'resolve_flag', 'retry_refund', 'mark_refunded'] as const;
export const adminStorageInput = storageToolInput.extend({ type: z.enum(ADMIN_STORAGE_ACTIONS), reason: z.string().trim().min(10).max(2000),
  operationKey: z.string().min(8).max(100).regex(/^[\w:-]+$/), fundedBy: z.enum(['kitchen', 'local_cooks', 'none']),
  refund: z.boolean().optional(), flagId: z.number().int().positive().optional(),
  photos: z.array(z.string().url().max(2000)).max(20).optional(),
  items: z.array(z.object({ name: z.string().trim().min(1).max(200), qty: z.number().int().min(1).max(9999), perishable: z.boolean() })).max(100).optional(),
  itemIndexes: z.array(z.number().int().min(0).max(99)).max(100).optional(), all: z.boolean().optional() });
export type AdminStorageInput = z.infer<typeof adminStorageInput>;
const fail = (code: string, status = 409): never => { throw new StorageRentalError(code, status); };

export async function previewAdminStorageAction(id: number, adminId: number, input: AdminStorageInput) {
  const actor = { id: adminId, role: 'admin' as const };
  if (input.type === 'goodwill_refund') return previewStorageTool(id, actor, 'refund', { amountCents: input.amountCents, fundedBy: input.fundedBy === 'local_cooks' ? 'local_cooks' : 'kitchen' });
  if (input.type === 'end_rental' && input.refund) {
    const { rental } = await storageToolContext(db, id, actor);
    return previewStorageTool(id, actor, 'move-out-by', { byDate: localToday(new Date(), rental.timezone!), emergency: input.emergency });
  }
  const detail = await adminStorageDetail(id, adminId);
  return { date: localToday(new Date(), detail.timezone!), amountCents: input.type === 'waive_holdover' ? detail.holdoverChargeCents
    : input.type === 'release_payout' ? detail.payments.filter(payment => !payment.transferSent).reduce((sum, payment) => sum + payment.payoutAmountCents, 0)
    : detail.terms.reduce((sum, term) => sum + term.totalCents, 0) };
}

/** Explicit allowlists: provider references and raw money metadata never leave the server. */
export async function adminStorageDetail(id: number, actorId: number) {
  const { rental, managerId } = await storageToolContext(db, id, { id: actorId, role: 'admin' });
  const dto = await readRental(id, { id: managerId!, role: 'manager' });
  const payments = await db.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingType, 'storage'), eq(paymentTransactions.bookingId, id)));
  const flags = await db.select({ id: bookingFlags.id, kind: bookingFlags.kind, note: bookingFlags.note, openedAt: bookingFlags.openedAt, resolvedAt: bookingFlags.resolvedAt })
    .from(bookingFlags).where(eq(bookingFlags.storageBookingId, id));
  const actions = await db.select({ id: supportActions.id, type: supportActions.actionType, reason: supportActions.internalNote, fundedBy: supportActions.fundedBy,
    amountCents: supportActions.amountCents, status: supportActions.status, createdAt: supportActions.createdAt, completedAt: supportActions.completedAt })
    .from(supportActions).where(eq(supportActions.storageBookingId, id));
  const problems = await db.select({ id: commitmentProblems.id, description: commitmentProblems.description, status: commitmentProblems.status, createdAt: commitmentProblems.createdAt })
    .from(commitmentProblems).where(eq(commitmentProblems.storageBookingId, id));
  const claims = await db.select({ id: damageClaims.id, ref: damageClaims.referenceCode, title: damageClaims.claimTitle, status: damageClaims.status, amountCents: damageClaims.claimedAmountCents })
    .from(damageClaims).where(eq(damageClaims.storageBookingId, id));
  const holdover = await db.select({ id: storageOverstayRecords.id, status: storageOverstayRecords.status, amountCents: storageOverstayRecords.finalPenaltyCents,
    days: storageOverstayRecords.daysOverdue, deadline: storageOverstayRecords.chefDisputeDeadline }).from(storageOverstayRecords).where(eq(storageOverstayRecords.storageBookingId, id));
  const mail = await db.select({ id: emailLogs.id, subject: emailLogs.subject, status: emailLogs.status, createdAt: emailLogs.createdAt, role: emailLogs.recipientRole })
    .from(emailLogs).where(like(emailLogs.trackingId, `storage-rental:${id}:%`));
  const inApp = await db.execute(sql`SELECT 'manager:' || n.id AS id, n.title AS subject, 'delivered' AS status, n.created_at AS "createdAt", u.role
    FROM manager_notifications n JOIN users u ON u.id = n.manager_id WHERE n.metadata->>'storageRentalId' = ${String(id)}
    UNION ALL SELECT 'chef:' || n.id, n.title, 'delivered', n.created_at, 'chef'
    FROM chef_notifications n WHERE n.metadata->>'storageRentalId' = ${String(id)}`);
  const notices = [...mail.map(row => ({ ...row, channel: 'email' })), ...inApp.rows.map(row => ({ ...row, channel: 'in_app' }))];
  return { ...dto, adminActions: ADMIN_STORAGE_ACTIONS, payments: payments.map(source => ({ amountCents: Number(source.amount), refundedCents: Number(source.refundAmount || 0),
    payoutAmountCents: expectedStoragePayoutCents(source), status: source.status, payoutStatus: source.transferId ? 'paid' : source.payoutHoldReason ? 'hold' : 'scheduled',
    holdReason: source.payoutHoldReason, transferSent: !!source.transferId, paidAt: source.paidAt, payoutDate: source.payoutEligibleAt })),
    flags, supportActions: actions, problems, claims, holdover: holdover.map(row => ({ ...row, amountCents: row.amountCents == null ? null
      : row.amountCents + Math.round(row.amountCents * dto.rentalTerms.taxRatePercent / 100) })), notices, removalReview: rental.removalReview };
}
export async function adminStorageList(filters: { state?: string; kitchenId?: number; q?: string; needsAttention?: boolean }, actorId: number) {
  const rows = await db.select({ id: storageBookings.id, kitchenId: kitchens.id }).from(storageBookings)
    .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .where(and(isNotNull(storageBookings.rentalTerms), filters.state ? eq(storageBookings.rentalState, filters.state as any) : undefined,
      filters.kitchenId ? eq(kitchens.id, filters.kitchenId) : undefined)).orderBy(asc(storageBookings.id));
  const results = [];
  for (const row of rows) {
    const detail = await adminStorageDetail(row.id, actorId);
    if (filters.q && ![detail.ref, detail.kitchen.name, detail.listing.name, detail.chef.name].join(' ').toLocaleLowerCase().includes(filters.q.toLocaleLowerCase())) continue;
    if (filters.needsAttention && !(['requested', 'removal_review', 'move_out_requested'].includes(detail.state!) || detail.phase === 'holdover'
      || detail.flags.some(flag => !flag.resolvedAt) || detail.problems.some(problem => problem.status !== 'resolved')
      || detail.claims.some(claim => !['draft', 'rejected', 'resolved', 'expired', 'charge_succeeded'].includes(claim.status))
      || detail.supportActions.some(action => ['executing', 'recovery_required'].includes(action.status)))) continue;
    const { flags, supportActions: audit, problems, claims, holdover, notices, payments, removalReview, ...summary } = detail;
    results.push(summary);
  }
  return results;
}

export async function runAdminStorageAction(id: number, adminId: number, raw: AdminStorageInput) {
  const input = adminStorageInput.parse(raw), actor = { id: adminId, role: 'admin' as const };
  const money = input.type === 'goodwill_refund' || input.type === 'end_rental' && input.refund;
  if (money ? input.fundedBy === 'none' : input.fundedBy !== 'none') fail('invalid_details', 400);
  const fingerprint = JSON.stringify(input);
  const reservation = await db.transaction(async tx => {
    const { rental, managerId } = await storageToolContext(tx, id, actor, true);
    const [prior] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey));
    if (prior) {
      if (prior.storageBookingId !== id || prior.actorUserId !== adminId || (prior.beforeState as any).fingerprint !== fingerprint) fail('operation_changed');
      if (prior.status === 'executing') fail('decision_pending');
      if (prior.status === 'failed') fail('operation_changed');
      if (prior.status === 'recovery_required') await tx.update(supportActions).set({ status: 'executing' }).where(eq(supportActions.id, prior.id));
      return { audit: prior, managerId, complete: prior.status === 'verified' };
    }
    const recoveryFor = ['retry_refund', 'mark_refunded'].includes(input.type) ? [...(await tx.select().from(paymentTransactions)
      .where(and(eq(paymentTransactions.bookingId, id), eq(paymentTransactions.bookingType, 'storage'))))
      .flatMap(source => (source.metadata as any)?.cancellationRefundOperation?.supportOperationKey ? [(source.metadata as any).cancellationRefundOperation.supportOperationKey] : []),
      ...(rental.assistanceHistory as any[]).filter(entry => !entry.complete && ['refund', 'move-out-by'].includes(entry.action)).map(entry => entry.operationKey)] : [];
    const [audit] = await tx.insert(supportActions).values({ storageBookingId: id, caseRef: rental.referenceCode || `SB-${id}`, actionType: input.type,
      actorUserId: adminId, actingFor: 'manager', requestSource: 'proactive', reasonCode: 'storage_support', internalNote: input.reason,
      amountCents: input.amountCents, fundedBy: input.fundedBy === 'kitchen' ? 'manager' : input.fundedBy, exception: input.emergency === true, operationKey: input.operationKey,
      beforeState: { state: rental.rentalState, unitIndex: rental.unitIndex, paidThrough: rental.paidThrough, reclaimEndOn: rental.reclaimEndOn,
        actionDate: localToday(new Date(), rental.timezone!), fingerprint, recoveryFor }, status: 'executing' }).returning();
    return { audit, managerId, complete: false };
  });
  if (reservation.complete) return adminStorageDetail(id, adminId);
  // Provider work and helper-owned transactions must run after the audit reservation commits.
  try {
    let result: any;
    const toolInput = { ...input, fundedBy: input.fundedBy === 'none' ? undefined : input.fundedBy };
    switch (input.type) {
      case 'approve_for_kitchen': result = await decideRental(id, 'reserved', { id: reservation.managerId!, role: 'manager' }, { unitIndex: input.unitIndex }); break;
      case 'decline_for_kitchen': result = await decideRental(id, 'declined', { id: reservation.managerId!, role: 'manager' }, { reason: input.reason }); break;
      case 'relocate': result = await runStorageTool(id, actor, 'change-unit', toolInput); break;
      case 'goodwill_refund': result = await runStorageTool(id, actor, 'refund', toolInput); break;
      case 'end_rental': {
        const { rental } = await storageToolContext(db, id, actor);
        if (rental.rentalState === 'ended' && rental.endReason === 'admin_ended') break;
        if (!['reserved', 'active', 'move_out_requested', 'removal_review'].includes(rental.rentalState!)) fail('not_active');
        const today = (reservation.audit.beforeState as { actionDate: string }).actionDate;
        reclaimPreview(rental as any, [], today, today, input.emergency === true);
        if (input.refund) {
          result = await runStorageTool(id, actor, 'move-out-by', { ...toolInput, byDate: today });
          if (!result.success) break;
        }
        await db.transaction(async tx => {
          await storageToolContext(tx, id, actor, true);
          await tx.update(storageBookings).set({ rentalState: 'ended', endReason: 'admin_ended', releasedOn: today, occupancy: null, needsCleaning: false,
            status: 'completed', updatedAt: new Date() }).where(eq(storageBookings.id, id));
          await queueStorageRentalNotice(tx, id, 'cleared', { eventKey: input.operationKey, date: today });
        });
        break;
      }
      case 'open_removal_review': result = await openRemovalReview(id); break;
      case 'send_final_notice': result = await sendFinalNotice(id, adminId, { photos: input.photos ?? [], items: input.items ?? [] }); break;
      case 'record_removal_for_kitchen': result = await recordRemoval(id, actor, { all: input.all, itemIndexes: input.itemIndexes, note: input.reason }); break;
      case 'waive_holdover': result = await waiveHoldover(id, reservation.managerId!, { reason: input.reason }); break;
      case 'open_flag': result = await changeStorageFlag(id, 'manual_hold', input.operationKey, false, adminId, input.reason); break;
      case 'resolve_flag': {
        const [flag] = await db.select().from(bookingFlags).where(and(eq(bookingFlags.id, input.flagId ?? 0), eq(bookingFlags.storageBookingId, id)));
        if (!flag?.providerRef) fail('invalid_details', 400);
        const kind = z.enum(['manual_hold', 'chargeback', 'payout_failed', 'transfer_failed']).parse(flag.kind);
        result = await changeStorageFlag(id, kind, flag.providerRef!, true, adminId, input.reason); break;
      }
      case 'release_payout': {
        await db.transaction(async tx => {
          const { rental } = await storageToolContext(tx, id, actor, true);
          const problems = await tx.select().from(commitmentProblems).where(eq(commitmentProblems.storageBookingId, id));
          await tx.update(storageBookings).set({ rentalTerms: { ...(rental.rentalTerms as object),
            payoutProblemOverrides: Object.fromEntries(problems.filter(problem => problem.status !== 'resolved').map(problem => [problem.id, problem.revision])) } }).where(eq(storageBookings.id, id));
        });
        const sources = await db.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, id), eq(paymentTransactions.bookingType, 'storage')));
        result = await Promise.all(sources.map(source => releaseStorageTermPayout(source.id, `admin:${input.operationKey}`)));
        if (result.some((row: any) => !row.success)) fail('payout_held');
        break;
      }
      case 'retry_refund': case 'mark_refunded': {
        result = await recoverStorageRefund(id, input.operationKey, input.type === 'retry_refund');
        const { rental } = await storageToolContext(db, id, actor);
        // Finish the original local transition only after every reserved refund is verified.
        for (const entry of rental.assistanceHistory as any[]) if (!entry.complete && ['refund', 'move-out-by'].includes(entry.action)) {
          if (input.type === 'mark_refunded' && !result.verifiedOperationKeys?.includes(entry.operationKey)) fail('refund_pending');
          await runStorageTool(id, { id: entry.actorId, role: entry.actorRole }, entry.action, JSON.parse(entry.fingerprint));
        }
        const prior = await db.select().from(supportActions).where(eq(supportActions.storageBookingId, id));
        for (const audit of prior) if (audit.status === 'recovery_required' && (reservation.audit.beforeState as any).recoveryFor?.includes(audit.operationKey))
          await runAdminStorageAction(id, audit.actorUserId, JSON.parse((audit.beforeState as any).fingerprint));
        break;
      }
    }
    if (result?.recoveryRequired) fail('refund_pending');
    const { rental: after } = await storageToolContext(db, id, actor);
    await db.update(supportActions).set({ status: 'verified', completedAt: new Date(), afterState: { state: after.rentalState, unitIndex: after.unitIndex,
      paidThrough: after.paidThrough, reclaimEndOn: after.reclaimEndOn }, error: null }).where(eq(supportActions.id, reservation.audit.id));
  } catch (error) {
    // Never put provider errors (which can contain Stripe references) in the admin DTO.
    const retryable = ['goodwill_refund', 'end_rental', 'release_payout', 'retry_refund', 'approve_for_kitchen', 'decline_for_kitchen'].includes(input.type)
      && !(error instanceof StorageRentalError && error.status < 500 && error.code !== 'refund_pending');
    await db.update(supportActions).set({ status: retryable ? 'recovery_required' : 'failed', error: 'storage_action_failed' }).where(eq(supportActions.id, reservation.audit.id));
    throw error;
  }
  return adminStorageDetail(id, adminId);
}
