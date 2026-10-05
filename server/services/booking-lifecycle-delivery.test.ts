import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./visit-duties', () => ({ kitchenDuties: vi.fn(async () => {
  const row = state.rows[0]?.[0];
  return { arrival: { enabled: row?.kitchen?.checkinCheckoutEnabled === true && row?.checklist?.checkinEnabled === true, instructions: row?.checklist?.checkinInstructions },
    departure: { enabled: row?.kitchen?.checkinCheckoutEnabled === true && row?.checklist?.checkoutEnabled === true, instructions: row?.checklist?.checkoutInstructions } };
}), storageDuties: vi.fn() }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
import { scheduleAdvanceReminders } from './advance-reminders';
const state = vi.hoisted(() => ({ notify: vi.fn(), insert: vi.fn(), send: vi.fn(), event: null as any, database: null as any, rows: [] as any[][] }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => state.database.select(...args), update: (...args: any[]) => state.database.update(...args), transaction: (run: any) => run(state.database) } }));
vi.mock('./notification.service', () => ({ notificationService: { create: state.notify } }));
vi.mock('../email', async importOriginal => ({ ...await importOriginal<typeof import('../email')>(), sendEmail: state.send }));
import { deliverBookingLifecycleEvents, queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
const tx: any = { select: () => { const chain: any = { from: () => chain, innerJoin: () => chain, leftJoin: () => chain, where: () => chain,
  limit: () => chain, orderBy: () => chain, for: () => chain, then: (resolve: any) => resolve(state.rows.shift()) }; return chain; },
  insert: () => ({ values: state.insert }),
  update: () => ({ set: (values: any) => ({ where: () => {
    Object.assign(state.event, values);
    const chain: any = { returning: async () => [{ ...state.event }], then: (resolve: any) => resolve([]) };
    return chain;
  } }) }),
};
describe('booking lifecycle recipients and durable email evidence', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'development'); state.rows = [
    [{ chefId: 3, managerId: 2 }], [{ id: 3, email: 'chef@example.test', role: 'chef' },
      { id: 2, email: 'manager@example.test', role: 'manager' }, { id: 1, email: 'support@example.test', role: 'admin' }] ]; });
  it('commits an in-app alert and email outbox recipient for each surface', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'report_attended', 'Chef attendance reported', 'Shared attendance evidence', 2, { visitId: 5 });
    expect(state.notify).toHaveBeenCalledTimes(3);
    expect(state.notify.mock.calls.map(call => call[0].actionUrl)).toEqual(['/booking/10', '/manager/booking/10', '/admin?section=transactions&bookingId=10']);
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'report_attended', actorId: 2,
      emails: [expect.objectContaining({ url: 'http://chef.localhost:5001/booking/10' }),
        expect.objectContaining({ url: 'http://kitchen.localhost:5001/manager/booking/10' }),
        expect.objectContaining({ url: 'http://admin.localhost:5001/admin?section=transactions&bookingId=10' })] }));
    expect(state.notify.mock.calls.every(call => call[1] === tx)).toBe(true);
  });
  it('rolls back the caller when the outbox cannot be saved', async () => {
    state.insert.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(queueBookingLifecycleEvent(tx, 10, 'report_attended', 'Confirmed', 'Payment captured')).rejects.toThrow('outbox unavailable');
  });
  it('commits participant receipts, manager-only email and reminder reconciliation for a visit action', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'checkout_requested', 'Inspection needed', 'Inspect current visit', 3,
      { visitId: 5, recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([3, 2]);
    expect(state.insert.mock.calls[0][0].emails).toHaveLength(1);
    expect(state.insert.mock.calls[0][0].emails[0].to).toBe('manager@example.test');
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(tx, 'booking', 10);
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(tx, 'booking_review', 10);
  });
  it('does not acknowledge suppressed test email as delivered', async () => {
    vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '1');
    try { expect(await deliverBookingLifecycleEvents()).toEqual({ completed: 0 }); }
    finally { vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0'); }
  });
});

const confirmed = () => ({ booking: { id: 10, chefId: 3, kitchenId: 4, status: 'confirmed', paymentStatus: 'paid',
  paymentIntentId: 'pi_fixture', bookingDate: new Date('2026-10-07'), startTime: '09:00', endTime: '15:00',
  operatingWindowStartTime: '08:00', selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '14:00', endTime: '15:00' }] },
  kitchen: { name: 'Fixture Kitchen', checkinCheckoutEnabled: false }, location: { name: 'Harbour', address: '1 Harbour Road' },
  checklist: { checkinEnabled: true, checkoutEnabled: true, checkinInstructions: 'Meet at side entrance' } });

describe('real rich renderer at the persisted confirmation boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'development'); state.rows = [
    [{ chefId: 3, managerId: 2 }], [{ id: 3, email: 'chef@example.test', role: 'chef' }, { id: 2, email: 'manager@example.test', role: 'manager' }],
    [confirmed()], [{ amount: '1220', tax: '150', fee: '70' }],
    [{ name: 'Approved cold storage', item: { totalPrice: '500', startDate: new Date('2026-10-07'), endDate: new Date('2026-10-10') } }],
    [{ name: 'Approved oven', item: { totalPrice: '200' } }],
  ]; });
  it('persists actual captured money, approved linked items, separate visits and role-specific destinations', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'confirmed', 'Confirmed', 'Captured');
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(tx, 'booking', 10);
    const emails = state.insert.mock.calls[0][0].emails;
    expect(emails[0].content.text).toContain('Payment captured: CAD $12.20 (tax CAD $1.50, service fee CAD $0.70)');
    expect(emails[0].content.text).toContain('2026-10-07–2026-10-10');
    expect(emails[0].content.text).toContain('Arrival tracking is off');
    expect(emails[0].content.text).toContain('Meet at side entrance');
    expect(emails[0].content.text).toContain('manager@example.test');
    expect(emails[0].content.text).toContain('/booking/10');
    expect(emails[1].content.text).toContain('/manager/booking/10');
    expect(emails[0].content.text).toContain('(2h; America/St_Johns)');
    const ics = emails[0].content.attachments[0].content;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:booking-10@localcooks.com-1');
    expect(ics).toContain('LOCATION:1 Harbour Road');
    expect(emails[1].content.attachments[0].content.match(/UID:.+/g)).toEqual(ics.match(/UID:.+/g));
    // JSON persistence is the retry input, without another mutable itinerary read.
    expect(JSON.parse(JSON.stringify(emails))[0].content.attachments[0].content).toBe(ics);
  });
  it('drains the persisted rich content and retries only the failed recipient with the same attachment and tracking key', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'confirmed', 'Confirmed', 'Captured');
    state.event = { ...state.insert.mock.calls[0][0], id: 99, deliveredEmailKeys: [], completedAt: null };
    state.database = tx;
    state.rows = [[state.event], [], [], [{ id: 1 }]];
    state.send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 0 });
    expect(state.event.deliveredEmailKeys).toEqual(['2']);
    const first = state.send.mock.calls[0];
    expect(first[0].attachments[0].content).toContain('UID:booking-10@localcooks.com-1');
    expect(first[1]).toMatchObject({ trackingId: 'booking-event:99:3', durableDelivery: true });
    state.rows = [[state.event], [{ status: 'confirmed' }], []]; state.send.mockResolvedValueOnce(true);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.send).toHaveBeenCalledTimes(3);
    expect(state.send.mock.calls[2]).toEqual(first);
    expect(state.event.completedAt).toBeInstanceOf(Date);
  });
  it('refuses a receipt for an unresolved capture', async () => {
    state.rows[2][0].booking.paymentStatus = 'authorized';
    await expect(queueBookingLifecycleEvent(tx, 10, 'confirmed', 'Confirmed', 'Captured')).rejects.toThrow('verified paid');
    expect(state.insert).not.toHaveBeenCalled();
  });
});
