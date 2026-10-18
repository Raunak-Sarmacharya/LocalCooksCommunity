import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { paymentTransactions, kitchenBookings, kitchenBookingVisits, kitchenBookingDayAllocations,
  kitchenBookingDayPayouts, kitchens, locations, users, storageBookings, storageListings, storageRentalTerms,
  equipmentBookings, equipmentListings, damageClaims, damageClaimHistory, paymentHistory } from '@shared/schema';
import type { RevenueDay, RevenueType } from '@shared/manager-revenue';
import { attachKitchenPayouts } from './kitchen-payout-service';
import { projectBookingCloseouts } from './clock-closeout';
import { readDayPayouts } from './kitchen-day-payouts';
import { storageTermPayout, storageTermPayoutFacts } from './storage-payouts';
import { assertBookingMoneyWritable, BookingMoneyFrozen } from './booking-money-guard';
import { buildManagerRevenue, revenueLocalDate, type LedgerPayment } from './manager-revenue-ledger';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const revenueQuery = z.object({ startDate: date, endDate: date,
  locationId: z.coerce.number().int().positive().optional(), kitchenId: z.coerce.number().int().positive().optional(),
}).refine(v => v.startDate <= v.endDate && Date.parse(v.endDate) - Date.parse(v.startDate) <= 1096 * 86400000,
  'Choose a date range of up to three years');
export type RevenueQuery = z.infer<typeof revenueQuery>;

/** Use the claim transfer's existing read-only freeze check, without attempting or scheduling any money operation. */
async function claimPayoutHold(bookingId: number | null, rentalId: number | null, operationKey?: string) {
  try { await assertBookingMoneyWritable({ ...(rentalId ? { storageRentalId: rentalId } : { bookingId: bookingId! }), operationKey }); return null; }
  catch (error) { if (error instanceof BookingMoneyFrozen) return 'support_flag'; throw error; }
}

/** Manager ownership is checked on the location on every read, including filters and compensation transfers. */
export async function readManagerRevenue(managerId: number, query: RevenueQuery) {
  const owned = await db.select({ id: kitchens.id, name: kitchens.name, locationId: locations.id,
    locationName: locations.name }).from(kitchens).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(locations.managerId, managerId));
  const filters = { kitchens: owned.map(k => ({ id: k.id, name: k.name, locationId: k.locationId })),
    locations: [...new Map(owned.map(k => [k.locationId, { id: k.locationId, name: k.locationName }])).values()] };
  const allowed = owned.filter(k => (!query.locationId || k.locationId === query.locationId) && (!query.kitchenId || k.id === query.kitchenId));
  if (!allowed.length) return buildManagerRevenue([], [], [], query, filters);
  const rows = await db.select({ source: paymentTransactions, booking: kitchenBookings, rental: storageBookings,
    equipmentBooking: equipmentBookings, term: storageRentalTerms, kitchen: kitchens, location: locations,
    chefName: users.fullName, claim: damageClaims,
    claimPaidAt: sql`(SELECT MAX(h.created_at) FROM damage_claim_history h WHERE h.damage_claim_id = ${damageClaims.id} AND h.action = 'kitchen_paid')`.mapWith(damageClaimHistory.createdAt),
    equipmentCents: sql<number>`COALESCE((SELECT SUM(e.total_price::numeric) FROM equipment_bookings e WHERE e.kitchen_booking_id = ${kitchenBookings.id}
      AND e.payment_intent_id = ${paymentTransactions.paymentIntentId}), 0)`,
    storageCents: sql<number>`COALESCE((SELECT SUM(s.total_price::numeric) FROM storage_bookings s WHERE s.kitchen_booking_id = ${kitchenBookings.id}
      AND s.payment_intent_id = ${paymentTransactions.paymentIntentId}), 0)`,
  }).from(paymentTransactions)
    .leftJoin(kitchenBookings, and(inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(kitchenBookings.id, paymentTransactions.bookingId)))
    .leftJoin(storageBookings, and(eq(paymentTransactions.bookingType, 'storage'), eq(storageBookings.id, paymentTransactions.bookingId)))
    .leftJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .leftJoin(equipmentBookings, and(eq(paymentTransactions.bookingType, 'equipment'), eq(equipmentBookings.id, paymentTransactions.bookingId)))
    .leftJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId))
    .innerJoin(kitchens, sql`${kitchens.id} = COALESCE(${kitchenBookings.kitchenId}, ${storageListings.kitchenId}, ${equipmentListings.kitchenId})`)
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .leftJoin(users, eq(users.id, paymentTransactions.chefId))
    .leftJoin(storageRentalTerms, eq(storageRentalTerms.paymentTransactionId, paymentTransactions.id))
    .leftJoin(damageClaims, eq(damageClaims.paymentTransactionId, paymentTransactions.id))
    .where(and(eq(locations.managerId, managerId), inArray(kitchens.id, allowed.map(k => k.id)),
      inArray(paymentTransactions.status, ['succeeded', 'partially_refunded', 'refunded']),
      sql`COALESCE(${paymentTransactions.metadata}->>'platformRecovery', 'false') <> 'true'`)).orderBy(asc(paymentTransactions.id));
  const bookingIds = [...new Set(rows.filter(r => r.booking).map(r => r.booking!.id))];
  const sourceIds = rows.map(r => r.source.id);
  const [visits, allocations, rawDays, liveDays, projected, transferHistory] = await Promise.all([
    bookingIds.length ? db.select().from(kitchenBookingVisits).where(inArray(kitchenBookingVisits.bookingId, bookingIds)) : [],
    sourceIds.length ? db.select().from(kitchenBookingDayAllocations).where(inArray(kitchenBookingDayAllocations.sourceId, sourceIds)) : [],
    sourceIds.length ? db.select().from(kitchenBookingDayPayouts).where(inArray(kitchenBookingDayPayouts.sourceId, sourceIds)) : [],
    readDayPayouts(bookingIds),
    projectBookingCloseouts([...new Map(rows.filter(r => r.booking).map(r => [r.booking!.id, r.booking!])).values()]).then(attachKitchenPayouts),
    sourceIds.length ? db.select().from(paymentHistory).where(and(inArray(paymentHistory.transactionId, sourceIds),
      or(eq(paymentHistory.eventType, 'payout_transfer_verified'), sql`${paymentHistory.eventType} ILIKE '%refund%'`))).orderBy(asc(paymentHistory.id)) : [],
  ]);
  const dayFor = (bookingId: number, visitId?: number | null, fallback?: string): RevenueDay => {
    const target = visits.find(v => v.bookingId === bookingId && v.id === visitId);
    const own = visits.filter(v => v.bookingId === bookingId && (target ? v.scheduleRevision === target.scheduleRevision : v.scheduleState !== 'superseded'));
    const dates = [...new Set(own.map(v => v.visitDate || fallback).filter((d): d is string => !!d))].sort();
    const date = target?.visitDate || fallback || dates[0] || '';
    return { number: Math.max(0, dates.indexOf(date)) + 1, total: Math.max(1, dates.length), date };
  };
  const payments: LedgerPayment[] = await Promise.all(rows.map(async r => {
    const m = (r.source.metadata || {}) as Record<string, any>;
    const type: RevenueType = r.claim || m.type === 'damage_claim' || m.damage_claim_id ? 'claim'
      : m.sessionExtensionId || m.type === 'session_extension' || m.type === 'overstay_penalty' ? 'extra_time'
      : r.source.bookingType === 'storage' ? 'storage' : 'kitchen_time';
    const timezone = r.location.timezone || 'America/St_Johns';
    const bookingId = r.equipmentBooking?.kitchenBookingId || r.source.bookingId;
    const fallback = r.booking?.bookingDate || r.rental?.startDate || r.equipmentBooking?.startDate || r.source.paidAt || r.source.createdAt;
    const day = dayFor(bookingId, r.claim?.kitchenBookingVisitId || Number(m.visitId) || null, r.term?.startsOn || revenueLocalDate(fallback, timezone));
    let payout: LedgerPayment['payout'] = type !== 'claim' && (r.booking || r.equipmentBooking) ? projected.find(b => b.id === bookingId)?.payout : undefined;
    if (r.rental && r.term?.paidAt) {
      const live = storageTermPayout(r.term, r.rental, await storageTermPayoutFacts(r.rental.id));
      payout = { status: live.holdReason ? 'on_hold' : 'scheduled',
        holdReason: live.holdReason, expectedAt: live.eligibleAt.toISOString() };
    }
    if (type === 'claim' && !r.source.transferId) {
      const holdReason = await claimPayoutHold(r.rental ? null : bookingId, r.rental?.id || null, r.claim?.transferOperation?.key);
      payout = { status: holdReason ? 'on_hold' : 'scheduled', holdReason, expectedAt: null };
    }
    const transfers = new Map<string, NonNullable<LedgerPayment['transfers']>[number]>();
    const refundDates: Record<string, string> = {};
    for (const event of transferHistory.filter(h => h.transactionId === r.source.id)) {
      const proof = event.metadata as { transferId?: string; originalAmountCents?: number; reversedCents?: number; refundId?: string; recoveredFromRefundId?: string } | null;
      const refundId = proof?.refundId || proof?.recoveredFromRefundId;
      if (refundId && !refundDates[refundId]) refundDates[refundId] = event.createdAt.toISOString();
      if (!proof?.transferId || !Number.isSafeInteger(proof.originalAmountCents)) continue;
      transfers.set(proof.transferId, { transferId: proof.transferId, originalAmountCents: proof.originalAmountCents!,
        reversedCents: Math.max(transfers.get(proof.transferId)?.reversedCents || 0, proof.reversedCents || 0),
        sentAt: transfers.get(proof.transferId)?.sentAt || event.createdAt.toISOString() });
    }
    if (r.source.transferId && !transfers.has(r.source.transferId)) transfers.set(r.source.transferId, {
      transferId: r.source.transferId, originalAmountCents: Number(m.payoutSent?.amountCents ?? m.transfer?.transferredCents ?? r.source.managerRevenue),
      reversedCents: Number(m.transfer?.reversedCents || 0), sentAt: r.claimPaidAt?.toISOString() || m.payoutSent?.sentAt || m.transfer?.transferredAt
        || (r.source.payoutReleasedAt || r.source.paidAt || r.source.createdAt).toISOString(),
    });
    return { source: r.source, transfers: [...transfers.values()], refundDates,
      bookingId, bookingReference: r.booking?.referenceCode || r.rental?.referenceCode || `#${bookingId}`,
      bookingUrl: r.rental ? `/manager-dashboard?view=storage-bookings&storageBooking=${r.rental.id}` : `/manager/booking/${bookingId}`,
      chefId: r.source.chefId, chefName: r.chefName, kitchenId: r.kitchen.id, kitchenName: r.kitchen.name,
      locationId: r.location.id, locationName: r.location.name, timezone, day, type,
      equipmentCents: r.source.bookingType === 'equipment' ? Number(r.source.baseAmount) - Number(r.source.taxAmount) : Number(r.equipmentCents),
      storageCents: Number(r.storageCents), taxRatePercent: Number(r.kitchen.taxRatePercent || 0),
      hoursBooked: type === 'extra_time' ? Number(m.extensionMinutes || m.minutes || 0) / 60
        : Number(r.booking?.durationHours || 0) || (Array.isArray(r.booking?.selectedSlots) ? r.booking.selectedSlots.length : 0), payout };
  }));
  // Compensation is platform-funded and has no chef payment row. Its saved transfer is an independent receipt.
  const compensations = await db.select({ claim: damageClaims, booking: kitchenBookings, rental: storageBookings,
    kitchen: kitchens, location: locations, chefName: users.fullName,
    claimPaidAt: sql`(SELECT MAX(h.created_at) FROM damage_claim_history h WHERE h.damage_claim_id = ${damageClaims.id} AND h.action = 'kitchen_paid')`.mapWith(damageClaimHistory.createdAt),
  }).from(damageClaims)
    .leftJoin(kitchenBookings, eq(kitchenBookings.id, damageClaims.kitchenBookingId))
    .leftJoin(storageBookings, eq(storageBookings.id, damageClaims.storageBookingId))
    .leftJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .innerJoin(kitchens, sql`${kitchens.id} = COALESCE(${kitchenBookings.kitchenId}, ${storageListings.kitchenId})`)
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).leftJoin(users, eq(users.id, damageClaims.chefId))
    .where(and(eq(locations.managerId, managerId), inArray(kitchens.id, allowed.map(k => k.id)),
      sql`${damageClaims.compensationOperation} IS NOT NULL`));
  for (const r of compensations) {
    const op = r.claim.compensationOperation!;
    if (['cancel_pending', 'cancelled'].includes(op.state)) continue;
    const bookingId = r.claim.kitchenBookingId || r.claim.storageBookingId!;
    const timezone = r.location.timezone || 'America/St_Johns';
    const holdReason = op.transferId ? null : await claimPayoutHold(r.claim.kitchenBookingId, r.claim.storageBookingId, op.key);
    payments.push({ source: { id: -r.claim.id, status: 'succeeded', bookingType: r.rental ? 'storage' : 'kitchen', bookingId,
      amount: String(op.amountCents), baseAmount: String(op.amountCents), managerRevenue: String(op.amountCents), serviceFee: '0', taxAmount: '0',
      stripeProcessingFee: '0', transferId: op.transferId || null, paidAt: r.claimPaidAt || new Date(op.attemptedAt || op.startedAt), createdAt: r.claim.createdAt,
      metadata: { type: 'damage_claim', reportOnTransfer: true, transfer: { transferredAt: r.claimPaidAt?.toISOString() || op.attemptedAt || op.startedAt, transferredCents: op.amountCents } } } as typeof paymentTransactions.$inferSelect,
      bookingId, bookingReference: r.booking?.referenceCode || r.rental?.referenceCode || `#${bookingId}`,
      bookingUrl: r.rental ? `/manager-dashboard?view=storage-bookings&storageBooking=${bookingId}` : `/manager/booking/${bookingId}`,
      chefId: r.claim.chefId, chefName: r.chefName, kitchenId: r.kitchen.id, kitchenName: r.kitchen.name,
      locationId: r.location.id, locationName: r.location.name, timezone,
      day: dayFor(bookingId, r.claim.kitchenBookingVisitId, r.claim.damageDate), type: 'claim', hoursBooked: 0, equipmentCents: 0, storageCents: 0,
      payout: { status: holdReason ? 'on_hold' : 'scheduled', holdReason, expectedAt: null } });
  }
  return buildManagerRevenue(payments, liveDays.map(d => ({ ...d, day: dayFor(d.bookingId, d.visitId, d.operatingDate || undefined),
    reversedCents: Number((rawDays.find(p => p.id === d.installmentId)?.evidence as any)?.reversedCents || 0) })), allocations, query, filters);
}
