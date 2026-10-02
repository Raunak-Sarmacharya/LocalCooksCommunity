import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ conditions: [] as any[], won: false, rows: [] as any[][], photosValid: true, queue: vi.fn() }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./kitchen-checkout-service', () => ({
  validateRequiredPhotos: async () => ({ valid: state.photosValid, error: 'Required removal photos missing' }),
  validateRequiredChecklistItems: async () => ({ valid: true }),
}));
vi.mock('../db', () => { const db: any = {
  select: () => { const q: any = { from: () => q, innerJoin: () => q, where: () => q,
    limit: async () => state.rows.shift() || [], for: async () => state.rows.shift() || [] }; return q; },
  update: () => ({ set: () => ({ where: (condition: any) => {
    state.conditions.push(condition);
    return { returning: async () => state.won ? [{ id: 1 }] : [] };
  } }) }),
  transaction: async (run: any) => run(db),
}; return { db }; });
import { autoCleanExpiredCheckout, requestStorageCheckout } from './storage-checkout-service';

describe('occupied cancelled storage removal', () => {
  beforeEach(() => { state.conditions = []; state.won = false; state.rows = []; state.photosValid = true; state.queue.mockReset(); });
  it('requires explicit removal confirmation even after the review deadline', async () => {
    expect(await autoCleanExpiredCheckout(1, 366, new Date('2020-01-01'), 24)).toBe(false);
    const query = new PgDialect().sqlToQuery(state.conditions[0]);
    expect(query.sql).toContain('"cancellation_accepted_at" is null');
    expect(query.params).toContain('checkout_requested');
  });
  it('does not update storage before the ordinary review deadline', async () => {
    expect(await autoCleanExpiredCheckout(1, 366, new Date(), 24)).toBe(false);
    expect(state.conditions).toEqual([]);
  });
  const occupied = () => {
    state.rows = [[{ booking: { id: 1, chefId: 366, kitchenBookingId: 10, status: 'cancellation_requested',
      cancellationAcceptedAt: new Date(), startDate: new Date('2020-01-01'), checkoutStatus: null,
      checkinStatus: 'not_checked_in', updatedAt: new Date('2026-01-01') }, locationId: 4 }], [{ id: 10 }]];
  };
  it('allows removal of accepted occupied storage without fabricating optional check-in', async () => {
    occupied(); state.won = true;
    expect((await requestStorageCheckout(1, 366)).success).toBe(true);
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), 10, 'storage_checkout_requested',
      expect.any(String), expect.any(String), 366, { storageBookingId: 1 });
    expect(new PgDialect().sqlToQuery(state.conditions[0]).sql).toContain('updated_at');
  });
  it('still enforces required inspection photos for accepted cancellation removal', async () => {
    occupied(); state.photosValid = false;
    expect((await requestStorageCheckout(1, 366)).error).toBe('Required removal photos missing');
    expect(state.conditions).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it('does not announce removal when a concurrent storage change wins', async () => {
    occupied();
    expect((await requestStorageCheckout(1, 366)).success).toBe(false);
    expect(state.queue).not.toHaveBeenCalled();
  });
});
