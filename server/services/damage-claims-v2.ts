import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, damageEvidence, damageClaimHistory, kitchenBookings, kitchenBookingVisits,
  kitchens, locations, users, supportActions } from '@shared/schema';
import { approvedClaimAmount, claimFilingWindow, claimResponseDeadline, claimTotal, fileClaimInput,
  claimSupportInput, validateClaimLines, type ClaimSupportInput } from '@shared/damage-claims';
import { recordedDepartureAt } from '@shared/clock-closeout';
import { calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime } from '@shared/timezone-utils';
import { generateReferenceCode } from '../reference-code';
import { workerAfter, workerPageEnd, workerRecord, isWorkerBudgetError, assertWorkerTime } from './worker-context';
import { assertBookingMoneyWritable } from './booking-money-guard';

export type ClaimTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Claim = typeof damageClaims.$inferSelect;
export class DamageClaimError extends Error { constructor(message: string, public status = 409) { super(message); } }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function lockClaim(id: number, tx: ClaimTx): Promise<Claim> {
  const [claim] = await tx.select().from(damageClaims).where(eq(damageClaims.id, id)).limit(1).for('update');
  if (!claim) throw new DamageClaimError('Claim not found.', 404);
  return claim;
}
export async function claimHistory(tx: ClaimTx, claim: Claim, status: Claim['status'], action: string,
  actor: 'manager' | 'chef' | 'admin' | 'system' | 'stripe_webhook', actorId?: number, publicMessage?: string) {
  const [history] = await tx.insert(damageClaimHistory).values({ damageClaimId: claim.id, previousStatus: claim.status,
    newStatus: status, action, actionBy: actor, actionByUserId: actorId, notes: publicMessage,
    metadata: { publicMessage } }).returning();
  await (await import('./damage-claim-notices')).queueDamageClaimNotice(tx, { ...claim, status }, history);
}
async function bookingContext(bookingId: number, managerId: number, visitId: number | undefined, tx: ClaimTx) {
  const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone,
    managerId: locations.managerId, locationId: locations.id, kitchenName: kitchens.name })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || row.managerId !== managerId) throw new DamageClaimError('Booking not found or unauthorized.', 404);
  if (!['confirmed', 'completed'].includes(row.booking.status) || !row.booking.chefId)
    throw new DamageClaimError('Choose a confirmed visit that has ended.');
  if (!row.timezone) throw new DamageClaimError('The kitchen timezone must be set before filing.');
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
  const visit = visitId ? visits.find(item => item.id === visitId) : visits.length === 1 ? visits[0] : visits.length ? null : row.booking;
  if (!visit) throw new DamageClaimError('Choose the affected visit.');
  const day = row.booking.bookingDate.toISOString().slice(0, 10);
  const endDay = calendarDateForBookingTime(day, visit.endTime, row.booking.operatingWindowStartTime, row.booking.startTime);
  const window = claimFilingWindow(createBookingDateTime(endDay, visit.endTime, row.timezone), recordedDepartureAt(visit));
  return { ...row, visit, window };
}
export async function readClaimFilingContext(bookingId: number, managerId: number, visitId?: number) {
  const ctx = await bookingContext(bookingId, managerId, visitId, db as unknown as ClaimTx);
  return { allowed: ctx.window.allowed, deadline: ctx.window.deadline.toISOString(), endedAt: ctx.window.endedAt.toISOString(),
    timezone: ctx.timezone, kitchenName: ctx.kitchenName, before: ctx.visit.checkinPhotoUrls || [], after: ctx.visit.checkoutPhotoUrls || [] };
}
export async function fileDamageClaim(managerId: number, raw: unknown) {
  const parsed = fileClaimInput.safeParse(raw);
  if (!parsed.success) throw new DamageClaimError('Describe what happened and add a receipt, invoice or quote to every cost line.', 400);
  const input = parsed.data, lines = validateClaimLines(input.lines), amount = claimTotal(lines);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${input.bookingId} FOR UPDATE`);
    const [existing] = await tx.select().from(damageClaims).where(and(eq(damageClaims.managerId, managerId), eq(damageClaims.requestKey, input.requestKey))).limit(1);
    if (existing) {
      if (existing.kitchenBookingId !== input.bookingId || hash(existing.costLines) !== hash(lines) || existing.claimDescription !== input.description
        || existing.kitchenBookingVisitId !== (input.visitId || null)) throw new DamageClaimError('This filing key belongs to different claim details.');
      return publicClaim(existing, tx);
    }
    const ctx = await bookingContext(input.bookingId, managerId, input.visitId, tx);
    if (!ctx.window.allowed) throw new DamageClaimError('Report within 72 hours of leaving the kitchen. Contact Local Cooks for help.');
    const now = new Date();
    const photos = (value: unknown) => Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string') : [];
    const visitEvidence = { before: photos(ctx.visit.checkinPhotoUrls), after: photos(ctx.visit.checkoutPhotoUrls),
      checkinNotes: ctx.visit.checkinNotes, checkoutNotes: ctx.visit.checkoutNotes, endedAt: ctx.window.endedAt.toISOString(),
      timezone: ctx.timezone, kitchenName: ctx.kitchenName };
    const [claim] = await tx.insert(damageClaims).values({ referenceCode: await generateReferenceCode('damage_claim'), claimVersion: 2,
      requestKey: input.requestKey, bookingType: 'kitchen', kitchenBookingId: input.bookingId,
      kitchenBookingVisitId: 'bookingId' in ctx.visit ? ctx.visit.id : null, managerId, chefId: ctx.booking.chefId!, locationId: ctx.locationId,
      claimTitle: lines.every(line => line.type === 'extra_cleaning') ? 'Extra cleaning' : 'Damage and cleaning',
      claimDescription: input.description, damageDate: ctx.window.endedAt.toISOString().slice(0, 10), status: 'submitted',
      claimedAmountCents: amount, finalAmountCents: amount, costLines: lines, visitEvidence,
      chefResponseDeadline: claimResponseDeadline(now), submittedAt: now, createdAt: now, updatedAt: now }).returning();
    const evidence = [ ...visitEvidence.before.map(fileUrl => ({ fileUrl, evidenceType: 'photo_before' as const })),
      ...visitEvidence.after.map(fileUrl => ({ fileUrl, evidenceType: 'photo_after' as const })),
      ...input.photos.map(photo => ({ ...photo, evidenceType: 'photo_after' as const })),
      ...lines.map(line => ({ ...line.document, description: line.description, amountCents: line.amountCents, evidenceType: 'invoice' as const })) ];
    if (evidence.length) await tx.insert(damageEvidence).values(evidence.map(item => ({ ...item, uploadedBy: managerId, damageClaimId: claim.id })));
    await claimHistory(tx, claim, 'submitted', 'submitted', 'manager', managerId);
    return publicClaim(claim, tx);
  });
}
/** No provider/customer identifiers or internal notes cross party APIs. */
export async function publicClaim(claim: Claim, tx: ClaimTx = db as unknown as ClaimTx) {
  const evidence = await tx.select({ id: damageEvidence.id, evidenceType: damageEvidence.evidenceType, fileUrl: damageEvidence.fileUrl,
    fileName: damageEvidence.fileName, uploadedBy: damageEvidence.uploadedBy, description: damageEvidence.description })
    .from(damageEvidence).where(eq(damageEvidence.damageClaimId, claim.id)).orderBy(asc(damageEvidence.id));
  const history = await tx.select({ id: damageClaimHistory.id, action: damageClaimHistory.action, status: damageClaimHistory.newStatus,
    createdAt: damageClaimHistory.createdAt }).from(damageClaimHistory).where(eq(damageClaimHistory.damageClaimId, claim.id)).orderBy(asc(damageClaimHistory.id));
  return { id: claim.id, referenceCode: claim.referenceCode, bookingId: claim.kitchenBookingId, visitId: claim.kitchenBookingVisitId,
    chefId: claim.chefId, managerId: claim.managerId, status: claim.status, claimVersion: claim.claimVersion,
    description: claim.claimDescription, amountCents: claim.finalAmountCents ?? claim.claimedAmountCents, claimedAmountCents: claim.claimedAmountCents,
    lines: claim.costLines, visitEvidence: claim.visitEvidence, chefResponse: claim.chefResponse,
    deadline: claim.chefResponseDeadline, upheldAt: claim.upheldAt, publicMessage: claim.adminDecisionReason,
    kitchenPaid: claim.transferOperation?.state === 'succeeded' || claim.compensationOperation?.state === 'succeeded',
    fundedBy: claim.fundedBy, chefOwes: claim.chefOwes, holdReleasedAt: claim.holdReleasedAt,
    paymentBusy: !!claim.paymentOperation && !['cancelled', 'succeeded'].includes(claim.paymentOperation.state),
    compensationPending: claim.compensationOperation?.state === 'pending', evidence, history };
}
export async function readBookingClaims(bookingId: number, actor: { id: number; role: string }) {
  if (actor.role !== 'admin') {
    const [row] = await db.select({ chefId: kitchenBookings.chefId, managerId: locations.managerId }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!row || (actor.role === 'manager' ? row.managerId : row.chefId) !== actor.id) throw new DamageClaimError('Booking not found.', 404);
  }
  const claims = await db.select().from(damageClaims).where(and(eq(damageClaims.kitchenBookingId, bookingId), sql`${damageClaims.status} <> 'draft'`))
    .orderBy(desc(damageClaims.id)).limit(50);
  return { claims: await Promise.all(claims.map(claim => publicClaim(claim))) };
}
export async function readChefClaims(chefId: number) {
  const claims = await db.select().from(damageClaims).where(and(eq(damageClaims.chefId, chefId), sql`${damageClaims.status} <> 'draft'`))
    .orderBy(desc(damageClaims.id)).limit(100);
  return { claims: await Promise.all(claims.map(claim => publicClaim(claim))) };
}
export async function disputeDamageClaim(claimId: number, chefId: number, raw: unknown) {
  const input = (await import('zod')).z.object({ note: (await import('zod')).z.string().trim().min(10).max(2000),
    photos: (await import('zod')).z.array((await import('@shared/damage-claims')).claimUpload).max(10).default([]) }).strict().safeParse(raw);
  if (!input.success) throw new DamageClaimError('Tell us why you disagree in at least 10 characters.', 400);
  await (await import('./damage-claim-money')).cancelClaimPayment(claimId, chefId);
  return db.transaction(async tx => {
    const claim = await lockClaim(claimId, tx);
    if (claim.chefId !== chefId) throw new DamageClaimError('Claim not found.', 404);
    if (!['submitted', 'under_review'].includes(claim.status) || claim.compensationOperation)
      throw new DamageClaimError('This claim has a saved decision. Contact Local Cooks to review it.');
    await tx.update(damageClaims).set({ status: 'under_review', chefResponse: input.data.note, chefRespondedAt: new Date(), updatedAt: new Date() }).where(eq(damageClaims.id, claimId));
    if (input.data.photos.length) await tx.insert(damageEvidence).values(input.data.photos.map(photo => ({ ...photo, damageClaimId: claimId,
      uploadedBy: chefId, evidenceType: 'photo_after' as const, description: input.data.note })));
    await claimHistory(tx, { ...claim, chefResponse: input.data.note }, 'under_review', 'chef_disputed', 'chef', chefId);
    return { success: true };
  });
}
/** Fixed-size keyset page even outside the recurring-worker context. Silence never approves or charges. */
export async function escalateDamageClaims(now = new Date(), limit = 3) {
  assertWorkerTime();
  const due = await db.select().from(damageClaims).where(and(eq(damageClaims.status, 'submitted'), lte(damageClaims.chefResponseDeadline, now),
    workerAfter('claims', damageClaims.id))).orderBy(asc(damageClaims.id)).limit(Math.min(25, Math.max(1, limit)));
  await workerPageEnd('claims', due.length);
  if (!due.length) return [];
  const results: Array<{ claimId: number; chefId: number; managerId: number; previousStatus: string; action: string }> = [];
  for (const row of due) {
    await workerRecord('claims', row.id);
    try {
      const done = await db.transaction(async tx => {
        const claim = await lockClaim(row.id, tx);
        if (claim.status !== 'submitted' || now < claim.chefResponseDeadline) return false;
        // A live payment can still finish: webhook reconciliation accepts under_review for its exact saved intent.
        await tx.update(damageClaims).set({ status: 'under_review', updatedAt: now }).where(eq(damageClaims.id, row.id));
        await claimHistory(tx, claim, 'under_review', 'escalated_to_admin', 'system');
        return true;
      });
      if (done) results.push({ claimId: row.id, chefId: row.chefId, managerId: row.managerId, previousStatus: row.status, action: 'escalated_to_admin' });
    } catch (error) { if (isWorkerBudgetError(error)) throw error; (await import('../logger')).logger.error('Claim escalation needs retry', { claimId: row.id }); }
  }
  return results;
}
export async function readClaimBookingHold(chefId: number, now = new Date()) {
  const rows = await db.select({ id: damageClaims.id, bookingId: damageClaims.kitchenBookingId, kitchenName: kitchens.name,
    amountCents: damageClaims.finalAmountCents }).from(damageClaims)
    .leftJoin(kitchenBookings, eq(kitchenBookings.id, damageClaims.kitchenBookingId)).leftJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .where(and(eq(damageClaims.chefId, chefId), eq(damageClaims.chefOwes, true), isNull(damageClaims.holdReleasedAt),
      isNull(damageClaims.resolvedAt), isNull(damageClaims.chargeSucceededAt), lte(damageClaims.upheldAt, new Date(now.getTime() - 7 * 86400000)),
      sql`${damageClaims.status} NOT IN ('rejected','resolved','charge_succeeded','expired')`)).orderBy(asc(damageClaims.id)).limit(20);
  return { held: rows.length > 0, claims: rows };
}
export async function decideDamageClaim(bookingId: number, adminId: number, raw: unknown) {
  const parsed = claimSupportInput.safeParse(raw);
  if (!parsed.success) throw new DamageClaimError('Choose the action, reason, internal note and message for both people.', 400);
  const input = parsed.data;
  const reserved = await db.transaction(async tx => {
    // Serialize support/claim money with flag writers using the same parent lock.
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const claim = await lockClaim(input.claimId, tx);
    if (claim.kitchenBookingId !== bookingId) throw new DamageClaimError('Claim does not belong to this booking.', 404);
    const [old] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey)).limit(1);
    if (old) {
      if (old.bookingId !== bookingId || old.actorUserId !== adminId || (old.beforeState as { inputHash?: string })?.inputHash !== hash(input))
        throw new DamageClaimError('This action key belongs to different details.');
      return { action: old, claim };
    }
    if (claim.paymentOperation && !['cancelled', 'succeeded'].includes(claim.paymentOperation.state))
      throw new DamageClaimError('A chef payment is open. It must finish or be cancelled before changing the decision.');
    if (claim.compensationOperation?.state === 'pending') throw new DamageClaimError('The saved kitchen payment needs recovery before a new decision. Retry its original action.');
    if (claim.chargeSucceededAt || claim.resolvedAt) throw new DamageClaimError('This claim is already resolved.');
    if (['claim_uphold', 'claim_reduce'].includes(input.type) && claim.status !== 'under_review') throw new DamageClaimError('Review the chef response or wait for the response deadline before upholding.');
    const amount = ['claim_uphold', 'claim_reduce', 'claim_compensate'].includes(input.type)
      ? approvedClaimAmount(claim.claimedAmountCents, input.amountCents ?? claim.claimedAmountCents) : 0;
    if (input.type === 'claim_compensate') {
      if (claim.compensationOperation || claim.transferOperation) throw new DamageClaimError('A kitchen payment is already recorded.');
      await assertBookingMoneyWritable({ bookingId, operationKey: input.operationKey }, tx);
    }
    const now = new Date(), update: Partial<typeof damageClaims.$inferInsert> = { adminDecisionReason: input.publicMessage,
      adminNotes: input.note, adminReviewerId: adminId, adminReviewedAt: now, updatedAt: now };
    if (['claim_uphold', 'claim_reduce'].includes(input.type)) Object.assign(update, { status: amount === claim.claimedAmountCents ? 'approved' : 'partially_approved',
      approvedAmountCents: amount, finalAmountCents: amount, upheldAt: claim.upheldAt || now, chefOwes: true });
    if (input.type === 'claim_reject' || input.type === 'claim_close') Object.assign(update, { status: input.type === 'claim_reject' ? 'rejected' : 'resolved',
      resolvedAt: now, resolvedBy: adminId, resolutionType: input.type === 'claim_reject' ? 'rejected' : 'closed', chefOwes: false });
    if (input.type === 'claim_release_hold') update.holdReleasedAt = now;
    if (input.type === 'claim_compensate') {
      const [manager] = await tx.select({ stripeAccountId: users.stripeAccountId }).from(users).where(eq(users.id, claim.managerId)).limit(1);
      if (!manager?.stripeAccountId) throw new DamageClaimError('The kitchen must finish payment setup first.');
      Object.assign(update, { approvedAmountCents: amount, finalAmountCents: amount, upheldAt: claim.upheldAt || now,
        chefOwes: input.chefStillOwes, fundedBy: 'local_cooks', status: input.chefStillOwes ? 'approved' : 'resolved',
        resolvedAt: input.chefStillOwes ? null : now, resolutionType: input.chefStillOwes ? null : 'write_off',
        compensationOperation: { key: `claim:${claim.id}:compensation`, state: 'pending', amountCents: amount,
          destination: manager.stripeAccountId, startedAt: now.toISOString() } });
    }
    const [action] = await tx.insert(supportActions).values({ bookingId, caseRef: claim.referenceCode || `#${claim.id}`,
      actionType: input.type, actorUserId: adminId, actingFor: 'local_cooks', requestSource: input.requestSource,
      reasonCode: input.reasonCode, internalNote: input.note, amountCents: amount || null, currency: 'CAD',
      fundedBy: input.type === 'claim_compensate' ? 'local_cooks' : 'none', operationKey: input.operationKey,
      status: input.type === 'claim_compensate' ? 'executing' : 'verified', beforeState: { claimId: claim.id, status: claim.status, inputHash: hash(input) },
      afterState: { ...update, publicMessage: input.publicMessage }, completedAt: input.type === 'claim_compensate' ? null : now }).returning();
    const [updated] = await tx.update(damageClaims).set(update).where(eq(damageClaims.id, claim.id)).returning();
    await claimHistory(tx, updated, updated.status, input.type, 'admin', adminId, input.publicMessage);
    return { action, claim: updated };
  });
  if (input.type === 'claim_compensate' && reserved.action.status !== 'verified') {
    try {
      const transfer = await (await import('./damage-claim-money')).sendClaimKitchenMoney(input.claimId, 'compensation', input.operationKey);
      await db.update(supportActions).set({ status: 'verified', providerRefs: { transferId: transfer.transferId }, error: null,
        completedAt: new Date() }).where(eq(supportActions.id, reserved.action.id));
    } catch (error) {
      await db.update(supportActions).set({ status: 'recovery_required', error: error instanceof Error ? error.message : 'Kitchen payment needs review' }).where(eq(supportActions.id, reserved.action.id));
      throw error;
    }
  }
  return { success: true, actionId: reserved.action.id };
}
