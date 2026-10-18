import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
vi.mock('../db', () => ({ db: {} }));
import { claimOpen, deriveBookingMoney, ensureBookingDocuments, originalSlots, planBookingDocuments, settlementState,
  type DocumentStore, type IssueDeps, type MoneyRows, type StoredDocument } from './booking-documents';
import { renderBookingDocumentPdf } from './booking-document-pdf';
import { bookingSettled, formatTimeRange, type SettlementState } from '@shared/booking-documents';

/** Dev booking #175 (Oct 15, 2026), copied read-only from the dev database. */
const booking175 = (): MoneyRows => ({
  booking: { id: 175, referenceCode: 'KB-BM3QS5', bookingDate: '2026-10-15T14:30:00.000Z', startTime: '15:55', endTime: '17:55',
    selectedSlots: [{ startTime: '15:55', endTime: '16:55' }, { startTime: '16:55', endTime: '17:25' }, { startTime: '17:25', endTime: '17:55' }],
    pricingMode: 'hourly', paymentIntentId: 'pi_3UQtF2CvcNYAkDXN1hibKVBa', status: 'confirmed' },
  kitchenName: 'PHASE0 Main Kitchen', locationName: 'PHASE0 Test Kitchen (Claude)', locationAddress: "Water St, St. John's, NL, Canada",
  timezone: 'America/St_Johns', chefName: 'TestSprite chef', chefEmail: 'phase0-chef@localcooks.test',
  payments: [
    { id: 141, amount: '3050', baseAmount: '2875', serviceFee: '175', taxAmount: '375', stripeProcessingFee: '143', managerRevenue: '2732', refundAmount: '0',
      paymentIntentId: 'pi_3UQtF2CvcNYAkDXN1hibKVBa', chargeId: 'ch_3UQtF2CvcNYAkDXN1CchZ62X', transferId: 'tr_3UQtF2CvcNYAkDXN1BTEx4u9', status: 'succeeded',
      paidAt: '2026-10-15T20:49:27.498Z', metadata: { transfer: { transferId: 'tr_3UQtF2CvcNYAkDXN1BTEx4u9', transferred: true, transferredAt: '2026-10-15T18:32:15.090Z', transferredCents: 2732 },
        stripeFees: { processingFee: 143 }, approvedTax: 375, taxRatePercent: 15, approvedSubtotal: 2500, platformCommission: 175,
        capturedComponentAllocations: [{ kind: 'kitchen', taxCents: 375, bookingId: 175, subtotalCents: 2500, managerGrossCents: 2875 }] } },
    { id: 142, amount: '1526', baseAmount: '1438', serviceFee: '88', taxAmount: '188', stripeProcessingFee: '86', managerRevenue: '1352', refundAmount: '0',
      paymentIntentId: 'pi_3UQtNlCvcNYAkDXN0ZcXVbvh', chargeId: 'ch_3UQtNlCvcNYAkDXN0Mm2rgdo', transferId: 'tr_3UQtNlCvcNYAkDXN042qWDId', status: 'succeeded',
      paidAt: '2026-10-15T20:58:06.185Z', metadata: { type: 'session_extension', minutes: 30, sessionExtensionId: 7, extensionKind: 'offer', approvedSubtotal: 1250, approvedTax: 188,
        platformCommission: 88, transfer: { transferId: 'tr_3UQtNlCvcNYAkDXN042qWDId', transferred: true, transferredAt: '2026-10-15T18:32:17.022Z', transferredCents: 1352 } } },
  ],
  extensions: [
    { id: 6, kind: 'request', minutes: 30, free: true, status: 'approved', originalEndTime: '16:55', endTime: '17:25', appliedAt: '2026-10-15T18:24:14.125Z', paidAt: null, paymentIntentId: 'pi_3UQtI8CvcNYAkDXN0Y20Ltub' },
    { id: 7, kind: 'offer', minutes: 30, free: false, status: 'approved', originalEndTime: '17:25', endTime: '17:55', appliedAt: '2026-10-15T18:28:01.272Z', paidAt: '2026-10-15T18:28:01.272Z', paymentIntentId: 'pi_3UQtNlCvcNYAkDXN0ZcXVbvh' },
    { id: 8, kind: 'offer', minutes: 30, free: false, status: 'offered', originalEndTime: '17:55', endTime: '18:25', appliedAt: null, paidAt: null, paymentIntentId: null },
  ],
  claims: [],
  addonNames: { storage: {}, equipment: {} },
});
const SETTLED: SettlementState = { bookingStatus: 'completed', visitsClosed: true, openClaims: 0, openExtraTimeCharges: 0, pendingPayments: 0,
  pendingRefunds: 0, untransferredPayouts: 0, moneyFrozen: false };

function memoryStore() {
  const docs: StoredDocument[] = [];
  let sequence = 0, inserts = 0;
  const store: DocumentStore & { docs: StoredDocument[]; inserts: () => number; sequence: () => number } = {
    docs, inserts: () => inserts, sequence: () => sequence,
    locked: (_id, fn) => fn(store),
    list: async bookingId => docs.filter(doc => doc.bookingId === bookingId).map(doc => structuredClone(doc)),
    nextSequence: async () => ++sequence,
    insert: async doc => {
      const existing = docs.find(item => item.sourceKey === doc.sourceKey);
      if (existing) return structuredClone(existing);
      inserts += 1;
      const { stripe: _stripe, ...row } = doc;
      const stored = { ...structuredClone(row), id: docs.length + 1 };
      docs.push(stored);
      return structuredClone(stored);
    },
  };
  return store;
}
function deps(rows: () => MoneyRows, settlement: SettlementState, store = memoryStore(), cardLookup = vi.fn(async () => ({ brand: 'visa', last4: '4242' }))) {
  let tick = Date.parse('2026-10-16T12:00:00Z');
  const value: IssueDeps & { store: ReturnType<typeof memoryStore> } = { store, loadRows: async () => rows(), settlement: async () => settlement, cardLookup,
    taxNumber: async () => null, now: () => new Date(tick += 1000) };
  return value;
}
const of = (docs: StoredDocument[], kind: string, audience: string) => docs.filter(doc => doc.kind === kind && doc.audience === audience);

describe('booking #175 money facts', () => {
  it('recovers the purchased hour from slots that now include the extra time', () => {
    expect(originalSlots(booking175())).toEqual([{ startTime: '15:55', endTime: '16:55' }]);
    expect(formatTimeRange('11:00', '13:00')).toBe('11:00 a.m.–1:00 p.m.');
  });
  it('itemizes the booking and the paid kitchen offer as separate payments', () => {
    const money = deriveBookingMoney(booking175());
    expect(money.payments.map(payment => ({ items: payment.items, tax: payment.taxCents, fee: payment.serviceFeeCents, total: payment.amountCents }))).toEqual([
      { items: [{ label: 'Kitchen session', detail: 'Thu, Oct 15 · 3:55–4:55 p.m. (1 hr)', subtotalCents: 2500 }], tax: 375, fee: 175, total: 3050 },
      { items: [{ label: 'More time', detail: 'Thu, Oct 15 · 5:25–5:55 p.m. (30 min · accepted kitchen offer)', subtotalCents: 1250 }], tax: 188, fee: 88, total: 1526 },
    ]);
    expect(money.freeTime).toEqual([{ label: 'More time', detail: 'Thu, Oct 15 · 4:55–5:25 p.m. (30 min) · added by the kitchen' }]);
  });
});

describe('issuing documents', () => {
  it('issues receipts $30.50 + $15.26, remittances $27.32 + $13.52 and both statements once settled', async () => {
    const d = deps(booking175, SETTLED);
    const { documents, settled } = await ensureBookingDocuments(175, d);
    expect(settled).toBe(true);
    expect(of(documents, 'payment', 'chef').map(doc => [doc.number, doc.amountCents])).toEqual([['LC-R-000001', 3050], ['LC-R-000002', 1526]]);
    expect(of(documents, 'remittance', 'manager').map(doc => doc.amountCents)).toEqual([2732, 1352]);
    const remittance = of(documents, 'remittance', 'manager')[0].snapshot;
    expect(remittance.sections[0].lines.map(line => [line.label, line.amountCents])).toEqual([['Kitchen session', 2500], ['HST (15%)', 375], ['Card processing', -143]]);
    expect(remittance.notes[0]).toBe('Paid to your Stripe account on Oct 15, 2026.');
    expect(JSON.stringify(of(documents, 'remittance', 'manager'))).not.toMatch(/Service fee/);
    const receipt = of(documents, 'payment', 'chef')[0].snapshot;
    expect(receipt.title).toBe('Receipt');
    expect(receipt.sections[0].lines.map(line => line.label)).toEqual(['Kitchen session', 'HST (15%)', 'Service fee']);
    expect(receipt.notes[0]).toBe('Paid with Visa •••• 4242 on Oct 15, 2026.');
    expect(receipt.meta).toContainEqual({ label: 'Booked time', value: '3:55–4:55 p.m. Newfoundland Time' });
    expect(receipt.parties).toContainEqual({ label: 'Billed to', value: 'TestSprite chef', detail: 'phase0-chef@localcooks.test' });
    expect(receipt.supplier).toMatchObject({ name: 'Local Cooks', website: 'localcooks.ca', address: '4 Priscilla Place, Paradise, NL', taxNumber: null });
    expect(of(documents, 'statement', 'chef')[0].amountCents).toBe(4576);
    expect(of(documents, 'statement', 'manager')[0].amountCents).toBe(4084);
    expect(of(documents, 'statement', 'chef')[0].snapshot.sections.at(-1)?.heading).toBe('Time added at no charge');
  });

  it('is idempotent per Stripe object: a second run issues nothing and asks Stripe for nothing', async () => {
    const d = deps(booking175, SETTLED);
    const first = await ensureBookingDocuments(175, d);
    const inserts = d.store.inserts(), sequence = d.store.sequence();
    const second = await ensureBookingDocuments(175, d);
    expect(d.store.inserts()).toBe(inserts);
    expect(d.store.sequence()).toBe(sequence);
    expect(d.cardLookup).toHaveBeenCalledTimes(2);
    expect(second.documents).toEqual(first.documents);
  });

  it('issues no statement before settlement; receipts and remittances still go out', async () => {
    const unsettled = { ...SETTLED, visitsClosed: false, untransferredPayouts: 1 };
    expect(bookingSettled(unsettled)).toEqual({ settled: false, blockers: ['visit_open', 'payout_pending'] });
    const { documents, settled, blockers } = await ensureBookingDocuments(175, deps(booking175, unsettled));
    expect(settled).toBe(false);
    expect(blockers).toContain('visit_open');
    expect(documents.filter(doc => doc.kind === 'statement')).toEqual([]);
    expect(of(documents, 'payment', 'chef')).toHaveLength(2);
  });

  it('never rewrites an issued document: a later refund gets its own receipt referencing the original', async () => {
    let rows = booking175();
    const d = deps(() => rows, SETTLED);
    const before = (await ensureBookingDocuments(175, d)).documents;
    rows = booking175();
    rows.payments[0] = { ...rows.payments[0], status: 'partially_refunded', refundAmount: '1000', refundedAt: '2026-10-17T15:00:00Z',
      metadata: { ...(rows.payments[0].metadata as object), refunds: [{ id: 're_goodwill', customerReceived: 1000, managerDebited: 0, platformServiceFeeReturned: 0, platformGoodwillCents: 1000 }] } };
    const after = (await ensureBookingDocuments(175, d)).documents;
    for (const doc of before) expect(after.find(item => item.id === doc.id)).toEqual(doc);
    const [refund] = of(after, 'refund', 'chef');
    expect(refund).toMatchObject({ number: 'LC-RF-000007', amountCents: -1000, referencesDocumentId: of(before, 'payment', 'chef')[0].id });
    expect(refund.snapshot.references).toEqual({ number: 'LC-R-000001' });
    expect(refund.snapshot.sections[0].lines[0].label).toBe('Goodwill refund from Local Cooks');
    // Goodwill is funded by Local Cooks: the kitchen keeps its payout, so no payout adjustment.
    expect(of(after, 'refund', 'manager')).toEqual([]);
    expect(of(after, 'statement', 'chef')).toEqual(of(before, 'statement', 'chef'));
  });

  it('uses one approved change destination on every source refund receipt and leaves source receipts unchanged', async () => {
    let rows = booking175();
    rows.changes = [{ id: 'change_final', destination: { date: '2026-10-20', pricingMode: 'hourly',
      slots: [{ startTime: '10:00', endTime: '11:00' }] } }];
    const d = deps(() => rows, SETTLED);
    const before = (await ensureBookingDocuments(175, d)).documents;
    rows = structuredClone(rows);
    rows.payments = rows.payments.map((payment, index) => ({ ...payment, status: 'partially_refunded', refundAmount: index ? '500' : '1000',
      refundedAt: '2026-10-17T15:00:00Z', metadata: { ...(payment.metadata as object), refunds: [{ id: `re_change_${index + 1}`,
        kitchenChangeId: 'change_final', customerReceived: index ? 500 : 1000, managerDebited: index ? 450 : 900,
        platformServiceFeeReturned: index ? 50 : 100 }] } }));
    const after = (await ensureBookingDocuments(175, d)).documents;
    for (const receipt of of(before, 'payment', 'chef')) expect(after.find(item => item.id === receipt.id)).toEqual(receipt);
    const refunds = of(after, 'refund', 'chef');
    expect(refunds).toHaveLength(2);
    for (const refund of refunds) {
      expect(refund.snapshot.meta.find(item => item.label === 'Visit date')?.value).toContain('Oct 20');
      expect(refund.snapshot.meta.find(item => item.label === 'Booked time')?.value).toContain('10:00');
    }
  });

  it('renders the stored snapshot to identical bytes every time', async () => {
    const { documents } = await ensureBookingDocuments(175, deps(booking175, SETTLED));
    for (const doc of documents) {
      const [a, b] = await Promise.all([renderBookingDocumentPdf(doc.snapshot), renderBookingDocumentPdf(structuredClone(doc.snapshot))]);
      expect(a.subarray(0, 4).toString()).toBe('%PDF');
      expect(a.equals(b)).toBe(true);
    }
    const dir = process.env.RECEIPTS_RENDER_DIR;
    if (dir) for (const doc of documents) fs.writeFileSync(path.join(dir, `175-${doc.number}.pdf`), await renderBookingDocumentPdf(doc.snapshot));
  });

  it('fails closed: a payment whose recorded parts exceed the charge gets no receipt and blocks the chef statement', async () => {
    const rows = booking175();
    rows.payments[1] = { ...rows.payments[1], amount: '1400' };
    const { documents } = await ensureBookingDocuments(175, deps(() => rows, SETTLED));
    expect(of(documents, 'payment', 'chef').map(doc => doc.amountCents)).toEqual([3050]);
    expect(of(documents, 'statement', 'chef')).toEqual([]);
    expect(of(documents, 'statement', 'manager')).toHaveLength(1);
  });
});

describe('refunds, claims and settlement', () => {
  it('shows a cancellation refund withheld before the payout on the remittance, and one taken back after it as an adjustment', () => {
    const rows = booking175();
    rows.payments = [{ ...rows.payments[0], status: 'partially_refunded', refundAmount: '1500',
      metadata: { ...(rows.payments[0].metadata as object), transfer: { transferId: 'tr_1', transferredAt: '2026-10-15T18:32:15Z', transferredCents: 1732 },
        refunds: [{ id: 're_1', customerReceived: 1500, managerDebited: 1500, platformServiceFeeReturned: 0 }], cancellationRefundOperation: { status: 'succeeded', refundId: 're_1' } } }];
    rows.payments[0].transferId = 'tr_1';
    rows.payments[0].payoutTransfers = { tr_1: { originalAmountCents: 1732, reversedCents: 500, refunds: { re_1: { amountCents: 500 } } } };
    const money = deriveBookingMoney(rows);
    const plan = planBookingDocuments(money, false);
    const remittance = plan.find(item => item.kind === 'remittance')!.build({ number: 'LC-PR-000001', issuedAt: '2026-10-16T00:00:00Z',
      supplier: { name: 'Local Cooks', legalNote: '', address: '', website: '', email: '', taxNumber: null }, card: null, issued: [] });
    expect(remittance.sections[0].lines.at(-1)).toEqual({ label: 'Refunded to the chef before payout', amountCents: -1000, tone: 'refund' });
    expect(remittance.total.amountCents).toBe(1732);
    const reversal = plan.find(item => item.kind === 'refund' && item.audience === 'manager')!;
    expect(reversal.build({ number: 'LC-RV-000002', issuedAt: '2026-10-16T00:00:00Z', supplier: { name: 'Local Cooks', legalNote: '', address: '', website: '', email: '', taxNumber: null },
      card: null, issued: [], referenced: { number: 'LC-PR-000001' } as StoredDocument }).total.amountCents).toBe(-500);
    expect(plan.find(item => item.kind === 'refund' && item.audience === 'chef')!.referencesSourceKey).toBe('payment:chef:pi_3UQtF2CvcNYAkDXN1hibKVBa');
  });

  it('receipts a paid claim with no tax or fee, remits it in full, and remits a Local Cooks-paid claim', () => {
    const rows = booking175();
    rows.payments.push({ id: 150, amount: '8000', baseAmount: '8000', serviceFee: '0', taxAmount: '0', stripeProcessingFee: '262', managerRevenue: '8000', refundAmount: '0',
      paymentIntentId: 'pi_claim', chargeId: 'ch_claim', transferId: 'tr_claim', status: 'succeeded', paidAt: '2026-10-17T12:00:00Z',
      metadata: { type: 'damage_claim', damage_claim_id: '9', damage_claim_v2: 'true', fundedBy: 'chef' } });
    rows.claims = [{ id: 9, claimTitle: 'Cracked cutting board', status: 'charge_succeeded', fundedBy: 'chef', paymentTransactionId: 150, stripePaymentIntentId: 'pi_claim',
      finalAmountCents: 8000, transferOperation: { state: 'succeeded', transferId: 'tr_claim', amountCents: 8000, attemptedAt: '2026-10-17T12:01:00Z' } },
      { id: 10, claimTitle: 'Deep clean', status: 'resolved', fundedBy: 'local_cooks', paymentTransactionId: null, stripePaymentIntentId: null, finalAmountCents: 4000,
        compensationOperation: { state: 'succeeded', transferId: 'tr_comp', amountCents: 4000, attemptedAt: '2026-10-18T12:00:00Z' } }];
    const money = deriveBookingMoney(rows);
    const claim = money.payments.find(payment => payment.purpose === 'claim')!;
    expect(claim).toMatchObject({ items: [{ label: 'Damage claim', detail: 'Cracked cutting board', subtotalCents: 8000 }], taxCents: 0, serviceFeeCents: 0,
      kitchen: { processingAbsorbed: true, transferredCents: 8000 } });
    const plan = planBookingDocuments(money, false).map(item => item.sourceKey);
    expect(plan).toEqual(expect.arrayContaining(['payment:chef:pi_claim', 'remittance:manager:tr_claim', 'remittance:manager:tr_comp']));
    expect(claimOpen(rows.claims[0])).toBe(false);
    expect(claimOpen({ ...rows.claims[0], transferOperation: { state: 'pending' } })).toBe(true);
  });

  it('derives settlement blockers from the recorded state', () => {
    const rows = booking175();
    rows.extensions.push({ id: 9, kind: 'extra_time', minutes: 30, free: false, status: 'offered', originalEndTime: '17:55', endTime: '18:25', appliedAt: null, paidAt: null, paymentIntentId: null });
    rows.payments[1] = { ...rows.payments[1], transferId: null, metadata: { ...(rows.payments[1].metadata as object), transfer: undefined } };
    const state = settlementState(rows, deriveBookingMoney(rows), { visitsClosed: true, moneyFrozen: false });
    expect(state).toMatchObject({ openExtraTimeCharges: 1, untransferredPayouts: 1, openClaims: 0, pendingPayments: 0 });
    // The expired kitchen offer #8 never blocks; an unpaid extra-time charge does.
    expect(bookingSettled(state).blockers).toEqual(['extra_time_unpaid', 'payout_pending']);
    expect(bookingSettled(settlementState(booking175(), deriveBookingMoney(booking175()), { visitsClosed: true, moneyFrozen: false })).settled).toBe(true);
  });
});


it('CP9: receipt and credit note list every dated allocation without duplicating the charge', () => {
  const rows = booking175(); rows.extensions = []; rows.payments = [rows.payments[0]];
  const payment = rows.payments[0]; payment.amount = 2440; payment.baseAmount = 2300; payment.taxAmount = 300; payment.serviceFee = 140; payment.refundAmount = 1220;
  payment.metadata = { datedQuote: { manifest: { days: [
    { date: '2030-01-15', pricingMode: 'hourly', slots: [{ startTime: '09:00', endTime: '10:00' }] },
    { date: '2030-01-18', pricingMode: 'daily', slots: [{ startTime: '08:00', endTime: '18:00' }] }] } },
    capturedComponentAllocations: [{ kind: 'kitchen', sessionIndex: 0, subtotalCents: 1000, taxCents: 150 }, { kind: 'kitchen', sessionIndex: 1, subtotalCents: 1000, taxCents: 150 }],
    refunds: [{ id: 're_day', customerReceived: 1220, managerDebited: 1100 }], cancellationRefundOperation: { dated: true, refundId: 're_day', days: [{ visitId: 9, date: '2030-01-18' }], lines: [{ visitId: 9, kind: 'kitchen', customerCents: 1220 }] } };
  const money = deriveBookingMoney(rows);
  expect(money.payments).toHaveLength(1); expect(money.payments[0].amountCents).toBe(2440);
  expect(money.payments[0].items.map(item => item.detail).join(' ')).toMatch(/Jan 15.*Jan 18.*Full day/);
  expect(money.payments[0].refunds[0].items).toEqual([{ label: '2030-01-18 · Kitchen day', amountCents: 1220 }]);
  const plan = planBookingDocuments(money, false);
  const ctx = { number: 'LC-R-1', issuedAt: '2030-01-19T12:00:00Z', supplier: { name: 'Local Cooks', legalNote: '', address: '', website: '', email: '', taxNumber: null }, referenced: { number: 'LC-R-0' } };
  const receipt = plan[0].build(ctx); expect(receipt.meta.filter(row => row.label === 'Booking day')).toHaveLength(2);
  const credit = plan.find(row => row.audience === 'chef' && row.kind === 'refund')!.build(ctx);
  expect(credit.sections[0].lines[0]).toMatchObject({ label: '2030-01-18 · Kitchen day', amountCents: -1220 });
});
