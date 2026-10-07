import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ current: null as any, existing: false, queue: vi.fn(), update: vi.fn(), delivery: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { transaction: async (run: any) => { const saved = state.current && { ...state.current }; try { return await run(db); } catch (error) { state.current = saved; throw error; } }, update: state.update,
    select: (fields?: any) => {
      let table = '';
      const rows = () => table === 'tour_delivery_events' ? state.existing ? [{ id: 99 }] : []
        : fields?.id ? [{ id: 10 }] : fields ? [] : state.current ? [state.current] : [];
      const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
        innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, for: () => chain,
        then: (resolve: any) => resolve(rows()) };
      return chain;
    } };
  return { db };
});
vi.mock('./tour-delivery-service', async importOriginal => ({ ...await importOriginal<typeof import('./tour-delivery-service')>(), queueTourEvent: state.queue, deliverTourEvents: state.delivery }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: async () => ({ tourOutcomeReminderMinutes: 30 }) }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import { remindUnrecordedTourOutcomes } from './tour-outcome-service';

beforeEach(() => {
  vi.clearAllMocks(); state.existing = false;
  state.update.mockImplementation(() => ({ set: (changes: any) => ({ where: () => ({ returning: async () => {
    if (!state.current) return []; state.current = { ...state.current, ...changes }; return [state.current];
  } }) }) }));
  state.current = { id: 10, status: 'pending', scheduledAt: new Date('2026-01-01T10:00:00Z'), updatedAt: new Date('2026-01-01T09:00:00Z') };
  state.queue.mockImplementation(async () => { state.existing = true; });
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
