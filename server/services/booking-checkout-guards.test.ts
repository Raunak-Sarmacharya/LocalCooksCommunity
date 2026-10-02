import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ rows: [] as any[][], writes: [] as any[], conditions: [] as any[], won: true }));
const stripe = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock('./stripe-service', () => ({ cancelPaymentIntent: stripe.cancel }));
vi.mock('../db', () => {
  const db: any = {
    select: () => { const q: any = { from: () => q, innerJoin: () => q, where: () => q,
      limit: async () => state.rows.shift() || [], then: (resolve: any) => resolve(state.rows.shift() || []) }; return q; },
    update: () => ({ set: (value: any) => { state.writes.push(value); return { where: (condition: any) => {
      state.conditions.push(condition); return { returning: async () => state.won ? [{ id: 10 }] : [] };
    } }; } }),
    execute: async () => [], transaction: async (run: any) => run(db),
  }; return { db };
});
vi.mock('./checkin-checkout-checklist', () => ({ getKitchenTrackingState: async () => ({ checkinEnabled: true }), isChecklistSectionEnabled: async () => true }));
import { requestKitchenCheckout, processKitchenCheckoutClear, autoCleanExpiredKitchenCheckout } from './kitchen-checkout-service';
import { checkoutKitchenVisit } from './kitchen-visit-lifecycle';
import { lazyExpireKitchenBookingAuth } from './auth-expiry-service';
const where = () => new PgDialect().sqlToQuery(state.conditions[0]);
describe('checkout guards (mocked database, no Stripe calls)', () => {
  beforeEach(() => { state.rows = []; state.writes = []; state.conditions = []; state.won = true; stripe.cancel.mockClear(); });
  it('rejects cancelled chef checkout without writes', async () => {
    state.rows.push([{ id: 10, chefId: 3, status: 'cancelled', checkinStatus: 'checked_in' }]);
    expect((await requestKitchenCheckout(10, 3)).success).toBe(false);
    expect(state.writes).toEqual([]);
  });
  it('rejects a checkout lost to cancellation or another action', async () => {
    state.won = false; state.rows.push([{ id: 10, chefId: 3, status: 'confirmed', checkinStatus: 'checked_in', locationId: 4, updatedAt: new Date('2026-01-01') }]);
    expect((await requestKitchenCheckout(10, 3)).success).toBe(false);
    expect(where().params).toContain('confirmed');
  });
  it('preserves chef notes and records manager communication separately', async () => {
    state.rows.push([{ id: 10, chefId: 3, checkinStatus: 'checkout_requested', updatedAt: new Date('2026-01-01') }], [{ managerId: 7 }]);
    expect((await processKitchenCheckoutClear(10, 7, 'All clear')).success).toBe(true);
    expect(state.writes[0]).not.toHaveProperty('checkoutNotes');
    expect(state.writes[0]).toMatchObject({ checkoutManagerMessage: 'Message from kitchen manager: All clear' });
    expect(where().params).toEqual(expect.arrayContaining(['confirmed', 'checkout_requested']));
  });
  it('does not announce lazy auto-clear when its guarded update loses', async () => {
    state.won = false;
    expect(await autoCleanExpiredKitchenCheckout(10, 3, new Date('2020-01-01'), 30)).toBe(false);
    expect(state.writes[0]).not.toHaveProperty('checkoutNotes');
    expect(where().params).toEqual(expect.arrayContaining(['confirmed', 'checkout_requested']));
  });
  it('rechecks multi-visit parent after taking its lock', async () => {
    state.rows.push([{ booking: { id: 10, chefId: 3, status: 'confirmed' }, visit: { id: 5, checkinStatus: 'checked_in' }, locationId: 4 }], [{ status: 'cancelled' }]);
    expect((await checkoutKitchenVisit(10, 5, 3)).success).toBe(false);
    expect(state.writes).toEqual([]);
  });
  it('does not void an authorization when approval won before the expiry lock', async () => {
    state.rows.push([{ status: 'confirmed', paymentStatus: 'authorized', paymentIntentId: 'pi_mock', createdAt: new Date('2020-01-01') }]);
    expect(await lazyExpireKitchenBookingAuth({ id: 10, status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_mock', chefId: 3, kitchenId: 4, createdAt: new Date('2020-01-01') })).toBe(false);
    expect(stripe.cancel).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
});
