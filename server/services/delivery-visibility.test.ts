import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, updates: vi.fn(), booking: vi.fn(), tour: vi.fn() }));
vi.mock('../db', () => ({ db: {
  transaction: async (run: any) => { const { db } = await import('../db'); return run(db); },
  select: () => {
    let table = '';
    const query: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return query; },
      where: () => query, orderBy: () => query, limit: () => query, offset: () => query, for: () => query,
      then: (resolve: any) => resolve(state.rows[table] || []) };
    return query;
  }, update: () => ({ set: (value: any) => ({ where: async () => state.updates(value) }) }),
} }));
vi.mock('./booking-lifecycle-delivery', () => ({ deliverBookingLifecycleEvents: state.booking }));
vi.mock('./tour-delivery-service', () => ({ deliverTourEvents: state.tour,
  tourEventMessages: (payload: any) => payload.messages }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: {} }));
import { describeDelivery, visibleEmailLogs, pendingDecisionDeliveries, retryDecisionDelivery, reconcileTourDelivery } from './delivery-visibility';
const now = new Date('2026-10-04T08:00:00Z');
const log = (extra: any = {}) => ({ id: 1, createdAt: now, category: 'lifecycle_outcome', status: 'failed',
  textBody: 'Public notice', trackingId: 'claim-outcome:7:12:3', retryCount: 1, retriedAt: now,
  errorMessage: 'SMTP password=secret raw dump', ...extra }) as any;
describe('operator delivery summaries', () => {
  it('shows a historical failed attempt separately from a subsequently acknowledged channel, without claiming acceptance is still missing', () => {
    const row = log({ trackingId: 'tour-event:8:chef-email', errorMessage: 'SMTP attempt deadline reached; acceptance may be ambiguous' });
    const event = { viewingId: 20, deliveredKeys: ['chef-email'], nextAttemptAt: now, attempts: 4,
      payload: { deliveryAttempts: { 'chef-email': { status: 'accepted', attempts: 3, lastAttemptAt: '2026-10-04T08:02:00Z' } } } };
    const result = describeDelivery(row, row, event, now);
    expect(result).toMatchObject({ state: 'SMTP acceptance recorded; inbox unverified', canRetry: false, nextAttemptAt: null,
      attemptStatus: 'failed', attempts: 3, eventAttempts: 4, lastAttemptAt: '2026-10-04T08:02:00.000Z' });
    expect(result.errorMessage).toContain('Historical attempt failed');
    expect(result.errorMessage).not.toContain('Acceptance not recorded');
  });
  it('does not offer a blind resend or next automatic attempt for uncertain acceptance', () => {
    const row = log({ trackingId: 'tour-event:8:chef-email' });
    const event = { viewingId: 20, deliveredKeys: [], nextAttemptAt: now, payload: { deliveryPaused: true,
      deliveryAttempts: { 'chef-email': { status: 'uncertain', attempts: 1, diagnostic: 'acceptance_unknown', lastAttemptAt: now.toISOString() } } } };
    expect(describeDelivery(row, row, event, now)).toMatchObject({ state: 'Acceptance uncertain; automatic resend paused', canRetry: false, nextAttemptAt: null });
  });
  it.each(['accepted', 'resend'] as const)('records evidence for explicit %s recovery under a row lock without sending email', async decision => {
    const event = { id: 8, deliveredKeys: ['manager'], payload: { deliveryPaused: true, deliveryFailures: 3,
      deliveryAttempts: { 'chef-email': { status: 'uncertain', attempts: 1, lastAttemptAt: now.toISOString(), recipient: 'chef@example.test' } } } };
    state.rows = { tour_delivery_events: [event] }; state.updates.mockClear(); state.tour.mockClear();
    expect((await reconcileTourDelivery(8, 'chef-email', decision, 'Checked relay queue reference fixture', 1, now.toISOString())).success).toBe(true);
    expect(state.updates).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ deliveryPaused: false }) }));
    const update = state.updates.mock.calls[0][0];
    expect(update.payload.deliveryAttempts['chef-email']).toMatchObject({ status: decision === 'accepted' ? 'verified' : 'retry_authorized', review: { actorId: 1, decision } });
    if (decision === 'accepted') expect(update.deliveredKeys).toEqual(['manager', 'chef-email']);
    expect(state.tour).not.toHaveBeenCalled();
  });
  it('rejects stale reconciliation evidence and respects an active worker lease', async () => {
    const event: any = { id: 8, payload: { deliveryAttempts: { 'chef-email': { status: 'uncertain', lastAttemptAt: now.toISOString() } } } };
    state.rows = { tour_delivery_events: [event] }; state.updates.mockClear();
    expect((await reconcileTourDelivery(8, 'chef-email', 'resend', 'Checked inbox', 1, 'stale')).success).toBe(false);
    event.leaseUntil = new Date(Date.now() + 60000);
    expect((await reconcileTourDelivery(8, 'chef-email', 'accepted', 'Checked inbox', 1, now.toISOString())).success).toBe(false);
    expect(state.updates).not.toHaveBeenCalled();
  });
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
    expect(describeDelivery(row, row, undefined, now)).toMatchObject({ state: 'Scheduled', canRetry: false });
    row.textBody = JSON.stringify({ reminder: { ...reminder, source: 'booking', kind: 'departure' }, channel: 'email' });
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
