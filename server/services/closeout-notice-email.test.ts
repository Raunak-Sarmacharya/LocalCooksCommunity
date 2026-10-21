import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, visits: [] as any[], claims: [] as any[], answers: [] as any[], cutover: null as Date | null, users: {} as Record<number, any> }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('./lifecycle-settings', () => ({ getSavedCloseoutNotificationsFrom: async () => state.cutover }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async (id: number) => state.users[id]?.name ?? (id === 3 ? 'A chef' : 'Manager') }));
import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { currentCloseoutEmail } from './closeout-notice-email';

const name = (table: any) => table[Symbol.for('drizzle:Name')];
/** The recipient lookup returns whichever address `username` names; every other table is fixed. */
function withUser(_id: number, username: string) {
  const select = () => {
    let table = '';
    const rows = () => table === 'users' ? [{ username }]
      : table === 'booking_feedback_responses' ? state.answers
      : table === 'kitchen_booking_visits' ? state.visits
      : table === 'damage_claims' ? state.claims
      : [{ booking: state.booking, kitchen: { id: 4, name: 'Harbour Kitchen' },
        location: { id: 1, name: 'Water Street Commissary', address: '1 Water St, St. John’s', timezone: 'America/St_Johns', managerId: 7 } }];
    const q: any = { from: (value: any) => { table = name(value); return q; }, innerJoin: () => q, where: () => q, orderBy: () => q,
      limit: () => q, then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
    return q;
  };
  return { select } as any;
}

// An attended visit (arrival and checkout recorded); WP-N's no-arrival email has its own tests below.
const base = { id: 128, chefId: 3, kitchenId: 4, referenceCode: 'KB-A7K9MX', bookingDate: new Date('2026-10-13'), startTime: '10:00', endTime: '11:00',
  status: 'completed', checkinStatus: 'checkout_requested', checkedInAt: new Date('2026-10-13T12:34:00Z'), checkoutRequestedAt: new Date('2026-10-13T13:25:00Z'), selectedSlots: null };
const send = (kind: any, recipient: number, to: string, metadata: any = {}) => currentCloseoutEmail(128, kind, metadata, recipient, to, withUser(recipient, to));

describe('closeout notice emails (rendered from current state, mocked database)', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T14:00:00Z'));
    const booking: any = { ...base, visitDuties: null };
    booking.visitDuties = { clockCloseout: { ...makeCloseoutSnapshot(booking, 'America/St_Johns',
      { serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15 }), serviceEndedAt: '2026-10-13T13:45:00.000Z' } };
    state.booking = booking; state.visits = []; state.claims = []; state.answers = []; state.cutover = null;
    state.users = { 3: { name: 'Maya Chen', username: 'maya@example.test' }, 7: { name: 'Sam Lee', username: 'sam@example.test' } };
  });
  afterEach(() => vi.useRealTimers());
  it('adds the feedback ask to each existing closeout email only while unanswered and open', async () => {
    state.booking.feedbackRequestedAt = new Date('2026-10-13T13:45:00Z');
    for (const [id, address] of [[3, 'maya@example.test'], [7, 'sam@example.test']] as const) {
      const email = await send('service_ended', id, address);
      expect(email?.text).toContain('Rate your session'); expect(email?.text).toContain('/booking/128#feedback');
    }
    state.answers = [{ id: 1 }];
    expect((await send('service_ended', 3, 'maya@example.test'))?.text).not.toContain('#feedback');
    state.answers = []; state.booking.feedbackRequestedAt = new Date('2026-09-01');
    expect((await send('service_ended', 3, 'maya@example.test'))?.text).not.toContain('#feedback');
  });

  it('renders only the targeted dated visit and suppresses a cancelled target at delivery', async () => {
    state.booking.status = 'confirmed'; state.booking.scheduleRevision = 1;
    state.visits = ['2026-10-13', '2026-10-16'].map((visitDate, blockIndex) => ({ id: 31 + blockIndex, bookingId: 128, blockIndex,
      visitDate, scheduleRevision: 1, scheduleState: 'active', operatingWindowStartTime: '08:00', startTime: '10:00', endTime: '11:00', checkinStatus: 'not_checked_in' }));
    state.booking.visitDuties = { clockCloseout: makeCloseoutSnapshot(state.booking, 'America/St_Johns', { serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15 }, state.visits) };
    const email = await send('service_ended', 7, 'sam@example.test', { visitKey: '31' });
    expect(email?.text).toContain('Oct 13'); expect(email?.text).not.toContain('Oct 16');
    state.visits[0].scheduleState = 'cancelled';
    expect(await send('service_ended', 7, 'sam@example.test', { visitKey: '31' })).toBeNull();
  });
  it.each(['submitted', 'charge_succeeded', 'rejected'])('chef closeout email reflects a %s claim without kitchen-only state', async status => {
    state.claims = [{ id: 1, claimVersion: 2, chefVisibleAt: new Date(), status, claimedAmountCents: 7000, finalAmountCents: 7000,
      chefResponseDeadline: new Date('2026-10-18T12:00:00Z') }];
    const email = (await send('service_ended', 3, 'maya@example.test'))!;
    expect(email.text).toContain(status === 'charge_succeeded' ? 'You paid $70.00 for damage or extra cleaning.' : status === 'submitted' ? 'Pay or dispute by' : 'nothing to pay');
    expect(email.text).not.toMatch(/all good|on its way to your bank|booking pause|kitchen payout/i);
    expect((await send('service_ended', 7, 'sam@example.test'))?.text).not.toContain('You paid $70.00');
    state.claims[0].chefVisibleAt = null;
    expect((await send('service_ended', 3, 'maya@example.test'))?.text).not.toMatch(/damage|cleaning|Pay or dispute/);
  });
  it('tells the chef the visit is complete with a neutral summary, local time and a help link', async () => {
    state.visits = [{ id: 1, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'checked_out', checkedInAt: new Date('2026-10-13T12:34:00Z'), checkoutRequestedAt: new Date('2026-10-13T13:31:00Z') }];
    const email = (await send('service_ended', 3, 'maya@example.test'))!;
    expect(email.subject).toBe('Your visit at Harbour Kitchen is complete · KB-A7K9MX');
    for (const text of [email.text!, email.html!]) {
      expect(text).toContain('Your visit at Harbour Kitchen on October 13, 2026 is complete');
      expect(text).toContain('Maya Chen');
      expect(text).toContain('Water Street Commissary');
      expect(text).toContain('Oct 13, 2026 10:00 AM - 11:00 AM');
      expect(text).toContain('Newfoundland');
      expect(text).toContain('KB-A7K9MX');
      expect(text).toContain('Arrival recorded at 10:04 AM; departure recorded at 11:01 AM.');
      expect(text).toContain('/booking/128');
      expect(text).toContain('/booking/128#booking-support');
      expect(text).toContain('not a payment receipt');
    }
    expect(email.text).not.toMatch(/Hi Chef|Inspection due/);
    expect(email.html).toContain('width=device-width');
    expect(email.html).toContain('role="presentation"');
  });
  it('offers the chef the final invoice once the paid booking is completed, and keeps the help link', async () => {
    state.booking.paymentStatus = 'paid';
    const email = (await send('service_ended', 3, 'maya@example.test'))!;
    for (const text of [email.text!, email.html!]) {
      expect(text).toContain('See your receipts');
      expect(text).toContain('/booking/128#booking-payment-title');
      expect(text).toContain('/booking/128#booking-support');
    }
    state.booking.paymentStatus = 'authorized';
    expect((await send('service_ended', 3, 'maya@example.test'))!.text).not.toContain('final invoice');
    state.booking.paymentStatus = 'paid';
    expect((await send('service_ended', 7, 'sam@example.test'))!.text).not.toContain('final invoice');
  });
  it.each([
    ['2026-10-13T12:34:00Z', undefined, 'Arrival recorded at 10:04 AM. No departure was recorded.'],
    [undefined, '2026-10-13T13:31:00Z', 'Departure recorded at 11:01 AM. No arrival was recorded.'],
  ])('words missing taps neutrally (%s / %s)', async (arrival, departure, expected) => {
    state.visits = [{ id: 1, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'not_checked_in',
      checkedInAt: arrival && new Date(arrival), checkoutRequestedAt: departure && new Date(departure) }];
    const email = (await send('service_ended', 3, 'maya@example.test'))!;
    expect(email.text).toContain(expected);
    expect(email.text).not.toMatch(/failed|missed|forgot|no-show/i);
  });
  it('asks the kitchen and tells the chef plainly when no arrival was recorded (WP-N): no "complete", no rating, no invoice', async () => {
    state.visits = [{ id: 1, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'not_checked_in' }];
    state.booking.paymentStatus = 'paid'; state.booking.feedbackRequestedAt = new Date('2026-10-13T13:45:00Z');
    const chef = (await send('service_ended', 3, 'maya@example.test'))!;
    expect(chef.subject).toBe('No check-in recorded · KB-A7K9MX');
    expect(chef.text).toContain('We didn\u2019t see a check-in for your booking at Harbour Kitchen (Oct 13, 10:00 a.m.). If you were there, let us know.');
    expect(chef.text).toContain('I was there');
    expect(chef.text).toContain('/booking/128#booking-support');
    // No money statement before the kitchen answers (owner, Oct 15).
    expect(chef.text).not.toMatch(/refund/i);
    expect(chef.text).not.toMatch(/complete|Rate your session|invoice|#feedback/i);
    const kitchen = (await send('service_ended', 7, 'sam@example.test'))!;
    expect(kitchen.subject).toBe('No check-in from Maya Chen · KB-A7K9MX');
    expect(kitchen.text).toContain('Tue, Oct 13, 10:00 a.m. Did they come? Tell us by Oct 14, 11:00 a.m.');
    expect(kitchen.text).toContain('/manager/booking/128');
    expect(kitchen.text).toContain('Nothing changes for your payout');
  });
  it('treats a kitchen "They came" statement as attended (WP-N)', async () => {
    state.visits = [{ id: 1, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'not_checked_in' }];
    const reader = withUser(3, 'maya@example.test');
    const select = reader.select;
    reader.select = (fields: any) => {
      const q = select(fields);
      const from = q.from;
      q.from = (value: any) => { if (name(value) === 'kitchen_booking_attendance_events') { q.then = (resolve: any) => Promise.resolve([{ bookingId: 128, visitId: 1, action: 'report_attended' }]).then(resolve); } return from(value); };
      return q;
    };
    const email = (await currentCloseoutEmail(128, 'service_ended', {}, 3, 'maya@example.test', reader))!;
    expect(email.subject).toBe('Your visit at Harbour Kitchen is complete · KB-A7K9MX');
  });
  it('tells the manager the visit ended, when inspection is due, and links to the inspection page', async () => {
    const email = (await send('service_ended', 7, 'sam@example.test'))!;
    expect(email.subject).toBe('Maya Chen’s visit at Harbour Kitchen has ended · KB-A7K9MX');
    expect(email.text).toContain('Maya Chen’s visit has ended');
    expect(email.text).toContain('Hi Sam Lee,');
    expect(email.text).toContain('Inspection due by: Wed, Oct 14, 2026 11:00 AM (Newfoundland');
    expect(email.text).toContain('/manager/booking/128/inspection');
    expect(email.text).not.toContain('payment receipt');
  });
  it('falls back to the address name, never to "Chef" or "Manager", when no display name exists', async () => {
    state.users = { 3: { username: 'maya@example.test' }, 7: { username: 'sam@example.test' } };
    expect((await send('service_ended', 3, 'maya@example.test'))!.text).toContain('Hi maya,');
    const manager = (await send('service_ended', 7, 'sam@example.test'))!;
    expect(manager.text).toContain('Hi sam,'); expect(manager.text).toContain('The customer’s visit has ended');
  });
  it('sends the closed-inspection notice to the manager only', async () => {
    state.booking.visitDuties.clockCloseout.inspections = { '2026-10-13|10:00-11:00|0': { outcome: 'auto_closed_uninspected', closedAt: '2026-10-14T13:30:00.000Z' } };
    vi.setSystemTime(new Date('2026-10-14T14:00:00Z'));
    const metadata = { visitKey: '2026-10-13|10:00-11:00|0' };
    const email = (await send('inspection_auto_closed', 7, 'sam@example.test', metadata))!;
    expect(email.subject).toBe('Inspection window closed for Maya Chen’s visit · KB-A7K9MX');
    expect(email.text).toContain('Inspection window closed for Maya Chen’s visit — no inspection recorded');
    expect(email.text).toContain('not a finding about damage');
    expect(email.text).toContain('No inspection recorded');
    expect(await send('inspection_auto_closed', 3, 'maya@example.test', metadata)).toBeNull();
  });
  it('sends nothing for a cancelled booking, a settled inspection, a no-show or a pre-cutover booking', async () => {
    state.booking.status = 'cancelled';
    expect(await send('service_ended', 3, 'maya@example.test')).toBeNull();
    expect(await send('service_ended', 7, 'sam@example.test')).toBeNull();
    state.booking.status = 'completed';
    state.visits = [{ id: 1, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'no_show' }];
    expect(await send('service_ended', 7, 'sam@example.test')).toBeNull();
    state.visits = [];
    state.booking.visitDuties.clockCloseout.inspections = { '2026-10-13|10:00-11:00|0': { outcome: 'auto_closed_uninspected', closedAt: '2026-10-14T13:30:00.000Z' } };
    vi.setSystemTime(new Date('2026-10-14T14:00:00Z'));
    state.booking.checkinStatus = 'checked_out';
    expect(await send('inspection_auto_closed', 7, 'sam@example.test', { visitKey: 'other' })).toBeNull();
    state.cutover = new Date('2026-10-13T14:00:00Z');
    expect(await send('service_ended', 3, 'maya@example.test')).toBeNull();
  });
  it('does not deliver to an address that no longer belongs to the recipient', async () => {
    expect(await currentCloseoutEmail(128, 'service_ended', {}, 3, 'someone-else@example.test', withUser(3, 'maya@example.test'))).toBeNull();
  });
});
