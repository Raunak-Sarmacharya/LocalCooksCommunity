/**
 * Issues and serves immutable booking money documents (shared/booking-documents.ts, migration 0086).
 *
 * Issuance is idempotent per Stripe object (source_key) and runs:
 *   - right after the money event is recorded (hooks: booking capture, claim payment, kitchen payout release), and
 *   - on first read of a booking's documents (backfill for bookings paid before this existed, and catch-up if a hook
 *     failed). Facts come only from our own rows (payment_transactions, extensions, claims); the single provider read
 *     is the card brand/last 4 for a NEW chef receipt, once, at issue time — never on download.
 * Once issued a document is never edited or rebuilt; the PDF renders from the stored snapshot only.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { logger } from '../logger';
import { damageClaims, kitchenBookingChanges, kitchenBookings, kitchens, locations, paymentTransactions, platformSettings, users,
  storageBookings, storageListings, storageRentalTerms, equipmentBookings, equipmentListings } from '@shared/schema';
import { bookingDocuments, type BookingDocumentRow } from '@shared/booking-documents-schema';
import { LOCAL_COOKS_SUPPLIER, bookingSettled, buildCompensationRemittance, buildPaymentReceipt, buildPayoutReversal, buildRefundReceipt,
  buildRemittance, buildStatement, documentNumber, formatDay, formatMinutes, formatTimeRange,
  type BookingFacts, type BookingMoney, type CompensationFact, type DocumentAudience, type DocumentKind, type DocumentSnapshot,
  type DocumentSupplier, type FreeTimeFact, type PaymentFact, type PaymentPurpose, type RefundFact, type SettlementState, type Slot } from '@shared/booking-documents';

// ── Raw rows (migration 0085 is required for extension refund evidence) ──────────────────────────────────────
export interface PaymentRow { id: number; amount: string | number; baseAmount: string | number | null; serviceFee: string | number | null;
  taxAmount: string | number | null; stripeProcessingFee: string | number | null; managerRevenue: string | number | null; refundAmount: string | number | null;
  paymentIntentId: string | null; chargeId: string | null; refundId?: string | null; transferId: string | null; status: string;
  paidAt: Date | string | null; refundedAt?: Date | string | null; metadata: unknown;
  dayPayouts?: Array<{ visitId: number; date: string; amountCents: number | null; transferId: string | null; noEntitlement: boolean; evidence: any; subtotalCents: number; taxCents: number; stripeFeeCents: number | null }>;
  payoutTransfers?: Record<string, { originalAmountCents: number; reversedCents: number; refunds?: Record<string, { amountCents: number }> }> }
export interface ExtensionRow { id: number; kind: string; minutes: number; free: boolean; status: string; originalEndTime: string; endTime: string;
  appliedAt: Date | string | null; paidAt: Date | string | null; paymentIntentId: string | null;
  amountCents?: number; quote?: { subtotalCents: number; taxCents: number; commissionCents: number }; refundId?: string | null; refundedAt?: Date | string | null;
  operation?: { state?: string; action?: string; capturedAt?: string; capturedAmountCents?: number; chargeId?: string | null } | null }
export interface ClaimRow { id: number; claimTitle: string; status: string; fundedBy: string | null; paymentTransactionId: number | null;
  stripePaymentIntentId: string | null; finalAmountCents: number | null; claimVersion?: number | null;
  transferOperation?: { state?: string; transferId?: string; amountCents?: number; attemptedAt?: string; startedAt?: string } | null;
  compensationOperation?: { state?: string; transferId?: string; amountCents?: number; attemptedAt?: string; startedAt?: string } | null;
  withdrawalOperation?: { state?: string } | null }
export interface MoneyRows {
  booking: { id: number; referenceCode: string | null; bookingDate: Date | string; startTime: string; endTime: string; selectedSlots: unknown;
    pricingMode: string | null; paymentIntentId: string | null; status: string };
  kitchenName: string; locationName: string | null; locationAddress: string | null; timezone: string;
  chefName: string; chefEmail: string | null;
  payments: PaymentRow[]; extensions: ExtensionRow[]; claims: ClaimRow[];
  changes?: Array<{ id: string; destination: unknown }>;
  addonNames: { storage: Record<number, string>; equipment: Record<number, string> };
}

const cents = (value: unknown) => { const n = Math.round(Number(value ?? 0)); return Number.isFinite(n) ? n : 0; };
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const meta = (row: { metadata: unknown }) => (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, any>;
const PAID = ['succeeded', 'partially_refunded', 'refunded'];
const dateOnly = (value: Date | string) => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

function purposeOf(row: PaymentRow, parentIntent: string | null): PaymentPurpose {
  const m = meta(row);
  if (m.type === 'damage_claim' || m.damage_claim_id != null) return 'claim';
  if (m.type === 'session_extension' || m.sessionExtensionId != null) return 'extension';
  if (m.kitchenChangeId != null) return 'change';
  return row.paymentIntentId && row.paymentIntentId === parentIntent ? 'booking' : 'other';
}

/** The slots the chef bought originally: saved selected slots minus every applied extension's added time. */
export function originalSlots(rows: Pick<MoneyRows, 'booking' | 'extensions'>): Slot[] {
  const saved = Array.isArray(rows.booking.selectedSlots) ? rows.booking.selectedSlots as Array<Slot | string> : [];
  let slots: Slot[] = saved.flatMap(slot => typeof slot === 'object' && slot?.startTime && slot?.endTime ? [{ startTime: slot.startTime, endTime: slot.endTime }] : []);
  if (!slots.length) slots = [{ startTime: rows.booking.startTime, endTime: rows.booking.endTime }];
  const added = rows.extensions.filter(ext => ext.appliedAt).map(ext => ext.kind === 'early_start'
    ? [toMin(ext.endTime), toMin(ext.originalEndTime)] : [toMin(ext.originalEndTime), toMin(ext.endTime)]);
  const kept = slots.filter(slot => !added.some(([from, to]) => toMin(slot.startTime) >= from && toMin(slot.endTime) <= to))
    .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  return kept.reduce<Slot[]>((merged, slot) => {
    const last = merged[merged.length - 1];
    if (last && last.endTime === slot.startTime) last.endTime = slot.endTime; else merged.push({ ...slot });
    return merged;
  }, []);
}
const slotMinutes = (slots: Slot[]) => slots.reduce((total, slot) => total + Math.max(0, toMin(slot.endTime) - toMin(slot.startTime)), 0);

const EXTENSION_SOURCE: Record<string, { chef: string; manager: string }> = {
  offer: { chef: 'accepted kitchen offer', manager: 'your offer, accepted by the chef' },
  request: { chef: 'your request', manager: 'requested by the chef' },
  extra_time: { chef: 'extra time charged after the session', manager: 'extra time you charged' },
  early_start: { chef: 'earlier start', manager: 'earlier start' },
};
function extensionItem(ext: ExtensionRow, date: string, audience: DocumentAudience) {
  const range = ext.kind === 'early_start' ? formatTimeRange(ext.endTime, ext.originalEndTime) : formatTimeRange(ext.originalEndTime, ext.endTime);
  const source = EXTENSION_SOURCE[ext.kind]?.[audience] || '';
  return { label: ext.kind === 'early_start' ? 'Earlier start' : 'More time',
    detail: `${formatDay(date)} · ${range} (${formatMinutes(ext.minutes)}${source ? ` · ${source}` : ''})` };
}

function refundReason(row: PaymentRow, receipt: Record<string, any>) {
  const m = meta(row);
  if (cents(receipt.platformGoodwillCents) > 0) return 'Goodwill refund from Local Cooks';
  if ([m.cancellationRefundOperation, ...(m.cancellationRefundOperations || [])].some(operation => operation?.chefInitiated && operation.refundId === receipt.id)) return 'Add-on refund';
  if (m.cancellationRefundOperation?.refundId === receipt.id) return 'Cancellation refund';
  if (m.kitchenChangeId != null || receipt.kitchenChangeId != null) return 'Booking change refund';
  if (m.fullRefundRequest?.recoveredFromRefundId === receipt.id || m.fullRefundRequest?.status === 'approved') return 'Refund approved by Local Cooks';
  if (purposeOf(row, null) === 'claim') return 'Claim refund';
  return 'Refund';
}
function refundsOf(row: PaymentRow, booking: BookingFacts, changes: MoneyRows['changes'], equipmentNames?: Record<number, string>): RefundFact[] {
  const receipts = Array.isArray(meta(row).refunds) ? meta(row).refunds as Array<Record<string, any>> : [];
  const facts = receipts.flatMap(receipt => {
    const id = String(receipt.id || receipt.refundId || '');
    const amount = cents(receipt.customerReceived);
    const operation = [meta(row).cancellationRefundOperation, ...(meta(row).cancellationRefundOperations || [])].find(op => op?.dated && op.refundId === id);
    const dayItems = operation?.lines?.map((line: any) => ({ label: `${operation.days?.find((day: any) => day.visitId === line.visitId)?.date || ''} · ${line.kind === 'equipment' ? equipmentNames?.[line.itemId] || 'Equipment' : 'Kitchen day'}`, amountCents: cents(line.customerCents) }));
    const destination = changes?.find(change => change.id === receipt.kitchenChangeId)?.destination as { date?: string; slots?: Slot[]; pricingMode?: string } | undefined;
    const bookingSchedule = destination?.date && destination.slots?.length ? { ...booking, bookingDate: destination.date,
      pricingMode: destination.pricingMode === 'daily' ? 'daily' as const : booking.pricingMode, originalSlots: destination.slots } : undefined;
    return id && amount > 0 ? [{ refundId: id, amountCents: amount, managerDebitedCents: cents(receipt.managerDebited ?? receipt.customerReceived),
      reason: refundReason(row, { ...receipt, id }), refundedAt: iso(row.refundedAt),
      ...(dayItems?.length && dayItems.reduce((sum: number, item: { amountCents: number }) => sum + item.amountCents, 0) === amount ? { items: dayItems } : {}),
      ...(bookingSchedule ? { bookingSchedule } : {}) }] : [];
  });
  // Legacy rows: an aggregate refund without per-refund receipts still gets one refund receipt.
  const missing = cents(row.refundAmount) - facts.reduce((total, fact) => total + fact.amountCents, 0);
  if (missing > 0 && row.refundId && !facts.some(fact => fact.refundId === row.refundId))
    facts.push({ refundId: row.refundId, amountCents: missing, managerDebitedCents: missing, reason: refundReason(row, { id: row.refundId }), refundedAt: iso(row.refundedAt) });
  return facts;
}

/** Pure: our recorded rows → the money facts every document is built from. */
export function deriveBookingMoney(rows: MoneyRows): BookingMoney {
  const parentIntent = rows.booking.paymentIntentId;
  const parent = rows.payments.find(row => row.paymentIntentId && row.paymentIntentId === parentIntent);
  const datedDays = parent ? meta(parent).datedQuote?.manifest?.days as Array<{ date: string; pricingMode: string; slots: Slot[] }> | undefined : undefined;
  const changed = parent ? meta(parent).originalBookingSchedule as { date?: string; slots?: Slot[]; pricingMode?: string } | undefined : undefined;
  const bookingDate = dateOnly(rows.booking.bookingDate);
  const slots = originalSlots(rows);
  const pricingMode = rows.booking.pricingMode === 'daily' ? 'daily' : 'hourly';
  const booking: BookingFacts = { bookingId: rows.booking.id, reference: rows.booking.referenceCode || `#${rows.booking.id}`, kitchenName: rows.kitchenName,
    locationName: rows.locationName, locationAddress: rows.locationAddress, timezone: rows.timezone, chefName: rows.chefName, chefEmail: rows.chefEmail,
    bookingDate, pricingMode, originalSlots: slots, ...(datedDays?.length ? { days: datedDays } : {}) };
  const historical = { ...booking, bookingDate: changed?.date || bookingDate, originalSlots: changed?.slots?.length ? changed.slots : slots };
  const session = pricingMode === 'daily' ? { label: 'Kitchen day', detail: formatDay(historical.bookingDate) }
    : { label: 'Kitchen session', detail: `${formatDay(historical.bookingDate)} · ${historical.originalSlots.map(slot => formatTimeRange(slot.startTime, slot.endTime)).join(', ')} (${formatMinutes(slotMinutes(historical.originalSlots))})` };

  const payments = rows.payments.filter(row => PAID.includes(row.status) && row.paymentIntentId).map((row): PaymentFact => {
    const m = meta(row), purpose = purposeOf(row, parentIntent), amount = cents(row.amount);
    const schedule = m.bookingSchedule;
    const paymentBooking = purpose === 'booking' ? historical : schedule?.date && schedule?.slots?.length
      ? { ...booking, bookingDate: schedule.date, originalSlots: schedule.slots } : booking;
    const claim = purpose === 'claim' ? rows.claims.find(item => item.paymentTransactionId === row.id || item.stripePaymentIntentId === row.paymentIntentId) : undefined;
    let items: PaymentFact['items'], kitchenItems: PaymentFact['kitchenItems'], tax = cents(row.taxAmount) || cents(m.approvedTax);
    if (purpose === 'claim') { items = [{ label: 'Damage claim', detail: claim?.claimTitle, subtotalCents: amount }]; tax = 0; }
    else if (purpose === 'extension') {
      const ext = rows.extensions.find(item => item.id === Number(m.sessionExtensionId) || (item.paymentIntentId && item.paymentIntentId === row.paymentIntentId));
      const subtotal = cents(m.approvedSubtotal) || cents(row.baseAmount) - tax;
      const fallback = { label: m.extensionKind === 'early_start' ? 'Earlier start' : 'More time', detail: m.minutes ? formatMinutes(Number(m.minutes)) : undefined };
      items = [{ ...(ext ? extensionItem(ext, bookingDate, 'chef') : fallback), subtotalCents: subtotal }];
      kitchenItems = [{ ...(ext ? extensionItem(ext, bookingDate, 'manager') : fallback), subtotalCents: subtotal }];
    } else if (purpose === 'booking' && Array.isArray(m.capturedComponentAllocations) && m.capturedComponentAllocations.length) {
      items = (m.capturedComponentAllocations as Array<Record<string, any>>).map(part => part.kind === 'storage'
        ? { label: 'Storage', detail: rows.addonNames.storage[Number(part.bookingId)], subtotalCents: cents(part.subtotalCents) }
        : part.kind === 'equipment' ? { label: 'Equipment', detail: [datedDays?.[part.sessionIndex]?.date, rows.addonNames.equipment[Number(part.bookingId)]].filter(Boolean).join(' · '), subtotalCents: cents(part.subtotalCents) }
        : datedDays?.[part.sessionIndex] ? { label: 'Kitchen day', detail: `${formatDay(datedDays[part.sessionIndex].date)} · ${datedDays[part.sessionIndex].pricingMode === 'daily' ? 'Full day' : datedDays[part.sessionIndex].slots.map(slot => formatTimeRange(slot.startTime, slot.endTime)).join(', ')}`, subtotalCents: cents(part.subtotalCents) }
        : { ...session, subtotalCents: cents(part.subtotalCents) });
      const allocatedTax = (m.capturedComponentAllocations as Array<Record<string, any>>).reduce((total, part) => total + cents(part.taxCents), 0);
      if (!tax) tax = allocatedTax;
    } else {
      const subtotal = cents(m.approvedSubtotal) || cents(row.baseAmount) - tax;
      items = [purpose === 'booking' ? { ...session, subtotalCents: subtotal }
        : purpose === 'change' ? { label: 'Booking change', detail: `${formatDay(paymentBooking.bookingDate)} - ${paymentBooking.originalSlots.map((slot: Slot) => formatTimeRange(slot.startTime, slot.endTime)).join(', ')}`, subtotalCents: subtotal }
        : { label: 'Payment', subtotalCents: subtotal }];
    }
    const subtotal = items.reduce((total, item) => total + item.subtotalCents, 0);
    // Stripe's captured amount is authoritative: the service fee is what remains (legacy fee columns can be stale).
    const serviceFee = purpose === 'claim' ? 0 : amount - subtotal - tax;
    // Never issue a receipt that does not add up; the planner fails this one document (and the chef statement) closed.
    const problem = serviceFee < 0 ? `Payment ${row.id} records more than was charged; Local Cooks must review it before a receipt is issued` : undefined;
    const transfer = m.transfer as Record<string, any> | undefined;
    const claimTransfer = claim?.transferOperation?.state === 'succeeded' ? claim.transferOperation : undefined;
    const transferId = claimTransfer?.transferId || row.transferId || transfer?.transferId || null;
    const evidence = transferId ? row.payoutTransfers?.[transferId] : undefined;
    const transferredCents = claimTransfer ? cents(claimTransfer.amountCents)
      : evidence ? evidence.originalAmountCents
      : m.payoutSent?.amountCents != null ? cents(m.payoutSent.amountCents)
      : transferId ? cents(row.managerRevenue) : null;
    const installments: PaymentFact[] | undefined = row.dayPayouts?.map(day => ({ installmentVisitId: day.visitId, paymentIntentId: row.paymentIntentId!, chargeId: row.chargeId, purpose,
      paidAt: iso(row.paidAt), bookingSchedule: { ...(paymentBooking || booking), days: undefined, bookingDate: day.date,
        originalSlots: datedDays?.find(d => d.date === day.date)?.slots || (paymentBooking || booking).originalSlots,
        pricingMode: datedDays?.find(d => d.date === day.date)?.pricingMode === 'daily' ? 'daily' : 'hourly' },
      items: [{ label: `Kitchen visit - ${day.date}`, subtotalCents: day.subtotalCents }], taxCents: day.taxCents, taxRatePercent: null,
      serviceFeeCents: 0, amountCents: day.subtotalCents + day.taxCents,
      refunds: refundsOf(row, booking, rows.changes, rows.addonNames.equipment).flatMap(refund => {
        const operation = [m.cancellationRefundOperation, ...(m.cancellationRefundOperations || [])].find(op => op?.dated && op.refundId === refund.refundId);
        const reversed = operation ? Number(day.evidence.reversals?.[operation.id] || 0) : 0;
        return reversed ? [{ ...refund, managerDebitedCents: reversed, reversedCents: reversed }] : [];
      }),
      kitchen: { noShare: day.noEntitlement, processingAbsorbed: false, processingFeeCents: day.stripeFeeCents || 0, transferId: day.transferId,
        transferredCents: day.transferId ? day.amountCents : null, transferredAt: day.evidence.sentAt || null, reversedCents: day.evidence.reversedCents || 0 } }));
    return { ...(installments ? { installments } : {}), bookingSchedule: paymentBooking, paymentIntentId: row.paymentIntentId!, chargeId: row.chargeId, purpose, paidAt: iso(row.paidAt), items, ...(kitchenItems ? { kitchenItems } : {}),
      taxCents: tax, taxRatePercent: m.taxRatePercent != null ? Number(m.taxRatePercent) : subtotal && tax ? Math.round(tax * 1000 / subtotal) / 10 : null,
      serviceFeeCents: Math.max(0, serviceFee), amountCents: amount, refunds: refundsOf(row, booking, rows.changes, rows.addonNames.equipment).map(refund => ({ ...refund,
        ...(evidence?.refunds && Object.keys(evidence.refunds).length ? { reversedCents: evidence.refunds[refund.refundId]?.amountCents || 0 } : {}) })), ...(problem ? { problem } : {}),
      kitchen: { noShare: purpose === 'claim' && (claim?.fundedBy === 'local_cooks' || m.platformRecovery === true),
        processingAbsorbed: purpose === 'claim',
        processingFeeCents: cents(row.stripeProcessingFee) || cents(m.stripeFees?.processingFee) || cents(transfer?.actualStripeFeeCents),
        transferId, transferredCents: transferId ? transferredCents : null,
        ...(evidence ? { reversedCents: evidence.reversedCents } : {}),
        transferredAt: transferId ? (transfer?.transferredAt || m.payoutSent?.sentAt || claimTransfer?.attemptedAt || claimTransfer?.startedAt || null) : null } };
  });
  // A late Checkout charge was verified but bought no time. It is accounting evidence, never a payout source.
  for (const ext of rows.extensions) {
    const op = ext.operation, q = ext.quote;
    if (!ext.paymentIntentId || payments.some(payment => payment.paymentIntentId === ext.paymentIntentId)
      || ext.paidAt || !op?.capturedAt || op.action !== 'refund' || !q || !ext.amountCents || op.capturedAmountCents !== ext.amountCents) continue;
    payments.push({ paymentIntentId: ext.paymentIntentId, chargeId: op.chargeId || null, purpose: 'extension', paidAt: op.capturedAt,
      items: [{ ...extensionItem(ext, bookingDate, 'chef'), subtotalCents: q.subtotalCents }], taxCents: q.taxCents, taxRatePercent: null,
      serviceFeeCents: q.commissionCents, amountCents: ext.amountCents,
      refunds: ext.refundId && ext.refundedAt ? [{ refundId: ext.refundId, refundedAt: iso(ext.refundedAt), amountCents: ext.amountCents,
        managerDebitedCents: 0, reason: 'Extra time unavailable' }] : [],
      kitchen: { noShare: true, processingAbsorbed: false, processingFeeCents: 0, transferId: null, transferredCents: null, transferredAt: null } });
  }
  const compensations: CompensationFact[] = rows.claims.flatMap(claim => claim.compensationOperation?.state === 'succeeded' && claim.compensationOperation.transferId
    ? [{ transferId: claim.compensationOperation.transferId, amountCents: cents(claim.compensationOperation.amountCents),
      transferredAt: claim.compensationOperation.attemptedAt || claim.compensationOperation.startedAt || null, label: 'Paid by Local Cooks', detail: `Claim: ${claim.claimTitle}` }] : []);
  const freeTime: FreeTimeFact[] = rows.extensions.filter(ext => ext.free && ext.appliedAt).map(ext => {
    const item = extensionItem(ext, bookingDate, 'chef');
    return { label: item.label, detail: item.detail.replace(/ · (your request|accepted kitchen offer|earlier start|extra time charged after the session)\)$/, ')') + ' · added by the kitchen' };
  });
  return { booking, payments, compensations, freeTime };
}

// ── Settlement (pure part) ────────────────────────────────────────────────────────────────────────────────────
const FINAL_CLAIM = ['rejected', 'resolved', 'expired', 'draft'];
export function claimOpen(claim: ClaimRow) {
  if (claim.withdrawalOperation && claim.withdrawalOperation.state !== 'succeeded') return true;
  if (claim.compensationOperation && claim.compensationOperation.state !== 'succeeded') return true;
  if (claim.status === 'charge_succeeded') return claim.fundedBy !== 'local_cooks' && claim.transferOperation?.state !== 'succeeded';
  return !FINAL_CLAIM.includes(claim.status);
}
export function settlementState(rows: MoneyRows, money: BookingMoney, facts: { visitsClosed: boolean; moneyFrozen: boolean }): SettlementState {
  const owed = (payment: PaymentFact): number => {
    if (payment.installments) return payment.installments.reduce((sum, day) => sum + owed(day), 0);
    if (payment.kitchen.noShare || payment.kitchen.transferId) return 0;
    const gross = payment.items.reduce((total, item) => total + item.subtotalCents, 0) + payment.taxCents;
    const fee = payment.kitchen.processingAbsorbed ? 0 : payment.kitchen.processingFeeCents;
    return Math.max(0, gross - fee - payment.refunds.reduce((total, refund) => total + refund.managerDebitedCents, 0));
  };
  const noEntitlement = new Set(rows.payments.filter(row => meta(row).payoutNoEntitlement === true || meta(row).payoutNoEntitlement === 'true').map(row => row.paymentIntentId));
  return {
    bookingStatus: rows.booking.status,
    visitsClosed: facts.visitsClosed,
    openClaims: rows.claims.filter(claimOpen).length,
    openExtraTimeCharges: rows.extensions.filter(ext => ext.operation?.state === 'pending'
      || (ext.kind === 'extra_time' && ['offered', 'requested', 'approved', 'disputed'].includes(ext.status) && !ext.paidAt)).length,
    pendingPayments: rows.payments.filter(row => ['pending', 'authorized', 'processing'].includes(row.status)).length,
    pendingRefunds: rows.payments.filter(row => {
      const m = meta(row);
      return (m.cancellationRefundOperation && m.cancellationRefundOperation.status !== 'succeeded')
        || m.fullRefundRequest?.status === 'pending' || (m.refundRecovery && m.refundRecovery.status !== 'succeeded')
        || (m.kitchenCancellationRefund && m.kitchenCancellationRefund.status !== 'succeeded');
    }).length,
    untransferredPayouts: money.payments.filter(payment => !noEntitlement.has(payment.paymentIntentId) && owed(payment) > 0).length,
    moneyFrozen: facts.moneyFrozen,
  };
}

// ── Planning (pure) ───────────────────────────────────────────────────────────────────────────────────────────
export interface StoredDocument { id: number; number: string; bookingId: number; kind: DocumentKind; audience: DocumentAudience; sourceKey: string;
  amountCents: number; issuedAt: string; snapshot: DocumentSnapshot; referencesDocumentId: number | null }
export type Card = { brand: string; last4: string } | null;
export interface PlannedDocument {
  sourceKey: string; kind: DocumentKind; audience: DocumentAudience; chargeId: string | null;
  stripe: { paymentIntentId?: string | null; chargeId?: string | null; refundId?: string | null; transferId?: string | null };
  referencesSourceKey?: string;
  build: (ctx: { number: string; issuedAt: string; supplier: DocumentSupplier; card: Card; referenced?: StoredDocument; issued: StoredDocument[] }) => DocumentSnapshot;
}
export const sourceKeys = {
  payment: (pi: string) => `payment:chef:${pi}`,
  refund: (audience: DocumentAudience, refundId: string) => `refund:${audience}:${refundId}`,
  remittance: (transferId: string) => `remittance:manager:${transferId}`,
  statement: (audience: DocumentAudience, bookingId: number) => `statement:${audience}:${bookingId}`,
};

/** Every document this booking is owed right now, in issue order (references before referrers, statements last). */
export function planBookingDocuments(money: BookingMoney, settled: boolean): PlannedDocument[] {
  const { booking } = money;
  const plan: PlannedDocument[] = [];
  for (const payment of money.payments) {
    const receiptKey = sourceKeys.payment(payment.paymentIntentId);
    plan.push({ sourceKey: receiptKey, kind: 'payment', audience: 'chef', chargeId: payment.chargeId,
      stripe: { paymentIntentId: payment.paymentIntentId, chargeId: payment.chargeId },
      build: ctx => { if (payment.problem) throw Error(payment.problem); return buildPaymentReceipt(payment.bookingSchedule || booking, payment, { ...ctx, card: ctx.card }); } });
    for (const refund of payment.refunds) plan.push({ sourceKey: sourceKeys.refund('chef', refund.refundId), kind: 'refund', audience: 'chef', chargeId: payment.chargeId,
      stripe: { paymentIntentId: payment.paymentIntentId, chargeId: payment.chargeId, refundId: refund.refundId }, referencesSourceKey: receiptKey,
      build: ctx => buildRefundReceipt(refund.bookingSchedule || payment.bookingSchedule || booking, payment, refund, { number: ctx.referenced!.number }, { ...ctx, card: ctx.card }) });
  }
  for (const payment of money.payments.flatMap(p => p.installments || [p])) {
    if (payment.kitchen.noShare || !payment.kitchen.transferId || payment.kitchen.transferredCents == null) continue;
    const remittanceKey = sourceKeys.remittance(payment.kitchen.transferId);
    plan.push({ sourceKey: remittanceKey, kind: 'remittance', audience: 'manager', chargeId: null,
      stripe: { paymentIntentId: payment.paymentIntentId, chargeId: payment.chargeId, transferId: payment.kitchen.transferId },
      build: ctx => buildRemittance(payment.bookingSchedule || booking, payment, ctx) });
    // Refunds taken back after the payout went out: whatever the transfer did not already withhold.
    const gross = (payment.kitchenItems || payment.items).reduce((total, item) => total + item.subtotalCents, 0) + payment.taxCents;
    let toReverse = payment.kitchen.reversedCents ?? Math.max(0, payment.refunds.reduce((total, refund) => total + refund.managerDebitedCents, 0)
      - Math.max(0, gross - (payment.kitchen.processingAbsorbed ? 0 : payment.kitchen.processingFeeCents) - payment.kitchen.transferredCents));
    for (const refund of payment.refunds) {
      const reversed = Math.min(toReverse, refund.reversedCents ?? refund.managerDebitedCents);
      if (reversed <= 0) continue;
      toReverse -= reversed;
      plan.push({ sourceKey: sourceKeys.refund('manager', refund.refundId) + (payment.installmentVisitId ? `:${payment.kitchen.transferId}` : ''), kind: 'refund', audience: 'manager', chargeId: null,
        stripe: { paymentIntentId: payment.paymentIntentId, refundId: refund.refundId, transferId: payment.kitchen.transferId }, referencesSourceKey: remittanceKey,
        build: ctx => buildPayoutReversal(payment.bookingSchedule || booking, refund, reversed, { number: ctx.referenced!.number }, ctx) });
    }
  }
  for (const compensation of money.compensations) plan.push({ sourceKey: sourceKeys.remittance(compensation.transferId), kind: 'remittance', audience: 'manager',
    chargeId: null, stripe: { transferId: compensation.transferId }, build: ctx => buildCompensationRemittance(booking, compensation, ctx) });
  if (settled) for (const audience of ['chef', 'manager'] as const) plan.push({ sourceKey: sourceKeys.statement(audience, booking.bookingId), kind: 'statement', audience,
    chargeId: null, stripe: {}, build: ctx => buildStatement(audience, booking, ctx.issued.map(doc => doc.snapshot), audience === 'chef' ? money.freeTime : [], ctx) });
  return plan;
}

// ── Store ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DocumentStore {
  /** Runs `fn` holding the booking's issuance lock. */
  locked<T>(bookingId: number, fn: (store: DocumentStore) => Promise<T>): Promise<T>;
  list(bookingId: number): Promise<StoredDocument[]>;
  nextSequence(): Promise<number>;
  /** Insert-if-absent by source key; returns the stored row (the existing one on conflict). */
  insert(doc: Omit<StoredDocument, 'id'> & { stripe: PlannedDocument['stripe'] }): Promise<StoredDocument>;
}
export class DocumentsUnavailable extends Error { constructor() { super('Receipts are not available yet. Please try again later.'); } }
const missingTable = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string }; message?: string };
  return e?.code === '42P01' || e?.cause?.code === '42P01' || /booking_documents|booking_document_number_seq/.test(String(e?.message)) && /does not exist/.test(String(e?.message));
};
const fromRow = (row: BookingDocumentRow): StoredDocument => ({ id: row.id, number: row.number, bookingId: row.bookingId, kind: row.kind, audience: row.audience,
  sourceKey: row.sourceKey, amountCents: row.amountCents, issuedAt: new Date(row.issuedAt).toISOString(), snapshot: row.lines, referencesDocumentId: row.referencesDocumentId });

type Conn = Pick<typeof db, 'select' | 'insert' | 'execute'>;
/** `bookingType` says which table booking_id points at: kitchen bookings and storage rentals share the id space. */
export function drizzleDocumentStore(connection: Conn = db, bookingType: 'kitchen' | 'storage' = 'kitchen'): DocumentStore {
  const store: DocumentStore = {
    async locked(bookingId, fn) {
      if (connection !== db) return fn(store);
      return db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${bookingType === 'kitchen' ? 'booking_documents' : 'storage_documents'}), ${bookingId})`);
        return fn(drizzleDocumentStore(tx as unknown as Conn, bookingType));
      });
    },
    async list(bookingId) {
      const rows = await connection.select().from(bookingDocuments).where(and(eq(bookingDocuments.bookingId, bookingId), eq(bookingDocuments.bookingType, bookingType)))
        .orderBy(asc(bookingDocuments.id));
      return rows.map(fromRow);
    },
    async nextSequence() {
      const result = await connection.execute(sql`SELECT nextval('booking_document_number_seq') AS value`);
      return Number((result.rows[0] as { value: string | number }).value);
    },
    async insert(doc) {
      const [row] = await connection.insert(bookingDocuments).values({ number: doc.number, bookingId: doc.bookingId, bookingType, kind: doc.kind, audience: doc.audience,
        sourceKey: doc.sourceKey, stripePaymentIntentId: doc.stripe.paymentIntentId ?? null, stripeChargeId: doc.stripe.chargeId ?? null,
        stripeRefundId: doc.stripe.refundId ?? null, stripeTransferId: doc.stripe.transferId ?? null, amountCents: doc.amountCents, currency: 'CAD',
        lines: doc.snapshot, referencesDocumentId: doc.referencesDocumentId, issuedAt: new Date(doc.issuedAt) })
        .onConflictDoNothing({ target: bookingDocuments.sourceKey }).returning();
      if (row) return fromRow(row);
      const [existing] = await connection.select().from(bookingDocuments).where(eq(bookingDocuments.sourceKey, doc.sourceKey)).limit(1);
      return fromRow(existing);
    },
  };
  return store;
}

// ── Readers ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function loadMoneyRows(bookingId: number, reader: Conn = db): Promise<MoneyRows | null> {
  const [row] = await reader.select({ id: kitchenBookings.id, chefId: kitchenBookings.chefId, referenceCode: kitchenBookings.referenceCode,
    bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime, selectedSlots: kitchenBookings.selectedSlots,
    pricingMode: kitchenBookings.pricingMode, paymentIntentId: kitchenBookings.paymentIntentId, status: kitchenBookings.status,
    kitchenName: kitchens.name, locationName: locations.name, locationAddress: locations.address, timezone: locations.timezone })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row) return null;
  const payments = await reader.select({ id: paymentTransactions.id, amount: paymentTransactions.amount, baseAmount: paymentTransactions.baseAmount,
    serviceFee: paymentTransactions.serviceFee, taxAmount: paymentTransactions.taxAmount, stripeProcessingFee: paymentTransactions.stripeProcessingFee,
    managerRevenue: paymentTransactions.managerRevenue, refundAmount: paymentTransactions.refundAmount, paymentIntentId: paymentTransactions.paymentIntentId,
    chargeId: paymentTransactions.chargeId, refundId: paymentTransactions.refundId, transferId: paymentTransactions.transferId, status: paymentTransactions.status,
    paidAt: paymentTransactions.paidAt, refundedAt: paymentTransactions.refundedAt, metadata: paymentTransactions.metadata })
    .from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId), inArray(paymentTransactions.bookingType, ['kitchen', 'bundle'])))
    .orderBy(asc(paymentTransactions.id)).limit(100);
  const dayRows = (await reader.execute(sql`SELECT d.source_id, d.visit_id, v.visit_date::text AS date,
    d.transfer_amount_cents AS amount, d.transfer_id, d.no_entitlement, d.evidence,
    SUM(a.subtotal_cents)::integer AS subtotal, SUM(a.tax_cents)::integer AS tax,
    CASE WHEN COUNT(a.stripe_fee_cents) = COUNT(*) THEN SUM(a.stripe_fee_cents)::integer END AS fee
    FROM kitchen_booking_day_payouts d JOIN kitchen_booking_day_allocations a
      ON a.source_id = d.source_id AND a.visit_id = d.visit_id AND a.allocation_revision = d.allocation_revision
    JOIN kitchen_booking_visits v ON v.id = d.visit_id JOIN payment_transactions pt ON pt.id = d.source_id
    WHERE pt.booking_id = ${bookingId} AND pt.payout_partition = 'per_day'
    GROUP BY d.id, v.visit_date ORDER BY d.id`)).rows as any[];
  for (const day of dayRows) {
    const source = payments.find(p => p.id === day.source_id) as PaymentRow | undefined;
    if (source) (source.dayPayouts ??= []).push({ visitId: day.visit_id, date: day.date, amountCents: day.amount,
      transferId: day.transfer_id, noEntitlement: day.no_entitlement, evidence: day.evidence,
      subtotalCents: day.subtotal, taxCents: day.tax, stripeFeeCents: day.fee });
  }
  // Migration 0085 supplies the verified late-charge refund fields.
  const extensions = (await reader.execute(sql`SELECT id, kind, minutes, free, status, original_end_time AS "originalEndTime", end_time AS "endTime",
    applied_at AS "appliedAt", paid_at AS "paidAt", payment_intent_id AS "paymentIntentId", amount_cents AS "amountCents", quote,
    refund_id AS "refundId", refunded_at AS "refundedAt", operation
    FROM kitchen_booking_extensions WHERE booking_id = ${bookingId} ORDER BY id LIMIT 100`)).rows as unknown as ExtensionRow[];
  const changes = await reader.select({ id: kitchenBookingChanges.id, destination: kitchenBookingChanges.destination }).from(kitchenBookingChanges)
    .where(eq(kitchenBookingChanges.bookingId, bookingId)).orderBy(asc(kitchenBookingChanges.createdAt));
  const transfers = (await reader.execute(sql`SELECT DISTINCT ON (ph.transaction_id, ph.metadata->>'transferId')
    ph.transaction_id AS "transactionId", ph.metadata FROM payment_history ph JOIN payment_transactions pt ON pt.id = ph.transaction_id
    WHERE pt.booking_id = ${bookingId} AND pt.booking_type IN ('kitchen', 'bundle') AND ph.event_type = 'payout_transfer_verified'
    ORDER BY ph.transaction_id, ph.metadata->>'transferId', ph.id DESC`)).rows as Array<{ transactionId: number; metadata: any }>;
  for (const transfer of transfers) {
    const source = payments.find(payment => payment.id === transfer.transactionId) as PaymentRow | undefined;
    if (source) source.payoutTransfers = { ...source.payoutTransfers, [transfer.metadata.transferId]: transfer.metadata };
  }
  const claims = await reader.select({ id: damageClaims.id, claimTitle: damageClaims.claimTitle, status: damageClaims.status, fundedBy: damageClaims.fundedBy,
    paymentTransactionId: damageClaims.paymentTransactionId, stripePaymentIntentId: damageClaims.stripePaymentIntentId, finalAmountCents: damageClaims.finalAmountCents,
    claimVersion: damageClaims.claimVersion, transferOperation: damageClaims.transferOperation, compensationOperation: damageClaims.compensationOperation,
    withdrawalOperation: damageClaims.withdrawalOperation }).from(damageClaims).where(eq(damageClaims.kitchenBookingId, bookingId)).limit(50);
  const storage = await reader.select({ id: storageBookings.id, name: storageListings.name }).from(storageBookings)
    .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).where(eq(storageBookings.kitchenBookingId, bookingId));
  const equipment = await reader.select({ id: equipmentBookings.id, type: equipmentListings.equipmentType, brand: equipmentListings.brand }).from(equipmentBookings)
    .innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId)).where(eq(equipmentBookings.kitchenBookingId, bookingId));
  const [chef] = row.chefId ? await reader.select({ email: users.username }).from(users).where(eq(users.id, row.chefId)).limit(1) : [];
  const { getUserDisplayName } = await import('../utils/user-display');
  const chefName = row.chefId ? await getUserDisplayName(row.chefId, 'chef') : 'Chef';
  return { booking: { id: row.id, referenceCode: row.referenceCode, bookingDate: row.bookingDate, startTime: row.startTime, endTime: row.endTime,
      selectedSlots: row.selectedSlots, pricingMode: row.pricingMode, paymentIntentId: row.paymentIntentId, status: row.status },
    kitchenName: row.kitchenName, locationName: row.locationName, locationAddress: row.locationAddress, timezone: row.timezone || 'America/St_Johns',
    chefName, chefEmail: chef?.email?.includes('@') ? chef.email : null,
    payments: payments as PaymentRow[], extensions, claims: claims as ClaimRow[], changes,
    addonNames: { storage: Object.fromEntries(storage.map(item => [item.id, item.name])),
      equipment: Object.fromEntries(equipment.map(item => [item.id, [item.brand, item.type].filter(Boolean).join(' ')])) } };
}

const CLOSED_INSPECTIONS = ['manager_cleared', 'auto_closed_uninspected', 'legacy_closed', 'issue_filed'];
async function visitsClosed(bookingId: number) {
  try {
    const { projectBookingCloseouts } = await import('./clock-closeout');
    const [projected] = await projectBookingCloseouts([{ id: bookingId }]) as Array<{ closeout?: { phase: string;
      visits: Array<{ scheduledEndAt: string; inspection: { outcome: string; dueAt: string } }> } }>;
    const closeout = projected?.closeout;
    if (!closeout || closeout.phase !== 'ended' || !closeout.visits.every(visit => CLOSED_INSPECTIONS.includes(visit.inspection.outcome))) return false;
    // The kitchen may still report damage for 72 h after departure (even after the inspection closed): the statement is
    // final only once every visit's claim window has passed. Later of booked end / inspection due → never issued early.
    const { CLAIM_WINDOW_MS } = await import('@shared/damage-claims');
    const now = Date.now();
    return closeout.visits.every(visit => Math.max(Date.parse(visit.scheduledEndAt) || 0, Date.parse(visit.inspection.dueAt) || 0) + CLAIM_WINDOW_MS <= now);
  } catch (error) {
    logger.warn('[Documents] Closeout unavailable; the statement waits', { bookingId, error });
    return false;
  }
}
async function moneyFrozen(bookingId: number) {
  const { assertBookingMoneyWritable, BookingMoneyFrozen } = await import('./booking-money-guard');
  try { await assertBookingMoneyWritable({ bookingId }); return false; }
  catch (error) { if (error instanceof BookingMoneyFrozen) return true; throw error; }
}
export async function readTaxNumber(reader: Conn = db) {
  const fromEnv = process.env.LOCAL_COOKS_GST_HST_NUMBER?.trim();
  if (fromEnv) return fromEnv;
  const [setting] = await reader.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, 'local_cooks_gst_hst_number')).limit(1);
  return setting?.value?.trim() || null;
}
/** One provider read per new chef receipt (never per download). Missing card details are simply not printed. */
export async function stripeCardLookup(chargeId: string): Promise<Card> {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover', maxNetworkRetries: 0, timeout: 2500 });
    const charge = await stripe.charges.retrieve(chargeId);
    const card = charge.payment_method_details?.card;
    return card?.brand && card.last4 ? { brand: card.brand, last4: card.last4 } : null;
  } catch (error) {
    logger.warn('[Documents] Card details unavailable for receipt', { chargeId, error });
    return null;
  }
}

// ── Issuance ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface IssueDeps {
  store: DocumentStore;
  loadRows: (bookingId: number) => Promise<MoneyRows | null>;
  settlement: (rows: MoneyRows, money: BookingMoney) => Promise<SettlementState>;
  cardLookup: (chargeId: string) => Promise<Card>;
  taxNumber: () => Promise<string | null>;
  now: () => Date;
}
export const defaultIssueDeps = (): IssueDeps => ({
  store: drizzleDocumentStore(),
  loadRows: id => loadMoneyRows(id),
  settlement: async (rows, money) => settlementState(rows, money, { visitsClosed: await visitsClosed(rows.booking.id), moneyFrozen: await moneyFrozen(rows.booking.id) }),
  cardLookup: stripeCardLookup,
  taxNumber: () => readTaxNumber(),
  now: () => new Date(),
});

/**
 * Issues every document the booking is owed and does not have yet; returns all of its documents. Idempotent:
 * existing source keys are never rebuilt. A document whose facts do not add up is skipped (logged) and blocks the
 * statement for its audience, so a statement never omits money.
 */
export async function ensureBookingDocuments(bookingId: number, deps: IssueDeps = defaultIssueDeps()): Promise<{ documents: StoredDocument[]; settled: boolean; blockers: string[] }> {
  const rows = await deps.loadRows(bookingId);
  if (!rows) throw Error('Booking not found');
  const money = deriveBookingMoney(rows);
  const { settled, blockers } = bookingSettled(await deps.settlement(rows, money));
  let existing: StoredDocument[];
  try { existing = await deps.store.list(bookingId); } catch (error) { if (missingTable(error)) throw new DocumentsUnavailable(); throw error; }
  for (const payment of money.payments) {
    const remittance = payment.kitchen.transferId && existing.find(doc => doc.sourceKey === sourceKeys.remittance(payment.kitchen.transferId!));
    // Legacy net transfer metadata can change; an issued remittance is an immutable original payout fact.
    if (remittance) payment.kitchen.transferredCents = remittance.amountCents;
  }
  const documents = await issuePlanned(bookingId, planBookingDocuments(money, settled), existing, deps);
  return { documents, settled, blockers };
}

/** Issues the planned documents not stored yet, under the issuance lock; returns all of them. */
async function issuePlanned(bookingId: number, plan: PlannedDocument[], existing: StoredDocument[], deps: Pick<IssueDeps, 'store' | 'cardLookup' | 'taxNumber' | 'now'>) {
  const missing = plan.filter(item => !existing.some(doc => doc.sourceKey === item.sourceKey));
  if (!missing.length) return existing;
  // Provider reads happen before the lock and only for documents about to be issued.
  const cards = new Map<string, Card>();
  for (const chargeId of Array.from(new Set(missing.filter(item => item.audience === 'chef' && item.chargeId).map(item => item.chargeId!))))
    cards.set(chargeId, await deps.cardLookup(chargeId));
  const supplier: DocumentSupplier = { ...LOCAL_COOKS_SUPPLIER, taxNumber: await deps.taxNumber() };
  return deps.store.locked(bookingId, async store => {
    const issued = await store.list(bookingId);
    const failed = new Set<DocumentAudience>();
    for (const item of plan) {
      if (issued.some(doc => doc.sourceKey === item.sourceKey)) continue;
      if (item.kind === 'statement' && failed.has(item.audience)) continue;
      const referenced = item.referencesSourceKey ? issued.find(doc => doc.sourceKey === item.referencesSourceKey) : undefined;
      if (item.referencesSourceKey && !referenced) { failed.add(item.audience); continue; }
      const issuedAt = deps.now().toISOString();
      let snapshot: DocumentSnapshot;
      try {
        const number = documentNumber(item.kind, item.audience, await store.nextSequence());
        snapshot = item.build({ number, issuedAt, supplier, card: item.chargeId ? cards.get(item.chargeId) ?? null : null, referenced,
          issued: issued.filter(doc => doc.audience === item.audience) });
      } catch (error) {
        failed.add(item.audience);
        logger.error('[Documents] Document not issued; facts need review', { bookingId, sourceKey: item.sourceKey, error });
        continue;
      }
      issued.push(await store.insert({ number: snapshot.number, bookingId, kind: item.kind, audience: item.audience, sourceKey: item.sourceKey,
        amountCents: snapshot.total.amountCents, issuedAt, snapshot, referencesDocumentId: referenced?.id ?? null, stripe: item.stripe }));
    }
    return issued;
  });
}

/** Post-commit hook for money paths: never throws, never blocks the caller's outcome. */
export async function issueBookingDocumentsSafely(bookingId: number | null | undefined, reason: string) {
  if (!bookingId) return;
  try { await ensureBookingDocuments(bookingId); }
  catch (error) {
    if (error instanceof DocumentsUnavailable) return;
    logger.warn('[Documents] Issue after money event will retry on next read', { bookingId, reason, error });
  }
}

/** Role-scoped list for the booking page. */
export function documentsFor(documents: StoredDocument[], audience: DocumentAudience) {
  return documents.filter(doc => doc.audience === audience).map(doc => ({ id: doc.id, number: doc.number, kind: doc.kind, title: doc.snapshot.title,
    issuedAt: doc.issuedAt, amountCents: doc.amountCents, summary: doc.snapshot.sections[0]?.lines[0]?.label ?? doc.snapshot.title }));
}

// ── Standalone storage rentals (booking_type 'storage') ─────────────────────────────────────────────────────────
export const storageTermLabel = (listing: string, startsOn: string, endsOn: string, days: number) =>
  `Storage · ${listing} · ${formatDay(startsOn)}–${formatDay(endsOn)} (${days} ${days === 1 ? 'day' : 'days'})`;
export type StorageMoneyRows = { booking: BookingFacts; listingName: string;
  terms: Array<{ startsOn: string; endsOn: string; days: number; subtotalCents: number; taxCents: number; payment: PaymentRow }> };

/** Pure: one payment per paid term. The kitchen's remittance is subtotal + tax − card processing (− refunds already taken). */
export function deriveStorageMoney(rows: StorageMoneyRows): BookingMoney {
  const payments = rows.terms.filter(term => PAID.includes(term.payment.status) && term.payment.paymentIntentId).map(({ payment: row, ...term }): PaymentFact => {
    const m = meta(row), amount = cents(row.amount), serviceFee = amount - term.subtotalCents - term.taxCents;
    const transfer = m.transfer as Record<string, any> | undefined;
    const transferId = row.transferId || transfer?.transferId || null;
    const evidence = transferId ? row.payoutTransfers?.[transferId] : undefined;
    const refunds = refundsOf(row, rows.booking, []).map(refund => ({ ...refund,
      reason: refund.reason.startsWith('Goodwill') ? refund.reason : 'Storage refund',
      ...(evidence?.refunds && Object.keys(evidence.refunds).length ? { reversedCents: evidence.refunds[refund.refundId]?.amountCents || 0 } : {}) }));
    return { bookingSchedule: { ...rows.booking, bookingDate: term.startsOn }, paymentIntentId: row.paymentIntentId!, chargeId: row.chargeId, purpose: 'other',
      paidAt: iso(row.paidAt), items: [{ label: storageTermLabel(rows.listingName, term.startsOn, term.endsOn, term.days), subtotalCents: term.subtotalCents }],
      taxCents: term.taxCents, taxRatePercent: term.subtotalCents && term.taxCents ? Math.round(term.taxCents * 1000 / term.subtotalCents) / 10 : null,
      serviceFeeCents: Math.max(0, serviceFee), amountCents: amount, refunds,
      ...(serviceFee < 0 ? { problem: `Payment ${row.id} records more than was charged; Local Cooks must review it before a receipt is issued` } : {}),
      kitchen: { noShare: false, processingAbsorbed: false, processingFeeCents: cents(row.stripeProcessingFee), transferId,
        transferredCents: transferId ? evidence ? evidence.originalAmountCents : m.payoutSent?.amountCents != null ? cents(m.payoutSent.amountCents) : cents(row.managerRevenue) : null,
        ...(evidence ? { reversedCents: evidence.reversedCents } : {}),
        transferredAt: transferId ? (transfer?.transferredAt || m.payoutSent?.sentAt || null) : null } };
  });
  return { booking: rows.booking, payments, compensations: [], freeTime: [] };
}

export async function loadStorageMoneyRows(rentalId: number, reader: Conn = db): Promise<StorageMoneyRows | null> {
  const [row] = await reader.select({ id: storageBookings.id, chefId: storageBookings.chefId, referenceCode: storageBookings.referenceCode, termStart: storageBookings.termStart,
    timezone: storageBookings.timezone, listingName: storageListings.name, kitchenName: kitchens.name, locationName: locations.name, locationAddress: locations.address })
    .from(storageBookings).innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageBookings.id, rentalId)).limit(1);
  if (!row?.termStart) return null;
  const terms = await reader.select({ term: storageRentalTerms, payment: paymentTransactions }).from(storageRentalTerms)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, storageRentalTerms.paymentTransactionId))
    .where(eq(storageRentalTerms.rentalId, rentalId)).orderBy(asc(storageRentalTerms.seq));
  const transfers = (await reader.execute(sql`SELECT DISTINCT ON (ph.transaction_id, ph.metadata->>'transferId')
    ph.transaction_id AS "transactionId", ph.metadata FROM payment_history ph JOIN payment_transactions pt ON pt.id = ph.transaction_id
    WHERE pt.booking_id = ${rentalId} AND pt.booking_type = 'storage' AND ph.event_type = 'payout_transfer_verified'
    ORDER BY ph.transaction_id, ph.metadata->>'transferId', ph.id DESC`)).rows as Array<{ transactionId: number; metadata: any }>;
  for (const transfer of transfers) {
    const source = terms.find(item => item.payment.id === transfer.transactionId)?.payment as PaymentRow | undefined;
    if (source) source.payoutTransfers = { ...source.payoutTransfers, [transfer.metadata.transferId]: transfer.metadata };
  }
  const [chef] = row.chefId ? await reader.select({ email: users.username }).from(users).where(eq(users.id, row.chefId)).limit(1) : [];
  const { getUserDisplayName } = await import('../utils/user-display');
  const booking: BookingFacts = { bookingId: row.id, reference: row.referenceCode || `#${row.id}`, kitchenName: row.kitchenName, locationName: row.locationName,
    locationAddress: row.locationAddress, timezone: row.timezone || 'America/St_Johns', chefName: row.chefId ? await getUserDisplayName(row.chefId, 'chef') : 'Chef',
    chefEmail: chef?.email?.includes('@') ? chef.email : null, bookingDate: row.termStart, pricingMode: 'daily', originalSlots: [] };
  return { booking, listingName: row.listingName, terms: terms.map(({ term, payment }) => ({ ...term, payment: payment as PaymentRow })) };
}

/** Receipts, refund receipts, remittances and payout adjustments per paid term (no statement: a rental has no single close). */
export async function ensureStorageDocuments(rentalId: number, deps: Pick<IssueDeps, 'cardLookup' | 'taxNumber' | 'now'> & { store?: DocumentStore; loadRows?: typeof loadStorageMoneyRows } = { cardLookup: stripeCardLookup, taxNumber: () => readTaxNumber(), now: () => new Date() }) {
  const rows = await (deps.loadRows ?? loadStorageMoneyRows)(rentalId);
  if (!rows) throw Error('Storage rental not found');
  const store = deps.store ?? drizzleDocumentStore(db, 'storage');
  let existing: StoredDocument[];
  try { existing = await store.list(rentalId); } catch (error) { if (missingTable(error)) throw new DocumentsUnavailable(); throw error; }
  const money = deriveStorageMoney(rows);
  for (const payment of money.payments) {
    const remittance = payment.kitchen.transferId && existing.find(doc => doc.sourceKey === `storage:${sourceKeys.remittance(payment.kitchen.transferId!)}`);
    if (remittance) payment.kitchen.transferredCents = remittance.amountCents;
  }
  // Source keys are global: the storage prefix keeps a rental's documents apart from a kitchen booking with the same id.
  const plan = planBookingDocuments(money, false).map(item => ({ ...item, sourceKey: `storage:${item.sourceKey}`,
    ...(item.referencesSourceKey ? { referencesSourceKey: `storage:${item.referencesSourceKey}` } : {}) }));
  return { documents: await issuePlanned(rentalId, plan, existing, { ...deps, store }) };
}

export async function issueStorageDocumentsSafely(rentalId: number | null | undefined, reason: string) {
  if (!rentalId) return;
  try { await ensureStorageDocuments(rentalId); }
  catch (error) {
    if (error instanceof DocumentsUnavailable) return;
    logger.warn('[Documents] Storage documents will retry on next read', { rentalId, reason, error });
  }
}
