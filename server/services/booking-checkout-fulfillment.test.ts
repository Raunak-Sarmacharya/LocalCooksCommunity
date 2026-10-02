import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, event: vi.fn(), next: 100 }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `FIXTURE-${state.next}` }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.event }));
vi.mock('./kitchen-checkout-holds', () => ({ fulfillKitchenCheckout: async (...args: any[]) => args.at(-1)(),
  KitchenHoldMissingError: class extends Error {}, KitchenSlotUnavailableError: class extends Error {} }));
vi.mock('../db', () => {
  const database = (rows: Record<string, any[]>) => {
    const name = (table: any) => table[Symbol.for('drizzle:Name')];
    return {
      select: () => ({ from: (table: any) => {
        const chain: any = { innerJoin: () => chain, where: () => chain, limit: () => chain,
          then: (resolve: any) => resolve(rows[name(table)] || []) }; return chain;
      } }),
      insert: (table: any) => ({ values: (data: any) => {
        const save = () => { const row = { id: state.next++, ...data }; (rows[name(table)] ||= []).push(row); return [row]; };
        return { returning: async () => save(), then: (resolve: any) => resolve(save()) };
      } }),
      update: (table: any) => ({ set: (data: any) => ({ where: async () => { for (const row of rows[name(table)] || []) Object.assign(row, data); } }) }),
      transaction: async (work: any) => {
        const draft = structuredClone(state.rows), result = await work(database(draft));
        Object.assign(state.rows, draft); return result;
      },
    };
  }; return { db: database(state.rows) };
});
import { fulfillQuotedKitchenBooking } from './booking-checkout-fulfillment';
const session: any = { id: 'cs_fixture', amount_total: 2440, currency: 'cad', metadata: {
  kitchen_id: '4', chef_id: '3', booking_date: '2099-01-01', start_time: '10:00', end_time: '11:00',
  total_price_cents: '2000', tax_cents: '300', platform_fee_cents: '140', tax_rate_percent: '15',
  fee_model: 'separate-charge-commission-v1', addon_prices: '{"s":[[8,1000]],"e":[]}',
  selected_storage: '[{"storageListingId":8,"startDate":"2099-01-01","endDate":"2099-01-02"}]', storage_quote_8: 'quote_fixture',
  hourly_rate_cents: '1000', duration_hours: '1' } };
const intent: any = { id: 'pi_fixture', status: 'requires_capture', amount: 2440 };
describe('atomic quoted checkout fulfillment', () => {
  beforeEach(() => {
    vi.resetAllMocks(); state.next = 100;
    Object.assign(state.rows, { kitchen_bookings: [], storage_bookings: [], equipment_bookings: [], payment_transactions: [],
      kitchens: [{ id: 4, managerId: 2 }], storage_listings: [{ id: 8, kitchenId: 4, name: 'Storage', pricingModel: 'daily', basePrice: '9999' }],
      storage_overstay_quotes: [{ id: 'quote_fixture', chefId: 3, storageListingId: 8, terms: { approved: 'original' } }] });
  });
  it('keeps quoted prices after listing rates change and duplicates no items on retry', async () => {
    const id = await fulfillQuotedKitchenBooking(session, intent, {} as any);
    expect(state.rows.storage_bookings[0].totalPrice).toBe('1000');
    expect(state.rows.storage_bookings[0].overstayTerms.approved).toBe('original');
    expect(state.rows.payment_transactions).toHaveLength(1);
    expect(await fulfillQuotedKitchenBooking(session, intent, {} as any)).toBe(id);
    expect(state.rows.kitchen_bookings).toHaveLength(1);
    expect(state.rows.storage_bookings).toHaveLength(1);
    expect(state.event).toHaveBeenCalledOnce();
  });
  it('commits no partial booking or ledger when durable delivery fails', async () => {
    state.event.mockRejectedValueOnce(new Error('delivery unavailable'));
    await expect(fulfillQuotedKitchenBooking(session, intent, {} as any)).rejects.toThrow('delivery unavailable');
    expect(state.rows.kitchen_bookings).toHaveLength(0);
    expect(state.rows.storage_bookings).toHaveLength(0);
    expect(state.rows.payment_transactions).toHaveLength(0);
    await fulfillQuotedKitchenBooking(session, intent, {} as any);
    expect(state.rows.kitchen_bookings).toHaveLength(1);
  });
});
