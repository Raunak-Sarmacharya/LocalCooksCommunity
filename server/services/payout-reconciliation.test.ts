import { describe, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
import { compareTransfers } from './payout-reconciliation';

describe('payout check against Stripe', () => {
  const settled = (...ids: string[]) => new Map(ids.map(id => [id, true]));
  it('flags only real differences: an amount, a transfer missing on either side', () => {
    const page = new Map([['tr_ok', 1000], ['tr_reversed', 8256], ['tr_ghost', 500]]);
    const stripe = new Map([['tr_ok', 1000], ['tr_reversed', 0], ['tr_new', 300]]);
    expect(compareTransfers(page, stripe, settled('tr_ok', 'tr_reversed', 'tr_new'))).toEqual([
      { transferId: 'tr_reversed', kind: 'amount', pageCents: 8256, stripeCents: 0 },
      { transferId: 'tr_new', kind: 'missing_on_page', pageCents: null, stripeCents: 300 },
      { transferId: 'tr_ghost', kind: 'not_in_stripe', pageCents: 500, stripeCents: null },
    ]);
  });
  it('gives a transfer made in the last half hour time to be recorded on our side', () => {
    expect(compareTransfers(new Map(), new Map([['tr_just_now', 300]]), new Map([['tr_just_now', false]]))).toEqual([]);
  });
});
