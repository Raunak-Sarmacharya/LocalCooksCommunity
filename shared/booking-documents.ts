/**
 * Booking money documents (WP-R, owner Oct 15): immutable receipts, refund receipts, kitchen remittances and the
 * final statements. Pure: facts in, snapshot out. A snapshot is built ONCE when the document is issued, stored,
 * and every PDF is rendered from the stored snapshot only, so a re-download is always the same document.
 *
 *  - payment    (chef)    one per Stripe payment: booking capture, paid extra time / early start, paid claim.
 *  - refund     (chef)    one per Stripe refund, referencing the payment receipt it refunds.
 *  - refund     (manager) the part of a refund taken back from a payout that was already sent (a reversal).
 *  - remittance (manager) one per Stripe transfer to the kitchen: booking + HST − card processing = payout.
 *  - statement  (both)    once, when the booking is settled (`bookingSettled`); lists the issued documents.
 *
 * English (en-CA) copy only: the PDFs never used the server i18n tables (see receipts-checkpoint.md).
 */
import { friendlyTimezoneName } from './timezone-utils';

export type DocumentKind = 'payment' | 'refund' | 'statement' | 'remittance';
export type DocumentAudience = 'chef' | 'manager';
export type DocLineTone = 'item' | 'tax' | 'fee' | 'deduction' | 'refund' | 'subtotal' | 'note';
export interface DocLine { label: string; detail?: string; amountCents: number | null; tone: DocLineTone }
export interface DocSection { heading?: string; lines: DocLine[] }
export interface DocumentSupplier { name: string; legalNote: string; address: string; website: string; email: string; taxNumber: string | null }
export interface DocumentSnapshot {
  version: 1;
  kind: DocumentKind;
  audience: DocumentAudience;
  number: string;
  title: string;
  issuedAt: string;
  /** Kitchen timezone: every date on the document is shown in it. */
  timezone: string;
  currency: string;
  supplier: DocumentSupplier;
  /** Top-right facts: kitchen, location, chef. */
  parties: Array<{ label: string; value: string; detail?: string }>;
  /** Left facts: reference, visit date, booked time. */
  meta: Array<{ label: string; value: string }>;
  sections: DocSection[];
  total: { label: string; amountCents: number };
  /** Paid-with line, transfer line, "estimated" notes; rendered under the total. */
  notes: string[];
  references: { number: string } | null;
}

export const LOCAL_COOKS_SUPPLIER: Omit<DocumentSupplier, 'taxNumber'> = {
  name: 'Local Cooks',
  legalNote: 'Local Cooks is the operating name of Jawrophi Delivery Inc.',
  address: '4 Priscilla Place, Paradise, NL',
  website: 'localcooks.ca',
  email: 'support@localcooks.ca',
};

const NUMBER_PREFIX: Record<string, string> = { 'payment:chef': 'R', 'refund:chef': 'RF', 'refund:manager': 'RV', 'remittance:manager': 'PR',
  'statement:chef': 'ST', 'statement:manager': 'PS' };
/** One shared sequence; the prefix tells the reader what the document is. Gaps are possible, reuse is not. */
export function documentNumber(kind: DocumentKind, audience: DocumentAudience, sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw Error('A positive document sequence is required');
  const prefix = NUMBER_PREFIX[`${kind}:${audience}`];
  if (!prefix) throw Error(`No ${audience} ${kind} document exists`);
  return `LC-${prefix}-${String(sequence).padStart(6, '0')}`;
}

// ── Formatting (deterministic; no locale-dependent Intl output except the timezone's generic name) ───────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
function clockParts(hhmm: string) {
  const total = minutesOf(hhmm) % (24 * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return { text: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, period: h < 12 ? 'a.m.' : 'p.m.' };
}
export const formatClock = (hhmm: string) => { const p = clockParts(hhmm); return `${p.text} ${p.period}`; };
/** "3:55–4:55 p.m." or "11:00 a.m.–1:00 p.m." (kitchen-local wall clock, as the app shows it). */
export function formatTimeRange(start: string, end: string) {
  const a = clockParts(start), b = clockParts(end);
  return a.period === b.period ? `${a.text}–${b.text} ${b.period}` : `${a.text} ${a.period}–${b.text} ${b.period}`;
}
export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}
/** YYYY-MM-DD → "Thu, Oct 15". */
export function formatDay(date: string) {
  const [y, mo, d] = date.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${DAYS[weekday]}, ${MONTHS[mo - 1]} ${d}`;
}
/** Instant → "Oct 15, 2026" in the kitchen's timezone. */
export function formatInstantDate(iso: string, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${MONTHS[Number(parts.month) - 1]} ${Number(parts.day)}, ${parts.year}`;
}
export const formatMoney = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const CARD_BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', interac: 'Interac',
  jcb: 'JCB', unionpay: 'UnionPay', diners: 'Diners Club' };
export const formatCard = (card: { brand: string; last4: string }) => `${CARD_BRANDS[card.brand.toLowerCase()] || card.brand} •••• ${card.last4}`;

// ── Facts ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type Slot = { startTime: string; endTime: string };
export interface BookingFacts {
  bookingId: number;
  reference: string;
  kitchenName: string;
  locationName: string | null;
  locationAddress: string | null;
  timezone: string;
  chefName: string;
  chefEmail: string | null;
  /** Visit date as booked originally (YYYY-MM-DD). */
  bookingDate: string;
  pricingMode: 'hourly' | 'daily';
  /** The originally purchased slots (before any extra time). */
  originalSlots: Slot[];
}
export type PaymentPurpose = 'booking' | 'extension' | 'claim' | 'change' | 'other';
export interface RefundFact {
  refundId: string;
  amountCents: number;
  /** Taken back from the kitchen's share. */
  managerDebitedCents: number;
  reason: string;
  refundedAt: string | null;
  reversedCents?: number;
}
export interface PaymentFact {
  paymentIntentId: string;
  chargeId: string | null;
  purpose: PaymentPurpose;
  paidAt: string | null;
  /** Chef-facing items (each its own subtotal). */
  items: Array<{ label: string; detail?: string; subtotalCents: number }>;
  /** Kitchen-facing labels of the same items. */
  kitchenItems?: Array<{ label: string; detail?: string; subtotalCents: number }>;
  taxCents: number;
  taxRatePercent: number | null;
  serviceFeeCents: number;
  amountCents: number;
  refunds: RefundFact[];
  /** Set when the recorded parts do not reconcile with the charge: no receipt is issued until reviewed. */
  problem?: string;
  kitchen: {
    /** No kitchen share on this payment (claim recovery or an invalid extension charge being refunded). */
    noShare: boolean;
    /** Local Cooks pays the card processing (claims). */
    processingAbsorbed: boolean;
    processingFeeCents: number;
    transferId: string | null;
    /** Original payout, before any later reversal. */
    transferredCents: number | null;
    transferredAt: string | null;
    reversedCents?: number;
  };
}
/** A transfer to the kitchen that is not funded by one of the chef's payments (Local Cooks paid a claim). */
export interface CompensationFact { transferId: string; amountCents: number; transferredAt: string | null; label: string; detail?: string }
/** Time the kitchen added at no charge: shown on the statement so the session length adds up. */
export interface FreeTimeFact { label: string; detail: string }
export interface BookingMoney { booking: BookingFacts; payments: PaymentFact[]; compensations: CompensationFact[]; freeTime: FreeTimeFact[] }

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const taxLabel = (rate: number | null) => rate ? `HST (${Number(rate.toFixed(3))}%)` : 'HST';
export function chargedLines(payment: Pick<PaymentFact, 'items' | 'taxCents' | 'taxRatePercent' | 'serviceFeeCents'>): DocLine[] {
  return [
    ...payment.items.map(item => ({ label: item.label, detail: item.detail, amountCents: item.subtotalCents, tone: 'item' as const })),
    ...(payment.taxCents ? [{ label: taxLabel(payment.taxRatePercent), amountCents: payment.taxCents, tone: 'tax' as const }] : []),
    // Owner: never print the percentage; hidden when there is no fee.
    ...(payment.serviceFeeCents ? [{ label: 'Service fee', amountCents: payment.serviceFeeCents, tone: 'fee' as const }] : []),
  ];
}
/** Fails closed: a receipt whose lines do not add up to what Stripe charged is never issued. */
export function assertLinesAddUp(lines: DocLine[], totalCents: number, what: string) {
  const total = sum(lines.filter(line => line.tone !== 'note' && line.tone !== 'subtotal').map(line => line.amountCents ?? 0));
  if (total !== totalCents) throw Error(`${what} lines (${total}) do not add up to ${totalCents}`);
}

function header(booking: BookingFacts, audience: DocumentAudience) {
  const parties = [
    { label: 'Kitchen', value: booking.kitchenName },
    ...(booking.locationName ? [{ label: 'Location', value: booking.locationName, ...(booking.locationAddress ? { detail: booking.locationAddress } : {}) }] : []),
    { label: audience === 'chef' ? 'Billed to' : 'Chef', value: booking.chefName, ...(audience === 'chef' && booking.chefEmail ? { detail: booking.chefEmail } : {}) },
  ];
  const slots = booking.originalSlots;
  const meta = [
    { label: 'Booking', value: booking.reference },
    { label: 'Visit date', value: formatDay(booking.bookingDate) },
    ...(slots.length && booking.pricingMode !== 'daily'
      ? [{ label: 'Booked time', value: `${slots.map(slot => formatTimeRange(slot.startTime, slot.endTime)).join(', ')} ${friendlyTimezoneName(booking.timezone)}` }] : []),
  ];
  return { parties, meta };
}
const base = (kind: DocumentKind, audience: DocumentAudience, title: string, booking: BookingFacts, number: string, issuedAt: string, supplier: DocumentSupplier) =>
  ({ version: 1 as const, kind, audience, number, title, issuedAt, timezone: booking.timezone, currency: 'CAD', supplier, ...header(booking, audience), references: null });

// ── Builders ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface IssueContext { number: string; issuedAt: string; supplier: DocumentSupplier }

export function buildPaymentReceipt(booking: BookingFacts, payment: PaymentFact, ctx: IssueContext & { card?: { brand: string; last4: string } | null }): DocumentSnapshot {
  const lines = chargedLines(payment);
  assertLinesAddUp(lines, payment.amountCents, 'Receipt');
  const paidOn = payment.paidAt ? ` on ${formatInstantDate(payment.paidAt, booking.timezone)}` : '';
  return { ...base('payment', 'chef', 'Receipt', booking, ctx.number, ctx.issuedAt, ctx.supplier), sections: [{ lines }],
    total: { label: 'Total paid', amountCents: payment.amountCents },
    notes: [ctx.card ? `Paid with ${formatCard(ctx.card)}${paidOn}.` : `Paid by card${paidOn}.`] };
}

export function buildRefundReceipt(booking: BookingFacts, payment: PaymentFact, refund: RefundFact, original: { number: string },
  ctx: IssueContext & { card?: { brand: string; last4: string } | null }): DocumentSnapshot {
  const on = refund.refundedAt ? ` on ${formatInstantDate(refund.refundedAt, booking.timezone)}` : '';
  return { ...base('refund', 'chef', 'Refund receipt', booking, ctx.number, ctx.issuedAt, ctx.supplier), references: { number: original.number },
    sections: [{ lines: [{ label: refund.reason, detail: `Refund of receipt ${original.number}`, amountCents: -refund.amountCents, tone: 'refund' }] }],
    total: { label: 'Total refunded', amountCents: -refund.amountCents },
    notes: [`Refunded to ${ctx.card ? formatCard(ctx.card) : 'the original card'}${on}. Banks can take 5–10 business days to show it.`] };
}

/** Kitchen side of a refund taken back after the payout was sent (a transfer reversal). */
export function buildPayoutReversal(booking: BookingFacts, refund: RefundFact, reversedCents: number, original: { number: string }, ctx: IssueContext): DocumentSnapshot {
  return { ...base('refund', 'manager', 'Payout adjustment', booking, ctx.number, ctx.issuedAt, ctx.supplier), references: { number: original.number },
    sections: [{ lines: [{ label: `Returned to the chef: ${refund.reason.toLowerCase()}`, detail: `Adjusts remittance ${original.number}`, amountCents: -reversedCents, tone: 'refund' }] }],
    total: { label: 'Taken from your payout', amountCents: -reversedCents }, notes: [] };
}

/** booking + HST − card processing (− anything already refunded to the chef) = the transfer. No service fee in or out. */
export function remittanceLines(payment: PaymentFact): DocLine[] {
  const items = (payment.kitchenItems || payment.items).map(item => ({ label: item.label, detail: item.detail, amountCents: item.subtotalCents, tone: 'item' as const }));
  const tax = payment.taxCents ? [{ label: taxLabel(payment.taxRatePercent), amountCents: payment.taxCents, tone: 'tax' as const }] : [];
  const processing = !payment.kitchen.processingAbsorbed && payment.kitchen.processingFeeCents
    ? [{ label: 'Card processing', amountCents: -payment.kitchen.processingFeeCents, tone: 'deduction' as const }] : [];
  const lines: DocLine[] = [...items, ...tax, ...processing];
  const transferred = payment.kitchen.transferredCents ?? 0;
  const gap = sum(lines.map(line => line.amountCents ?? 0)) - transferred;
  const refunded = sum(payment.refunds.map(refund => refund.managerDebitedCents));
  if (gap > 0 && gap <= refunded) lines.push({ label: 'Refunded to the chef before payout', amountCents: -gap, tone: 'refund' });
  else if (gap !== 0) lines.push({ label: 'Adjustment', detail: 'Difference recorded on the transfer', amountCents: -gap, tone: 'deduction' });
  return lines;
}
export function buildRemittance(booking: BookingFacts, payment: PaymentFact, ctx: IssueContext): DocumentSnapshot {
  if (!payment.kitchen.transferId || payment.kitchen.transferredCents == null) throw Error('A remittance needs a recorded transfer');
  const lines = remittanceLines(payment);
  assertLinesAddUp(lines, payment.kitchen.transferredCents, 'Remittance');
  return { ...base('remittance', 'manager', 'Payout remittance', booking, ctx.number, ctx.issuedAt, ctx.supplier), sections: [{ lines }],
    total: { label: 'Paid to you', amountCents: payment.kitchen.transferredCents },
    notes: [transferNote(payment.kitchen.transferredAt, booking.timezone),
      ...(payment.kitchen.processingAbsorbed ? ['Local Cooks paid the card processing on this payment.'] : [])] };
}
export function buildCompensationRemittance(booking: BookingFacts, compensation: CompensationFact, ctx: IssueContext): DocumentSnapshot {
  return { ...base('remittance', 'manager', 'Payout remittance', booking, ctx.number, ctx.issuedAt, ctx.supplier),
    sections: [{ lines: [{ label: compensation.label, detail: compensation.detail, amountCents: compensation.amountCents, tone: 'item' }] }],
    total: { label: 'Paid to you', amountCents: compensation.amountCents }, notes: [transferNote(compensation.transferredAt, booking.timezone)] };
}
const transferNote = (at: string | null, timezone: string) => at ? `Paid to your Stripe account on ${formatInstantDate(at, timezone)}.` : 'Paid to your Stripe account.';

/** Summary of already-issued documents. A statement never recomputes money: it adds up the issued snapshots. */
export function buildStatement(audience: DocumentAudience, booking: BookingFacts, documents: DocumentSnapshot[], freeTime: FreeTimeFact[], ctx: IssueContext): DocumentSnapshot {
  const included = documents.filter(doc => doc.audience === audience && doc.kind !== 'statement')
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.number.localeCompare(b.number));
  const sections: DocSection[] = included.map(doc => ({ heading: `${doc.title} ${doc.number}`,
    lines: [...doc.sections.flatMap(section => section.lines), { label: doc.total.label, amountCents: doc.total.amountCents, tone: 'subtotal' as const }] }));
  if (freeTime.length) sections.push({ heading: 'Time added at no charge', lines: freeTime.map(item => ({ label: item.label, detail: item.detail, amountCents: 0, tone: 'note' as const })) });
  const total = sum(included.map(doc => doc.total.amountCents));
  return { ...base('statement', audience, audience === 'chef' ? 'Booking statement' : 'Payout statement', booking, ctx.number, ctx.issuedAt, ctx.supplier),
    sections, total: { label: audience === 'chef' ? (included.some(doc => doc.kind === 'refund') ? 'Net paid' : 'Total paid') : 'Total paid to you', amountCents: total },
    notes: ['Final statement for this booking. Any later payment or refund gets its own receipt.'] };
}

// ── Settlement ────────────────────────────────────────────────────────────────────────────────────────────────
export interface SettlementState {
  bookingStatus: string;
  /** Service ended and every visit's inspection is closed (cleared, auto-closed, legacy, or an issue was filed). */
  visitsClosed: boolean;
  /** Claims that are not final, or chef-paid claims whose kitchen transfer has not succeeded. */
  openClaims: number;
  /** Extra-time / extension charges offered, requested or mid-payment. */
  openExtraTimeCharges: number;
  /** Payments still pending/authorized/processing. */
  pendingPayments: number;
  /** Refund decisions not yet confirmed by Stripe. */
  pendingRefunds: number;
  /** Captured payments with a kitchen share still owed and no transfer. */
  untransferredPayouts: number;
  /** An open support/dispute flag or an executing support money action. */
  moneyFrozen: boolean;
}
const CANCELLED = ['cancelled', 'declined', 'rejected', 'expired'];
/**
 * A booking is settled when nothing about its money can still change on its own: the visit is over and inspected
 * (or it was cancelled before), there is no open claim, no unpaid extra-time charge, no pending payment or refund,
 * every kitchen share has been transferred, and no support flag/dispute holds the booking's money.
 */
export function bookingSettled(state: SettlementState): { settled: boolean; blockers: string[] } {
  const blockers = [
    ...(!CANCELLED.includes(state.bookingStatus) && !state.visitsClosed ? ['visit_open'] : []),
    ...(state.openClaims ? ['claim_open'] : []),
    ...(state.openExtraTimeCharges ? ['extra_time_unpaid'] : []),
    ...(state.pendingPayments ? ['payment_pending'] : []),
    ...(state.pendingRefunds ? ['refund_pending'] : []),
    ...(state.untransferredPayouts ? ['payout_pending'] : []),
    ...(state.moneyFrozen ? ['support_hold'] : []),
  ];
  return { settled: blockers.length === 0, blockers };
}
