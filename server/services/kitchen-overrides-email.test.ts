import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({ defaults: {} as any, overrides: new Map<number, any>(), kitchens: [] as any[],
  bookings: [] as any[], visits: [] as any[], events: [] as any[], chef: {} as any, notifications: [] as any[], writes: [] as string[], wakeup: vi.fn() }));
vi.mock('../lifecycle-inngest', () => ({ inngest: { send: state.wakeup }, bookingNoticeEvent: 'booking/notice.queued' }));
vi.mock('../db', () => {
  const name = (table: any) => table[Symbol.for('drizzle:Name')];
  const params = (condition: any) => condition ? new PgDialect().sqlToQuery(condition).params : [];
  const database: any = {
    execute: vi.fn(),
    transaction: async (run: any) => run(database),
    select: (fields: any) => {
      let table: any, condition: any;
      const rows = () => {
        const values = params(condition), id = values.find(value => typeof value === 'number');
        switch (name(table)) {
          case 'locations': return [{ id: 33, managerId: 2, name: 'Harbour', timezone: 'America/St_Johns' }];
          case 'kitchens': {
            if (!fields) return state.kitchens.filter(k => k.id === id);
            const list = fields?.location ? state.kitchens.filter(k => k.id === id && k.managerId === values[1]) : state.kitchens;
            return list.map(kitchen => ({ kitchen, location: { id: 33, managerId: 2, name: 'Harbour', timezone: 'America/St_Johns' }, override: state.overrides.get(kitchen.id) }));
          }
          case 'checkin_checkout_checklists': return [state.defaults];
          case 'kitchen_checkin_checkout_overrides': return state.overrides.has(id) ? [state.overrides.get(id)] : [];
          case 'kitchen_bookings': {
            if (!fields) return state.bookings.filter(b => b.id === id);
            if (fields?.chefId) return state.bookings.filter(b => b.id === id).map(b => ({ chefId: b.chefId, managerId: 2 }));
            const list = fields?.chef ? state.bookings.filter(b => b.id === id) : state.bookings.filter(b => b.kitchenId === id && b.status === 'confirmed');
            return list.map(booking => ({ booking, kitchen: state.kitchens.find(k => k.id === booking.kitchenId),
              location: { id: 33, name: 'Harbour', timezone: 'America/St_Johns' }, timezone: 'America/St_Johns',
              checklist: state.defaults, override: state.overrides.get(booking.kitchenId), chef: state.chef }));
          }
          case 'kitchen_booking_visits': return state.visits.filter(v => v.bookingId === id);
          case 'booking_lifecycle_events': return state.events.filter(e => e.bookingId === id && !e.completedAt);
          case 'users': return [{ ...state.chef, email: state.chef.username }, { id: 2, email: 'manager@test.ca', role: 'manager' }];
          default: return [];
        }
      };
      const q: any = { from: (t: any) => { table = t; return q; }, innerJoin: () => q, leftJoin: () => q,
        where: (c: any) => { condition = c; return q; }, limit: () => q, for: () => q,
        then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject) };
      return q;
    },
    insert: (table: any) => ({ values: (patch: any) => {
      state.writes.push(name(table));
      if (name(table) === 'booking_lifecycle_events') state.events.push({ id: state.events.length + 1, ...patch });
      const q: any = { onConflictDoUpdate: ({ set }: any) => {
        state.overrides.set(patch.kitchenId, { ...state.overrides.get(patch.kitchenId), ...patch, ...set }); return q;
      }, then: (resolve: any) => resolve([]) }; return q;
    } }),
    update: (table: any) => ({ set: (patch: any) => ({ where: (condition: any) => {
      const id = params(condition).find(v => typeof v === 'number');
      if (name(table) === 'booking_lifecycle_events') Object.assign(state.events.find(e => e.id === id), patch);
      return Promise.resolve([]);
    } }) }),
    delete: (table: any) => ({ where: (condition: any) => { state.writes.push(name(table)); state.overrides.delete(params(condition)[0] as number); } }),
  };
  return { db: database };
});
vi.mock('./notification.service', () => ({ notificationService: { create: async (notice: any) => { state.notifications.push(notice); } } }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Alex' }));
import { db } from '../db';
import { kitchenChecklistSetup, setKitchenChecklistOverrides, queueLocationInstructionUpdates, validateKitchenOverridePatch } from './kitchen-checklist-overrides';
import { changedKitchenSections, eligibleInstructionSections, queueKitchenInstructionUpdates, currentKitchenInstructionEmail } from './kitchen-instructions-updated';

const all = ['arrivalInstructions', 'departureInstructions', 'arrivalTasks', 'departureTasks'] as const;
it('queues nothing before release and sends the current text after release', async () => {
  vi.setSystemTime(new Date('2099-10-01T12:00:00Z'));
  await setKitchenChecklistOverrides(40, 2, { checkinInstructions: 'PRIVATE-ACCESS-SENTINEL' });
  expect(state.events).toEqual([]);
  expect(state.notifications).toEqual([]);
  const metadata = { revision: 1, before: state.defaults, sections: ['arrivalInstructions'] as const, recipientPolicy: 'chef' as const };
  expect(await currentKitchenInstructionEmail(10, { ...metadata, sections: [...metadata.sections] }, 3, state.chef.username)).toBeNull();
  vi.setSystemTime(new Date('2099-10-14T12:00:00Z'));
  expect((await currentKitchenInstructionEmail(10, { ...metadata, sections: [...metadata.sections] }, 3, state.chef.username))?.text).toContain('PRIVATE-ACCESS-SENTINEL');
});
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2099-10-14T12:00:00Z'));
  vi.stubEnv('INNGEST_EVENT_KEY', '');
  state.defaults = { id: 1, locationId: 33, checkinInstructions: 'Main door', checkoutInstructions: 'Lock up', checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] };
  state.overrides.clear(); state.kitchens = [{ id: 40, locationId: 33, managerId: 2, name: 'Ocean kitchen' }, { id: 41, locationId: 33, managerId: 2, name: 'Other kitchen' }];
  state.bookings = [{ id: 10, kitchenId: 40, chefId: 3, status: 'confirmed', checkinStatus: 'not_checked_in', referenceCode: 'KB-ABC', bookingDate: new Date('2099-10-15T00:00:00Z'), startTime: '09:00', endTime: '11:00' }];
  state.visits = []; state.events = []; state.notifications = []; state.writes = [];
  state.chef = { id: 3, username: 'alex@test.ca', role: 'chef', managerProfileData: { fullName: 'Alex' } };
});

it('sets and clears each section without changing any other scope, and deletes the empty row', async () => {
  for (const section of all) {
    const fields = section.endsWith('Instructions') ? [section === 'arrivalInstructions' ? 'checkinInstructions' : 'checkoutInstructions']
      : section === 'arrivalTasks' ? ['checkinItems', 'checkinPhotoRequirements'] : ['checkoutItems', 'checkoutPhotoRequirements'];
    const patch = Object.fromEntries(fields.map(field => [field, field.endsWith('Instructions') ? '' : []]));
    await setKitchenChecklistOverrides(40, 2, patch);
    expect(state.overrides.get(40)).toMatchObject(patch);
    const result = await setKitchenChecklistOverrides(40, 2, Object.fromEntries(fields.map(field => [field, null])));
    expect(result.effective).toMatchObject(state.defaults);
    expect(state.overrides.size).toBe(0);
  }
  expect(state.writes).not.toContain('checkin_checkout_checklists');
});
it('checks ownership and rejects invalid fields before writing', async () => {
  await expect(setKitchenChecklistOverrides(40, 99, { checkinInstructions: 'Hijack' })).rejects.toMatchObject({ status: 403 });
  expect(validateKitchenOverridePatch({ checkinItems: null })).toEqual({ checkinItems: null });
  expect(() => validateKitchenOverridePatch({ storageCheckinInstructions: 'Wrong scope' })).toThrow('Unknown');
  expect(() => validateKitchenOverridePatch({ checkinItems: [{ id: 'a', label: '' }] })).toThrow('Invalid');
  expect(state.writes).toEqual([]);
});
it.each([0, -1, NaN, 1.2])('rejects invalid kitchen ID %s without writing', async id => {
  await expect(setKitchenChecklistOverrides(id, 2, { checkinInstructions: 'Door' })).rejects.toMatchObject({ status: 400 });
  expect(state.writes).toEqual([]);
});
it('queues the existing event-driven wakeup through the lifecycle outbox (mocked provider)', async () => {
  vi.stubEnv('INNGEST_EVENT_KEY', 'mock-key');
  state.wakeup.mockResolvedValue({ ids: ['mock'] });
  await setKitchenChecklistOverrides(40, 2, { checkinInstructions: 'New entry' });
  await vi.waitFor(() => expect(state.wakeup).toHaveBeenCalledWith({ name: 'booking/notice.queued', data: { bookingId: 10 } }));
  expect(state.events).toHaveLength(1);
});
it('coalesces bursts into one chef-only pending row with a revision and original baseline', async () => {
  const before = { ...state.defaults };
  await setKitchenChecklistOverrides(40, 2, { checkinInstructions: 'Side door' });
  await setKitchenChecklistOverrides(40, 2, { checkoutItems: [{ id: 'clean', label: 'Clean sink' }], checkoutPhotoRequirements: [] });
  expect(state.events).toHaveLength(1);
  expect(state.events[0]).toMatchObject({ kind: 'instructions_updated', metadata: { revision: 2, before, sections: ['arrivalInstructions', 'departureTasks'] } });
  expect(state.events[0].emails.map((e: any) => e.to)).toEqual(['alex@test.ca']);
  expect(state.notifications).toHaveLength(1);
});
it.each(['cancelled', 'completed', 'pending', 'cancellation_requested'])('never queues updates for %s bookings', async status => {
  state.bookings[0].status = status;
  await setKitchenChecklistOverrides(40, 2, { checkinInstructions: 'New door' });
  expect(state.events).toEqual([]);
});
it('a checked-in producer queues departure tasks/photos only, excluding arrival changes', async () => {
  Object.assign(state.bookings[0], { checkinStatus: 'checked_in', bookingDate: new Date('2099-10-14') });
  vi.setSystemTime(new Date('2099-10-14T12:00:00Z'));
  await setKitchenChecklistOverrides(40, 2, { checkinInstructions: 'New arrival', checkoutInstructions: 'New departure',
    checkinItems: [{ id: 'a', label: 'Arrival task' }], checkoutPhotoRequirements: [{ id: 'p', label: 'Departure photo' }] });
  expect(state.events[0].metadata.sections).toEqual(['departureInstructions', 'departureTasks']);
  expect(state.events[0].emails.map((email: any) => email.to)).toEqual(['alex@test.ca']);
});
it('does not notify for whitespace-only instruction changes or retired access tasks', async () => {
  state.defaults.checkinItems = [{ id: 'old', label: 'Retired code task', category: 'smart_lock' }];
  await setKitchenChecklistOverrides(40, 2, { checkinInstructions: '  Main door  ', checkinItems: [] });
  expect(state.events).toEqual([]);
});
it.each(['not_checked_in', 'checked_out', 'checkout_requested', 'checkout_claim_filed'])('does not send to a started/closed %s booking', async checkinStatus => {
  Object.assign(state.bookings[0], { checkinStatus, bookingDate: new Date('2000-10-15') });
  await setKitchenChecklistOverrides(40, 2, { checkoutInstructions: 'New exit' });
  expect(state.events).toEqual([]);
});
it('upcoming bookings receive all sections; in-progress visits receive only departure sections', () => {
  const booking = state.bookings[0];
  expect(eligibleInstructionSections(booking, 'America/St_Johns', [], [...all])).toEqual(all);
  booking.checkinStatus = 'checked_in'; booking.bookingDate = new Date('2099-10-14');
  expect(eligibleInstructionSections(booking, 'America/St_Johns', [], [...all])).toEqual(['departureInstructions', 'departureTasks']);
  expect(eligibleInstructionSections({ ...booking, checkinStatus: 'not_checked_in' }, 'America/St_Johns', [{ checkinStatus: 'checked_in', startTime: '09:00', endTime: '11:00' }], [...all])).toEqual(['departureInstructions', 'departureTasks']);
});
it('uses the kitchen timezone rather than the UTC wall-clock start', () => {
  const booking = { ...state.bookings[0], bookingDate: new Date('2026-10-15'), startTime: '09:00' };
  expect(eligibleInstructionSections(booking, 'America/St_Johns', [], [...all], new Date('2026-10-15T10:00:00Z'))).toEqual(all);
  expect(eligibleInstructionSections(booking, 'Europe/Kyiv', [], [...all], new Date('2026-10-15T10:00:00Z'))).toEqual([]);
});
it('location edits affect inherited fields, while overrides shield only their own fields', async () => {
  const before = { ...state.defaults };
  state.overrides.set(40, { checkinInstructions: 'Kitchen door', checkoutInstructions: null });
  state.bookings.push({ ...state.bookings[0], id: 11, kitchenId: 41 });
  state.defaults = { ...before, checkinInstructions: 'New location door', checkoutInstructions: 'New location exit' };
  await queueLocationInstructionUpdates(db as any, 33, before, state.defaults, 2);
  expect(state.events.find(e => e.bookingId === 10).metadata.sections).toEqual(['departureInstructions']);
  expect(state.events.find(e => e.bookingId === 11).metadata.sections).toEqual(['arrivalInstructions', 'departureInstructions']);
  expect((await kitchenChecklistSetup(40, 33)).effective.checkinInstructions).toBe('Kitchen door');
});
it('detects tasks and photos separately, including explicit removal', () => {
  expect(changedKitchenSections(state.defaults, { ...state.defaults, checkinPhotoRequirements: [{ id: 'a', label: 'Door' }] })).toEqual(['arrivalTasks']);
});
it('compares effective obligations rather than object key order, optional defaults or task categories', () => {
  const before = { ...state.defaults, checkinItems: [{ id: 'a', label: 'Wash sink' }] };
  const same = { ...before, checkinItems: [{ label: 'Wash sink', id: 'a', required: true, photoRequired: false, category: 'cleaning', description: '' }] };
  expect(changedKitchenSections(before, same)).toEqual([]);
  expect(changedKitchenSections(before, { ...same, checkinItems: [{ ...same.checkinItems[0], required: false }] })).toEqual(['arrivalTasks']);
});
it('delivery revalidates state, renders current values and task additions/removals, with a named greeting', async () => {
  const before = { ...state.defaults, checkoutItems: [{ id: 'old', label: 'Old duty' }] };
  await queueKitchenInstructionUpdates(db as any, 40, before, { ...before, checkinInstructions: 'Queued old text', checkoutItems: [] }, 2);
  state.defaults = { ...state.defaults, checkinInstructions: '', checkoutItems: [{ id: 'new', label: 'Wash sink' }] };
  const email = await currentKitchenInstructionEmail(10, state.events[0].metadata, 3, state.chef.username);
  expect(email?.text).toContain('Hi Alex,'); expect(email?.text).toContain('Newfoundland');
  expect(email?.text).toContain('KB-ABC'); expect(email?.text).toContain('Ocean kitchen'); expect(email?.text).toContain('Harbour');
  expect(email?.text).toContain('Removed by the kitchen'); expect(email?.text).toContain('New task added: Wash sink'); expect(email?.text).toContain('Task removed: Old duty');
  expect(email?.text).not.toContain('Queued old text'); expect(email?.html).toContain('viewport');
  state.bookings[0].checkinStatus = 'checked_in';
  expect((await currentKitchenInstructionEmail(10, state.events[0].metadata, 3, state.chef.username))?.text).not.toContain('Arrival instructions:');
  state.bookings[0].status = 'cancelled';
  expect(await currentKitchenInstructionEmail(10, state.events[0].metadata, 3, state.chef.username)).toBeNull();
});
it('skips reverted edits and recipients who no longer own the booking', async () => {
  await setKitchenChecklistOverrides(40, 2, { checkinInstructions: 'Side door' });
  state.overrides.clear();
  expect(await currentKitchenInstructionEmail(10, state.events[0].metadata, 3, state.chef.username)).toBeNull();
  expect(await currentKitchenInstructionEmail(10, state.events[0].metadata, 2, 'manager@test.ca')).toBeNull();
});

it('keeps shared instruction updates available to remaining dated days after the first visit', () => {
  const booking = { ...state.bookings[0], scheduleRevision: 1, bookingDate: new Date('2026-10-12'), startTime: '09:00', endTime: '11:00' };
  const visits = ['2026-10-12', '2026-10-16'].map((visitDate, blockIndex) => ({ id: 10 + blockIndex, blockIndex,
    visitDate, scheduleRevision: 1, scheduleState: 'active', startTime: '09:00', endTime: '11:00',
    operatingWindowStartTime: '08:00', checkinStatus: blockIndex ? 'not_checked_in' : 'checked_out' }));
  expect(eligibleInstructionSections(booking, 'UTC', visits, [...all], new Date('2026-10-14T12:00Z'))).toEqual(all);
  visits[1].scheduleState = 'cancelled';
  expect(eligibleInstructionSections(booking, 'UTC', visits, [...all], new Date('2026-10-14T12:00Z'))).toEqual([]);
});
