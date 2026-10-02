import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, event: vi.fn() }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.event }));
vi.mock('../db', () => {
  const database = (rows: Record<string, any[]>) => {
    const name = (table: any) => table[Symbol.for('drizzle:Name')];
    const db: any = {
      select: () => ({ from: (table: any) => {
        const chain: any = { where: () => chain, limit: () => chain, for: () => chain,
          then: (resolve: any) => resolve(rows[name(table)] || []) }; return chain;
      } }),
      update: (table: any) => ({ set: (values: any) => ({ where: async () => {
        for (const row of rows[name(table)] || []) Object.assign(row, values);
      } }) }),
      transaction: async (work: any) => {
        const draft = structuredClone(state.rows);
        const result = await work(database(draft));
        Object.assign(state.rows, draft);
        return result;
      },
    }; return db;
  };
  return { db: database(state.rows) };
});
import { cancelBookingItem } from './booking-item-cancellation';
describe('modular cancellation preserves the shared authorization and parent deadline', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.rows.kitchen_bookings = [{ id: 1, chefId: 3, bookingDate: new Date('2099-01-01'), startTime: '10:00',
      cancellationPolicyHours: 24, status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_shared',
      storageItems: [{ storageBookingId: 2 }], equipmentItems: [{ equipmentBookingId: 2 }] }];
    for (const kind of ['storage', 'equipment']) state.rows[`${kind}_bookings`] = [{ id: 2, chefId: 3,
      kitchenBookingId: 1, status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_shared' }];
  });
  it.each(['storage', 'equipment'] as const)('withdraws an unpaid %s item without cancelling the parent hold', async kind => {
    await cancelBookingItem(kind, 2, 3, 'Change of plan');
    expect(state.rows[`${kind}_bookings`][0].status).toBe('cancelled');
    expect(state.rows.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_shared' });
    expect(state.event).toHaveBeenCalledOnce();
  });
  it.each(['storage', 'equipment'] as const)('requests manager review for a paid %s item', async kind => {
    Object.assign(state.rows[`${kind}_bookings`][0], { status: 'confirmed', paymentStatus: 'paid' });
    await cancelBookingItem(kind, 2, 3, 'Changed storage needs');
    expect(state.rows[`${kind}_bookings`][0]).toMatchObject({ status: 'cancellation_requested', paymentStatus: 'paid' });
    expect(state.rows.kitchen_bookings[0].status).toBe('pending');
  });
  it('uses the accepted parent deadline', async () => {
    state.rows.kitchen_bookings[0].bookingDate = new Date('2000-01-01');
    await expect(cancelBookingItem('equipment', 2, 3)).rejects.toThrow('deadline has passed');
    expect(state.rows.equipment_bookings[0].status).toBe('pending');
  });
  it('blocks withdrawal during payment reconciliation', async () => {
    state.rows.kitchen_bookings[0].paymentDecision = { state: 'pending' };
    await expect(cancelBookingItem('storage', 2, 3)).rejects.toThrow('reconciliation');
  });
  it('rolls back cancellation if its durable notification cannot commit', async () => {
    state.event.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(cancelBookingItem('storage', 2, 3)).rejects.toThrow('outbox unavailable');
    expect(state.rows.storage_bookings[0].status).toBe('pending');
  });
});
