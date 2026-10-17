import { describe, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
import { deriveBookingMoney, ensureBookingDocuments, planBookingDocuments, settlementState,
  type DocumentStore, type IssueDeps, type MoneyRows, type StoredDocument } from './booking-documents';
import { recordPayoutTransferEvidence } from './payout-document-evidence';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SettlementState } from '@shared/booking-documents';

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


describe('predeploy finding 6: immutable payout and verified reversals', () => {
  it('a fee callback reducing the net cannot erase the adjustment or rewrite the original remittance', async () => {
    const rows = booking175(), d = deps(() => rows, { ...SETTLED, bookingStatus: 'confirmed' });
    const before = (await ensureBookingDocuments(175, d)).documents;
    const original = before.find(doc => doc.kind === 'remittance' && doc.sourceKey.endsWith(rows.payments[0].transferId!))!;
    rows.payments[0].status = 'partially_refunded'; rows.payments[0].refundAmount = '100';
    const metadata = rows.payments[0].metadata as any;
    metadata.transfer.transferredCents = 2632;
    metadata.refunds = [{ id: 're_after_payout', customerReceived: 100, managerDebited: 100 }];
    rows.payments[0].payoutTransfers = { [rows.payments[0].transferId!]: { originalAmountCents: 2732, reversedCents: 100,
      refunds: { re_after_payout: { amountCents: 100 } } } };
    const after = (await ensureBookingDocuments(175, d)).documents;
    expect(after.find(doc => doc.id === original.id)).toEqual(original);
    expect(of(after, 'refund', 'manager')).toEqual([expect.objectContaining({ amountCents: -100, referencesDocumentId: original.id })]);
  });
  it('attributes a verified reversal to its refund, without charging the earlier pre-payout refund again', () => {
    const rows = booking175(), source = rows.payments[0], m = source.metadata as any;
    m.transfer.transferredCents = 2532;
    m.refunds = [{ id: 're_before', customerReceived: 100, managerDebited: 100 }, { id: 're_after', customerReceived: 100, managerDebited: 100 }];
    source.payoutTransfers = { [source.transferId!]: { originalAmountCents: 2632, reversedCents: 100, refunds: { re_after: { amountCents: 100 } } } };
    const money = deriveBookingMoney(rows), plan = planBookingDocuments(money, false);
    expect(money.payments[0].kitchen.transferredCents).toBe(2632);
    expect(plan.filter(doc => doc.kind === 'refund' && doc.audience === 'manager').map(doc => doc.sourceKey)).toEqual(['refund:manager:re_after']);
  });
  it('stores provider evidence separately from replaceable payment metadata and refuses an original amount change', async () => {
    const dialect = new PgDialect(), history: any[] = [];
    const tx: any = { execute: vi.fn(async (query: any) => {
      const { sql, params } = dialect.sqlToQuery(query);
      if (sql.startsWith('SELECT')) return { rows: history.length ? [{ metadata: history.at(-1) }] : [] };
      history.push(JSON.parse(params.find(value => typeof value === 'string' && value.startsWith('{')) as string));
      return { rows: [] };
    }) };
    await recordPayoutTransferEvidence(tx, 'pi_1', { transferId: 'tr_1', originalAmountCents: 1000, reversedCents: 0 });
    await recordPayoutTransferEvidence(tx, 'pi_1', { transferId: 'tr_1', originalAmountCents: 1000, reversedCents: 100,
      refund: { refundId: 're_1', reversalId: 'trr_1', amountCents: 100 } });
    expect(history.at(-1)).toMatchObject({ originalAmountCents: 1000, reversedCents: 100, refunds: { re_1: { reversalId: 'trr_1', amountCents: 100 } } });
    await expect(recordPayoutTransferEvidence(tx, 'pi_1', { transferId: 'tr_1', originalAmountCents: 900, reversedCents: 100 })).rejects.toThrow('Original transfer amount changed');
  });
});

describe('predeploy finding 8: late extension charge accounting without entitlement', () => {
  it('issues the charge receipt and its referencing refund receipt with no kitchen remittance or owed share', async () => {
    const rows = booking175(); rows.payments = []; rows.extensions = [{ id: 80, kind: 'offer', minutes: 30, free: false, status: 'cancelled',
      originalEndTime: '16:55', endTime: '17:25', appliedAt: null, paidAt: null, paymentIntentId: 'pi_late', amountCents: 1501,
      quote: { subtotalCents: 1250, taxCents: 188, commissionCents: 63 }, refundId: 're_late', refundedAt: '2026-10-16T15:00:00Z',
      operation: { action: 'refund', state: 'done', capturedAt: '2026-10-16T14:00:00Z', capturedAmountCents: 1501, chargeId: 'ch_late' } }];
    const money = deriveBookingMoney(rows);
    expect(money.payments[0].kitchen.noShare).toBe(true);
    const d = deps(() => rows, SETTLED);
    const { documents } = await ensureBookingDocuments(175, d);
    const receipt = of(documents, 'payment', 'chef')[0], refund = of(documents, 'refund', 'chef')[0];
    expect(receipt).toMatchObject({ sourceKey: 'payment:chef:pi_late', amountCents: 1501 });
    expect(refund).toMatchObject({ sourceKey: 'refund:chef:re_late', amountCents: -1501, referencesDocumentId: receipt.id });
    expect(of(documents, 'remittance', 'manager')).toEqual([]);
    expect(of(documents, 'statement', 'manager')[0].amountCents).toBe(0);
    expect(rows.extensions[0].appliedAt).toBeNull();
    const again = await ensureBookingDocuments(175, d);
    expect(again.documents).toEqual(documents);
  });
  it('does not invent a completed refund while provider verification is still pending', () => {
    const rows = booking175(); rows.payments = []; rows.extensions = [{ id: 80, kind: 'offer', minutes: 30, free: false, status: 'cancelled',
      originalEndTime: '16:55', endTime: '17:25', appliedAt: null, paidAt: null, paymentIntentId: 'pi_late', amountCents: 1501,
      quote: { subtotalCents: 1250, taxCents: 188, commissionCents: 63 }, refundId: 're_pending', refundedAt: null,
      operation: { action: 'refund', state: 'pending', capturedAt: '2026-10-16T14:00:00Z', capturedAmountCents: 1501 } }];
    const plan = planBookingDocuments(deriveBookingMoney(rows), false);
    expect(plan.map(doc => doc.kind)).toEqual(['payment']);
  });
});

describe('CP5 installment documents', () => {
  const daily = () => {
    const rows = booking175(); rows.extensions = []; rows.payments = [rows.payments[0]];
    rows.payments[0].transferId = null;
    rows.payments[0].metadata = { approvedSubtotal: 2500, approvedTax: 375, platformCommission: 175 };
    rows.payments[0].dayPayouts = [0, 1].map(i => ({ visitId: i + 1, date: i ? '2026-10-17' : '2026-10-15', amountCents: 1366,
      transferId: `tr_day_${i + 1}`, noEntitlement: false, evidence: { sentAt: '2026-10-18T12:00:00Z' }, subtotalCents: 1250,
      taxCents: i ? 188 : 187, stripeFeeCents: i ? 72 : 71 }));
    return rows;
  };
  it('issues one real chef receipt and a separate exact remittance for each daily transfer', () => {
    const money = deriveBookingMoney(daily()), plan = planBookingDocuments(money, false);
    expect(money.payments).toHaveLength(1);
    expect(plan.filter(d => d.kind === 'payment')).toHaveLength(1);
    expect(plan.filter(d => d.kind === 'remittance').map(d => d.sourceKey)).toEqual(['remittance:manager:tr_day_1', 'remittance:manager:tr_day_2']);
    expect(money.payments[0].installments!.reduce((sum, d) => sum + d.kitchen.transferredCents!, 0)).toBe(2732);
  });
  it('waits for the remaining installment before settling the final statement', () => {
    const rows = daily(); rows.payments[0].dayPayouts![1].transferId = null;
    expect(settlementState(rows, deriveBookingMoney(rows), { visitsClosed: true, moneyFrozen: false }).untransferredPayouts).toBe(1);
    rows.payments[0].dayPayouts![1].transferId = 'tr_day_2';
    expect(settlementState(rows, deriveBookingMoney(rows), { visitsClosed: true, moneyFrozen: false }).untransferredPayouts).toBe(0);
  });
});
