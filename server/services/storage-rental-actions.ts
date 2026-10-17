/** Kitchen tools. Rental -> listing locks; provider work runs only after committing local intent. */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { kitchens, locations, storageBookings, storageListings, storageRentalTerms } from '@shared/schema';
import { addDays, extensionLimit, localToday, occupancyRange, reclaimRule, termPrice, toDateRange, unusedRefundSplit, type RentalDates } from '@shared/storage-rental';
import { freeUnit, StorageRentalError } from './storage-rentals';
import { previewStorageRefund, refundRentalUnused } from './storage-rental-money';
import { scheduleStorageTermPayout } from './storage-payouts';
import { queueStorageRentalNotice } from './storage-rental-notices';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { storageSettings } from './storage-settings';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;
export type StorageToolActor = { id: number; role: 'manager' | 'admin' };
const fail = (code: string, status = 409): never => { throw new StorageRentalError(code, status); };
const reasonSchema = z.string().trim().min(1).max(2000);
export const storageToolInput = z.object({ reason: reasonSchema.optional(), unitIndex: z.number().int().min(1).max(200).optional(),
  byDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.number().int().min(1).max(30).optional(),
  amountCents: z.number().int().positive().safe().optional(), operationKey: z.string().min(8).max(100).regex(/^[\w:-]+$/).optional(),
  emergency: z.boolean().optional(), fundedBy: z.enum(['kitchen', 'local_cooks']).optional() });
export type StorageToolInput = z.infer<typeof storageToolInput>;

export async function storageToolContext(reader: Reader, id: number, actor: StorageToolActor, lock = false) {
  const query = reader.select().from(storageBookings).where(eq(storageBookings.id, id));
  const [rental] = lock ? await query.for('update') : await query;
  if (!rental?.rentalState || !rental.rentalTerms || !rental.timezone || !rental.termStart || !rental.paidThrough) fail('not_found', 404);
  if (lock) await reader.select({ id: storageListings.id }).from(storageListings).where(eq(storageListings.id, rental.storageListingId)).for('update');
  const [place] = await reader.select({ listing: storageListings, managerId: locations.managerId }).from(storageListings)
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(storageListings.id, rental.storageListingId));
  if (!place || actor.role === 'manager' && place.managerId !== actor.id) fail('not_found', 404);
  return { rental, ...place };
}

async function paidTerms(reader: Reader, id: number) {
  return reader.select().from(storageRentalTerms).where(and(eq(storageRentalTerms.rentalId, id), eq(storageRentalTerms.status, 'paid')));
}
export function reclaimPreview(rental: Pick<RentalDates, 'termStart' | 'paidThrough'>, terms: Parameters<typeof unusedRefundSplit>[0], today: string, byDate: string, emergency = false) {
  try { addDays(byDate, 0); } catch { return fail('invalid_details', 400); }
  const rule = reclaimRule(rental, today, byDate);
  if (!rule.allowed && !(emergency && byDate >= today)) fail('reclaim_not_allowed');
  const shares = unusedRefundSplit(terms, addDays(byDate, 1));
  return { ...rule, allowed: true, byDate, amountCents: shares.reduce((sum, part) => sum + part.customer, 0), shares };
}
export async function previewStorageTool(id: number, actor: StorageToolActor, action: string, input: StorageToolInput, reader: Reader = db, now = new Date()) {
  const { rental, listing } = await storageToolContext(reader, id, actor);
  const today = localToday(now, rental.timezone!);
  if (action === 'move-out-by') {
    if (!(actor.role === 'admin' ? ['reserved', 'active', 'move_out_requested', 'removal_review'] : ['reserved', 'active']).includes(rental.rentalState!)) fail('not_active');
    if (!input.byDate) fail('invalid_details', 400);
    return reclaimPreview(rental as RentalDates, await paidTerms(reader, id), today, input.byDate!, actor.role === 'admin' && input.emergency === true);
  }
  if (action === 'refund') {
    if (reader !== db) return fail('invalid_details', 400);
    const money = await previewStorageRefund(id);
    const cap = actor.role === 'admin' && input.fundedBy === 'local_cooks' ? money.customerCents : money.kitchenCents;
    if (input.amountCents != null && input.amountCents > cap) fail('refund_too_large');
    return { amountCents: input.amountCents ?? cap, maxAmountCents: cap, date: today };
  }
  if (action === 'offer-extension') {
    if (!input.days) fail('invalid_details', 400);
    const others = await reader.select().from(storageBookings).where(and(eq(storageBookings.storageListingId, listing.id), eq(storageBookings.unitIndex, rental.unitIndex!)));
    const nextReservationStart = others.filter(other => other.id !== id && other.occupancy && other.termStart! > rental.paidThrough!).map(other => other.termStart!).sort()[0] ?? null;
    const limit = extensionLimit(rental as RentalDates, today, { platformMaxDays: (await storageSettings(reader)).maxTermDays, listingMaxDays: listing.maxTermDays, nextReservationStart });
    if (input.days! > limit.maxDays) fail('not_extendable');
    const frozen = rental.rentalTerms as { dailyPriceCents: number; taxRatePercent: number };
    const price = await termPrice({ days: input.days!, ...frozen, serviceFee: async (subtotal, tax) => (await calculateCheckoutFeesAsync(subtotal, { taxAmountCents: tax }, reader)).platformCommissionInCents });
    return { amountCents: price.totalCents, days: input.days!, date: addDays(rental.paidThrough!, input.days!) };
  }
  return fail('invalid_details', 400);
}

export async function runStorageTool(id: number, actor: StorageToolActor, action: 'change-unit' | 'move-out-by' | 'offer-extension' | 'release' | 'refund', raw: StorageToolInput, now = new Date()) {
  const input = storageToolInput.parse(raw);
  if (action !== 'offer-extension') reasonSchema.parse(input.reason);
  const operationKey = input.operationKey ?? `tool:${randomUUID()}`;
  // Retrying a failed provider call must reuse the same reference.
  if ((action === 'refund' || action === 'move-out-by') && !input.operationKey) fail('invalid_details', 400);
  let refundPreview: Awaited<ReturnType<typeof previewStorageTool>> | undefined;
  if (action === 'refund') {
    const { rental } = await storageToolContext(db, id, actor);
    if (!(rental.assistanceHistory as any[]).some(entry => entry.operationKey === operationKey)) refundPreview = await previewStorageTool(id, actor, action, input, db, now);
  }
  const prepared = await db.transaction(async tx => {
    const { rental, listing } = await storageToolContext(tx, id, actor, true);
    const history = Array.isArray(rental.assistanceHistory) ? rental.assistanceHistory : [];
    const previous = history.find((entry: any) => entry.operationKey === operationKey);
    const fingerprint = JSON.stringify({ action, actorId: actor.id, ...input });
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('operation_changed');
      return previous as { preview: any; complete?: boolean };
    }
    const terms = await tx.select().from(storageRentalTerms).where(eq(storageRentalTerms.rentalId, id));
    if (terms.some(term => ['awaiting_payment', 'authorized'].includes(term.status)) || (rental.reclaim as any)?.pending) fail('decision_pending');
    const update: Partial<typeof storageBookings.$inferInsert> = { updatedAt: now };
    let preview: any = null;
    if (action === 'refund') {
      await assertBookingMoneyWritable({ storageRentalId: id, operationKey }, tx);
      preview = refundPreview;
      if (!input.amountCents) fail('invalid_details', 400);
    } else if (action === 'offer-extension') {
      preview = await previewStorageTool(id, actor, action, input, tx, now);
      await queueStorageRentalNotice(tx, id, 'offer_extension', { eventKey: operationKey, days: input.days, amountCents: preview.amountCents, endOn: preview.date });
    } else {
      if (!['reserved', 'active', 'move_out_requested', 'removal_review'].includes(rental.rentalState!)) fail('not_active');
      if (action === 'change-unit') {
        if (!input.unitIndex || input.unitIndex === rental.unitIndex) fail('invalid_details', 400);
        if (!await freeUnit(tx, listing.id, listing.unitCount, rental as RentalDates, localToday(now, rental.timezone!), id, input.unitIndex)) fail('full');
        update.unitIndex = input.unitIndex;
      }
      if (action === 'release') {
        // A release confirms an empty unit. Occupied rentals must use the move-out / removal evidence flow.
        const noShow = rental.rentalState === 'reserved' && !rental.checkinCompletedAt && localToday(now, rental.timezone!) >= addDays(rental.termStart!, 7);
        if (rental.rentalState !== 'move_out_requested' && !noShow) fail('visit_action_invalid');
        Object.assign(update, { rentalState: 'ended', endReason: 'cleared', status: 'completed', checkoutStatus: 'completed',
          checkoutApprovedAt: now, checkoutApprovedBy: actor.id, releasedOn: localToday(now, rental.timezone!), needsCleaning: false });
        const range = occupancyRange({ ...rental, ...update } as RentalDates);
        update.occupancy = range ? toDateRange(range) : null;
        await queueStorageRentalNotice(tx, id, 'cleared', { eventKey: operationKey, date: now });
      }
      if (action === 'move-out-by') {
        await assertBookingMoneyWritable({ storageRentalId: id, operationKey }, tx);
        preview = await previewStorageTool(id, actor, action, input, tx, now);
        if (rental.reclaimEndOn) fail('reclaim_already_served');
        // Keep the old occupancy until the refund succeeds; the reclaim date caps extensions immediately.
        update.reclaimEndOn = input.byDate;
        update.reclaim = { byDate: input.byDate, reason: input.reason, actorId: actor.id, operationKey, pending: preview.amountCents > 0 };
      }
    }
    update.assistanceHistory = [...history, { action, actorId: actor.id, reason: input.reason, operationKey, fingerprint, preview,
      actorRole: actor.role, recordedAt: now.toISOString(), complete: !['refund', 'move-out-by'].includes(action) }];
    await tx.update(storageBookings).set(update).where(eq(storageBookings.id, id));
    if (action === 'release') await scheduleStorageTermPayout(id, tx, now);
    return { preview, complete: !['refund', 'move-out-by'].includes(action) };
  });
  if (prepared.complete) return { success: true, ...prepared.preview };
  let refunds;
  if (action === 'refund' || action === 'move-out-by' && prepared.preview.amountCents > 0) {
    refunds = await refundRentalUnused(id, { actorId: actor.id, operationKey,
      cause: action === 'refund' ? actor.role === 'admin' && input.fundedBy === 'local_cooks' ? 'goodwill_lc' : 'goodwill_kitchen'
        : actor.role === 'admin' && input.fundedBy === 'local_cooks' ? 'local_cooks' : 'kitchen',
      ...(action === 'refund' ? { amountCents: input.amountCents } : { fromDate: addDays(input.byDate!, 1) }) });
    if (refunds.refunds.some(row => row.status !== 'succeeded')) return { success: false, recoveryRequired: true };
  }
  await db.transaction(async tx => {
    const { rental } = await storageToolContext(tx, id, actor, true);
    const history = rental.assistanceHistory as any[];
    if (history.find(entry => entry.operationKey === operationKey)?.complete) return;
    const update: Partial<typeof storageBookings.$inferInsert> = { assistanceHistory: history.map(entry => entry.operationKey === operationKey ? { ...entry, complete: true } : entry) };
    if (action === 'move-out-by') {
      update.reclaim = { ...(rental.reclaim as object), pending: false };
      const range = occupancyRange({ ...rental, reclaim: update.reclaim } as RentalDates, localToday(now, rental.timezone!));
      update.occupancy = range ? toDateRange(range) : null;
      await queueStorageRentalNotice(tx, id, 'reclaim', { eventKey: operationKey, byDate: input.byDate, amountCents: prepared.preview.amountCents });
    }
    await tx.update(storageBookings).set(update).where(eq(storageBookings.id, id));
  });
  return { success: true, ...prepared.preview };
}

export async function setStorageUnitService(listingId: number, managerId: number, unitIndex: number, outOfService: boolean, reason: string, now = new Date()) {
  reasonSchema.parse(reason);
  return db.transaction(async tx => {
    const [listing] = await tx.select().from(storageListings).where(eq(storageListings.id, listingId)).for('update');
    const [place] = listing ? await tx.select({ managerId: locations.managerId }).from(kitchens).innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, listing.kitchenId)) : [];
    if (!listing || place?.managerId !== managerId) fail('not_found', 404);
    if (!Number.isSafeInteger(unitIndex) || unitIndex < 1 || unitIndex > listing.unitCount) fail('invalid_details', 400);
    const units = { ...listing.outOfServiceUnits };
    if (outOfService) units[String(unitIndex)] = { reason: reason.trim(), actorId: managerId, at: now.toISOString() };
    else delete units[String(unitIndex)];
    await tx.update(storageListings).set({ outOfServiceUnits: units, unitServiceHistory: [...(Array.isArray(listing.unitServiceHistory) ? listing.unitServiceHistory : []),
      { unitIndex, outOfService, actorId: managerId, reason: reason.trim(), at: now.toISOString() }] }).where(eq(storageListings.id, listingId));
    return { success: true, outOfServiceUnits: units };
  });
}
