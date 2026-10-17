import { isCurrentVisit } from '@shared/dated-visits';
import { visitAttendanceEnd } from '@shared/booking-attendance';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, damageEvidence, damageClaimHistory, kitchenBookings, kitchenBookingVisits,
  storageBookings, storageListings, kitchens, locations, users, supportActions, platformSettings } from '@shared/schema';
import { approvedClaimAmount, claimFilingWindow, claimResponseDeadline, claimTotal, fileClaimInput,
  claimSupportInput, claimUpload, claimBookingHeld, validateClaimLines, type ClaimSupportInput } from '@shared/damage-claims';
import { occupancyRange, toDateRange, localToday, type RentalDates } from '@shared/storage-rental';
import { scheduleStorageTermPayout } from './storage-payouts';
import { recordedDepartureAt } from '@shared/clock-closeout';
import { generateReferenceCode } from '../reference-code';
import { workerAfter, workerPageEnd, workerRecord, isWorkerBudgetError, assertWorkerTime } from './worker-context';
import { assertBookingMoneyWritable } from './booking-money-guard';

export type ClaimTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Claim = typeof damageClaims.$inferSelect;
export class DamageClaimError extends Error { constructor(message: string, public status = 409, public code?: string) { super(message); } }
export type ClaimTarget = { kind: 'booking' | 'storage'; id: number };
export const claimBelongsTo = (claim: Pick<Claim, 'kitchenBookingId' | 'storageBookingId'>, target: ClaimTarget) =>
  target.kind === 'storage' ? claim.storageBookingId === target.id && !claim.kitchenBookingId : claim.kitchenBookingId === target.id && !claim.storageBookingId;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const chefCanSeeClaim = (claim: Claim) => !!claim.chefVisibleAt || claim.claimVersion === 1 && !!claim.submittedAt;
export async function damageClaimsReviewFirst(tx: ClaimTx = db as unknown as ClaimTx) {
  const [setting] = await tx.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, 'damageClaimsReviewFirst')).limit(1);
  return !['false', '0'].includes(String(setting?.value ?? 'true'));
}

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
  if (claim.storageBookingId) await scheduleStorageTermPayout(claim.storageBookingId, tx);
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
  if (row.booking.scheduleRevision && (!('bookingId' in visit) || !isCurrentVisit(row.booking, visit)))
    throw new DamageClaimError('Choose an active visit from the current booking schedule.');
  if (row.booking.scheduleRevision && !visitId) throw new DamageClaimError('Choose the affected visit.');
  const window = claimFilingWindow(visitAttendanceEnd({ ...row.booking, timezone: row.timezone }, visit), recordedDepartureAt(visit));
  return { ...row, visit, window };
}
async function storageClaimContext(rentalId: number, managerId: number, tx: ClaimTx) {
  const [row] = await tx.select({ booking: storageBookings, timezone: storageBookings.timezone,
    managerId: locations.managerId, locationId: locations.id, kitchenName: kitchens.name }).from(storageBookings)
    .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageBookings.id, rentalId)).limit(1);
  if (!row?.booking.rentalState || !row.booking.chefId || row.managerId !== managerId) throw new DamageClaimError('Storage rental not found.', 404, 'not_found');
  if (!row.timezone || !row.booking.checkoutRequestedAt || !['move_out_requested', 'ended', 'active'].includes(row.booking.rentalState)
    || row.booking.rentalState === 'active' && !row.booking.reopenedFrom) throw new DamageClaimError('Request move-out before reporting damage.', 409, 'claim_move_out_required');
  const movedOut = row.booking.reopenedFrom || row.booking.checkoutRequestedAt;
  const window = claimFilingWindow(movedOut, null);
  const photos = (value: unknown) => Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string') : [];
  const before = [...photos(row.booking.checkinPhotoUrls), ...photos(row.booking.handoverPhotoUrls)];
  const noBaseline = photos(row.booking.checkinPhotoUrls).length === 0;
  return { ...row, timezone: row.timezone, window, visit: { ...row.booking, checkinPhotoUrls: before, noBaseline,
    checkinNotes: row.booking.checkinNotes } };
}
export async function readStorageClaimFilingContext(rentalId: number, managerId: number) {
  const ctx = await storageClaimContext(rentalId, managerId, db as unknown as ClaimTx);
  return { allowed: ctx.window.allowed, deadline: ctx.window.deadline.toISOString(), endedAt: ctx.window.endedAt.toISOString(),
    timezone: ctx.timezone, kitchenName: ctx.kitchenName, before: ctx.visit.checkinPhotoUrls, after: ctx.visit.checkoutPhotoUrls || [],
    noBaseline: ctx.visit.noBaseline, baselineNote: ctx.visit.noBaseline ? 'No move-in photos were taken.' : null };
}
export async function readClaimFilingContext(bookingId: number, managerId: number, visitId?: number) {
  const ctx = await bookingContext(bookingId, managerId, visitId, db as unknown as ClaimTx);
  return { allowed: ctx.window.allowed, deadline: ctx.window.deadline.toISOString(), endedAt: ctx.window.endedAt.toISOString(),
    timezone: ctx.timezone, kitchenName: ctx.kitchenName, before: ctx.visit.checkinPhotoUrls || [], after: ctx.visit.checkoutPhotoUrls || [] };
}
export async function fileDamageClaim(managerId: number, raw: unknown) {
  const parsed = fileClaimInput.safeParse(raw);
  if (!parsed.success) throw new DamageClaimError('Describe what happened and add a receipt, invoice or quote to every cost line.', 400);
  const input = parsed.data;
  if (claimTotal(input.lines) > 25000) throw new DamageClaimError('For amounts over $250, Local Cooks handles it with you.', 400);
  const lines = validateClaimLines(input.lines), amount = claimTotal(lines);
  const target: ClaimTarget = { kind: input.storageRentalId ? 'storage' : 'booking', id: (input.storageRentalId || input.bookingId)! };
  return db.transaction(async tx => {
    await tx.execute(target.kind === 'storage' ? sql`SELECT id FROM storage_bookings WHERE id = ${target.id} FOR UPDATE`
      : sql`SELECT id FROM kitchen_bookings WHERE id = ${target.id} FOR UPDATE`);
    const [existing] = await tx.select().from(damageClaims).where(and(eq(damageClaims.managerId, managerId), eq(damageClaims.requestKey, input.requestKey))).limit(1);
    if (existing) {
      if (!claimBelongsTo(existing, target) || hash(validateClaimLines(existing.costLines)) !== hash(lines) || existing.claimDescription !== input.description
        || (input.visitId !== undefined && existing.kitchenBookingVisitId !== input.visitId)) throw new DamageClaimError('This filing key belongs to different claim details.');
      return publicClaim(existing, tx);
    }
    const ctx = input.storageRentalId ? await storageClaimContext(input.storageRentalId, managerId, tx) : await bookingContext(input.bookingId!, managerId, input.visitId, tx);
    if (!ctx.window.allowed) throw new DamageClaimError('Report within 72 hours of leaving the kitchen. Contact Local Cooks for help.', 409, input.storageRentalId ? 'claim_window_closed' : undefined);
    // One claim per visit keeps the $250 cap meaningful (no splitting); further costs go through Local Cooks.
    const visitKey = 'bookingId' in ctx.visit ? ctx.visit.id : null;
    const [earlier] = await tx.select({ id: damageClaims.id }).from(damageClaims).where(and(target.kind === 'storage' ? eq(damageClaims.storageBookingId, target.id) : eq(damageClaims.kitchenBookingId, target.id),
      ...(target.kind === 'storage' ? [sql`${damageClaims.submittedAt} >= ${ctx.booking.checkoutRequestedAt}`] : []),
      eq(damageClaims.claimVersion, 2), sql`${damageClaims.status} <> 'draft'`,
      visitKey === null ? sql`${damageClaims.kitchenBookingVisitId} IS NULL` : eq(damageClaims.kitchenBookingVisitId, visitKey))).limit(1);
    if (earlier) throw new DamageClaimError('You already reported this visit. Contact Local Cooks to add more costs.', 409);
    const now = new Date();
    const reviewFirst = target.kind === 'storage' || await damageClaimsReviewFirst(tx);
    const photos = (value: unknown) => Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string') : [];
    const visitEvidence = { before: photos(ctx.visit.checkinPhotoUrls), after: photos(ctx.visit.checkoutPhotoUrls),
      checkinNotes: ctx.visit.checkinNotes, checkoutNotes: ctx.visit.checkoutNotes, endedAt: ctx.window.endedAt.toISOString(),
      timezone: ctx.timezone, kitchenName: ctx.kitchenName, highlighted: input.selectedPhotoUrls,
      ...(target.kind === 'storage' ? { noBaseline: 'noBaseline' in ctx.visit && ctx.visit.noBaseline, baselineNote: 'noBaseline' in ctx.visit && ctx.visit.noBaseline ? 'No move-in photos were taken.' : undefined } : {}) };
    if (input.selectedPhotoUrls.some(url => ![...visitEvidence.before, ...visitEvidence.after].includes(url)))
      throw new DamageClaimError('Choose photos attached to this visit.', 400);
    const [claim] = await tx.insert(damageClaims).values({ referenceCode: await generateReferenceCode('damage_claim', tx), claimVersion: 2,
      requestKey: input.requestKey, bookingType: target.kind === 'storage' ? 'storage' : 'kitchen', kitchenBookingId: input.bookingId ?? null, storageBookingId: input.storageRentalId ?? null,
      kitchenBookingVisitId: 'bookingId' in ctx.visit ? ctx.visit.id : null, managerId, chefId: ctx.booking.chefId!, locationId: ctx.locationId,
      claimTitle: lines.every(line => line.type === 'extra_cleaning') ? 'Extra cleaning' : 'Damage and cleaning',
      claimDescription: input.description, damageDate: ctx.window.endedAt.toISOString().slice(0, 10), status: reviewFirst ? 'in_review' : 'submitted',
      chefVisibleAt: reviewFirst ? null : now,
      claimedAmountCents: amount, finalAmountCents: amount, costLines: lines, visitEvidence,
      chefResponseDeadline: claimResponseDeadline(now), submittedAt: now, createdAt: now, updatedAt: now }).returning();
    const evidence = [ ...visitEvidence.before.map(fileUrl => ({ fileUrl, evidenceType: 'photo_before' as const })),
      ...visitEvidence.after.map(fileUrl => ({ fileUrl, evidenceType: 'photo_after' as const })),
      ...input.photos.map(photo => ({ ...photo, evidenceType: 'photo_after' as const })),
      ...lines.map(line => ({ ...line.document, description: line.description, amountCents: line.amountCents, evidenceType: 'invoice' as const })) ];
    if (evidence.length) await tx.insert(damageEvidence).values(evidence.map(item => ({ ...item, uploadedBy: managerId, damageClaimId: claim.id })));
    if (input.storageRentalId) {
      const rental = ctx.booking as typeof storageBookings.$inferSelect;
      const releasedOn = rental.releasedOn || localToday(now, ctx.timezone);
      const needsCleaning = rental.needsCleaning || !!rental.reopenedFrom;
      const range = occupancyRange({ ...rental, rentalState: 'ended', releasedOn, needsCleaning } as RentalDates);
      await tx.update(storageBookings).set({ rentalState: 'ended', endReason: 'claim', releasedOn, needsCleaning,
        occupancy: range ? toDateRange(range) : null, checkoutApprovedAt: rental.checkoutApprovedAt || now,
        checkoutStatus: 'checkout_claim_filed', status: 'completed', updatedAt: now }).where(eq(storageBookings.id, input.storageRentalId));
    }
    await claimHistory(tx, claim, claim.status, 'submitted', 'manager', managerId);
    return publicClaim(claim, tx);
  });
}
/** First-review admin messages and the kitchen's replies are between Local Cooks and the kitchen only. */
export const kitchenOnlyClaimActions = ['claim_send', 'claim_ask_info', 'claim_close'];
/** No provider/customer identifiers or internal notes cross party APIs. The chef audience never sees first-review exchanges. */
export async function publicClaim(claim: Claim, tx: ClaimTx = db as unknown as ClaimTx, audience: 'kitchen' | 'chef' = 'kitchen') {
  const evidence = await tx.select({ id: damageEvidence.id, evidenceType: damageEvidence.evidenceType, fileUrl: damageEvidence.fileUrl,
    fileName: damageEvidence.fileName, uploadedBy: damageEvidence.uploadedBy, description: damageEvidence.description, createdAt: damageEvidence.createdAt })
    .from(damageEvidence).where(eq(damageEvidence.damageClaimId, claim.id)).orderBy(asc(damageEvidence.id));
  const history = await tx.select({ id: damageClaimHistory.id, action: damageClaimHistory.action, status: damageClaimHistory.newStatus,
    createdAt: damageClaimHistory.createdAt, actionBy: damageClaimHistory.actionBy }).from(damageClaimHistory)
    .where(eq(damageClaimHistory.damageClaimId, claim.id)).orderBy(asc(damageClaimHistory.id));
  const chef = audience === 'chef', lastAdmin = history.filter(row => row.actionBy === 'admin' && row.action.startsWith('claim_')).at(-1);
  // Reply evidence and its history row use the same PostgreSQL transaction timestamp (including old replies).
  const replyTimes = new Set(history.filter(row => row.action === 'kitchen_reply').map(row => row.createdAt.getTime()));
  const publicEvidence = evidence.map(({ createdAt, ...row }) => {
    const fromKitchenReply = row.uploadedBy === claim.managerId && replyTimes.has(createdAt.getTime());
    return { ...row, fromKitchenReply, description: chef && fromKitchenReply ? null : row.description };
  });
  const publicMessage = chef && (!lastAdmin || kitchenOnlyClaimActions.includes(lastAdmin.action)) ? null : claim.adminDecisionReason;
  const sentIndex = history.findIndex(row => row.action === 'claim_send');
  const visibleHistory = !chef || claim.claimVersion !== 2 ? history : sentIndex >= 0 ? history.slice(sentIndex)
    : history.filter(row => claim.chefVisibleAt && row.createdAt >= claim.chefVisibleAt);
  return { id: claim.id, referenceCode: claim.referenceCode, bookingId: claim.kitchenBookingId, storageRentalId: claim.storageBookingId, visitId: claim.kitchenBookingVisitId,
    chefId: claim.chefId, managerId: claim.managerId, status: claim.status, claimVersion: claim.claimVersion,
    createdAt: claim.createdAt, claimTitle: claim.claimTitle,
    description: claim.claimDescription, amountCents: claim.finalAmountCents ?? claim.claimedAmountCents, claimedAmountCents: claim.claimedAmountCents,
    lines: claim.costLines, visitEvidence: claim.visitEvidence, chefResponse: claim.chefResponse,
    deadline: claim.chefResponseDeadline, upheldAt: claim.upheldAt, publicMessage,
    kitchenPaid: claim.transferOperation?.state === 'succeeded' || claim.compensationOperation?.state === 'succeeded',
    kitchenPaymentPending: !!claim.chargeSucceededAt && claim.fundedBy !== 'local_cooks' && claim.transferOperation?.state !== 'succeeded',
    fundedBy: claim.fundedBy, chefOwes: claim.chefOwes, holdReleasedAt: claim.holdReleasedAt,
    chefVisible: chefCanSeeClaim(claim), reviewRequest: chef ? null : claim.reviewRequest, kitchenReply: chef ? null : claim.kitchenReply,
    paymentBusy: !!claim.paymentOperation && !['cancelled', 'succeeded'].includes(claim.paymentOperation.state),
    compensationPending: claim.compensationOperation?.state === 'pending', withdrawalPending: claim.withdrawalOperation?.state === 'pending',
    resolutionType: claim.resolutionType, evidence: publicEvidence, history: visibleHistory.map(({ actionBy: _actionBy, ...row }) => row) };
}
export async function readManagerClaims(managerId: number) {
  const claims = await db.select().from(damageClaims).where(eq(damageClaims.managerId, managerId)).orderBy(desc(damageClaims.id)).limit(100);
  return { claims: await Promise.all(claims.map(claim => publicClaim(claim))) };
}
export async function readBookingClaims(bookingId: number, actor: { id: number; role: string | null }, kind: 'booking' | 'storage' = 'booking') {
  let kitchenParticipant = actor.role === 'admin';
  if (actor.role !== 'admin') {
    const [row] = kind === 'storage' ? await db.select({ chefId: storageBookings.chefId, managerId: locations.managerId }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageBookings.id, bookingId)).limit(1)
      : await db.select({ chefId: kitchenBookings.chefId, managerId: locations.managerId }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!row || row.managerId !== actor.id && row.chefId !== actor.id) throw new DamageClaimError('Booking not found.', 404);
    kitchenParticipant = row.managerId === actor.id;
  }
  const claims = await db.select().from(damageClaims).where(and(kind === 'storage' ? eq(damageClaims.storageBookingId, bookingId) : eq(damageClaims.kitchenBookingId, bookingId), sql`${damageClaims.status} <> 'draft'`))
    .orderBy(desc(damageClaims.id)).limit(50);
  return { claims: await Promise.all(claims.filter(claim => kitchenParticipant || chefCanSeeClaim(claim)).map(async claim => ({
    ...await publicClaim(claim, undefined, kitchenParticipant ? 'kitchen' : 'chef'),
    // Local Cooks only: a chef payment held for review, so support can start it over.
    ...(actor.role === 'admin' ? { paymentReview: claimPaymentReview(claim) } : {}) }))) };
}
export async function readChefClaims(chefId: number) {
  const claims = await db.select().from(damageClaims).where(and(eq(damageClaims.chefId, chefId), sql`${damageClaims.status} <> 'draft'`))
    .orderBy(desc(damageClaims.id)).limit(100);
  return { claims: await Promise.all(claims.filter(chefCanSeeClaim).map(claim => publicClaim(claim, undefined, 'chef'))) };
}
export async function replyToClaimReview(id: number, managerId: number, raw: unknown) {
  const parsed = z.object({ note: z.string().trim().min(10).max(2000), files: z.array(claimUpload).max(10).default([]) }).strict().safeParse(raw);
  if (!parsed.success) throw new DamageClaimError('Reply to Local Cooks with a note and any requested documents.', 400);
  return db.transaction(async tx => {
    const claim = await lockClaim(id, tx);
    if (claim.managerId !== managerId) throw new DamageClaimError('Claim not found.', 404);
    if (claim.status !== 'awaiting_kitchen') throw new DamageClaimError('This claim is not waiting for kitchen information.');
    await tx.update(damageClaims).set({ status: 'in_review', kitchenReply: parsed.data.note, updatedAt: new Date() }).where(eq(damageClaims.id, id));
    if (parsed.data.files.length) await tx.insert(damageEvidence).values(parsed.data.files.map(file => ({ ...file, damageClaimId: id, uploadedBy: managerId,
      evidenceType: file.mimeType?.startsWith('image/') ? 'photo_after' as const : 'document' as const, description: null })));
    await claimHistory(tx, claim, 'in_review', 'kitchen_reply', 'manager', managerId);
    return { success: true };
  });
}
export async function disputeDamageClaim(claimId: number, chefId: number, raw: unknown) {
  const input = z.object({ note: z.string().trim().min(10).max(2000), photos: z.array(claimUpload).max(10).default([]) }).strict().safeParse(raw);
  if (!input.success) throw new DamageClaimError('Tell us why you disagree in at least 10 characters.', 400);
  await (await import('./damage-claim-money')).cancelClaimPayment(claimId, chefId);
  return db.transaction(async tx => {
    const claim = await lockClaim(claimId, tx);
    if (claim.chefId !== chefId) throw new DamageClaimError('Claim not found.', 404);
    if (!chefCanSeeClaim(claim)) throw new DamageClaimError('Claim not found.', 404);
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
  const rows = await db.select({ id: damageClaims.id, bookingId: damageClaims.kitchenBookingId, storageRentalId: damageClaims.storageBookingId, kitchenName: kitchens.name,
    amountCents: damageClaims.finalAmountCents }).from(damageClaims)
    .leftJoin(kitchenBookings, eq(kitchenBookings.id, damageClaims.kitchenBookingId))
    .leftJoin(storageBookings, eq(storageBookings.id, damageClaims.storageBookingId)).leftJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .leftJoin(kitchens, eq(kitchens.id, sql`COALESCE(${kitchenBookings.kitchenId}, ${storageListings.kitchenId})`))
    .where(and(eq(damageClaims.chefId, chefId), eq(damageClaims.chefOwes, true), isNull(damageClaims.holdReleasedAt),
      isNull(damageClaims.resolvedAt), isNull(damageClaims.chargeSucceededAt), lte(damageClaims.upheldAt, new Date(now.getTime() - 7 * 86400000)),
      sql`${damageClaims.status} NOT IN ('rejected','resolved','charge_succeeded','expired')`)).orderBy(asc(damageClaims.id)).limit(20);
  return { held: rows.length > 0, claims: rows };
}
/** The hold itself is computed live; this bounded sweep only sends the once-per-claim notice to both people. */
export async function notifyDamageClaimBookingHolds(now = new Date()) {
  assertWorkerTime();
  const due = await db.select().from(damageClaims).where(and(workerAfter('claimHolds', damageClaims.id), eq(damageClaims.chefOwes, true),
    isNull(damageClaims.holdReleasedAt), isNull(damageClaims.resolvedAt), isNull(damageClaims.chargeSucceededAt),
    isNull(damageClaims.bookingHoldNotifiedAt), lte(damageClaims.upheldAt, new Date(now.getTime() - 7 * 86400000))))
    .orderBy(asc(damageClaims.id)).limit(3);
  await workerPageEnd('claimHolds', due.length, 3);
  if (!due.length) return;
  for (const row of due) {
    await workerRecord('claimHolds', row.id);
    await db.transaction(async tx => {
      const claim = await lockClaim(row.id, tx);
      if (claim.bookingHoldNotifiedAt || !claimBookingHeld(claim, now)) return;
      await tx.update(damageClaims).set({ bookingHoldNotifiedAt: now }).where(eq(damageClaims.id, row.id));
      await claimHistory(tx, claim, claim.status, 'booking_hold_started', 'system');
    });
  }
}
export async function decideDamageClaim(bookingId: number, adminId: number, raw: unknown, kind: 'booking' | 'storage' = 'booking') {
  const parsed = claimSupportInput.safeParse(raw);
  if (!parsed.success) throw new DamageClaimError('Choose the action, reason, internal note and message for both people.', 400);
  const input = parsed.data;
  if (input.type === 'claim_restart_payment') return restartClaimPayment(bookingId, adminId, input, kind);
  if (input.type === 'claim_compensate') await cancelOpenChefPaymentForCompensation(bookingId, adminId, input, kind);
  const reserved = await db.transaction(async tx => {
    // Serialize support/claim money with flag writers using the same parent lock.
    await tx.execute(kind === 'storage' ? sql`SELECT id FROM storage_bookings WHERE id = ${bookingId} FOR UPDATE` : sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const claim = await lockClaim(input.claimId, tx);
    if (!claimBelongsTo(claim, { kind, id: bookingId })) throw new DamageClaimError('Claim does not belong to this booking.', 404);
    // Cancellation may have committed just before its audit acknowledgement was interrupted.
    if (input.type === 'claim_compensate' && claim.paymentOperation?.state === 'cancelled') await tx.execute(sql`
      UPDATE support_actions SET status = 'verified', completed_at = NOW(), error = NULL
      WHERE ${kind === 'storage' ? sql`storage_booking_id` : sql`booking_id`} = ${bookingId} AND action_type = 'claim_cancel_payment' AND status = 'executing'
        AND before_state->>'claimId' = ${String(claim.id)}`);
    const [old] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey)).limit(1);
    if (old) {
      if ((kind === 'storage' ? old.storageBookingId : old.bookingId) !== bookingId || old.actorUserId !== adminId || (old.beforeState as { inputHash?: string })?.inputHash !== hash(input))
        throw new DamageClaimError('This action key belongs to different details.');
      return { action: old, claim };
    }
    if (input.type === 'claim_withdraw' && claim.withdrawalOperation)
      throw new DamageClaimError('This withdrawal already has a saved decision. Recover its original support action.');
    if (input.type !== 'claim_withdraw' && claim.paymentOperation && !['cancelled', 'succeeded'].includes(claim.paymentOperation.state))
      throw new DamageClaimError('A chef payment is open. It must finish or be cancelled before changing the decision.');
    if (claim.compensationOperation?.state === 'pending') throw new DamageClaimError('The saved kitchen payment needs recovery before a new decision. Retry its original action.');
    if (input.type !== 'claim_withdraw' && (claim.chargeSucceededAt || claim.resolvedAt)) throw new DamageClaimError('This claim is already resolved.');
    const firstReview = !chefCanSeeClaim(claim);
    if (['claim_send', 'claim_ask_info'].includes(input.type) && (!firstReview || claim.status !== 'in_review'))
      throw new DamageClaimError('This action is available during the first Local Cooks review.');
    if (input.type === 'claim_reject' && firstReview) throw new DamageClaimError('Close this first-review claim with a reason for the kitchen.');
    if (['claim_uphold', 'claim_reduce'].includes(input.type) && claim.status !== 'under_review') throw new DamageClaimError('Review the chef response or wait for the response deadline before upholding.');
    const amount = ['claim_send', 'claim_uphold', 'claim_reduce', 'claim_compensate'].includes(input.type)
      ? approvedClaimAmount(firstReview ? claim.claimedAmountCents : claim.finalAmountCents ?? claim.claimedAmountCents,
        input.amountCents ?? (firstReview ? claim.claimedAmountCents : claim.finalAmountCents ?? claim.claimedAmountCents)) : 0;
    if (input.type === 'claim_compensate') {
      if (claim.compensationOperation || claim.transferOperation) throw new DamageClaimError('A kitchen payment is already recorded.');
      await assertBookingMoneyWritable({ ...(kind === 'storage' ? { storageRentalId: bookingId } : { bookingId }), operationKey: input.operationKey }, tx);
    }
    const now = new Date(), update: Partial<typeof damageClaims.$inferInsert> = { adminDecisionReason: input.publicMessage,
      adminNotes: input.note, adminReviewerId: adminId, adminReviewedAt: now, updatedAt: now };
    if (input.type === 'claim_send') Object.assign(update, { status: 'submitted', approvedAmountCents: amount, finalAmountCents: amount,
      chefVisibleAt: now, chefResponseDeadline: claimResponseDeadline(now) });
    if (input.type === 'claim_ask_info') Object.assign(update, { status: 'awaiting_kitchen', reviewRequest: input.publicMessage });
    if (['claim_uphold', 'claim_reduce'].includes(input.type)) Object.assign(update, { status: amount === claim.claimedAmountCents ? 'approved' : 'partially_approved',
      approvedAmountCents: amount, finalAmountCents: amount, upheldAt: claim.upheldAt || now, chefOwes: true });
    if (input.type === 'claim_reject' || input.type === 'claim_close') Object.assign(update, { status: input.type === 'claim_reject' ? 'rejected' : 'resolved',
      resolvedAt: now, resolvedBy: adminId, resolutionType: input.type === 'claim_reject' ? 'rejected' : 'closed', chefOwes: false });
    if (input.type === 'claim_release_hold') update.holdReleasedAt = now;
    if (input.type === 'claim_compensate') {
      const [manager] = await tx.select({ stripeAccountId: users.stripeConnectAccountId }).from(users).where(eq(users.id, claim.managerId)).limit(1);
      if (!manager?.stripeAccountId) throw new DamageClaimError('The kitchen must finish payment setup first.');
      Object.assign(update, { approvedAmountCents: amount, finalAmountCents: amount, upheldAt: claim.upheldAt || now,
        chefOwes: firstReview ? false : input.chefStillOwes, fundedBy: 'local_cooks', status: !firstReview && input.chefStillOwes ? 'approved' : 'resolved',
        resolvedAt: !firstReview && input.chefStillOwes ? null : now, resolutionType: !firstReview && input.chefStillOwes ? null : 'write_off',
        compensationOperation: { key: `claim:${claim.id}:compensation`, state: 'pending', amountCents: amount,
          destination: manager.stripeAccountId, startedAt: now.toISOString() } });
    }
    if (input.type === 'claim_withdraw') Object.assign(update, { status: 'resolved', resolvedAt: now, resolvedBy: adminId, chefOwes: false,
      resolutionType: 'withdrawn', withdrawalOperation: { key: `claim:${claim.id}:withdraw`, state: 'pending',
        intentId: claim.paymentOperation?.intentId, amountCents: claim.paymentOperation?.amountCents || 0, startedAt: now.toISOString() } });
    const [action] = await tx.insert(supportActions).values({ bookingId: kind === 'booking' ? bookingId : null, storageBookingId: kind === 'storage' ? bookingId : null, caseRef: claim.referenceCode || `#${claim.id}`,
      actionType: input.type, actorUserId: adminId, actingFor: 'local_cooks', requestSource: input.requestSource,
      reasonCode: input.reasonCode, internalNote: input.note, amountCents: amount || null, currency: 'CAD',
      fundedBy: ['claim_compensate', 'claim_withdraw'].includes(input.type) ? 'local_cooks' : 'none', operationKey: input.operationKey,
      status: ['claim_compensate', 'claim_withdraw'].includes(input.type) ? 'executing' : 'verified', beforeState: { claimId: claim.id, status: claim.status, inputHash: hash(input) },
      afterState: { ...update, publicMessage: input.publicMessage }, completedAt: ['claim_compensate', 'claim_withdraw'].includes(input.type) ? null : now }).returning();
    const [updated] = await tx.update(damageClaims).set(update).where(eq(damageClaims.id, claim.id)).returning();
    await claimHistory(tx, updated, updated.status, input.type, 'admin', adminId, input.publicMessage);
    return { action, claim: updated };
  });
  if (input.type === 'claim_withdraw' && reserved.action.status !== 'verified') {
    try {
      const result = await (await import('./damage-claim-money')).withdrawClaimMoney(input.claimId, input.operationKey);
      await db.update(supportActions).set({ status: 'verified', providerRefs: result, error: null, completedAt: new Date() }).where(eq(supportActions.id, reserved.action.id));
    } catch (error) {
      await db.update(supportActions).set({ status: 'recovery_required', error: error instanceof Error ? error.message : 'Withdrawal needs review' }).where(eq(supportActions.id, reserved.action.id));
      throw error;
    }
  }
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

/** Why a chef's claim payment is held for Local Cooks (an unmatched creation attempt), or null. Admin view only. */
export function claimPaymentReview(claim: Claim) {
  const op = claim.paymentOperation;
  return op && !op.intentId && op.error && !['cancelled', 'succeeded'].includes(op.state) ? op.error : null;
}

/**
 * "Start the payment over" for a chef payment held for review (no payment-provider match could be verified automatically).
 * The provider is asked again first: a found payment is attached (and settled if paid); a confirmed absence resets it. Only when the
 * check still can't decide does Local Cooks' own verification (checked in the provider, with a note) reset it. Audited.
 */
async function restartClaimPayment(bookingId: number, adminId: number, input: ClaimSupportInput, kind: 'booking' | 'storage') {
  const [claim] = await db.select().from(damageClaims).where(eq(damageClaims.id, input.claimId)).limit(1);
  if (!claim || !claimBelongsTo(claim, { kind, id: bookingId })) throw new DamageClaimError('Claim does not belong to this booking.', 404);
  // A retried submission returns what was already done (never acts twice).
  const [done] = await db.select().from(supportActions).where(eq(supportActions.operationKey, input.operationKey)).limit(1);
  if (done) {
    if ((kind === 'storage' ? done.storageBookingId : done.bookingId) !== bookingId || done.actorUserId !== adminId || done.actionType !== 'claim_restart_payment' || (done.beforeState as { inputHash?: string })?.inputHash !== hash(input))
      throw new DamageClaimError('This action key belongs to different details.');
    return { success: true, result: (done.beforeState as { result?: string }).result };
  }
  const op = claim.paymentOperation;
  if (!op || !claimPaymentReview(claim)) throw new DamageClaimError('This claim has no payment waiting for review.');
  const money = await import('./damage-claim-money');
  const outcome = await money.resolveStalledClaimCreation(claim.id, op, claim);
  let result: 'found' | 'reset' | 'verified_reset';
  if (outcome.kind !== 'review') result = outcome.kind;
  else {
    if (input.verifiedNoPayment !== true) throw new DamageClaimError(`We still can't verify it automatically: ${outcome.reason} Check the payment provider, then confirm no payment was taken.`);
    await db.transaction(async tx => {
      const current = await lockClaim(claim.id, tx);
      if (current.paymentOperation?.key !== op.key || current.paymentOperation.intentId) return;
      await tx.update(damageClaims).set({ paymentOperation: { ...current.paymentOperation, state: 'cancelled',
        error: 'Local Cooks checked the payment provider: no payment was taken. A new payment can start.' }, stripePaymentIntentId: null, updatedAt: new Date() })
        .where(eq(damageClaims.id, claim.id));
    });
    result = 'verified_reset';
  }
  await db.insert(supportActions).values({ bookingId: kind === 'booking' ? bookingId : null, storageBookingId: kind === 'storage' ? bookingId : null, caseRef: claim.referenceCode || `#${claim.id}`, actionType: 'claim_restart_payment',
    actorUserId: adminId, actingFor: 'local_cooks', requestSource: input.requestSource, reasonCode: input.reasonCode, internalNote: input.note,
    amountCents: op.amountCents, currency: 'CAD', fundedBy: 'none', operationKey: input.operationKey,
    beforeState: { claimId: claim.id, inputHash: hash(input), operationKey: op.key, result }, status: 'verified', completedAt: new Date() });
  // The chef hears Local Cooks' message: they can pay again (or that the earlier payment was found).
  if (claim.chefId) {
    const [chef] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, claim.chefId)).limit(1);
    const { ensureServerI18n, tLocale } = await import('../i18n');
    await ensureServerI18n();
    const t = (key: string) => tLocale(chef?.locale, key, { ns: 'booking' });
    await (await import('./notification.service')).notificationService.create({ userId: claim.chefId, target: 'chef', type: 'system_announcement',
      title: t(result === 'found' ? 'dcV2RestartFoundTitle' : 'dcV2RestartTitle'), message: input.publicMessage,
      actionUrl: kind === 'storage' ? `/storage/${bookingId}` : `/booking/${bookingId}`, actionLabel: t('dcV2View'), metadata: { damageClaimId: claim.id } });
  }
  return { success: true, result };
}

/** A kitchen compensation must not race an already opened chef payment. Reserve and audit cancellation first;
 * a processing/succeeded payment cannot be compensated again and is reconciled through its original intent. */
async function cancelOpenChefPaymentForCompensation(bookingId: number, adminId: number, input: ClaimSupportInput, kind: 'booking' | 'storage') {
  const cancellation = await db.transaction(async tx => {
    await tx.execute(kind === 'storage' ? sql`SELECT id FROM storage_bookings WHERE id = ${bookingId} FOR UPDATE` : sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const claim = await lockClaim(input.claimId, tx);
    if (!claimBelongsTo(claim, { kind, id: bookingId })) throw new DamageClaimError('Claim does not belong to this booking.', 404);
    if (!claim.paymentOperation || ['cancelled', 'succeeded'].includes(claim.paymentOperation.state) || claim.compensationOperation) return null;
    approvedClaimAmount(claim.finalAmountCents ?? claim.claimedAmountCents, input.amountCents);
    await assertBookingMoneyWritable({ ...(kind === 'storage' ? { storageRentalId: bookingId } : { bookingId }), operationKey: input.operationKey }, tx);
    const key = `claim_cancel:${hash(input.operationKey)}`;
    const [existing] = await tx.select().from(supportActions).where(eq(supportActions.operationKey, key)).limit(1);
    if (existing) {
      if ((existing.beforeState as { inputHash?: string }).inputHash !== hash(input)) throw new DamageClaimError('This cancellation belongs to another decision.');
      return { claim, actionId: existing.id };
    }
    const [action] = await tx.insert(supportActions).values({ bookingId: kind === 'booking' ? bookingId : null, storageBookingId: kind === 'storage' ? bookingId : null, caseRef: claim.referenceCode || `#${claim.id}`, actionType: 'claim_cancel_payment',
      actorUserId: adminId, actingFor: 'local_cooks', requestSource: input.requestSource, reasonCode: input.reasonCode, internalNote: input.note,
      amountCents: claim.paymentOperation.amountCents, currency: 'CAD', fundedBy: 'none', operationKey: key,
      beforeState: { claimId: claim.id, inputHash: hash(input) }, status: 'executing' }).returning();
    return { claim, actionId: action.id };
  });
  if (!cancellation) return;
  try {
    await (await import('./damage-claim-money')).cancelClaimPayment(cancellation.claim.id, cancellation.claim.chefId);
    await db.update(supportActions).set({ status: 'verified', completedAt: new Date(), error: null }).where(eq(supportActions.id, cancellation.actionId));
  } catch (error) {
    await db.update(supportActions).set({ status: 'failed', completedAt: new Date(), error: error instanceof Error ? error.message : 'Card cancellation needs review' })
      .where(eq(supportActions.id, cancellation.actionId));
    throw error;
  }
}
