import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, updates: vi.fn(), booking: vi.fn(), tour: vi.fn() }));
vi.mock('../db', () => ({ db: {
  select: () => {
    let table = '';
    const query: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return query; },
      where: () => query, orderBy: () => query, limit: () => query, offset: () => query,
      then: (resolve: any) => resolve(state.rows[table] || []) };
    return query;
  }, update: () => ({ set: (value: any) => ({ where: async () => state.updates(value) }) }),
} }));
vi.mock('./booking-lifecycle-delivery', () => ({ deliverBookingLifecycleEvents: state.booking }));
vi.mock('./tour-delivery-service', () => ({ deliverTourEvents: state.tour,
  tourEventMessages: (payload: any) => payload.messages }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: {} }));
import { describeDelivery, visibleEmailLogs, pendingDecisionDeliveries, retryDecisionDelivery } from './delivery-visibility';
const now = new Date('2026-10-04T08:00:00Z');
const log = (extra: any = {}) => ({ id: 1, createdAt: now, category: 'lifecycle_outcome', status: 'failed',
  textBody: 'Public notice', trackingId: 'claim-outcome:7:12:3', retryCount: 1, retriedAt: now,
  errorMessage: 'SMTP password=secret raw dump', ...extra }) as any;
describe('operator delivery summaries', () => {
  it('shows unread digest timing and safe original recovery without exposing saved JSON', () => {
    const row = log({ category: 'chat_digest', status: 'scheduled', trackingId: 'chat-message:thread:m1:2',
      textBody: JSON.stringify({ conversationId: 'thread', applicationId: 8, bookingId: 10, dueAt: '2026-10-04T09:00:00Z', path: '/manager/dashboard?view=messages&conversation=thread&booking=10' }) });
    expect(describeDelivery(row, row, undefined, now)).toMatchObject({ source: 'chat', sourceId: 10, canRetry: false, state: 'Scheduled' });
    expect(describeDelivery(row, row, undefined, new Date('2026-10-04T09:01:00Z'))).toMatchObject({ canRetry: true, recipientDestination: '/manager/dashboard?view=messages&conversation=thread&booking=10' });
    row.status = 'suppressed'; expect(describeDelivery(row, row, undefined, now).canRetry).toBe(false);
  });
  it('keeps source/history/retry context without returning SMTP diagnostics or historical body', () => {
    const result = describeDelivery(log(), undefined, undefined, now);
    expect(result).toMatchObject({ source: 'claim', sourceId: 7, resource: 'history/reference 12',
      nextAttemptAt: '2026-10-04T08:01:00.000Z', destination: '/admin?section=damage-claims', canRetry: true });
    expect(JSON.stringify(result)).not.toMatch(/secret|Public notice/);
  });
  it('distinguishes in-app acknowledgment, email acceptance, scheduled and policy-pending work', () => {
    const reminder = { source: 'tour', reservationId: 20, resource: 'location-5', kind: 'arrival',
      due: '2026-10-05T06:00:00Z', start: '2026-10-05T08:00:00Z', end: '2026-10-05T08:30:00Z', path: '/dashboard?view=viewings&viewing=20', shortVisit: true };
    const row = log({ category: 'advance_reminder', status: 'scheduled', textBody: JSON.stringify({ reminder, channel: 'email' }) });
    expect(describeDelivery(row, row, undefined, now)).toMatchObject({ state: 'Scheduled', canRetry: false, sourceId: 20 });
    row.status = 'sent'; expect(describeDelivery(row, row, undefined, now).state).toContain('SMTP acceptance');
    row.textBody = JSON.stringify({ reminder, channel: 'notification' });
    expect(describeDelivery(row, row, undefined, now).state).toBe('In-app acknowledgment recorded');
    row.status = 'scheduled'; row.textBody = JSON.stringify({ reminder: { ...reminder, kind: 'departure' }, channel: 'email' });
    expect(describeDelivery(row, row, undefined, now)).toMatchObject({ state: 'Policy pending', canRetry: false });
  });
  it('does not promise retry for a leased or acknowledged original decision or legacy action', () => {
    const original = log({ category: 'booking', trackingId: 'booking-event:9:3' });
    const event = { bookingId: 10, createdAt: now, nextAttemptAt: now, leaseUntil: new Date(now.getTime() + 60000), deliveredEmailKeys: [] };
    expect(describeDelivery(original, original, event, now)).toMatchObject({ canRetry: false, eventId: 9, sourceId: 10, attempts: null });
    event.leaseUntil = now; event.deliveredEmailKeys = ['3'] as any;
    expect(describeDelivery(original, original, event, now)).toMatchObject({ canRetry: false, state: 'SMTP acceptance recorded; inbox unverified' });
    expect(describeDelivery(log({ category: 'damage_claim', trackingId: null }), undefined, undefined, now).canRetry).toBe(false);
  });
  it('requires operational investigation for corrupt schedules', () => {
    expect(describeDelivery(log({ category: 'advance_reminder', textBody: '{bad' }), undefined, undefined, now)).toMatchObject({ canRetry: false });
  });
  it('serializes failed attempts through the original intent with linked storage context and no stored body', async () => {
    state.rows = { email_logs: [log({ id: 3, trackingId: 'claim-outcome:7:12:3' })],
      damage_claims: [{ id: 7, kitchenBookingId: null, storageBookingId: 30 }],
      storage_bookings: [{ id: 30, kitchenBookingId: 10, storageListingId: 4 }] };
    const [record] = await visibleEmailLogs([log({ category: 'lifecycle_outcome_attempt', retryOfId: 3 })]);
    expect(record.delivery).toMatchObject({ originalLogId: 3, source: 'claim', sourceId: 7 });
    expect(record.delivery.resource).toContain('storage #30 / listing #4 · linked kitchen booking #10');
    expect(JSON.stringify(record)).not.toMatch(/SMTP password|secret|textBody|htmlBody/);
  });
  it('lists original decisions with intended recipients and owned recovery even without an attempt', async () => {
    state.rows = { booking_lifecycle_events: [{ id: 9, bookingId: 10, createdAt: now, nextAttemptAt: now,
      emails: [{ key: '3', to: 'chef@example.test', content: { text: 'PRIVATE SNAPSHOT' } }],
      deliveredEmailKeys: [], metadata: { deliveryRecoveryOwnerIds: [1], privateNote: 'PRIVATE' } }],
    tour_delivery_events: [{ id: 8, viewingId: 20, createdAt: now, nextAttemptAt: now, attempts: 2, deliveredKeys: ['chef-email'],
      payload: { deliveryRecoveryOwnerIds: [1], messages: [{ key: 'chef-email', email: { to: 'chef@example.test', html: 'PRIVATE' } }] } }] };
    const records = await pendingDecisionDeliveries();
    expect(records[0]).toMatchObject({ source: 'booking', reservationId: 10, recoveryOwnerIds: [1],
      recipients: [{ recipient: 'chef@example.test', channel: 'email', acknowledged: false }] });
    expect(records[1].recipients[0].acknowledged).toBe(true);
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
  });
  it('leaves leased events untouched and recovers a specific original through the existing replay dispatcher', async () => {
    const event = { id: 9, leaseUntil: new Date(Date.now() + 60000), completedAt: null as Date | null };
    state.rows = { booking_lifecycle_events: [event] }; state.updates.mockClear(); state.booking.mockClear();
    expect((await retryDecisionDelivery('booking', 9)).success).toBe(false);
    expect(state.updates).not.toHaveBeenCalled();
    event.leaseUntil = now;
    state.booking.mockImplementation(async () => { event.completedAt = now; });
    expect((await retryDecisionDelivery('booking', 9)).success).toBe(true);
    expect(state.booking).toHaveBeenCalledWith(1, 20000, undefined, 9, true);
    expect((await retryDecisionDelivery('booking', 9)).success).toBe(true);
    expect(state.booking).toHaveBeenCalledTimes(1);
  });
});
