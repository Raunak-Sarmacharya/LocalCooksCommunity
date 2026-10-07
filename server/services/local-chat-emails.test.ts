import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({ notify: vi.fn(), dispatch: vi.fn(), suppressed: false,
  rows: [{ id: 11 }, { id: 12 }] as { id: number }[], status: 'scheduled', conditions: [] as any[], error: vi.fn() }));
vi.mock('./chat-notices', () => ({ notifyPersistedChatMessage: state.notify, dispatchChatDigests: state.dispatch }));
vi.mock('../e2e-outbound-guard', () => ({ isE2eOutboundSuppressed: () => state.suppressed }));
vi.mock('../logger', () => ({ logger: { error: state.error } }));
vi.mock('../db', () => ({ db: { select: (fields: any) => {
  const chain: any = { from: () => chain, where: (condition: any) => { state.conditions.push(condition); return chain; },
    limit: () => chain, then: (resolve: any) => Promise.resolve(fields.status ? [{ status: state.status }] : state.rows).then(resolve) };
  return chain;
} } }));

let queue: typeof import('./local-chat-emails').queueLocalChatMessageEmail;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', '');
  state.suppressed = false; state.rows = [{ id: 11 }, { id: 12 }]; state.status = 'scheduled'; state.conditions = [];
  state.notify.mockReset().mockResolvedValue({ initialTrackingId: 'chat-message:thread:m1:2' });
  state.dispatch.mockReset().mockResolvedValue({ completed: 0, errors: 0 });
  queue = (await import('./local-chat-emails')).queueLocalChatMessageEmail;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('local chat delivery ownership', () => {
  it.each(['production', 'test'])('does nothing in %s', async environment => {
    vi.stubEnv('NODE_ENV', environment); await queue('thread', 'm1', 3);
    expect(state.notify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does nothing on Vercel or when outbound is suppressed', async () => {
    vi.stubEnv('VERCEL', '1'); await queue('thread', 'm1', 3);
    vi.stubEnv('VERCEL', ''); state.suppressed = true; await queue('thread', 'm1', 3);
    expect(state.notify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('queues both directions and watches only exact initial/reminder delivery keys', async () => {
    await queue('thread', 'm1', 3); await queue('thread', 'm1', 2);
    expect(state.notify.mock.calls).toEqual([['thread', 'm1', 3], ['thread', 'm1', 2]]);
    const query = new PgDialect().sqlToQuery(state.conditions[0]);
    expect(query.params).toEqual(['chat_digest', 'chat-message:thread:m1:2', 'chat-message:thread:m1:2:reminder', 'scheduled', 'failed']);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.dispatch.mock.calls).toEqual([[1, 20000, 11], [1, 20000, 12]]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.dispatch).toHaveBeenCalledTimes(4); // Future reminders remain owned.
  });
  it('does not start a runner for consecutive messages or already completed intents', async () => {
    state.notify.mockResolvedValueOnce({ queued: true }); await queue('thread', 'm2', 3);
    state.rows = []; await queue('thread', 'm1', 3);
    expect(vi.getTimerCount()).toBe(0); expect(state.dispatch).not.toHaveBeenCalled();
  });
  it('retires terminal intents and stops the idle runner', async () => {
    await queue('thread', 'm1', 3); state.status = 'suppressed';
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.dispatch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps failed intents for the existing dispatcher to retry', async () => {
    await queue('thread', 'm1', 3); state.status = 'failed';
    state.dispatch.mockRejectedValueOnce(Error('temporary failure'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(state.dispatch).toHaveBeenCalledTimes(4); expect(state.error).toHaveBeenCalledTimes(1);
  });
  it('never overlaps polling ticks during a slow delivery', async () => {
    await queue('thread', 'm1', 3);
    let finish!: (value: unknown) => void;
    state.dispatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(15000);
    expect(state.dispatch).toHaveBeenCalledTimes(1);
    finish({ completed: 0, errors: 0 }); await vi.advanceTimersByTimeAsync(0);
    expect(state.dispatch).toHaveBeenCalledTimes(2);
  });
});

it('watches both broadcast recipients and reminders', async () => {
  state.notify.mockResolvedValue({ queued: true, initialRecipients: [{ role: 'chef', trackingId: 'chat-message:thread:m1:3' }, { role: 'manager', trackingId: 'chat-message:thread:m1:2' }] });
  await queue('thread', 'm1', 1);
  expect(new PgDialect().sqlToQuery(state.conditions[0]).params).toEqual(['chat_digest', 'chat-message:thread:m1:3', 'chat-message:thread:m1:3:reminder', 'chat-message:thread:m1:2', 'chat-message:thread:m1:2:reminder', 'scheduled', 'failed']);
});
