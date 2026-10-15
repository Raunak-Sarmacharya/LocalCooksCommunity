import { createBookingDateTime } from '@shared/timezone-utils';
vi.mock('./clock-closeout', () => ({ persistBookingCloseout: vi.fn(async () => ({ changed: false })), projectBookingCloseout: async () => ({ closeout: { visits: [{ inspection: { deadline: '2026-10-16T12:00:00Z' } }] } }) }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./visit-duties', async original => ({ ...await original<typeof import('./visit-duties')>(), kitchenDuties: vi.fn(async () => ({
  arrival: { enabled: true, instructions: 'Meet at side entrance', items: [], photos: [] },
  departure: { enabled: true, instructions: 'Clean up', items: [], photos: [] }, checkinWindowMinutesBefore: 15 })),
  currentKitchenDuties: vi.fn(async () => ({
    arrival: { enabled: true, instructions: 'Meet at side entrance', items: [], photos: [] },
    departure: { enabled: true, instructions: 'Clean up', items: [], photos: [] }, checkinWindowMinutesBefore: 15 })), storageDuties: vi.fn() }));
vi.mock('./visit-code-challenge', () => ({ chefVisitCodes: async () => [], currentArrivalNoticeTargets: async () => state.activeTargets, arrivalModeFor: (states: any[]) => !states.length ? 'legacy' : states.every(state => state.mode === states[0].mode) ? states[0].mode : 'mixed' }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn(), acknowledgeConfirmationReminders: vi.fn(),
  reminderVisitTimes: (booking: any, timezone: string) => (booking.selectedSlots || [{ startTime: booking.startTime, endTime: booking.endTime }]).map((slot: any, index: number) => ({ index,
    start: createBookingDateTime(booking.bookingDate.toISOString().slice(0, 10), slot.startTime, timezone),
    end: createBookingDateTime(booking.bookingDate.toISOString().slice(0, 10), slot.endTime, timezone) })) }));
import { scheduleAdvanceReminders, acknowledgeConfirmationReminders } from './advance-reminders';
const state = vi.hoisted(() => ({ payout: null as any, feedbackEmail: vi.fn(), closeoutEmail: vi.fn(), instructionEmail: vi.fn(), notify: vi.fn(), insert: vi.fn(), send: vi.fn(), log: vi.fn(), adminEmailEnabled: true, activeTargets: [] as any[], noticeRow: null as any, event: null as any, database: null as any, rows: [] as any[][], people: [] as any[] }));
vi.mock('./kitchen-payout-service', () => ({ readKitchenPayout: async () => state.payout }));
import { tEmail } from '../i18n/outbound';
vi.mock('./booking-feedback-service', () => ({ currentBookingFeedbackEmail: state.feedbackEmail,
  bookingFeedbackNoticeCopy: (kind: string, kitchen: string, locale?: string) => ({
    title: tEmail(locale, kind === 'feedback_flagged' ? 'bookingFeedbackFlagTitle' : 'bookingFeedbackTitle'),
    message: tEmail(locale, kind === 'feedback_flagged' ? 'bookingFeedbackFlagBody' : 'bookingFeedbackReminder', { kitchen }),
    actionLabel: tEmail(locale, kind === 'feedback_flagged' ? 'bookingFeedbackSupport' : 'bookingFeedbackRate'),
  }) }));
vi.mock('./closeout-notice-email', () => ({ closeoutNoticeKinds: ['service_ended', 'inspection_auto_closed'], currentCloseoutEmail: state.closeoutEmail }));
vi.mock('./kitchen-instructions-updated', () => ({ currentKitchenInstructionEmail: state.instructionEmail }));
// Mirrors the real helper's first rule (profile name), without consuming the mocked query queue.
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async (id: number) => (state.people || []).find((row: any) => row.id === id)?.profile?.fullName || '' }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => state.database.select(...args), update: (...args: any[]) => state.database.update(...args), transaction: (run: any) => run(state.database) } }));
vi.mock('./email-log-service', () => ({ logOutgoingEmail: state.log }));
vi.mock('./notification.service', () => ({ notificationService: { create: state.notify } }));
vi.mock('../email', async importOriginal => ({ ...await importOriginal<typeof import('../email')>(), sendEmail: state.send }));
import { bookingLifecycleEmailMessage, currentArrivalNotice, deliverBookingLifecycleEvents, queueBookingLifecycleEvent, requeueBookingNotice } from './booking-lifecycle-delivery';
import { generateBookingConfirmationEmail } from '../email';
const tx: any = { select: (fields?: any) => {
  if (fields?.adminEmailNotifications && !fields.id) return { from: () => ({ where: () => ({ limit: async () => [{ role: 'admin', adminEmailNotifications: state.adminEmailEnabled }] }) }) };
 const chain: any = { from: () => chain, innerJoin: () => chain, leftJoin: () => chain, where: () => chain,
  limit: () => chain, orderBy: () => chain, for: () => chain, then: (resolve: any) => resolve(fields?.chef ? [state.noticeRow] : fields?.booking && fields?.timezone ? [{ booking: confirmed().booking, timezone: 'America/St_Johns' }] : state.rows.shift()) };
  const from = chain.from;
  chain.from = (table: any) => {
    const name = table[Symbol.for('drizzle:Name')];
    if (['platform_settings', 'kitchen_booking_visits'].includes(name)) chain.then = (resolve: any) => resolve([]);
    return from(table);
  };
  return chain; },
  insert: () => ({ values: state.insert }),
  update: () => ({ set: (values: any) => ({ where: () => {
    Object.assign(state.event, values);
    const chain: any = { returning: async () => [{ ...state.event }], then: (resolve: any) => resolve([]) };
    return chain;
  } }) }),
};
it('keeps recorded change totals and schedule without emailing the itemized quote', () => {
  const message = bookingLifecycleEmailMessage('kitchen_change_awaiting_payment', 'Review this change. Original: 2026-10-20 09:00–11:00; requested: 2026-10-21 13:00–15:00 (Newfoundland time). Recorded kitchen CAD 100.00; current quote CAD 120.00; kitchen after change CAD 120.00. Additional kitchen CAD 20.00, tax CAD 2.60, service fee CAD 1.40, payment CAD 24.00. Refund on approval: kitchen CAD 0.00 plus original tax CAD 0.00, total CAD 0.00. The original service fee stays charged.');
  expect(message).toContain('Additional total: CAD 24.00');
  expect(message).toContain('Refund on approval: CAD 0.00');
  expect(message).toContain('9:00 a.m.');
  expect(message).not.toMatch(/service fee|\btax\b|09:00|13:00|%/i);
});
describe('instruction update outbox delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('INNGEST_EVENT_KEY', ''); state.database = tx;
    state.event = { id: 88, bookingId: 10, kind: 'instructions_updated', title: 'Update', message: 'Stale queued notes',
      metadata: { revision: 2, sections: ['departureInstructions'], recipientPolicy: 'chef' },
      emails: [{ key: '3', to: 'alex@test.ca', url: 'https://chef.localcooks.test/booking/10' }], deliveredEmailKeys: [], completedAt: null };
    state.rows = [[{ ...state.event }], []]; state.send.mockResolvedValue(true);
  });
  it('renders delivery-time content with revision-aware SMTP evidence', async () => {
    state.instructionEmail.mockResolvedValue({ to: 'alex@test.ca', subject: 'Current update', text: 'Current departure', html: '<p>Current departure</p>' });
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.instructionEmail).toHaveBeenCalledWith(10, expect.objectContaining({ revision: 2 }), 3, 'alex@test.ca');
    expect(state.send.mock.calls[0][0].text).toBe('Current departure');
    expect(state.send.mock.calls[0][1].trackingId).toBe('booking-event:88:3:r2');
  });
  it('completes an ineligible/reverted update without sending queued stale content', async () => {
    state.instructionEmail.mockResolvedValue(null);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.send).not.toHaveBeenCalled(); expect(state.event.completedAt).toBeInstanceOf(Date);
  });
});
describe('closeout notice delivery and recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('INNGEST_EVENT_KEY', ''); vi.stubEnv('NODE_ENV', 'development'); state.database = tx; state.adminEmailEnabled = true;
    state.send.mockResolvedValue(true);
  });
  it('targets only an unanswered participant with localized feedback copy and an anchor', async () => {
    state.rows = [[{ chefId: 3, managerId: 2, kitchenName: 'Harbour Kitchen' }], [
      { id: 3, email: 'chef@example.test', role: 'chef', locale: 'en-CA' },
      { id: 2, email: 'manager@example.test', role: 'manager', locale: 'fr-CA' },
      { id: 1, email: 'admin@example.test', role: 'admin' }]];
    await queueBookingLifecycleEvent(tx, 10, 'feedback_requested', 'Queued title', 'Queued message', undefined,
      { recipientPolicy: 'participants', recipientIds: [2] });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify.mock.calls[0][0]).toMatchObject({ userId: 2, actionUrl: '/manager/booking/10#feedback', title: 'Comment ça s’est passé?' });
    expect(state.notify.mock.calls[0][0].metadata).toEqual({ bookingId: 10 });
    const emails = state.insert.mock.calls[0][0].emails;
    expect(emails).toHaveLength(1); expect(emails[0].content.text).toContain('Ça prend 30 secondes.');
  });
  it('routes concerning feedback only to the admin support case, with no answers in the notice shell', async () => {
    state.rows = [[{ chefId: 3, managerId: 2, kitchenName: 'Harbour Kitchen' }], [
      { id: 3, email: 'chef@example.test', role: 'chef' }, { id: 2, email: 'manager@example.test', role: 'manager' },
      { id: 1, email: 'admin@example.test', role: 'admin', adminEmailNotifications: true, locale: 'en-CA' }]];
    await queueBookingLifecycleEvent(tx, 10, 'feedback_flagged', 'Concern', 'Concern', 3, { recipientPolicy: 'admins', supportCase: true });
    expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([1]);
    expect(state.notify.mock.calls[0][0].actionUrl).toBe('/admin?section=booking-support&booking=10');
    expect(state.insert.mock.calls[0][0].emails).toHaveLength(1);
  });
  it('tells only the manager the chef is running late, in their language, linking straight to messaging', async () => {
    state.people = [{ id: 3, profile: { fullName: 'Maya Chen' } }];
    state.rows = [[{ chefId: 3, managerId: 2, kitchenName: 'Harbour Kitchen', timezone: 'America/St_Johns' }], [
      { id: 3, email: 'chef@example.test', role: 'chef', locale: 'en-CA' },
      { id: 2, email: 'manager@example.test', role: 'manager', locale: 'en-CA' },
      { id: 1, email: 'admin@example.test', role: 'admin', adminEmailNotifications: true, locale: 'en-CA' }]];
    await queueBookingLifecycleEvent(tx, 10, 'running_late', 'Maya Chen is running late', 'fallback', 3,
      { recipientPolicy: 'manager', minutes: 15, reportedAt: '2026-10-14T12:52:00.000Z', endsAt: '2026-10-14T17:30:00.000Z', note: 'Traffic is slow' });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify.mock.calls[0][0]).toMatchObject({ userId: 2, title: 'Maya Chen is running late', actionLabel: 'Message Maya Chen', actionUrl: '/manager/booking/10?action=message' });
    expect(state.notify.mock.calls[0][0].message).toContain('Maya Chen is running about 15 minutes late. Their booking still ends at 3:00 p.m.');
    expect(state.notify.mock.calls[0][0].message).toContain('Their note: Traffic is slow');
    const emails = state.insert.mock.calls[0][0].emails;
    expect(emails).toHaveLength(1);
    expect(emails[0].url).toContain('/manager/booking/10?action=message');
    expect(emails[0].content.text).toContain('Message Maya Chen');
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(tx, 'booking', 10);
  });
  it('drops an answered or expired feedback reminder at delivery time', async () => {
    state.event = { id: 95, bookingId: 10, kind: 'feedback_requested', title: 'Feedback', message: 'Queued', metadata: {},
      emails: [{ key: '3', to: 'chef@example.test', url: 'https://chef.localcooks.test/booking/10#feedback' }], deliveredEmailKeys: [], completedAt: null };
    state.rows = [[{ ...state.event }]]; state.feedbackEmail.mockResolvedValue(null);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.feedbackEmail).toHaveBeenCalledWith(10, 3, 'chef@example.test'); expect(state.send).not.toHaveBeenCalled();
  });
  it.each(['service_ended', 'inspection_auto_closed'])('renders %s from current state at delivery, not from the queued generic text', async kind => {
    state.event = { id: 90, bookingId: 10, kind, title: 'Visit finished', message: 'Queued generic text', metadata: { visitKey: '5' },
      emails: [{ key: '2', to: 'manager@example.test', url: 'https://kitchen.localcooks.test/manager/booking/10' }], deliveredEmailKeys: [], completedAt: null };
    state.rows = [[{ ...state.event }], []];
    state.closeoutEmail.mockResolvedValue({ to: 'manager@example.test', subject: 'Rich closeout', text: 'Rich text', html: '<p>Rich</p>' });
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.closeoutEmail).toHaveBeenCalledWith(10, kind, { visitKey: '5' }, 2, 'manager@example.test');
    expect(state.send.mock.calls[0][0]).toMatchObject({ subject: 'Rich closeout', text: 'Rich text' });
    expect(state.send.mock.calls[0][0].html).not.toContain('Queued generic text');
  });
  it('sends nothing when the booking was cancelled or the notice is no longer relevant', async () => {
    state.event = { id: 91, bookingId: 10, kind: 'service_ended', title: 'Visit finished', message: 'Queued', metadata: {},
      emails: [{ key: '3', to: 'chef@example.test', url: 'https://chef.localcooks.test/booking/10' }], deliveredEmailKeys: [], completedAt: null };
    state.rows = [[{ ...state.event }], []];
    state.closeoutEmail.mockResolvedValue(null);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.send).not.toHaveBeenCalled(); expect(state.event.completedAt).toBeInstanceOf(Date);
  });
  it('queues the inspection-closed notice for the manager only, in-app and email, and words visit-finished notices per role', async () => {
    const people = () => [[{ chefId: 3, managerId: 2 }], [{ id: 3, email: 'chef@example.test', role: 'chef' },
      { id: 2, email: 'manager@example.test', role: 'manager' }, { id: 1, email: 'support@example.test', role: 'admin', adminEmailNotifications: true }]];
    state.rows = people();
    await queueBookingLifecycleEvent(tx, 10, 'inspection_auto_closed', 'Inspection window closed', 'Closed', undefined, { recipientPolicy: 'manager', visitKey: '5' });
    expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([2]);
    expect(state.insert.mock.calls[0][0].emails.map((email: any) => email.to)).toEqual(['manager@example.test']);
    state.notify.mockClear(); state.insert.mockClear(); state.rows = people();
    await queueBookingLifecycleEvent(tx, 10, 'service_ended', 'Visit finished', 'Generic', undefined, { recipientPolicy: 'participants',
      roleText: { chef: { title: 'Your visit is complete', message: 'Chef text' }, manager: { title: 'A visit has ended', message: 'Manager text' } } });
    expect(state.notify.mock.calls.map(call => [call[0].userId, call[0].title, call[0].message])).toEqual([
      [3, 'Your visit is complete', 'Chef text'], [2, 'A visit has ended', 'Manager text']]);
    expect(state.insert.mock.calls[0][0].emails.map((email: any) => email.to)).toEqual(['chef@example.test', 'manager@example.test']);
  });
});
describe('booking lifecycle recipients and durable email evidence', () => {
  beforeEach(() => { vi.clearAllMocks(); state.adminEmailEnabled = true; vi.stubEnv('NODE_ENV', 'development'); state.rows = [
    [{ chefId: 3, managerId: 2 }], [{ id: 3, email: 'chef@example.test', role: 'chef' },
      { id: 2, email: 'manager@example.test', role: 'manager' }, { id: 1, email: 'support@example.test', role: 'admin', adminEmailNotifications: true }] ]; });
  it('records the R5 request deadline in both request emails and schedules decision reminders', async () => {
    state.rows[0] = [{ chefId: 3, managerId: 2, timezone: 'UTC', kitchenName: 'Harbour Kitchen', bookingDate: new Date('2026-10-14'), startTime: '20:00', endTime: '21:00' }];
    state.rows.push([{ booking: { id: 10, kitchenId: 4, chefId: 3, paymentIntentId: 'pi_fixture', status: 'pending', createdAt: new Date('2026-10-14T10:00:00Z'),
      bookingDate: new Date('2026-10-14'), startTime: '20:00', endTime: '21:00' }, kitchen: { name: 'Harbour Kitchen' }, location: { timezone: 'UTC', name: 'Harbour' } }]);
    state.rows.push([{ status: 'authorized', amount: '1200' }]);
    await queueBookingLifecycleEvent(tx, 10, 'requested', 'Request received', 'Review request');
    const emails = state.insert.mock.calls[0][0].emails.filter((email: any) => !email.adminRecipient);
    expect(emails).toHaveLength(2);
    for (const email of emails) expect(email.content.text).toContain('7:00 p.m.');
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(tx, 'manager_decision', 10);
  });
  it('uses expiry role copy and an environment-aware Find another time link', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'cancelled', 'Booking request expired', 'Chef expiry copy', undefined,
      { requestExpired: true, kitchenPath: '/kitchen-preview/5?kitchenId=4', roleText: {
        chef: { title: 'Booking request expired', message: "The request expired. Your card wasn't charged." },
        manager: { title: 'Booking request expired', message: 'The request expired. Their card hold was released.' } } });
    const emails = state.insert.mock.calls[0][0].emails;
    const chef = emails.find((email: any) => email.key === '3');
    expect(chef.content.text).toContain("Your card wasn't charged.");
    expect(chef.content.text).toContain('Find another time');
    expect(chef.content.text).toContain('http://chef.localhost:5001/kitchen-preview/5?kitchenId=4');
    expect(emails.find((email: any) => email.key === '2').content.text).toContain('Their card hold was released.');
  });
  it('commits an in-app alert and email outbox recipient for each surface', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'report_attended', 'Chef attendance reported', 'Shared attendance evidence', 2, { visitId: 5 });
    // Attendance is on the owner's admin tracking list (problems): Local Cooks gets its own summary.
    expect(state.notify).toHaveBeenCalledTimes(3);
    expect(state.notify.mock.calls.map(call => call[0].actionUrl)).toEqual(['/booking/10', '/manager/booking/10', '/admin?section=transactions&bookingId=10']);
    expect(state.notify.mock.calls[2][0].title).toMatch(/^Attendance reported · /);
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'report_attended', actorId: 2,
      emails: [expect.objectContaining({ url: 'http://chef.localhost:5001/booking/10' }),
        expect.objectContaining({ url: 'http://kitchen.localhost:5001/manager/booking/10' }),
        expect.objectContaining({ url: 'http://admin.localhost:5001/admin?section=transactions&bookingId=10' })] }));
    expect(state.notify.mock.calls.every(call => call[1] === tx)).toBe(true);
  });
  it('queues support notices to both parties and financial flags only to admins with a case link', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'support_updated', 'Local Cooks support updated your booking', 'Shared update', 77, { recipientPolicy: 'participants' });
    expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([3, 2]);
    expect(state.insert.mock.calls[0][0].emails.map((email: any) => email.to)).toEqual(['chef@example.test', 'manager@example.test']);
    state.notify.mockClear(); state.insert.mockClear(); state.rows = [[{ chefId: 3, managerId: 2 }], [
      { id: 3, email: 'chef@example.test', role: 'chef' }, { id: 2, email: 'manager@example.test', role: 'manager' },
      { id: 1, email: 'admin@example.test', role: 'admin', adminEmailNotifications: true }]];
    await queueBookingLifecycleEvent(tx, 10, 'support_flag_changed', 'Payment needs review', 'Shared flag', undefined, { recipientPolicy: 'admins', supportCase: true });
    expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([1]);
    expect(state.insert.mock.calls[0][0].emails[0].url).toBe('http://admin.localhost:5001/admin?section=booking-support&booking=10');
  });
  it('renders payout failure guidance on the notice shell with an environment-aware Connect refresh link', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'support_payout_failed', 'We couldn’t send your payout for KB-TEST',
      'We couldn’t send your payout for KB-TEST — update your payout details.', undefined, { recipientPolicy: 'manager' });
    const emails = state.insert.mock.calls[0][0].emails;
    expect(emails).toHaveLength(1); expect(emails[0].content.html).toContain('http://kitchen.localhost:5001/manager/stripe-connect/refresh?role=manager');
    expect(emails[0].content.text).toContain('update your payout details');
  });
  it('tells the manager they have been paid (amount + statement link); Local Cooks gets a "Payout sent" summary', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'payout_released', 'You’ve been paid', 'Queued fallback', undefined,
      { recipientPolicy: 'manager', transactionId: 8, amountCents: 2732 });
    expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([2, 1]);
    expect(state.notify.mock.calls[1][0].title).toMatch(/^Payout sent · .* · \$27\.32$/);
    expect(state.notify.mock.calls[0][0]).toMatchObject({ title: 'You’ve been paid $27.32 · #10', actionLabel: 'View payout statement' });
    expect(state.notify.mock.calls[0][0].message).toContain('$27.32');
    const emails = state.insert.mock.calls[0][0].emails;
    expect(emails.map((email: any) => email.to)).toEqual(['manager@example.test', 'support@example.test']);
    expect(emails[1].content.subject).toMatch(/^Payout sent · /);
    expect(emails[0].content.text).toContain('your usual payout schedule');
    expect(emails[0].content.html).toContain('http://kitchen.localhost:5001/manager/booking/10#booking-payment-title');
  });
  it('rolls back the caller when the outbox cannot be saved', async () => {
    state.insert.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(queueBookingLifecycleEvent(tx, 10, 'report_attended', 'Confirmed', 'Payment captured')).rejects.toThrow('outbox unavailable');
  });
  it('Local Cooks events: every admin gets the in-app alert, email only for opted-in admins', async () => {
    state.rows[1][2].adminEmailNotifications = false;
    state.rows[1].push({ id: 4, email: 'test_admin@localcooks.ca', role: 'admin', adminEmailNotifications: true });
    await queueBookingLifecycleEvent(tx, 10, 'support_flag', 'Payment needs review', 'Flag', undefined, { recipientPolicy: 'admins', supportCase: true });
    expect(state.notify).toHaveBeenCalledTimes(2);
    expect(state.insert.mock.calls[0][0].emails.map((email: any) => email.to)).toEqual(['test_admin@localcooks.ca']);
  });
  it('visit milestones and reminders never copy admins', async () => {
    state.rows[1].push({ id: 4, email: 'test_admin@localcooks.ca', role: 'admin', adminEmailNotifications: true });
    await queueBookingLifecycleEvent(tx, 10, 'checkin_recorded', 'Checked in', 'Chef checked in.');
    expect(state.insert.mock.calls[0][0].emails.map((email: any) => email.to)).not.toContain('test_admin@localcooks.ca');
    expect(state.notify.mock.calls.map(call => call[0].userId)).not.toContain(4);
  });
  it('a cancellation reaches opted-in admins in Local Cooks wording with the refund facts (never "You cancelled")', async () => {
    Object.assign(state.rows[0][0], { startTime: '10:00', bookingDate: new Date('2026-10-17T00:00:00Z'), referenceCode: 'KB-Z2BR6J' });
    state.rows[1].push({ id: 4, email: 'test_admin@localcooks.ca', role: 'admin', adminEmailNotifications: true });
    await queueBookingLifecycleEvent(tx, 10, 'cancelled', 'Booking cancelled', 'You cancelled your booking.', 3,
      { cancellationNotice: { cause: 'chef', refundCents: 2907, feeCents: 143 } });
    const admin = state.notify.mock.calls.find(call => call[0].userId === 4)![0];
    expect(admin.title).toMatch(/^Booking cancelled · /);
    expect(admin.message).toMatch(/cancelled — .* Refunded \$29\.07\. Processing fee kept: \$1\.43\./);
    expect(admin.message).not.toMatch(/You cancelled/);
    const email = state.insert.mock.calls[0][0].emails.find((item: any) => item.to === 'test_admin@localcooks.ca');
    expect(email.content.subject).toMatch(/^Booking cancelled · /);
  });
  it('commits participant receipts, manager-only email and reminder reconciliation for a visit action', async () => {
    await queueBookingLifecycleEvent(tx, 10, 'checkout_requested', 'Inspection needed', 'Inspect current visit', 3,
      { visitId: 5, recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([2]);
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

describe('support recipient notice replay', () => {
  let original: any, inserted: any;
  beforeEach(() => {
    vi.stubEnv('INNGEST_EVENT_KEY', ''); inserted = null;
    original = { id: 88, bookingId: 10, kind: 'support_updated', title: 'Support update', message: 'Recorded message',
      metadata: { deliveryFailures: 1 }, deliveredEmailKeys: ['2'], completedAt: null,
      emails: [{ key: '3', to: 'chef@example.test', url: 'http://chef.localhost:5001/booking/10' },
        { key: '2', to: 'manager@example.test', url: 'http://kitchen.localhost:5001/manager/booking/10' }] };
    state.database = { select: () => {
      let table: any;
      const chain: any = { from: (value: any) => { table = value; return chain; }, where: () => chain, for: () => chain, limit: () => chain,
        then: (resolve: any) => resolve(table[Symbol.for('drizzle:Name')] === 'booking_lifecycle_events' ? [original] : []) }; return chain;
    }, update: () => ({ set: (values: any) => ({ where: async () => Object.assign(original, values) }) }),
    insert: () => ({ values: (values: any) => { inserted = values; return { returning: async () => [{ id: 99 }] }; } }) };
  });
  it('requeues just the failed recipient and stops the older worker from sending that same channel', async () => {
    expect(await requeueBookingNotice(10, 88, 3, false, 'delivery_retry', 77, 'support-notice')).toEqual({ success: true, eventId: 99 });
    expect(inserted.emails).toHaveLength(1); expect(inserted.emails[0].key).toBe('3');
    expect(original.metadata.supersededEmailKeys).toEqual(['3']); expect(inserted.metadata.supersededEmailKeys).toEqual([]);
    expect(inserted.metadata.originalEventId).toBe(88);
  });
  it('requires an explicit force plus reason for an already-accepted recipient', async () => {
    await expect(requeueBookingNotice(10, 88, 2, false, 'retry', 77, 'support-notice')).rejects.toThrow('already accepted');
    await expect(requeueBookingNotice(10, 88, 2, true, '', 77, 'support-notice')).rejects.toThrow('already accepted');
    await expect(requeueBookingNotice(10, 88, 2, true, 'requested_again', 77, 'support-notice')).resolves.toMatchObject({ success: true });
  });
  it('refuses an unknown recipient, an active delivery lease and a notice that has not failed', async () => {
    await expect(requeueBookingNotice(10, 88, 4, false, 'retry', 77, 'support-notice')).rejects.toThrow('recipient');
    original.leaseUntil = new Date(Date.now() + 60000);
    await expect(requeueBookingNotice(10, 88, 3, false, 'retry', 77, 'support-notice')).rejects.toThrow('already being sent');
    original.leaseUntil = null; original.metadata.deliveryFailures = 0;
    await expect(requeueBookingNotice(10, 88, 3, false, 'retry', 77, 'support-notice')).rejects.toThrow('not failed');
  });
});

describe('current arrival notices', () => {
  const target = { targetKey: 'booking:10', visitId: null, revision: 2, mode: 'staffed' as const };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    state.noticeRow = { ...confirmed(), location: { timezone: 'UTC' }, chef: { username: 'chef@example.test' } };
    state.activeTargets = [target]; state.rows = [];
  });
  afterEach(() => vi.useRealTimers());
  it('mode changes always qualify for chef email; reissue emails only qualify near arrival or after failed attempts', async () => {
    expect((await currentArrivalNotice(10, 'arrival_mode_changed', [target], 3, 'chef@example.test', false, tx))?.emailEligible).toBe(true);
    const early = await currentArrivalNotice(10, 'arrival_code_reissued', [target], 3, 'chef@example.test', false, tx);
    expect(early?.emailEligible).toBe(false);
    expect(early?.message).toContain('ask for the current one');
    expect((await currentArrivalNotice(10, 'arrival_code_reissued', [target], 3, 'chef@example.test', true, tx))?.emailEligible).toBe(true);
    vi.setSystemTime(new Date('2026-10-07T07:00:00Z'));
    expect((await currentArrivalNotice(10, 'arrival_code_reissued', [target], 3, 'chef@example.test', false, tx))?.emailEligible).toBe(true);
  });
  it('skips cancelled, superseded, consumed, revoked and expired targets rather than sending queued content', async () => {
    state.noticeRow.booking.status = 'cancelled';
    expect(await currentArrivalNotice(10, 'arrival_mode_changed', [target], 3, 'chef@example.test', false, tx)).toBeNull();
    state.noticeRow.booking.status = 'confirmed'; state.activeTargets = [];
    expect(await currentArrivalNotice(10, 'arrival_mode_changed', [target], 3, 'chef@example.test', false, tx)).toBeNull();
    state.activeTargets = [target]; vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    expect(await currentArrivalNotice(10, 'arrival_mode_changed', [target], 3, 'chef@example.test', false, tx)).toBeNull();
  });
});

describe('real rich renderer at the persisted confirmation boundary', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T12:00:00Z')); vi.clearAllMocks(); state.adminEmailEnabled = true; vi.stubEnv('NODE_ENV', 'development'); state.rows = [
    [{ chefId: 3, managerId: 2 }], [{ id: 3, email: 'chef@example.test', role: 'chef' }, { id: 2, email: 'manager@example.test', role: 'manager' }],
    [confirmed()], [{ amount: '1220', tax: '150', fee: '70', payout: '1080' }],
    [{ name: 'Approved cold storage', item: { totalPrice: '500', startDate: new Date('2026-10-07'), endDate: new Date('2026-10-10') } }],
    [{ name: 'Approved oven', item: { totalPrice: '200' } }],
  ]; state.people = state.rows[1]; });
  it('persists actual captured money, approved linked items, separate visits and role-specific destinations', async () => {
    state.rows[1][0].profile = { fullName: 'Sam Taylor' };
    await queueBookingLifecycleEvent(tx, 10, 'confirmed', 'Confirmed', 'Captured');
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(tx, 'booking', 10);
    const emails = state.insert.mock.calls[0][0].emails;
    expect(emails[0].content.text).toContain('Total paid: CAD $12.20');
    expect(emails[0].content.text).toContain('2026-10-07–2026-10-10');
    expect(emails[0].content.text).not.toContain('Check in for each visit');
    // No Stripe fee recorded yet: the staff estimate subtracts the display estimate (2.9% + $0.30 of $12.20 = $0.65), as the kitchen page does.
    expect(emails[1].content.text).toContain('Estimated payout: CAD $10.15');
    expect(emails[0].content.text).not.toMatch(/^Service fee:|tax CAD|America\//im);
    expect(emails[0].content.text).toContain('Hi Sam Taylor,');
    expect(emails[0].content.text).not.toContain('Hi Chef,');
    expect(emails[0].content.text).toContain('Meet at side entrance');
    expect(emails[0].content.text).toContain('manager@example.test');
    expect(emails[0].content.text).toContain('/booking/10');
    expect(emails[1].content.text).toContain('/manager/booking/10');
    expect(emails[0].content.text).toContain('Newfoundland Time');
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
  it.each(['2026-10-01T12:00:00Z', '2026-10-06T12:00:00Z'])('refreshes older queued confirmations without structured inputs at %s', async instant => {
    vi.setSystemTime(new Date(instant));
    const old = generateBookingConfirmationEmail({ chefEmail: 'chef@example.test', chefName: 'Alex', kitchenName: 'Fixture Kitchen',
      ...confirmed().booking, bookingId: 10, timezone: 'America/St_Johns', isStaff: false,
      totalCents: 1220, paymentSummary: 'Payment captured: CAD $12.20', arrivalInstructions: 'PRIVATE-LEGACY-SENTINEL' });
    state.event = { id: 99, bookingId: 10, kind: 'confirmed', title: 'Confirmed', message: 'Captured', metadata: {},
      emails: [{ key: '3', to: 'chef@example.test', url: 'https://chef.example.test/booking/10', content: old }], deliveredEmailKeys: [] };
    state.database = tx; state.rows = [[state.event], []]; state.send.mockResolvedValue(true);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    const content = state.send.mock.calls[0][0];
    expect(JSON.stringify(content)).not.toContain('PRIVATE-LEGACY-SENTINEL');
    expect(content.text).toContain('Total paid: CAD $12.20');
    expect(content.attachments).toEqual(old.attachments);
    expect(content.text.includes('Arrival instructions:')).toBe(instant.includes('10-06'));
  });
  it('replaces unrecognized legacy content with a safe body and a working booking button', async () => {
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    state.event = { id: 99, bookingId: 10, kind: 'confirmed', title: 'Confirmed', message: 'Captured', metadata: {},
      emails: [{ key: '3', to: 'chef@example.test', url: 'https://chef.example.test/booking/10',
        content: { to: 'chef@example.test', subject: 'Confirmed', text: 'PRIVATE-LEGACY-SENTINEL', html: '<p>PRIVATE-LEGACY-SENTINEL</p>' } }], deliveredEmailKeys: [] };
    state.database = tx; state.rows = [[state.event], []]; state.send.mockResolvedValue(true);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    const content = state.send.mock.calls[0][0];
    expect(JSON.stringify(content)).not.toContain('PRIVATE-LEGACY-SENTINEL');
    expect(content.text).toContain('Open booking: https://chef.example.test/booking/10');
    expect(content.html).toContain('href="https://chef.example.test/booking/10"');
  });
  it('does not acknowledge newly released details from an earlier accepted overview after a worker interruption', async () => {
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    await queueBookingLifecycleEvent(tx, 10, 'confirmed', 'Confirmed', 'Captured');
    state.event = { ...state.insert.mock.calls[0][0], id: 99, deliveredEmailKeys: ['2'], completedAt: null };
    state.database = tx;
    const overview = state.event.emails.find((email: any) => email.key === '3').content.text;
    expect(overview).not.toContain('Arrival instructions:');
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    vi.mocked(acknowledgeConfirmationReminders).mockClear();
    state.rows = [[state.event], [{ id: 1, textBody: overview, createdAt: new Date('2026-10-01T12:00:00Z') }]];
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(acknowledgeConfirmationReminders).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });
  it('suppresses queued emails after an admin opts out without claiming SMTP acceptance', async () => {
    state.event = { id: 99, bookingId: 10, kind: 'report_attended', title: 'Review attendance', message: 'Review record',
      emails: [{ key: '1', to: 'admin@example.test', url: 'https://admin.example.test' }], metadata: {}, deliveredEmailKeys: [] };
    state.database = tx;
    state.adminEmailEnabled = false;
    state.rows = [[state.event]];
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.send).not.toHaveBeenCalled();
    expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped_preference' }));
    expect(state.event.deliveredEmailKeys).toEqual(['1']);
  });
});

describe('booking email retry policy', () => {
  const event = (metadata: Record<string, unknown> = {}) => ({ id: 77, bookingId: 10, kind: 'requested', title: 'Request received', message: 'Review request',
    emails: [{ key: '3', to: 'chef@invalid.test', url: 'https://chef.example.test/booking/10' }], metadata, deliveredEmailKeys: [], completedAt: null });
  beforeEach(() => { vi.clearAllMocks(); state.database = tx; state.adminEmailEnabled = true; });
  it('stops retrying an address the relay permanently refuses and raises recovery once', async () => {
    const { SmtpDeliveryError } = await import('./bounded-smtp');
    state.event = event();
    state.rows = [[state.event], [], [{ id: 1 }]];
    state.send.mockRejectedValueOnce(new SmtpDeliveryError('smtp_rejected', { responseCode: 554, code: 'EENVELOPE', command: 'RCPT TO' }));
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.event.completedAt).toBeInstanceOf(Date);
    expect(state.event.metadata).toMatchObject({ undeliverableEmailKeys: ['3'], deliveryRecoveryOwnerIds: [1] });
    expect(state.event.metadata.deliveryFailures).toBeUndefined();
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][1]).toMatchObject({ reportDeliveryFailure: true, durableDelivery: true });
  });
  it('classifies relay refusals: 5xx at RCPT or end of DATA is permanent; sender, auth and 4xx stay retryable', async () => {
    const { SmtpDeliveryError, isPermanentRecipientRejection } = await import('./bounded-smtp');
    const refusal = (smtp: { responseCode?: number; code?: string; command?: string }) => new SmtpDeliveryError('smtp_rejected', smtp);
    expect(isPermanentRecipientRejection(refusal({ responseCode: 554, code: 'EMESSAGE', command: 'DATA' }))).toBe(true);
    expect(isPermanentRecipientRejection(refusal({ responseCode: 550, code: 'EENVELOPE', command: 'RCPT TO' }))).toBe(true);
    expect(isPermanentRecipientRejection(refusal({ responseCode: 553, code: 'EENVELOPE', command: 'MAIL FROM' }))).toBe(false);
    expect(isPermanentRecipientRejection(refusal({ responseCode: 535, code: 'EAUTH' }))).toBe(false);
    expect(isPermanentRecipientRejection(refusal({ responseCode: 451, code: 'EMESSAGE', command: 'DATA' }))).toBe(false);
    expect(isPermanentRecipientRejection(new SmtpDeliveryError('acceptance_unknown'))).toBe(false);
  });
  it('keeps our own relay or sender failures retryable with backoff, then parks the event', async () => {
    const { SmtpDeliveryError } = await import('./bounded-smtp');
    state.event = event({ deliveryRecoveryOwnerIds: [1], deliveryFailures: 2 });
    state.rows = [[state.event], [], []];
    state.send.mockRejectedValueOnce(new SmtpDeliveryError('smtp_rejected', { responseCode: 535, code: 'EAUTH' }));
    const before = Date.now();
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 0 });
    expect(state.event.completedAt).toBeNull();
    expect(state.event.metadata).toMatchObject({ deliveryFailures: 3 });
    expect(state.event.metadata.deliveryPaused).toBeUndefined();
    expect(state.event.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(240_000);
    state.event = event({ deliveryRecoveryOwnerIds: [1], deliveryFailures: 7 });
    state.rows = [[state.event], [], []];
    state.send.mockResolvedValueOnce(false);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 0 });
    expect(state.event.metadata).toMatchObject({ deliveryFailures: 8, deliveryPaused: true });
  });
  it('doubles the retry delay from one minute and caps it at six hours', async () => {
    const { bookingEmailRetryDelayMs } = await import('./booking-lifecycle-delivery');
    expect([1, 2, 3, 10, 40].map(bookingEmailRetryDelayMs)).toEqual([60_000, 120_000, 240_000, 21_600_000, 21_600_000]);
  });
});

describe('consolidated checkout and closeout notices', () => {
  const people = [{ id: 3, email: 'chef@example.test', role: 'chef', locale: 'en-CA' },
    { id: 2, email: 'manager@example.test', role: 'manager', locale: 'en-CA' }];
  const context = { chefId: 3, managerId: 2, kitchenName: 'Harbour Kitchen', bookingDate: new Date('2026-10-14'), startTime: '09:00', timezone: 'UTC' };
  beforeEach(() => { vi.clearAllMocks(); state.database = tx; state.payout = null; });
  it.each([true, false])('selects exactly one manager checkout notice (after closeout: %s)', async afterCloseout => {
    state.payout = afterCloseout ? { timing: 'after_closeout', status: 'scheduled', amountCents: 2732, expectedAt: '2026-10-16T12:00:00Z' } : { timing: 'at_capture', status: 'sent' };
    state.rows = [[context], people];
    await queueBookingLifecycleEvent(tx, 10, 'checkout_requested', 'Checked out', 'Review checkout', 3, { recipientPolicy: 'participants' });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify.mock.calls[0][0].userId).toBe(2);
    expect(state.insert.mock.calls[0][0].emails[0].to).toBe('manager@example.test');
    expect(state.notify.mock.calls[0][0].title).toContain('checked out');
    expect(state.insert.mock.calls[0][0].emails).toHaveLength(1);
    expect(state.notify.mock.calls[0][0].message.includes('$27.32')).toBe(afterCloseout);
  });
  it('sends one chef Visit complete notice with the outcome and no second email, idempotent per visit', async () => {
    state.rows = [[], [context], people, []];
    await queueBookingLifecycleEvent(tx, 10, 'visit_closed', 'Fallback', 'Fallback', 2,
      { visitId: 5, recipientPolicy: 'chef', emailRecipientPolicy: 'none', inspectionOutcome: 'manager_cleared' });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify.mock.calls[0][0]).toMatchObject({ userId: 3, title: 'Visit complete \u00b7 Harbour Kitchen', message: tEmail('en-CA', 'ncVisitCompleteInvoice', { kitchen: 'Harbour Kitchen' }) });
    expect(state.insert.mock.calls[0][0].emails).toEqual([]);
    state.rows = [[{ id: 99 }]];
    await queueBookingLifecycleEvent(tx, 10, 'visit_closed', 'Fallback', 'Fallback', 2, { visitId: 5 });
    expect(state.notify).toHaveBeenCalledTimes(1);
  });
});


describe('claim-aware chef closeout delivery', () => {
  beforeEach(() => { vi.clearAllMocks(); state.database = tx; state.payout = null; });
  it.each(['submitted', 'charge_succeeded', 'rejected'])('a %s claim replaces all-good copy in both channels', async status => {
    const claim = { id: 9, claimVersion: 2, chefVisibleAt: new Date(), kitchenBookingVisitId: 5, status,
      claimedAmountCents: 7000, finalAmountCents: 7000, chefResponseDeadline: new Date('2026-10-18T12:00:00Z') };
    state.rows = [[], [{ chefId: 3, managerId: 2, kitchenName: 'Harbour Kitchen', bookingDate: new Date('2026-10-14'), startTime: '09:00', timezone: 'UTC' }],
      [{ id: 3, email: 'chef@example.test', role: 'chef', locale: 'en-CA' }], [claim]];
    await queueBookingLifecycleEvent(tx, 10, 'visit_closed', 'Visit complete', 'Fallback', 2,
      { visitId: 5, recipientPolicy: 'chef', inspectionOutcome: 'manager_cleared' });
    const notice = state.notify.mock.calls[0][0];
    expect(notice.userId).toBe(3);
    expect(notice.message).not.toMatch(/all good|kitchen payout|sent to the kitchen/i);
    expect(notice.message).toContain(status === 'charge_succeeded' ? 'You paid $70.00' : status === 'submitted' ? 'Pay or dispute by' : 'nothing to pay');
    expect(state.insert.mock.calls[0][0].emails[0].content.text).toContain(notice.message);
  });
});

it.each([0, 5000])('cancellation delivers recipient copy and only retained kitchen money (%i)', async retained => {
  vi.clearAllMocks(); state.database = tx; state.payout = null;
  state.people = [{ id: 3, profile: { fullName: 'Sam' } }, { id: 2, profile: { fullName: 'Maya' } }];
  state.rows = [[{ chefId: 3, managerId: 2, kitchenName: 'Harbour Kitchen', bookingDate: new Date('2026-10-14'), startTime: '09:00', timezone: 'UTC' }],
    [{ id: 3, email: 'chef@example.test', role: 'chef', locale: 'en-CA' }, { id: 2, email: 'manager@example.test', role: 'manager', locale: 'en-CA' }]];
  await queueBookingLifecycleEvent(tx, 10, 'cancelled', 'Fallback', 'Fallback', 3,
    { recipientPolicy: 'participants', cancellationNotice: { cause: 'chef', kitchenShareRetainedCents: retained } });
  expect(state.notify.mock.calls.map(call => call[0].userId)).toEqual([3, 2]);
  const kitchen = state.notify.mock.calls.find(call => call[0].userId === 2)![0];
  expect(kitchen.title).toBe('Booking cancelled');
  expect(kitchen.message).toContain('Sam cancelled'); expect(kitchen.message).toContain('9:00 a.m.');
  expect(kitchen.message).toContain('that time is open again.');
  expect(kitchen.message.includes('$50.00')).toBe(retained > 0);
  const emails = state.insert.mock.calls[0][0].emails;
  expect(emails.map((email: any) => email.to)).toEqual(['chef@example.test', 'manager@example.test']);
  expect(emails[1].content.text).toContain(kitchen.message);
  expect(emails[1].content.text).not.toContain('$0.00');
  expect(emails[0].content.text).not.toContain('that time is open again');
});
