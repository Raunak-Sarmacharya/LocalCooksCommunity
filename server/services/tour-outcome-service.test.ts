import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ current: null as any, existing: false, queue: vi.fn(), update: vi.fn(), delivery: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { transaction: (run: any) => run(db), update: state.update,
    select: (fields?: any) => {
      let table = '';
      const rows = () => table === 'tour_delivery_events' ? state.existing ? [{ id: 99 }] : []
        : fields?.id ? [{ id: 10 }] : fields ? [] : state.current ? [state.current] : [];
      const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
        innerJoin: () => chain, where: () => chain, limit: () => chain, for: () => chain,
        then: (resolve: any) => resolve(rows()) };
      return chain;
    } };
  return { db };
});
vi.mock('./tour-delivery-service', () => ({ queueTourEvent: state.queue, deliverTourEvents: state.delivery }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: async () => ({ tourOutcomeReminderMinutes: 30 }) }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import { remindUnrecordedTourOutcomes } from './tour-outcome-service';

beforeEach(() => {
  vi.clearAllMocks(); state.existing = false;
  state.current = { id: 10, status: 'pending', scheduledAt: new Date('2026-01-01T10:00:00Z'), updatedAt: new Date('2026-01-01T09:00:00Z') };
  state.queue.mockImplementation(async () => { state.existing = true; });
  state.delivery.mockResolvedValue({ delivered: 0, errors: 0 });
});
describe('tour request expiry delivery', () => {
  it('queues once under the tour lock without writing attendance or reservation state', async () => {
    await remindUnrecordedTourOutcomes(); await remindUnrecordedTourOutcomes();
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'expired', before: state.current, after: state.current }));
    expect(state.update).not.toHaveBeenCalled();
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
    await remindUnrecordedTourOutcomes();
    expect(state.queue).toHaveBeenCalledTimes(2);
    expect(state.update).not.toHaveBeenCalled();
  });
  it('does not queue new work after the function budget is exhausted', async () => {
    await remindUnrecordedTourOutcomes({ budgetMs: 0 });
    expect(state.queue).not.toHaveBeenCalled();
    expect(state.delivery).toHaveBeenCalledWith(undefined, 20, 0);
  });
});
