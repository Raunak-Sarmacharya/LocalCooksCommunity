import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

type Row = { chefId: number; customerId: string | null; methodId: string | null; updatedAt: Date };
const state = vi.hoisted(() => ({ kitchen: [] as any[], storage: [] as any[], locks: [] as any[] }));
vi.mock('../db', () => {
  const paramsOf = (condition: any) => new PgDialect().sqlToQuery(condition).params as unknown[];
  const db: any = {
    transaction: async (run: any) => run(db),
    execute: async () => ({ rows: state.locks }),
    select: () => { let rows: Row[] = [];
      const chain: any = { from: (table: any) => { rows = getTableName(table) === 'kitchen_bookings' ? state.kitchen : state.storage; return chain; },
        where: (condition: any) => { const [chefId] = paramsOf(condition); rows = rows.filter(row => row.chefId === chefId && row.methodId); return chain; },
        groupBy: () => chain,
        then: (resolve: any) => resolve(rows.map(row => ({ customerId: row.customerId, methodId: row.methodId, at: row.updatedAt }))) };
      return chain; },
    update: (table: any) => ({ set: (input: any) => ({ where: async (condition: any) => {
      const [chefId, ...methods] = paramsOf(condition), rows = getTableName(table) === 'kitchen_bookings' ? state.kitchen : state.storage;
      for (const row of rows) if (row.chefId === chefId && methods.includes(row.methodId)) row.methodId = input.stripePaymentMethodId;
    } }) }),
  };
  return { db };
});
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { listSavedCards, removeSavedCard } from './chef-saved-cards';

const visa = (fingerprint: string | null, last4 = '4242') => ({ livemode: false, customer: 'cus', card: { brand: 'visa', last4, exp_month: 12, exp_year: 2030, fingerprint, wallet: null } });
const row = (chefId: number, methodId: string, customerId: string, day: number): Row => ({ chefId, customerId, methodId, updatedAt: new Date(`2026-10-${10 + day}T12:00:00Z`) });
const OWNER: Record<string, string> = { pm_a1: 'cus_1', pm_a2: 'cus_2', pm_b: 'cus_3', pm_other: 'cus_9' };
let methods: Record<string, any>;
const stripe = { paymentMethods: {
  retrieve: vi.fn(async (id: string) => { if (!methods[id]) throw Object.assign(new Error('nope'), { code: 'resource_missing' }); if (methods[id] === 'boom') throw new Error('network'); return methods[id].customer === 'cus' ? { ...methods[id], customer: OWNER[id] } : methods[id]; }),
  detach: vi.fn(async (id: string) => { if (methods[id] === 'cannot') throw new Error('network'); if (methods[id]?.customer === null) throw new Error('The payment method you provided is not attached to a customer'); return methods[id]; }),
} } as any;

beforeEach(() => {
  process.env.VISIT_CODE_HMAC_SECRET = 'x'.repeat(40);
  state.locks = []; stripe.paymentMethods.retrieve.mockClear(); stripe.paymentMethods.detach.mockClear();
  methods = { pm_a1: visa('fp_a'), pm_a2: visa('fp_a'), pm_b: visa('fp_b', '1881'), pm_gone: { ...visa('fp_a'), customer: null } };
  state.kitchen = [row(7, 'pm_a1', 'cus_1', 1), row(7, 'pm_b', 'cus_3', 5), row(7, 'pm_gone', 'cus_4', 9), row(8, 'pm_other', 'cus_9', 2), { ...row(7, 'pm_x', 'cus_x', 3), methodId: null }];
  state.storage = [row(7, 'pm_a2', 'cus_2', 3), row(8, 'pm_a1', 'cus_1', 1)];
  methods.pm_other = visa('fp_a');
});

describe('listSavedCards', () => {
  it('groups payment methods that share a fingerprint into one card, newest-used first, with an opaque handle', async () => {
    const { cards } = await listSavedCards(7, stripe);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ brand: 'visa', last4: '1881', expMonth: 12, expYear: 2030, wallet: null, lastUsedAt: '2026-10-15T12:00:00.000Z' });
    expect(cards[1]).toMatchObject({ last4: '4242', lastUsedAt: '2026-10-13T12:00:00.000Z' });
    expect(cards[0].id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(cards)).not.toMatch(/pm_|cus_|fp_/);
    expect((await listSavedCards(7, stripe)).cards.map(card => card.id)).toEqual(cards.map(card => card.id));
  });
  it('skips detached methods and methods Stripe cannot return, instead of failing the list', async () => {
    methods.pm_b = 'boom'; delete methods.pm_a2;
    const { cards } = await listSavedCards(7, stripe);
    expect(cards.map(card => card.last4)).toEqual(['4242']);
  });
  it('falls back to brand, last four and expiry when Stripe sends no fingerprint', async () => {
    methods.pm_a1 = visa(null); methods.pm_a2 = visa(null);
    expect((await listSavedCards(7, stripe)).cards).toHaveLength(2);
  });
  it('ignores a method attached to a different customer than the booking recorded', async () => {
    methods.pm_b = { ...visa('fp_b'), customer: { id: 'cus_someone_else' } };
    expect((await listSavedCards(7, stripe)).cards.map(card => card.last4)).toEqual(['4242']);
  });
});

describe('lockedReason', () => {
  it('is set per card from any of its payment methods, null for the others', async () => {
    state.locks = [{ reason: 'pending_request', method_id: 'pm_a2' }];
    expect((await listSavedCards(7, stripe)).cards.map(card => [card.last4, card.lockedReason])).toEqual([['1881', null], ['4242', 'pending_request']]);
    state.locks = [{ reason: 'payment_in_progress', method_id: 'pm_b' }];
    expect((await listSavedCards(7, stripe)).cards.map(card => card.lockedReason)).toEqual(['payment_in_progress', null]);
  });
});

describe('removeSavedCard', () => {
  const handleOf = async (last4: string, chefId = 7) => (await listSavedCards(chefId, stripe)).cards.find(card => card.last4 === last4)!.id;
  it('detaches every payment method in the group and clears only this chef’s rows', async () => {
    const id = await handleOf('4242');
    await expect(removeSavedCard(7, id, stripe)).resolves.toEqual({ removed: true });
    expect(stripe.paymentMethods.detach.mock.calls.map(call => call[0]).sort()).toEqual(['pm_a1', 'pm_a2']);
    expect(state.kitchen.find(r => r.customerId === 'cus_1')!.methodId).toBeNull();
    expect(state.storage.find(r => r.customerId === 'cus_2')!.methodId).toBeNull();
    expect(state.kitchen.find(r => r.customerId === 'cus_3')!.methodId).toBe('pm_b');
    expect(state.storage.find(r => r.chefId === 8)!.methodId).toBe('pm_a1'); // another chef, same fingerprint: untouched
    expect((await listSavedCards(7, stripe)).cards.map(card => card.last4)).toEqual(['1881']);
  });
  it('a hold waiting on the kitchen refuses with the exact owner message (and wins over a payment in progress)', async () => {
    const id = await handleOf('4242');
    state.locks = [{ reason: 'payment_in_progress', method_id: 'pm_a1' }, { reason: 'pending_request', method_id: 'pm_a2' }];
    await expect(removeSavedCard(7, id, stripe)).rejects.toMatchObject({ status: 409,
      message: "This card is holding payment for a request the kitchen hasn't answered yet. You can remove it after they answer." });
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
  });
  it('404 for a handle that is not one of this chef’s cards, and never calls detach', async () => {
    await expect(removeSavedCard(7, 'A'.repeat(22), stripe)).rejects.toMatchObject({ status: 404 });
    const other = await handleOf('4242', 8);
    await expect(removeSavedCard(9, other, stripe)).rejects.toMatchObject({ status: 404 });
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
  });
  it('refuses while one of the chef’s payments is mid-flight on this card', async () => {
    const id = await handleOf('4242');
    state.locks = [{ reason: 'payment_in_progress', method_id: 'pm_a2' }];
    await expect(removeSavedCard(7, id, stripe)).rejects.toMatchObject({ status: 409, message: 'A payment with this card is still finishing. Try again in a few minutes.' });
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();
    expect(state.kitchen.find(r => r.customerId === 'cus_1')!.methodId).toBe('pm_a1');
  });
  it('a copy Stripe says is already gone counts as removed', async () => {
    const id = await handleOf('4242');
    stripe.paymentMethods.detach.mockImplementationOnce(async () => { throw Object.assign(new Error('No such PaymentMethod'), { code: 'resource_missing' }); });
    await expect(removeSavedCard(7, id, stripe)).resolves.toEqual({ removed: true });
    expect([state.kitchen.find(r => r.customerId === 'cus_1')!.methodId, state.storage.find(r => r.customerId === 'cus_2')!.methodId]).toEqual([null, null]);
  });
  it('a detach that fails leaves its row in place and tells the chef', async () => {
    const id = await handleOf('4242');
    stripe.paymentMethods.detach.mockImplementationOnce(async () => { throw new Error('network'); });
    await expect(removeSavedCard(7, id, stripe)).rejects.toMatchObject({ status: 503 });
    expect([state.kitchen.find(r => r.customerId === 'cus_1')!.methodId, state.storage.find(r => r.customerId === 'cus_2')!.methodId].filter(Boolean)).toHaveLength(1);
  });
});
