import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { kitchenBookings } from '@shared/schema';

const state = vi.hoisted(() => ({ booking: {} as any, setup: {} as any, writes: [] as any[],
  addTaskAtLock: false, queue: vi.fn(), deliver: vi.fn() }));
vi.mock('../db', () => {
  const database: any = {
    select: (fields: any) => {
      const q: any = { from: () => q, innerJoin: () => q, leftJoin: () => q, where: () => q,
        limit: async () => fields.booking ? [{ booking: state.booking, kitchen: { id: 4, locationId: 5, checkinCheckoutEnabled: false }, checklist: state.setup }]
          : [{ ...state.booking, locationId: 5, timezone: 'UTC' }] };
      return q;
    },
    execute: async () => {
      if (state.addTaskAtLock) state.setup.checkinItems = [{ id: 'safety', label: 'Check the safety station', required: true }];
      return [];
    },
    update: (table: any) => ({ set: (values: any) => ({ where: () => ({ returning: async () => {
      expect(table).toBe(kitchenBookings); state.writes.push(values); Object.assign(state.booking, values); return [{ id: 10 }];
    } }) }) }),
  };
  database.transaction = async (fn: any) => fn(database);
  return { db: database };
});
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue, deliverBookingLifecycleEvents: state.deliver }));
import { requestKitchenCheckin, requestKitchenCheckout } from './kitchen-checkout-service';
import { currentKitchenDuties } from './visit-duties';

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  const section = { enabled: false, instructions: 'Original instructions', items: [], photos: [] };
  state.booking = { id: 10, chefId: 3, kitchenId: 4, status: 'confirmed', checkinStatus: 'not_checked_in',
    bookingDate: new Date('2026-10-13T00:00:00Z'), updatedAt: new Date('2026-10-12T00:00:00Z'), startTime: '09:00', endTime: '17:00',
    visitDuties: { version: 1, source: 'confirmation', capturedAt: '2026-10-12T00:00:00Z', arrival: section, departure: section,
      checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 } };
  state.setup = { checkinEnabled: false, checkoutEnabled: false, checkinInstructions: 'Current entrance', checkoutInstructions: 'Current exit',
    checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] };
  state.writes = []; state.addTaskAtLock = false;
});
afterEach(() => vi.useRealTimers());

it('allows arrival and then departure with every old flag off and zero tasks, retaining the old snapshot byte for byte', async () => {
  const snapshot = JSON.stringify(state.booking.visitDuties);
  const current = await currentKitchenDuties(10);
  expect(current.arrival).toMatchObject({ workflowEnabled: true, tasksRequired: false, instructions: 'Current entrance' });
  expect((await requestKitchenCheckin(10, 3)).success).toBe(true);
  expect((await requestKitchenCheckout(10, 3)).success).toBe(true);
  expect(state.writes).toHaveLength(2);
  expect(JSON.stringify(state.booking.visitDuties)).toBe(snapshot);
  expect(state.writes.every(write => !Object.hasOwn(write, 'visitDuties'))).toBe(true);
});
it.each(['arrival', 'departure'] as const)('blocks a current required %s task absent from the old snapshot with a field error', async stage => {
  if (stage === 'departure') state.booking.checkinStatus = 'checked_in';
  state.setup[stage === 'arrival' ? 'checkinItems' : 'checkoutItems'] = [{ id: 'safety', label: 'Check the safety station', required: true }];
  const result = stage === 'arrival' ? await requestKitchenCheckin(10, 3) : await requestKitchenCheckout(10, 3);
  expect(result).toMatchObject({ success: false, fieldErrors: { items: 'Complete required checklist items: Check the safety station' } });
  expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
});
it('revalidates requirements at the transaction boundary and returns a field error without evidence or notices', async () => {
  state.addTaskAtLock = true;
  const result = await requestKitchenCheckin(10, 3);
  expect(result).toMatchObject({ success: false, fieldErrors: { items: expect.stringContaining('Check the safety station') } });
  expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.deliver).not.toHaveBeenCalled();
});
it('records a newly added required task once completed while keeping old instructions as the booking record', async () => {
  state.setup.checkinItems = [{ id: 'safety', label: 'Check the safety station', required: true }];
  const items = [{ id: 'safety', label: 'Check the safety station', checked: true }];
  expect((await requestKitchenCheckin(10, 3, 'self', 'Sam checked the station', [], items)).success).toBe(true);
  expect(state.writes[0].checkinChecklistItems).toEqual(items);
  expect(state.booking.visitDuties.arrival.instructions).toBe('Original instructions');
});
