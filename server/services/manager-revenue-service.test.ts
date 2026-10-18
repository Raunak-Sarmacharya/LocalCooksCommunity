import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ queries: [] as Array<{ table: string; sql: string; params: unknown[] }>, owned: [] as unknown[], payments: [] as any[], guard: vi.fn() }));
vi.mock('../db', () => ({ db: {
  select: () => { let table: any, condition: any; const chain: any = {
    from: (value: any) => { table = value; return chain; }, innerJoin: () => chain, leftJoin: () => chain,
    where: (value: any) => { condition = value; return chain; }, orderBy: () => chain,
    then: (resolve: any) => { const name = getTableName(table); state.queries.push({ table: name, ...new PgDialect().sqlToQuery(condition) }); resolve(name === 'kitchens' ? state.owned : name === 'payment_transactions' ? state.payments : []); },
  }; return chain; },
} }));
vi.mock('./kitchen-payout-service', () => ({ attachKitchenPayouts: async (rows: unknown[]) => rows }));
vi.mock('./clock-closeout', () => ({ projectBookingCloseouts: async (rows: any[]) => rows.map(row => ({ ...row,
  payout: { status: 'on_hold', holdReason: 'reported_issue', expectedAt: '2099-01-01T12:00:00Z' } })) }));
vi.mock('./kitchen-day-payouts', () => ({ readDayPayouts: async () => [] }));
vi.mock('./storage-payouts', () => ({ storageTermPayout: vi.fn(), storageTermPayoutFacts: vi.fn() }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: state.guard, BookingMoneyFrozen: class extends Error {} }));
import { BookingMoneyFrozen } from './booking-money-guard';
import { readManagerRevenue, revenueQuery } from './manager-revenue-service';
beforeEach(() => { state.queries = []; state.owned = [{ id: 3, name: 'East', locationId: 4, locationName: 'Main' }]; state.payments = []; state.guard.mockReset(); });
describe('manager revenue read scope', () => {
  it('uses the claim transfer freeze check and never inherits the booking inspection or chef-issue hold', async () => {
    state.payments = [{ source: { id: 1, bookingId: 7, bookingType: 'kitchen', status: 'succeeded',
      amount: '5000', baseAmount: '5000', serviceFee: '0', taxAmount: '0', managerRevenue: '5000', chefId: 2,
      paidAt: new Date('2026-10-15T12:00:00Z'), createdAt: new Date('2026-10-15T12:00:00Z'), metadata: { type: 'damage_claim' } },
      booking: { id: 7, referenceCode: 'KB-7', bookingDate: new Date('2026-10-14T12:00:00Z') },
      kitchen: { id: 3, name: 'East' }, location: { id: 4, name: 'Main', timezone: 'America/St_Johns' },
      claim: { transferOperation: { key: 'claim-transfer' } }, chefName: 'Jamie', equipmentCents: 0, storageCents: 0 }];
    const query = { startDate: '2026-10-01', endDate: '2026-10-31' };
    state.guard.mockRejectedValue(new BookingMoneyFrozen());
    const held = await readManagerRevenue(10, query);
    expect(held.upcoming[0]).toMatchObject({ type: 'claim', status: 'on_hold', holdReason: 'support_flag', expectedAt: null, amountCents: 5000 });
    expect(state.guard).toHaveBeenCalledWith({ bookingId: 7, operationKey: 'claim-transfer' });
    state.guard.mockResolvedValue(undefined);
    expect((await readManagerRevenue(10, query)).upcoming[0]).toMatchObject({ type: 'claim', status: 'scheduled', expectedAt: null });
    state.payments[0].source.transferId = 'tr_claim';
    state.payments[0].source.paidAt = new Date('2026-09-15T12:00:00Z');
    state.payments[0].claimPaidAt = new Date('2026-10-15T12:00:00Z');
    expect((await readManagerRevenue(10, query)).paid[0].paidAt).toBe('2026-10-15T12:00:00.000Z');
  });
  it('rejects invalid, reversed and oversized ranges and invalid IDs', () => {
    const base = { startDate: '2026-10-01', endDate: '2026-10-31' };
    for (const change of [{ startDate: '2026-02-30' }, { endDate: '2026-09-01' }, { startDate: '2020-01-01' }, { locationId: '-1' }, { kitchenId: 'no' }])
      expect(revenueQuery.safeParse({ ...base, ...change }).success).toBe(false);
    expect(revenueQuery.safeParse({ ...base, kitchenId: '3' }).success).toBe(true);
  });
  it('returns no financial data for another location or kitchen', async () => {
    for (const filter of [{ locationId: 99 }, { kitchenId: 99 }]) {
      const ledger = await readManagerRevenue(10, { startDate: '2026-10-01', endDate: '2026-10-31', ...filter });
      expect(ledger.paid).toEqual([]); expect(ledger.upcoming).toEqual([]); expect(ledger.summary.netEarnings).toBe(0);
    }
    expect(state.queries.every(q => q.table === 'kitchens')).toBe(true);
  });
  it('scopes payment and compensation reads to the authenticated manager and selected owned kitchen', async () => {
    await readManagerRevenue(10, { startDate: '2026-10-01', endDate: '2026-10-31', locationId: 4, kitchenId: 3 });
    expect(state.queries.map(q => q.table)).toEqual(['kitchens', 'payment_transactions', 'damage_claims']);
    for (const q of state.queries) { expect(q.sql).toContain('"locations"."manager_id"'); expect(q.params).toContain(10); }
    for (const q of state.queries.slice(1)) { expect(q.sql).toContain('"kitchens"."id"'); expect(q.params).toContain(3); }
  });
});
