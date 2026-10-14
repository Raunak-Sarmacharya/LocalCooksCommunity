import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, checklist: {} as any, override: null as any, enabled: true, writes: [] as any[] }));
vi.mock('../db', () => ({ db: {
  select: () => { const q: any = { from: () => q, innerJoin: () => q, leftJoin: () => q, where: () => q,
    limit: async () => [{ booking: state.booking, kitchen: { locationId: 5, checkinCheckoutEnabled: state.enabled }, checklist: state.checklist, override: state.override }] }; return q; },
  update: () => ({ set: (values: any) => ({ where: async () => { state.writes.push(values); Object.assign(state.booking, values); } }) }),
} }));
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: async () => ({ checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 }) }));
vi.mock('./damage-claim-limits-service', () => ({ getStorageCheckoutSettings: async () => ({ reviewWindowHours: 2 }) }));
import { kitchenDuties, currentKitchenDuties, validateCurrentKitchenSubmission, storageDuties,
  bookingInstructionRelease, instructionStateForVisit, redactInstructionDuties } from './visit-duties';

describe('chef instruction projections', () => {
  const booking = { id: 10, bookingDate: '2026-10-20', startTime: '09:00', endTime: '17:00', status: 'confirmed',
    selectedSlots: [{ date: '2026-10-20', startTime: '09:00', endTime: '10:00' },
      { date: '2026-10-23', startTime: '16:00', endTime: '17:00' }] };
  it('uses each split visit and the earliest unfinished visit for the booking answer', () => {
    const visits = [{ id: 21, blockIndex: 0, startTime: '09:00', endTime: '10:00', checkinStatus: 'not_checked_in' },
      { id: 22, blockIndex: 1, startTime: '16:00', endTime: '17:00', checkinStatus: 'not_checked_in' }];
    const result = bookingInstructionRelease(booking, 'America/St_Johns', visits, 48, 15, new Date('2026-10-19T12:00:00Z'));
    expect(result.instructionsReleased).toBe(true);
    expect(result.visits.map(visit => visit.instructionsReleased)).toEqual([true, false]);
    visits[0].checkinStatus = 'checked_out';
    expect(bookingInstructionRelease(booking, 'America/St_Johns', visits, 48, 15, new Date('2026-10-19T12:00:00Z')).instructionsReleased).toBe(false);
  });
  it.each(['cancelled', 'completed'])('withholds live instructions for %s bookings', status => {
    expect(bookingInstructionRelease({ ...booking, status }, 'UTC', [], 48, 15, new Date('2026-10-20T09:00:00Z')).instructionsReleased).toBe(false);
  });
  it('releases when check-in opens earlier than preparation without blocking arrival', () => {
    const start = new Date('2026-10-20T12:00:00Z');
    expect(instructionStateForVisit(start, 1, 120, true, new Date('2026-10-20T10:00:00Z')))
      .toEqual({ instructionsReleased: true, instructionsReleaseAt: '2026-10-20T10:00:00.000Z' });
  });
  it('redacts only free-text instructions and preserves required tasks and photos', () => {
    const duties = { arrival: { instructions: 'PRIVATE-ACCESS-SENTINEL', items: [{ id: 'a', label: 'Bring tools' }], photos: [{ id: 'p', label: 'Worktop' }] },
      departure: { instructions: 'PRIVATE-ACCESS-SENTINEL', items: [], photos: [] } };
    const redacted = redactInstructionDuties(duties, false) as typeof duties;
    expect(JSON.stringify(redacted)).not.toContain('PRIVATE-ACCESS-SENTINEL');
    expect(redacted.arrival.items).toEqual(duties.arrival.items);
    expect(redacted.arrival.photos).toEqual(duties.arrival.photos);
    expect(redactInstructionDuties(duties, true)).toBe(duties);
    expect(duties.arrival.instructions).toBe('PRIVATE-ACCESS-SENTINEL');
  });
  it('keeps departure instructions available during the existing service-end grace', () => {
    const single = { ...booking, selectedSlots: null, endTime: '10:00', checkinStatus: 'checked_in' };
    expect(bookingInstructionRelease(single, 'UTC', [], 48, 15, new Date('2026-10-20T10:10:00Z')).instructionsReleased).toBe(true);
    expect(bookingInstructionRelease(single, 'UTC', [], 48, 15, new Date('2026-10-20T10:15:00Z')).instructionsReleased).toBe(false);
  });
});
describe('snapshot service (mocked database)', () => {
  beforeEach(() => { state.booking = { id: 10, visitDuties: null }; state.override = null; state.enabled = true; state.writes = [];
    state.checklist = { checkinEnabled: true, checkoutEnabled: true, checkoutItems: [{ id: 'clean', label: 'Original cleaning', required: true }],
      storageCheckinEnabled: false, storageCheckoutEnabled: true }; });
  it('keeps read-only legacy previews unsaved until the first actual action', async () => {
    expect((await kitchenDuties(10)).source).toBe('legacy_first_action'); expect(state.writes).toEqual([]);
    const captured = await kitchenDuties(10, undefined, 'legacy_first_action');
    expect(state.booking.visitDuties).toEqual(captured);
  });
  it('captures effective kitchen fields and revalidates new overrides without rewriting history or storage', async () => {
    state.override = { checkinInstructions: 'Kitchen entry', checkoutItems: [] };
    const captured = await kitchenDuties(10, undefined, 'confirmation');
    expect(captured.arrival.instructions).toBe('Kitchen entry');
    expect(captured.departure.items).toEqual([]);
    state.override = { ...state.override, checkoutItems: [{ id: 'new', label: 'Kitchen clean-up' }] };
    expect((await currentKitchenDuties(10)).departure.items[0].label).toBe('Kitchen clean-up');
    expect(await kitchenDuties(10)).toBe(captured);
    await expect(validateCurrentKitchenSubmission(undefined as any, 10, 'departure')).rejects.toThrow('Kitchen clean-up');
    expect(state.writes).toHaveLength(1);
    state.booking.visitDuties = null;
    expect((await storageDuties(30)).arrival.instructions).not.toBe('Kitchen entry');
  });
  it.each(['not_checked_in', 'checked_in'])('retains confirmation duties before or after start (%s)', async checkinStatus => {
    state.booking.checkinStatus = checkinStatus;
    const captured = await kitchenDuties(10, undefined, 'confirmation');
    state.enabled = false; state.checklist = { checkoutEnabled: false, checkoutItems: [{ id: 'extra', label: 'New duty' }] };
    expect(await kitchenDuties(10)).toEqual(captured);
    expect((await kitchenDuties(10)).departure.items[0].label).toBe('Original cleaning');
    expect(state.writes).toHaveLength(1);
  });
  it('captures independent storage requirements and actual storage review window', async () => {
    const captured = await storageDuties(30, undefined, 'confirmation');
    expect(captured.arrival.enabled).toBe(false); expect(captured.departure.enabled).toBe(true);
    expect(captured.checkoutReviewWindowMinutes).toBe(120);
    state.checklist.storageCheckoutEnabled = false;
    expect(await storageDuties(30)).toEqual(captured);
  });
  it('reads an old disabled snapshot unchanged while resolving current required kitchen tasks', async () => {
    const saved = await kitchenDuties(10, undefined, 'confirmation');
    const legacy = { ...saved, version: 1, arrival: { ...saved.arrival, enabled: false }, departure: { ...saved.departure, enabled: false } };
    state.booking.visitDuties = legacy;
    state.enabled = false;
    state.checklist = { checkinEnabled: false, checkoutEnabled: false, checkinInstructions: 'Current arrival',
      checkinItems: [{ id: 'new', label: 'New required task', required: true }], storageCheckinEnabled: false };
    const current = await currentKitchenDuties(10);
    expect(current.arrival).toMatchObject({ enabled: true, workflowEnabled: true, tasksRequired: true, instructions: 'Current arrival' });
    expect(await kitchenDuties(10)).toBe(legacy);
    await expect(validateCurrentKitchenSubmission(undefined as any, 10, 'arrival')).rejects.toMatchObject({
      fieldErrors: { items: 'Complete required checklist items: New required task' },
    });
    await expect(validateCurrentKitchenSubmission(undefined as any, 10, 'arrival', [], [{ id: 'new', checked: true }])).resolves.toBeUndefined();
    expect(state.writes).toHaveLength(1);
  });
});
