import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, visits: [] as any[], managerId: 2, timezone: undefined as string | null | undefined, writes: [] as any[], notice: vi.fn(), captured: vi.fn(), lateOpen: vi.fn(async () => false), window: vi.fn(async (): Promise<any> => null), persist: vi.fn(async () => ({ changed: true })) }));
vi.mock('../db', () => {
  const db: any = { execute: async () => [], select: () => { let table: string; const q: any = {
    from: (t: any) => { table = t[Symbol.for('drizzle:Name')]; return q; }, innerJoin: () => q, where: () => q,
    limit: async () => [{ booking: state.booking, managerId: state.managerId, timezone: state.timezone }],
    then: (resolve: any) => resolve(table === 'kitchen_booking_visits' ? state.visits : []) }; return q; },
    update: () => ({ set: (values: any) => ({ where: async () => { state.writes.push(values); } }) }) };
  db.transaction = async (run: any) => run(db); return { db };
});
vi.mock('./visit-duties', () => ({ kitchenDuties: state.captured }));
vi.mock('./outcome-delivery', () => ({}));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.notice, deliverBookingLifecycleEvents: async () => { throw Error('SMTP unavailable'); } }));
vi.mock('./clock-closeout', () => ({ lateDepartureOpen: state.lateOpen, persistBookingCloseout: state.persist, visitClock: state.window }));
import { assistKitchenVisit } from './visit-assistance';
const input = { action: 'departure' as const, reason: 'Chef reported leaving; upload repeatedly failed', actualAt: '2026-10-02T19:30:00Z',
  expectedUpdatedAt: '2026-10-02T18:00:00Z', expectedBookingUpdatedAt: '2026-10-02T18:00:00Z' };
describe('audited manager assistance (mocked database)', () => {
  beforeEach(() => { state.booking = { id: 10, chefId: 3, status: 'confirmed', checkinStatus: 'not_checked_in',
    updatedAt: new Date(input.expectedUpdatedAt), assistanceHistory: [], checkinPhotoUrls: ['original'], checkoutPhotoUrls: ['existing'] };
    state.visits = []; state.managerId = 2; state.timezone = undefined; state.writes = []; vi.clearAllMocks(); state.captured.mockResolvedValue({ version: 1 });
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T20:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it('requests inspection without manufacturing arrival, clearance, photos or money; keeps durable recovery on send failure', async () => {
    expect(await assistKitchenVisit(10, 2, input)).toEqual({ success: true });
    expect(state.writes[0]).toMatchObject({ checkinStatus: 'checkout_requested', actualEndTime: '17:00', assistanceHistory: [expect.objectContaining({ actorId: 2, reason: input.reason, actualAt: new Date(input.actualAt).toISOString() })] });
    for (const field of ['checkedInAt', 'checkinPhotoUrls', 'checkoutPhotoUrls', 'checkoutApprovedAt', 'status', 'paymentStatus']) expect(state.writes[0]).not.toHaveProperty(field);
    expect(state.notice.mock.calls[0][2]).toBe('visit_assisted');
    expect(state.notice.mock.calls[0][6]).toMatchObject({ recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
  });
  it('preserves history and separately records assisted arrival', async () => {
    state.booking.assistanceHistory = [{ action: 'earlier correction' }];
    await assistKitchenVisit(10, 2, { ...input, action: 'arrival' });
    expect(state.writes[0].assistanceHistory).toHaveLength(2); expect(state.writes[0].checkedInMethod).toBe('manager');
    expect(state.writes[0].checkedInAt).toEqual(new Date(input.actualAt));
  });
  it("refuses to record anything for a visit whose arrival window hasn't opened, or with times from before it", async () => {
    // Tomorrow's visit: recording today's times would let its inspection (and payout) run a day early.
    state.window.mockResolvedValue({ arrivalOpensAt: Date.parse('2026-10-04T19:45:00Z') });
    await expect(assistKitchenVisit(10, 2, { ...input, action: 'arrival' })).rejects.toThrow(/hasn’t started yet/);
    await expect(assistKitchenVisit(10, 2, input)).rejects.toThrow(/hasn’t started yet/);
    // Window open (today's visit), but the reported time is before it.
    state.window.mockResolvedValue({ arrivalOpensAt: Date.parse('2026-10-02T19:45:00Z') });
    await expect(assistKitchenVisit(10, 2, input)).rejects.toThrow(/hasn’t started yet/);
    expect(state.writes).toEqual([]); expect(state.notice).not.toHaveBeenCalled();
    state.window.mockResolvedValue({ arrivalOpensAt: Date.parse('2026-10-02T19:00:00Z') });
    expect(await assistKitchenVisit(10, 2, input)).toEqual({ success: true });
    state.window.mockResolvedValue(null);
  });
  it('rejects another location manager before changing anything', async () => {
    await expect(assistKitchenVisit(10, 999, input)).rejects.toThrow(/not found/); expect(state.writes).toEqual([]);
  });
  it.each(['cancelled', 'completed', 'pending'])('does not assist a %s booking', async status => {
    state.booking.status = status; await expect(assistKitchenVisit(10, 2, input)).rejects.toThrow(/confirmed/); expect(state.notice).not.toHaveBeenCalled();
  });
  it('records when a chef who never checked out left, after the booking already reads completed (inspection window open)', async () => {
    Object.assign(state.booking, { status: 'completed', checkinStatus: 'checked_in', checkedInAt: new Date('2026-10-02T16:00:00Z') });
    state.lateOpen.mockResolvedValueOnce(true);
    expect(await assistKitchenVisit(10, 2, input)).toEqual({ success: true });
    expect(state.writes[0]).toMatchObject({ checkinStatus: 'checkout_requested', assistanceHistory: [expect.objectContaining({ action: 'departure', actualAt: '2026-10-02T19:30:00.000Z' })] });
    expect(state.persist).toHaveBeenCalledWith(10, expect.anything(), expect.any(Date));
  });
  it('refuses a late departure once the inspection window has closed', async () => {
    Object.assign(state.booking, { status: 'completed', checkinStatus: 'checked_in' });
    state.lateOpen.mockResolvedValueOnce(false);
    await expect(assistKitchenVisit(10, 2, input)).rejects.toThrow(/confirmed/);
    await expect(assistKitchenVisit(10, 2, { ...input, action: 'arrival' })).rejects.toThrow(/confirmed/);
    expect(state.writes).toEqual([]);
  });
  it.each(['checkout_requested', 'checkout_claim_filed', 'checked_out', 'no_show'])('preserves competing review/correction %s', async checkinStatus => {
    state.booking.checkinStatus = checkinStatus; await expect(assistKitchenVisit(10, 2, input)).rejects.toThrow(/correction|inspection/); expect(state.writes).toEqual([]);
  });
  it('rejects stale parent, foreign visits, missing reason and ambiguous/future time', async () => {
    await expect(assistKitchenVisit(10, 2, { ...input, expectedBookingUpdatedAt: '2026-10-01' })).rejects.toThrow(/changed/);
    await expect(assistKitchenVisit(10, 2, { ...input, visitId: 999 })).rejects.toThrow(/Choose/);
    await expect(assistKitchenVisit(10, 2, { ...input, reason: '' })).rejects.toThrow(/explain/);
    await expect(assistKitchenVisit(10, 2, { ...input, actualAt: '2026-10-02T19:30:00' })).rejects.toThrow(/UTC offset/);
    await expect(assistKitchenVisit(10, 2, { ...input, actualAt: '2099-10-02T19:30:00Z' })).rejects.toThrow(/no later/);
    expect(state.writes).toEqual([]);
  });

  it.each([
    { timezone: 'Asia/Tokyo', instant: '2026-10-02T00:30:00.000Z' },
    { timezone: 'America/Toronto', instant: '2026-10-02T13:30:00.000Z' },
    { timezone: 'America/Vancouver', instant: '2026-10-02T16:30:00.000Z' },
    { timezone: 'UTC', instant: '2026-10-02T09:30:00.000Z' },
    { timezone: 'America/St_Johns', instant: '2026-10-02T12:00:00.000Z' },
  ])('resolves datetime-local in owned $timezone for single and selected split visits', async ({ timezone, instant }) => {
    state.timezone = timezone;
    for (const visitId of [undefined, 5]) {
      state.visits = visitId ? [{ ...state.booking, id: visitId, bookingId: 10 }] : [];
      await assistKitchenVisit(10, 2, { ...input, action: 'arrival', actualAt: '2026-10-02T09:30', visitId,
        ...{ timezone: 'America/St_Johns', browserTimezone: 'UTC' } });
      const values = state.writes.at(-1);
      expect(values.checkedInAt.toISOString()).toBe(instant);
      expect(values.actualStartTime).toBe('09:30');
      expect(values.assistanceHistory[0]).toMatchObject({ actualAt: instant, recordedAt: '2026-10-03T20:00:00.000Z' });
      expect(state.notice.mock.calls.at(-1)?.[6]).toMatchObject({ visitId, actualAt: instant,
        recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    }
  });

  it.each([
    { timezone: 'Asia/Tokyo', wall: '04:30' },
    { timezone: 'America/Toronto', wall: '15:30' },
    { timezone: 'America/Vancouver', wall: '12:30' },
    { timezone: 'UTC', wall: '19:30' },
    { timezone: 'America/St_Johns', wall: '17:00' },
  ])('keeps explicit UTC assistance instant unchanged and formats $timezone wall time', async ({ timezone, wall }) => {
    state.timezone = timezone;
    await assistKitchenVisit(10, 2, { ...input, action: 'arrival' });
    expect(state.writes[0].checkedInAt.toISOString()).toBe('2026-10-02T19:30:00.000Z');
    expect(state.writes[0].actualStartTime).toBe(wall);
  });

  it('records an overnight split departure at its reported local date, separate from recording time', async () => {
    state.timezone = 'America/Vancouver';
    state.visits = [{ ...state.booking, id: 5, bookingId: 10, checkinStatus: 'checked_in',
      checkedInAt: new Date('2026-10-03T06:00:00Z'), startTime: '23:00', endTime: '01:00' }];
    await assistKitchenVisit(10, 2, { ...input, visitId: 5, actualAt: '2026-10-03T00:30' });
    expect(state.writes[0]).toMatchObject({ actualEndTime: '00:30', checkoutRequestedAt: new Date('2026-10-03T20:00:00Z'),
      assistanceHistory: [expect.objectContaining({ actualAt: '2026-10-03T07:30:00.000Z' })] });
    expect(state.writes[0]).not.toHaveProperty('checkedOutAt');
    expect(state.writes[0]).not.toHaveProperty('checkoutApprovedAt');
    await expect(assistKitchenVisit(10, 2, { ...input, visitId: 5, actualAt: '2026-10-02T22:59' })).rejects.toThrow(/cannot precede.*arrival/);
    expect(state.writes).toHaveLength(1);
  });

  it('accepts exact now in the owned zone and rejects future local input before requirements capture', async () => {
    state.timezone = 'America/Vancouver';
    await assistKitchenVisit(10, 2, { ...input, actualAt: '2026-10-03T13:00' });
    expect(state.writes[0].assistanceHistory[0].actualAt).toBe('2026-10-03T20:00:00.000Z');
    state.captured.mockClear(); state.notice.mockClear();
    await expect(assistKitchenVisit(10, 2, { ...input, actualAt: '2026-10-03T13:01' })).rejects.toThrow(/no later/);
    expect(state.writes).toHaveLength(1); expect(state.captured).not.toHaveBeenCalled(); expect(state.notice).not.toHaveBeenCalled();
  });

  it.each(['2026-03-08T02:30', '2026-11-01T01:30', '2026-02-30T09:00'])('rejects missing/repeated/invalid kitchen-local time %s', async actualAt => {
    state.timezone = 'America/Toronto'; vi.setSystemTime(new Date('2026-11-02T20:00:00Z'));
    await expect(assistKitchenVisit(10, 2, { ...input, actualAt })).rejects.toThrow(/valid kitchen-local time/);
    expect(state.writes).toEqual([]); expect(state.captured).not.toHaveBeenCalled(); expect(state.notice).not.toHaveBeenCalled();
  });
  it.each([
    { actualAt: '2026-11-01T01:30:00-04:00', instant: '2026-11-01T05:30:00.000Z' },
    { actualAt: '2026-11-01T01:30:00-05:00', instant: '2026-11-01T06:30:00.000Z' },
  ])('preserves explicit DST occurrence $actualAt', async ({ actualAt, instant }) => {
    state.timezone = 'America/Toronto'; vi.setSystemTime(new Date('2026-11-02T20:00:00Z'));
    await assistKitchenVisit(10, 2, { ...input, action: 'arrival', actualAt });
    expect(state.writes[0].checkedInAt.toISOString()).toBe(instant); expect(state.writes[0].actualStartTime).toBe('01:30');
  });
  it('denies a foreign manager before timezone parsing, duties capture or mutations', async () => {
    state.timezone = 'not-a-timezone';
    await expect(assistKitchenVisit(10, 999, { ...input, actualAt: '2026-10-02T09:30' })).rejects.toThrow('Booking not found');
    expect(state.writes).toEqual([]); expect(state.captured).not.toHaveBeenCalled(); expect(state.notice).not.toHaveBeenCalled();
  });
  it('preserves St. Johns fallback for raw local input when location zone is absent', async () => {
    await assistKitchenVisit(10, 2, { ...input, action: 'arrival', actualAt: '2026-10-02T09:30' });
    expect(state.writes[0]).toMatchObject({ actualStartTime: '09:30', checkedInAt: new Date('2026-10-02T12:00:00Z') });
  });
});
