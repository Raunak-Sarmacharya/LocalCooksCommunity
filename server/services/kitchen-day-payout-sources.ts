import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions, kitchenBookings, kitchenBookingVisits, kitchenBookingExtensions,
  kitchenBookingDayAllocations as allocations } from '@shared/schema';
import { allocateDatedCapture, type DayComponent } from './dated-booking-quote';
import { ensureDayPayoutRows } from './kitchen-day-payouts';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Adopt supplemental sources before the common dispatcher can consider a legacy transfer. Never guess a visit. */
export async function partitionDatedSupplement(sourceId: number, tx: Tx) {
  const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).for('update');
  if (!source || !['kitchen', 'bundle'].includes(source.bookingType)) return false;
  if (source.payoutPartition === 'per_day') return true;
  const saved = (source.metadata || {}) as Record<string, any>;
  if (!saved.sessionExtensionId && !saved.kitchenChangeId) return false;
  const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, source.bookingId));
  if (!booking?.scheduleRevision) return false;
  if (source.transferId) throw Error('Dated supplemental source already used a legacy transfer; needs review');
  await tx.update(paymentTransactions).set({ payoutPartition: 'per_day', payoutTiming: 'after_closeout' }).where(eq(paymentTransactions.id, source.id));
  return true;
}

export async function syncDayPayoutSource(sourceId: number) {
  const [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId));
  if (!source || source.payoutPartition !== 'per_day' || !source.paymentIntentId) throw Error('Daily source not found');
  if ((source.metadata as any)?.datedQuote) {
    await (await import('./dated-booking-allocations')).syncDatedPayment(source.paymentIntentId);
    return;
  }
  // Same charge/balance verification as CP4; no estimate becomes a final allocation.
  const evidence = await (await import('./stripe-service')).getDatedCaptureEvidence(source.paymentIntentId);
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).for('update');
    const m = (locked.metadata || {}) as Record<string, any>;
    if (!m.sessionExtensionId && !m.kitchenChangeId) throw Error('Unknown supplemental source');
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, locked.bookingId));
    let components: DayComponent[] = m.dayComponents;
    if (m.sessionExtensionId) {
      const [extension] = await tx.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, Number(m.sessionExtensionId)));
      const visit = visits.find(v => v.id === extension?.visitId);
      if (!visit || extension.bookingId !== locked.bookingId || extension.paymentIntentId !== locked.paymentIntentId || !extension.paidAt)
        throw Error('Supplemental payment visit needs review');
      components = [{ visitId: visit.id, sessionIndex: visit.blockIndex, componentKey: `extension:${extension.id}`,
        kind: 'kitchen', bookingId: locked.bookingId, subtotalCents: Number(locked.baseAmount) - Number(locked.taxAmount) }];
    }
    if (!components?.length && Number.isSafeInteger(m.visitId) && visits.some(v => v.id === m.visitId)) {
      const visit = visits.find(v => v.id === m.visitId)!;
      components = [{ visitId: visit.id, sessionIndex: visit.blockIndex, componentKey: `change:${m.kitchenChangeId}`, kind: 'kitchen', bookingId: locked.bookingId, subtotalCents: Number(locked.baseAmount) - Number(locked.taxAmount) }];
    }
    if (!components?.length || components.some(c => !visits.some(v => v.id === c.visitId) || !Number.isSafeInteger(c.subtotalCents) || c.subtotalCents < 0)
      || new Set(components.map(c => `${c.visitId}:${c.componentKey}`)).size !== components.length) throw Error('Supplemental day allocations required');
    components = [...components].sort((a, b) => visits.find(v => v.id === a.visitId)!.visitDate!.localeCompare(visits.find(v => v.id === b.visitId)!.visitDate!) || a.componentKey.localeCompare(b.componentKey));
    if (evidence.intentId !== locked.paymentIntentId || evidence.capturedCents !== Number(locked.amount)
      || Number(locked.baseAmount) + Number(locked.serviceFee) !== evidence.capturedCents) throw Error('Supplemental capture differs');
    const allocated = allocateDatedCapture(components, { totalCents: Number(locked.amount), taxCents: Number(locked.taxAmount), serviceFeeCents: Number(locked.serviceFee) } as any, evidence.feeCents);
    const existing = await tx.select().from(allocations).where(eq(allocations.sourceId, sourceId)).orderBy(asc(allocations.id));
    for (const part of allocated) {
      const previous = existing.find(p => p.visitId === part.visitId && p.componentKey === part.componentKey && p.allocationRevision === 1);
      const proof = { chargeId: evidence.chargeId, balanceTransactionId: evidence.balanceTransactionId, feeDetails: evidence.feeDetails, feeStatus: evidence.feeCents === null ? 'pending' : 'verified' };
      if (previous) {
        if (previous.subtotalCents !== part.subtotalCents || previous.taxCents !== part.taxCents || previous.serviceFeeCents !== part.serviceFeeCents
          || previous.stripeFeeCents !== null && evidence.feeCents !== null && (previous.stripeFeeCents !== part.stripeFeeCents
            || (previous.evidence as any).balanceTransactionId !== evidence.balanceTransactionId)) throw Error('Frozen supplemental allocation differs');
        if (previous.stripeFeeCents === null && evidence.feeCents !== null) await tx.update(allocations).set({ stripeFeeCents: part.stripeFeeCents, evidence: proof }).where(eq(allocations.id, previous.id));
      } else await tx.insert(allocations).values({ sourceId, visitId: part.visitId, allocationRevision: 1, componentKey: part.componentKey,
        subtotalCents: part.subtotalCents, taxCents: part.taxCents, serviceFeeCents: part.serviceFeeCents, stripeFeeCents: part.stripeFeeCents, evidence: proof });
    }
    if (existing.length && existing.length !== allocated.length) throw Error('Supplemental allocation set differs');
    if (evidence.feeCents !== null) await tx.update(paymentTransactions).set({ stripeProcessingFee: String(evidence.feeCents), chargeId: evidence.chargeId,
      managerRevenue: String(Number(locked.baseAmount) - evidence.feeCents), metadata: { ...m, feeStatus: 'verified', balanceTransactionId: evidence.balanceTransactionId } }).where(eq(paymentTransactions.id, sourceId));
    await ensureDayPayoutRows(tx, sourceId);
  });
}
