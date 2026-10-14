import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ booking: {} as any, responses: [] as any[], people: [] as any[], managerId: 2,
  due: [] as any[], locks: [] as string[], queries: [] as any[], inserts: [] as any[], updates: [] as any[], queue: vi.fn(), transactions: 0 }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => connection.select(...args), transaction: async (work: any) => { state.transactions++; return work(connection); } } }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('../email', () => ({ renderTransactionalEmail: (data: any) => data }));
import { getAdminBookingFeedback, getBookingFeedback, submitBookingFeedback, sweepBookingFeedback, currentBookingFeedbackEmail } from './booking-feedback-service';
const now = new Date('2026-10-04T12:00:00Z');
function params(condition: any): any[] { return condition?.queryChunks ? condition.queryChunks.flatMap(params) : condition && 'value' in condition ? [condition.value] : []; }
const connection: any = {
  execute: vi.fn(async () => { state.locks.push('booking:update'); }),
  select: (fields?: any) => {
    let table = '', condition: any, limit = Infinity;
    const rows = () => {
      const values = params(condition);
      if (table === 'kitchen_bookings') return fields?.booking ? [{ booking: state.booking, managerId: state.managerId, kitchenName: 'Harbour Kitchen' }] : fields?.id ? state.due.slice(0, limit) : [state.booking];
      if (table === 'users') return state.people.filter(p => p.id === values.find(v => typeof v === 'number'));
      if (table === 'locations' || table === 'kitchens') return [{ managerId: state.managerId }];
      if (table === 'booking_feedback_responses') return state.responses.filter(r =>
        r.bookingId === values.find(v => typeof v === 'number') && (!values.some(v => v === 'chef' || v === 'manager') || r.respondentRole === values.find(v => v === 'chef' || v === 'manager'))
        && (values.filter(v => typeof v === 'number').length < 2 || r.respondentId === values.filter(v => typeof v === 'number')[1]));
      return [];
    };
    const q: any = { from: (t: any) => { table = t[Symbol.for('drizzle:Name')]; return q; }, innerJoin: () => q,
      where: (c: any) => { condition = c; state.queries.push(c); return q; }, limit: (n: number) => { limit = n; return q; }, orderBy: () => q,
      for: (mode: string) => { state.locks.push(`${table}:${mode}`); return q; }, then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
    return q;
  },
  insert: () => ({ values: async (data: any) => { state.inserts.push(data); state.responses.push({ id: 1, ...data }); } }),
  update: () => ({ set: (data: any) => ({ where: async () => { state.updates.push(data); Object.assign(state.booking, data); } }) }),
};
const chef = { id: 3, role: 'chef' as const }, manager = { id: 2, role: 'manager' as const }, admin = { id: 9, role: 'admin' as const };
const answer = (role = 'manager', id = 2) => ({ id: 7, bookingId: 20, respondentRole: role, respondentId: id, rating: 1, tags: [], comment: 'Private concern', createdAt: now });
beforeEach(() => {
  vi.clearAllMocks(); state.managerId = 2; state.responses = []; state.locks = []; state.queries = []; state.inserts = []; state.updates = []; state.transactions = 0;
  state.booking = { id: 20, kitchenId: 5, chefId: 3, status: 'completed', feedbackRequestedAt: new Date('2026-10-01T12:00:00Z'), feedbackRemindedAt: null };
  state.people = [{ id: 3, role: 'chef', username: 'chef@example.test', locale: 'fr-CA' }, { id: 2, role: 'manager', username: 'manager@example.test' }, { id: 9, role: 'admin' }]; state.due = [{ id: 20 }];
});
describe('private immutable booking responses', () => {
  it('reads only the current participant’s own answer without exposing submission status of the other side', async () => {
    state.responses = [answer()];
    const read = await getBookingFeedback(connection, 20, chef, now);
    expect(read).toMatchObject({ available: true, response: null });
    expect(Object.keys(read).sort()).toEqual(['available', 'closesAt', 'requestedAt', 'response']);
    expect(JSON.stringify(read)).not.toContain('Private concern');
    expect((await getBookingFeedback(connection, 20, manager, now)).response?.comment).toBe('Private concern');
  });
  it('preserves historical responses for admin only', async () => {
    state.responses = [answer(), answer('chef', 3)];
    expect((await getAdminBookingFeedback(connection, 20, admin)).responses).toHaveLength(2);
    await expect(getAdminBookingFeedback(connection, 20, chef)).rejects.toMatchObject({ statusCode: 404 });
  });
  it.each([{ id: 88, role: 'chef' }, { id: 3, role: 'manager' }, { id: 3, role: 'admin' }])('denies foreign or wrong-role access %j', async viewer => {
    await expect(getBookingFeedback(connection, 20, viewer as any, now)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('serializes submissions, stores trimmed comments and rejects even identical second submissions', async () => {
    const result = await submitBookingFeedback(connection, 20, chef, { rating: 4, comment: '  Nice  ' }, now);
    expect(result.response).toMatchObject({ respondentId: 3, respondentRole: 'chef', comment: 'Nice' });
    expect(state.locks).toContain('booking:update');
    await expect(submitBookingFeedback(connection, 20, chef, { rating: 4, comment: 'Nice' }, now)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.inserts).toHaveLength(1); expect(state.queue).not.toHaveBeenCalled();
  });
  it('never reveals or replaces a previous manager’s answer', async () => {
    state.responses = [answer('manager', 99)];
    expect(await getBookingFeedback(connection, 20, manager, now)).toMatchObject({ response: null, available: false });
    await expect(submitBookingFeedback(connection, 20, manager, { rating: 5 }, now)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.inserts).toHaveLength(0);
  });
  it.each([{ status: 'cancelled' }, { feedbackRequestedAt: new Date('2026-09-20') }, { feedbackRequestedAt: null }])('refuses closed/unrequested bookings %j', async patch => {
    Object.assign(state.booking, patch);
    await expect(submitBookingFeedback(connection, 20, chef, { rating: 5 }, now)).rejects.toMatchObject({ code: 'BOOKING_FEEDBACK_CLOSED', statusCode: 409 });
    expect(state.inserts).toHaveLength(0);
  });
  it('refuses cross-role chips and oversized notes', async () => {
    for (const input of [{ rating: 4, tags: ['damaged_something'] }, { rating: 4, comment: 'x'.repeat(1001) }])
      await expect(submitBookingFeedback(connection, 20, chef, input, now)).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each([{ rating: 2 }, { rating: 5, tags: ['not_clean'] }])('flags concerning answers only to admins %j', async input => {
    await submitBookingFeedback(connection, 20, chef, input, now);
    expect(state.queue).toHaveBeenCalledWith(connection, 20, 'feedback_flagged', expect.any(String), expect.any(String), 3,
      { recipientPolicy: 'admins', supportCase: true, feedbackRole: 'chef' });
  });
});
describe('bounded day-three reminder', () => {
  it('uses the partial-index predicate and exact day-three/day-fourteen boundaries', async () => {
    state.responses = [answer('chef', 3)];
    expect(await sweepBookingFeedback(3, now)).toEqual({ processed: 1, reminded: 1 });
    const query = new PgDialect().sqlToQuery(state.queries[0]);
    expect(query.sql).toContain('"feedback_reminded_at" is null');
    expect(query.sql).toContain('"feedback_requested_at" <='); expect(query.sql).toContain('"feedback_requested_at" >');
    expect(query.params).toEqual(['completed', '2026-10-01T12:00:00.000Z', '2026-09-20T12:00:00.000Z']);
    expect(state.queue).toHaveBeenCalledWith(connection, 20, 'feedback_requested', expect.any(String), expect.any(String), undefined,
      { recipientPolicy: 'participants', recipientIds: [2] });
    expect(state.booking.feedbackRemindedAt).toEqual(now);
    await sweepBookingFeedback(3, now); expect(state.queue).toHaveBeenCalledTimes(1);
  });
  it('early-exits empty ticks and rejects unbounded batches', async () => {
    state.due = []; expect(await sweepBookingFeedback(3, now)).toEqual({ processed: 0, reminded: 0 });
    expect(state.queries).toHaveLength(1); expect(state.transactions).toBe(0);
    await expect(sweepBookingFeedback(4, now)).rejects.toThrow();
  });
  it.each([{ feedbackRemindedAt: now }, { feedbackRequestedAt: new Date('2026-10-02') }, { status: 'cancelled' }, { feedbackRequestedAt: new Date('2026-09-20') }])('rechecks due state under the lock %j', async patch => {
    Object.assign(state.booking, patch); await sweepBookingFeedback(3, now); expect(state.queue).not.toHaveBeenCalled(); expect(state.updates).toHaveLength(0);
  });
  it('marks the batch handled without notifying when both sides answered', async () => {
    state.responses = [answer(), answer('chef', 3)]; await sweepBookingFeedback(3, now);
    expect(state.queue).not.toHaveBeenCalled(); expect(state.booking.feedbackRemindedAt).toEqual(now);
  });
  it('renders localized email and drops late answered or expired reminders', async () => {
    const email = await currentBookingFeedbackEmail(20, 3, 'chef@example.test', connection, now);
    expect(email).toMatchObject({ actionLabel: 'Évaluez votre séance' }); expect((email as any).actionUrl).toContain('/booking/20#feedback');
    state.responses = [answer('chef', 3)]; expect(await currentBookingFeedbackEmail(20, 3, 'chef@example.test', connection, now)).toBeNull();
    state.responses = []; expect(await currentBookingFeedbackEmail(20, 3, 'wrong@example.test', connection, now)).toBeNull();
    expect(await currentBookingFeedbackEmail(20, 3, 'chef@example.test', connection, new Date('2026-10-15T12:00:00Z'))).toBeNull();
  });
});
