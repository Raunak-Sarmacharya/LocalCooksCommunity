import { beforeEach, describe, expect, it, vi } from 'vitest';
// "Change request": the chef's own pending request must not block the hours of its replacement (10-11 can become 10-12).
const h = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, conflict: vi.fn() }));
vi.mock('./booking-policy-settings', () => ({ kitchenBookingPolicies: async () => ({ timezone: 'America/St_Johns', turnoverBufferEnabled: true }) }));
vi.mock('./kitchen-checkout-incidents', () => ({ recordCheckoutConflict: h.conflict, registerKitchenCheckout: vi.fn() }));
vi.mock('../db', () => ({
  pool: { connect: async () => ({ query: vi.fn(async () => ({})), release: vi.fn() }) },
  db: { select: () => { let table = ''; const q: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return q; }, where: () => q, limit: () => q,
    then: (resolve: any) => resolve(h.rows[table] || []) }; return q; } },
}));
import { fulfillKitchenCheckout, hasInventoryConflict, KitchenSlotUnavailableError } from './kitchen-checkout-holds';

const slot = (startTime: string, endTime: string) => ({ startTime, endTime });
const booking = (id: number, status: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ id, kitchenId: 4, status, paymentDecision: null,
  bookingDate: new Date('2099-01-01T12:00:00Z'), startTime: start, endTime: end, operatingWindowStartTime: '08:00', selectedSlots: [slot(start, end)], ...extra });
const wanted = [slot('10:00', '11:00'), slot('11:00', '12:00')];

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = { kitchen_bookings: [booking(10, 'pending', '10:00', '11:00')], kitchen_checkout_holds: [] };
});

describe('inventory conflicts while changing a pending request', () => {
  it('blocks the longer hours without the exclusion and allows them with it', async () => {
    expect(await hasInventoryConflict(4, '2099-01-01', wanted, '08:00')).toBe(true);
    expect(await hasInventoryConflict(4, '2099-01-01', wanted, '08:00', undefined, 10)).toBe(false);
  });
  it('still blocks on anyone else’s booking, including one right next to the old hours (turnover buffer)', async () => {
    h.rows.kitchen_bookings.push(booking(20, 'confirmed', '12:00', '13:00'));
    expect(await hasInventoryConflict(4, '2099-01-01', wanted, '08:00', undefined, 10)).toBe(true);
  });
  it('does not exclude a different booking by accident', async () => {
    expect(await hasInventoryConflict(4, '2099-01-01', wanted, '08:00', undefined, 99)).toBe(true);
  });
  it('still blocks on another chef’s checkout hold', async () => {
    h.rows.kitchen_checkout_holds = [{ id: 'hold-x', kitchenId: 4, operatingDate: '2099-01-01', windowStartTime: '08:00', expiresAt: new Date(Date.now() + 60_000), selectedSlots: [slot('11:00', '12:00')] }];
    expect(await hasInventoryConflict(4, '2099-01-01', wanted, '08:00', undefined, 10)).toBe(true);
  });
});

describe('fulfilling the replacement under the day lock', () => {
  const run = (replaces?: number) => fulfillKitchenCheckout(undefined, 'cs_x', 4, '2099-01-01', wanted, '08:00', async () => 'created', undefined, replaces);
  it('creates the new request while the earlier one is still undecided', async () => {
    await expect(run(10)).resolves.toBe('created');
  });
  it.each([
    ['accepted', { status: 'confirmed' }],
    ['being accepted right now (decision recorded)', { paymentDecision: { target: 'confirmed', state: 'pending' } }],
  ])('race: when the kitchen has %s the original keeps its hours, so the overlapping replacement cannot be created', async (_name, patch) => {
    Object.assign(h.rows.kitchen_bookings[0], patch);
    await expect(run(10)).rejects.toBeInstanceOf(KitchenSlotUnavailableError);
    expect(h.conflict).toHaveBeenCalledWith('cs_x');
  });
  it('race: a declined or expired original no longer holds any hours, so the replacement is just a normal request', async () => {
    h.rows.kitchen_bookings[0].status = 'cancelled';
    await expect(run(10)).resolves.toBe('created');
  });
  it('without a replaced request the old hours block as before', async () => {
    await expect(run()).rejects.toBeInstanceOf(KitchenSlotUnavailableError);
  });
});
