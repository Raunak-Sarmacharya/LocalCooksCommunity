import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./tour-reconfirmation-service', () => ({ queueTourReconfirmations: vi.fn(async () => ({ queued: 0, errors: 0 })) }));
const state = vi.hoisted(() => ({ current: null as any, existing: false, keys: new Set<string>(),
  feedback: { chef: false, manager: false }, queue: vi.fn(), update: vi.fn(), delivery: vi.fn() }));
vi.mock('./tour-feedback-service', () => ({ readTourFeedbackStatus: async () => ({ ...state.feedback,
  missing: !state.feedback.chef || !state.feedback.manager, bothReady: state.feedback.chef && state.feedback.manager, conflict: false, closed: false }) }));
vi.mock('../db', () => {
  const db: any = { transaction: async (run: any) => { const saved = state.current && { ...state.current }, keys = new Set(state.keys); try { return await run(db); } catch (error) { state.current = saved; state.keys = keys; throw error; } }, update: state.update,
    select: (fields?: any) => {
      let table = '', key = '';
      const findKey = (value: any): string => typeof value?.value === 'string' && value.value.startsWith('feedback:') ? value.value
        : (value?.queryChunks || []).map(findKey).find(Boolean) || '';
      const rows = () => table === 'tour_delivery_events' ? (key ? state.keys.has(key) : state.existing) ? [{ id: 99 }] : []
        : fields?.id ? [{ id: 10 }] : fields?.managerId && state.current?.status === 'confirmed' && state.current.durationMinutes
          && state.current.scheduledAt.getTime()+state.current.durationMinutes*60000<=Date.now()
          ? [{ viewing:state.current, managerId:2,locationName:'Fixture kitchen' }] : fields ? [] : state.current ? [state.current] : [];
      const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
        innerJoin: () => chain, where: (condition: any) => { key = findKey(condition); return chain; }, orderBy: () => chain, limit: () => chain, for: () => chain,
        then: (resolve: any) => resolve(rows()) };
      return chain;
    } };
  return { db };
});
vi.mock('./tour-delivery-service', async importOriginal => ({ ...await importOriginal<typeof import('./tour-delivery-service')>(), queueTourEvent: state.queue, deliverTourEvents: state.delivery }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: async () => ({ tourOutcomeReminderMinutes: 30 }) }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import { remindUnrecordedTourOutcomes } from './tour-outcome-service';
import { tourFeedbackEventKey } from '@shared/tour-feedback';

beforeEach(() => {
  vi.clearAllMocks(); state.existing = false; state.keys = new Set(); state.feedback = { chef: false, manager: false };
  state.update.mockImplementation(() => ({ set: (changes: any) => ({ where: () => {
    const save = () => { if (!state.current) return []; state.current = { ...state.current, ...changes }; return [state.current]; };
    return { returning: async () => save(), then: (resolve: any) => resolve(save()) };
  } }) }));
  state.current = { id: 10, status: 'pending', scheduledAt: new Date('2026-01-01T10:00:00Z'), updatedAt: new Date('2026-01-01T09:00:00Z') };
  state.queue.mockImplementation(async (_tx: any, input: any) => {
    if (input.kind.startsWith('feedback_')) state.keys.add(tourFeedbackEventKey(input.after, input.kind));
    else state.existing = true;
  });
  state.delivery.mockResolvedValue({ delivered: 0, errors: 0 });
});
afterEach(() => vi.useRealTimers());

describe('pending tour escalation enqueue', () => {
  it.each(['pending_local_cooks', 'pending'])('queues %s within six hours once despite unrelated edits', async status => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-01T04:00:00Z'));
    state.current.status = status;
    await remindUnrecordedTourOutcomes();
    state.current.updatedAt = new Date('2026-01-01T04:01:00Z');
    await remindUnrecordedTourOutcomes();
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue.mock.calls[0][1].kind).toBe('request_escalation');
    expect(state.update).not.toHaveBeenCalled();
  });
  it('retries a failed escalation without expiring the original request early', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-01T09:59:00Z'));
    state.queue.mockRejectedValueOnce(Error('Ledger unavailable'));
    expect((await remindUnrecordedTourOutcomes()).errors).toBe(1);
    await remindUnrecordedTourOutcomes();
    expect(state.queue.mock.calls.map(call => call[1].kind)).toEqual(['request_escalation', 'request_escalation']);
    expect(state.update).not.toHaveBeenCalled();
  });
  it('queues an overnight twelve-hour SLA alert before the six-hour start window and deduplicates their overlap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
    state.current.createdAt = new Date('2025-12-31T13:00:00Z');
    state.current.adminReviewedAt = new Date('2025-12-31T13:00:00Z');
    await remindUnrecordedTourOutcomes();
    vi.setSystemTime(new Date('2026-01-01T04:00:00Z'));
    await remindUnrecordedTourOutcomes();
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.update).not.toHaveBeenCalled();
  });
});
describe('tour request expiry delivery', () => {
  it('persists an old already-notified expiry without creating a second notice', async () => {
    state.existing = true;
    await remindUnrecordedTourOutcomes();
    expect(state.current).toMatchObject({ status: 'cancelled', requestExpiredAt: new Date('2026-01-01T10:00:00Z') });
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('persists expiry once at the requested start and releases the pending reservation', async () => {
    await remindUnrecordedTourOutcomes(); await remindUnrecordedTourOutcomes();
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'expired', after: expect.objectContaining({ status: 'cancelled', requestExpiredAt: new Date('2026-01-01T10:00:00Z') }) }));
    expect(state.current).toMatchObject({ status: 'cancelled', cancelledBy: 'request_expired' });
  });
  it('does not queue stale expiry when a concurrent confirmation no longer matches the locked query', async () => {
    state.current = null;
    await remindUnrecordedTourOutcomes();
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('leaves a failed enqueue retryable and reports the error', async () => {
    state.queue.mockRejectedValueOnce(Error('Ledger unavailable'));
    expect((await remindUnrecordedTourOutcomes()).errors).toBe(1);
    expect(state.existing).toBe(false);
    expect(state.current.status).toBe('pending');
    await remindUnrecordedTourOutcomes();
    expect(state.queue).toHaveBeenCalledTimes(2);
    expect(state.current.status).toBe('cancelled');
  });
  it('does not queue new work after the function budget is exhausted', async () => {
    await remindUnrecordedTourOutcomes({ budgetMs: 0 });
    expect(state.queue).not.toHaveBeenCalled();
    expect(state.delivery).toHaveBeenCalledWith(undefined, 20, 0);
  });
});
it('requests feedback at the end without closing lifecycle or inventing completion/absence', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-01T10:30:00Z'));
  state.current = { ...state.current,status:'confirmed',lifecycleState:'confirmed',confirmationVerified:true,durationMinutes:30,attendanceHistory:[],checkedInAt:null };
  await remindUnrecordedTourOutcomes(); await remindUnrecordedTourOutcomes();
  expect(state.queue.mock.calls.filter(call => call[1].kind === 'feedback_requested')).toHaveLength(1);
  expect(state.queue.mock.calls.filter(call => call[1].kind === 'reminder' || call[1].kind === 'feedback_missing')).toHaveLength(0);
  expect(state.current).toMatchObject({ status:'confirmed',lifecycleState:'confirmed',checkedInAt:null });
  expect(state.current.completedAt).toBeUndefined(); expect(state.current.noShowAt).toBeUndefined();
});

describe('24-hour missing feedback escalation', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); state.current = { ...state.current,
    status: 'confirmed', lifecycleState: 'confirmed', confirmationVerified: true, durationMinutes: 30,
    appointmentRevision: 1, feedbackRequestedAt: new Date('2026-01-01T10:30:00Z') };
    state.keys.add(tourFeedbackEventKey(state.current, 'feedback_requested'));
  });
  it.each([{ chef: false, manager: false }, { chef: true, manager: false }, { chef: false, manager: true }])('alerts admin once when either response is missing: %j', async feedback => {
    state.feedback = feedback; vi.setSystemTime(new Date('2026-01-02T10:29:59Z'));
    await remindUnrecordedTourOutcomes(); expect(state.queue).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-01-02T10:30:00Z')); await remindUnrecordedTourOutcomes(); await remindUnrecordedTourOutcomes();
    expect(state.queue.mock.calls.map(call => call[1].kind)).toEqual(['feedback_missing']);
    expect(state.current.lifecycleState).toBe('confirmed');
  });
  it('suppresses a missing-feedback alert after both responses arrive', async () => {
    state.feedback = { chef: true, manager: true }; vi.setSystemTime(new Date('2026-01-03T10:30:00Z'));
    await remindUnrecordedTourOutcomes(); expect(state.queue).not.toHaveBeenCalled();
  });
  it('uses appointment event keys despite old scalar markers after a reschedule', async () => {
    state.current.appointmentRevision = 2; state.current.feedbackEscalatedAt = new Date('2026-01-01T10:30:00Z');
    vi.setSystemTime(new Date('2026-01-03T10:30:00Z')); await remindUnrecordedTourOutcomes();
    expect(state.queue.mock.calls.map(call => call[1].kind)).toEqual(['feedback_requested', 'feedback_missing']);
  });
  it('leaves failed enqueue retryable without changing lifecycle or fabricating an outcome', async () => {
    vi.setSystemTime(new Date('2026-01-02T10:30:00Z')); state.queue.mockRejectedValueOnce(Error('Ledger unavailable'));
    expect((await remindUnrecordedTourOutcomes()).errors).toBe(1);
    expect(state.current.feedbackEscalatedAt).toBeUndefined();
    await remindUnrecordedTourOutcomes(); expect(state.current.feedbackEscalatedAt).toEqual(new Date('2026-01-02T10:30:00Z'));
    expect(state.current.lifecycleState).toBe('confirmed');
  });
  it('does not collect after a concurrent admin decision or without verified confirmation', async () => {
    vi.setSystemTime(new Date('2026-01-03T10:30:00Z')); state.current.visitResult = 'unrecorded';
    await remindUnrecordedTourOutcomes(); expect(state.queue).not.toHaveBeenCalled();
    state.current.visitResult = null; state.current.confirmationVerified = false;
    await remindUnrecordedTourOutcomes(); expect(state.queue).not.toHaveBeenCalled();
  });
});
