import type Stripe from 'stripe';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookingDayAllocations, paymentTransactions, kitchenBookingVisits, equipmentBookings } from '@shared/schema';
import { allocateDatedCapture, datedCheckoutMetadata, verifyDatedQuote, type DayComponent, type DatedBookingManifest } from './dated-booking-quote';
import { approvedBookingCapture } from '@shared/booking-capture-terms';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DatedCaptureEvidence = { intentId: string; capturedCents: number; currency: string; feeCents: number | null;
  metadata: Record<string, string>;
  chargeId: string | null; balanceTransactionId: string | null; feeDetails: Stripe.BalanceTransaction.FeeDetail[] | null };
const ref = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id;

export async function verifiedDatedCaptureEvidence(intent: Stripe.PaymentIntent, provider: Stripe): Promise<DatedCaptureEvidence> {
  // A partial capture (the chef accepted the kitchen's new total) receives less than the authorization; the exact amount is checked against the source.
  if (intent.status !== 'succeeded' || intent.currency !== 'cad' || !(intent.amount_received > 0 && intent.amount_received <= intent.amount)) throw Error('Dated capture is not verified');
  const evidence: DatedCaptureEvidence = { intentId: intent.id, capturedCents: intent.amount_received, currency: intent.currency,
    feeCents: null, chargeId: null, balanceTransactionId: null, feeDetails: null, metadata: intent.metadata };
  if (!intent.latest_charge) return evidence;
  const charge = typeof intent.latest_charge === 'string' ? await provider.charges.retrieve(intent.latest_charge) : intent.latest_charge;
  if (ref(charge.payment_intent) !== intent.id || charge.currency !== intent.currency || !charge.paid || !charge.captured
    || charge.amount_captured !== intent.amount_received) throw Error('Dated captured charge needs review');
  evidence.chargeId = charge.id;
  if (!charge.balance_transaction) return evidence;
  const balance = typeof charge.balance_transaction === 'string' ? await provider.balanceTransactions.retrieve(charge.balance_transaction) : charge.balance_transaction;
  if (ref(balance.source) !== charge.id || balance.currency !== intent.currency || balance.amount !== charge.amount_captured
    || !Number.isSafeInteger(balance.fee) || balance.fee < 0 || balance.net !== balance.amount - balance.fee
    || balance.fee_details.some(line => line.currency !== intent.currency || !Number.isSafeInteger(line.amount) || line.amount < 0)
    || balance.fee_details.reduce((sum, line) => sum + line.amount, 0) !== balance.fee) throw Error('Dated balance transaction needs review');
  return { ...evidence, feeCents: balance.fee, balanceTransactionId: balance.id, feeDetails: balance.fee_details };
}

/** Also checked before capture: saved equipment/visit identities must still match the entire frozen quote. */
export async function datedSourceComponents(tx: Tx, source: typeof paymentTransactions.$inferSelect) {
  if (source?.payoutPartition !== 'per_day') throw Error('Dated source partition is required before capture');
  const saved = source.metadata as { datedQuote?: unknown; dayComponents?: DayComponent[]; datedDeclinedEquipmentIds?: number[] };
  const quote = verifyDatedQuote(saved.datedQuote), m = quote.manifest;
  // Equipment the kitchen declined and the chef agreed to go without: excluded from the capture and from every allocation.
  const declined = new Set(saved.datedDeclinedEquipmentIds ?? []);
  const components = saved.dayComponents?.filter(row => !(row.kind === 'equipment' && declined.has(row.bookingId)));
  const captured = acceptedDatedTotals(m, components?.reduce((sum, row) => sum + row.subtotalCents, 0) ?? 0, declined.size > 0);
  if (Number(source.amount) !== captured.totalCents || source.chefId !== m.chefId || source.managerId !== m.managerId
    || source.currency.toLowerCase() !== 'cad' || Number(source.baseAmount) !== captured.subtotalCents + captured.taxCents
    || Number(source.taxAmount) !== captured.taxCents || Number(source.serviceFee) !== captured.serviceFeeCents
    || source.payoutTiming !== 'after_closeout' || !components?.length) throw Error('Dated allocation source needs review');
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, source.bookingId));
  const equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, source.bookingId));
  const expected: DayComponent[] = [];
  for (const [sessionIndex, day] of Array.from(m.days.entries())) {
    const visit = visits.find(row => row.visitDate === day.date && row.scheduleRevision === 1);
    if (!visit) throw Error('Dated allocation visit is missing');
    expected.push({ visitId: visit.id, sessionIndex, componentKey: 'kitchen', kind: 'kitchen', bookingId: source.bookingId, subtotalCents: day.kitchenCents });
    for (const item of day.equipment) {
      const row = equipment.find(row => row.kitchenBookingVisitId === visit.id && row.equipmentListingId === item.listingId);
      if (!row || Number(row.totalPrice) !== item.cents) throw Error('Dated allocation equipment needs review');
      if (declined.has(row.id)) continue;
      expected.push({ visitId: visit.id, sessionIndex, componentKey: `equipment:${row.id}`, kind: 'equipment', bookingId: row.id, subtotalCents: item.cents });
    }
  }
  if (expected.length !== components.length || expected.some((row, index) => Object.entries(row).some(([key, value]) => components[index][key as keyof DayComponent] !== value)))
    throw Error('Dated allocation components need review');
  if (equipment.length !== expected.filter(row => row.kind === 'equipment').length + declined.size
    || equipment.some(row => declined.has(row.id) && row.status === 'confirmed')) throw Error('Unexpected dated equipment rows');
  return { saved, quote, components: expected, captured };
}

/** What the source captures: the frozen totals, or the same approved-share arithmetic as single-day for accepted components. */
export function acceptedDatedTotals(m: DatedBookingManifest, acceptedSubtotalCents: number, partial: boolean) {
  if (!partial) return { subtotalCents: m.subtotalCents, taxCents: m.taxCents, serviceFeeCents: m.serviceFeeCents, totalCents: m.totalCents };
  const capture = approvedBookingCapture({ subtotal: m.subtotalCents, tax: m.taxCents, commission: m.serviceFeeCents, rate: m.taxRatePercent,
    authorizedAmount: m.totalCents }, acceptedSubtotalCents);
  return { subtotalCents: acceptedSubtotalCents, taxCents: capture.tax, serviceFeeCents: capture.commission, totalCents: capture.amount };
}

/** Source lock precedes booking/visit locks. Unknown fee rows remain NULL until verified provider evidence arrives. */
export async function writeDatedCaptureAllocations(tx: Tx, sourceId: number, evidence: DatedCaptureEvidence) {
  const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).for('update');
  const { saved, quote, components: expected, captured } = await datedSourceComponents(tx, source);
  const m = { ...quote.manifest, ...captured };
  if (source.paymentIntentId !== evidence.intentId || evidence.currency !== 'cad' || evidence.capturedCents !== m.totalCents
    || Object.entries(datedCheckoutMetadata(quote)).some(([key, value]) => evidence.metadata[key] !== value)) throw Error('Dated allocation source needs review');
  const allocations = allocateDatedCapture(expected, m, evidence.feeCents);
  const existing = await tx.select().from(kitchenBookingDayAllocations).where(eq(kitchenBookingDayAllocations.sourceId, sourceId)).orderBy(asc(kitchenBookingDayAllocations.id));
  for (const row of allocations) {
    const previous = existing.find(item => item.visitId === row.visitId && item.componentKey === row.componentKey && item.allocationRevision === 1);
    const allocationEvidence = { contract: m.contract, quoteHash: quote.hash, intentId: evidence.intentId, capturedCents: evidence.capturedCents,
      chargeId: evidence.chargeId, balanceTransactionId: evidence.balanceTransactionId, feeDetails: evidence.feeDetails,
      feeStatus: evidence.feeCents === null ? 'pending' : 'verified', sessionIndex: row.sessionIndex, kind: row.kind, bookingId: row.bookingId };
    if (previous) {
      if (previous.subtotalCents !== row.subtotalCents || previous.taxCents !== row.taxCents || previous.serviceFeeCents !== row.serviceFeeCents
        || previous.stripeFeeCents !== null && evidence.feeCents !== null && (previous.stripeFeeCents !== row.stripeFeeCents
          || (previous.evidence as any)?.balanceTransactionId !== evidence.balanceTransactionId)) throw Error('Frozen day allocations differ from provider evidence');
      if (previous.stripeFeeCents === null && evidence.feeCents !== null) await tx.update(kitchenBookingDayAllocations)
        .set({ stripeFeeCents: row.stripeFeeCents, evidence: allocationEvidence }).where(eq(kitchenBookingDayAllocations.id, previous.id));
    } else await tx.insert(kitchenBookingDayAllocations).values({ sourceId, visitId: row.visitId, allocationRevision: 1, componentKey: row.componentKey,
      subtotalCents: row.subtotalCents, taxCents: row.taxCents, serviceFeeCents: row.serviceFeeCents, stripeFeeCents: row.stripeFeeCents, evidence: allocationEvidence });
  }
  if (existing.length && existing.length !== allocations.length) throw Error('Unexpected dated allocation rows');
  // Do not downgrade verified fee evidence on a delayed event lacking a balance transaction.
  if (evidence.feeCents !== null) await tx.update(paymentTransactions).set({ stripeProcessingFee: String(evidence.feeCents), chargeId: evidence.chargeId,
    managerRevenue: String(m.totalCents - m.serviceFeeCents - evidence.feeCents),
    metadata: { ...saved, feeStatus: 'verified', balanceTransactionId: evidence.balanceTransactionId, feeDetails: evidence.feeDetails,
      capturedComponentAllocations: allocations }, updatedAt: new Date() }).where(eq(paymentTransactions.id, sourceId));
}

/** Capture webhooks synchronize evidence only. CP5 owns all daily transfer release. */
export async function syncDatedPayment(intentId: string) {
  const intent = await (await import('./stripe-service')).getBookingPaymentIntent(intentId);
  if (intent.status !== 'succeeded' && intent.amount_received === 0) return;
  const [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intentId)).limit(1);
  if (!source || source.payoutPartition !== 'per_day') throw Error('Dated capture source is not yet available');
  const evidence = await (await import('./stripe-service')).getDatedCaptureEvidence(intentId);
  await db.transaction(tx => writeDatedCaptureAllocations(tx, source.id, evidence));
}
