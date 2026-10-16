import { describe, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
import { deriveStorageMoney, ensureStorageDocuments, type DocumentStore, type StoredDocument } from './booking-documents';

const booking = { bookingId: 7, reference: 'SB-7', kitchenName: 'Harbour', locationName: null, locationAddress: null, timezone: 'America/St_Johns',
  chefName: 'Sam', chefEmail: null, bookingDate: '2026-10-17', pricingMode: 'daily' as const, originalSlots: [] };
const payment = (extra: Record<string, unknown> = {}) => ({ id: 1, amount: '3550', baseAmount: '3450', serviceFee: '100', taxAmount: '450', stripeProcessingFee: '133',
  managerRevenue: '3317', refundAmount: '1183', paymentIntentId: 'pi_1', chargeId: 'ch_1', transferId: 'tr_1', status: 'partially_refunded', paidAt: '2026-10-16T12:00:00Z',
  metadata: { refunds: [{ id: 're_1', customerReceived: 1183, managerDebited: 1150, platformServiceFeeReturned: 33 }], payoutSent: { amountCents: 2167 } }, ...extra });
const rows = { booking, listingName: 'Shelf', terms: [{ startsOn: '2026-10-17', endsOn: '2026-10-19', days: 3, subtotalCents: 3000, taxCents: 450, payment: payment() }] };

describe('storage documents', () => {
  it('labels each term and issues receipt, refund receipt and remittance under storage keys, idempotently', async () => {
    const money = deriveStorageMoney(rows);
    expect(money.payments[0].items[0].label).toBe('Storage · Shelf · Sat, Oct 17–Mon, Oct 19 (3 days)');
    expect(money.payments[0]).toMatchObject({ serviceFeeCents: 100, taxCents: 450, refunds: [{ reason: 'Storage refund', amountCents: 1183, managerDebitedCents: 1150 }] });
    const stored: StoredDocument[] = [];
    const store: DocumentStore = { locked: (_id, fn) => fn(store), list: async () => [...stored], nextSequence: async () => stored.length + 1,
      insert: async doc => { const row = { ...doc, id: stored.length + 1 }; stored.push(row); return row; } };
    const deps = { store, loadRows: async () => rows, cardLookup: async () => null, taxNumber: async () => null, now: () => new Date('2026-10-20T12:00:00Z') };
    await ensureStorageDocuments(7, deps);
    await ensureStorageDocuments(7, deps);
    expect(stored.map(doc => [doc.sourceKey, doc.amountCents])).toEqual([['storage:payment:chef:pi_1', 3550], ['storage:refund:chef:re_1', -1183],
      ['storage:remittance:manager:tr_1', 2167]]);
    expect(JSON.stringify(stored.find(doc => doc.kind === 'remittance')!.snapshot)).toContain('Card processing');
  });
});
