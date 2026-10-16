import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  send: vi.fn(async (_event: unknown) => ({ ids: ['evt'] })),
  expireExtension: vi.fn(async (..._args: unknown[]) => ({ expired: true })),
  lazyExpire: vi.fn(async (..._args: unknown[]) => true),
  persist: vi.fn(async (..._args: unknown[]) => ({ changed: true })),
  release: vi.fn(async (..._args: unknown[]) => ({ success: true })),
  rows: [] as Array<Record<string, unknown>>,
  responseDeadline: new Date('2026-10-15T21:00:00Z'),
}));
vi.mock('../db', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows }) }) }),
  transaction: async (run: (tx: unknown) => unknown) => run({}),
} }));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../lifecycle-inngest', () => ({ inngest: { send: state.send } }));
vi.mock('stripe', () => ({ default: class { paymentIntents = {}; } }));
vi.mock('./session-extensions', () => ({ expireSessionExtension: state.expireExtension }));
vi.mock('./auth-expiry-service', () => ({ lazyExpireKitchenBookingAuth: state.lazyExpire }));
vi.mock('./clock-closeout', () => ({ persistBookingCloseout: state.persist }));
vi.mock('./kitchen-payout-service', () => ({ releaseKitchenPayout: state.release }));
vi.mock('./booking-response-deadline', () => ({ getBookingResponseDeadline: async () => state.responseDeadline }));
import { deadlineGraceMs, deadlineHorizonMs, deadlineScheduledEvent, runDeadlineExpiry, scheduleBookingRequestTimer, scheduleDeadlineTimer } from './deadline-timer';

const NOW = Date.parse('2026-10-15T20:30:00Z');
const flush = () => new Promise(resolve => setTimeout(resolve, 20));
beforeEach(() => { vi.clearAllMocks(); state.rows = []; vi.stubEnv('INNGEST_EVENT_KEY', 'test-key'); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x'); });
afterEach(() => vi.unstubAllEnvs());

describe('scheduleDeadlineTimer: best-effort, never throws', () => {
  it('sends one event carrying kind, id and the exact instant, deduped by a deterministic event id', async () => {
    scheduleDeadlineTimer('extension', 10, new Date('2026-10-15T20:30:56Z'), NOW);
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send).toHaveBeenCalledWith({ id: `deadline:extension:10:${Date.parse('2026-10-15T20:30:56Z')}`, name: deadlineScheduledEvent,
      data: { kind: 'extension', id: 10, dueAt: '2026-10-15T20:30:56.000Z' } });
  });
  it('sends nothing without an event key, for bad input, or beyond the sleep horizon (the tick covers those)', async () => {
    scheduleDeadlineTimer('closeout', 4, null, NOW);
    scheduleDeadlineTimer('closeout', 4, 'not a date', NOW);
    scheduleDeadlineTimer('closeout', 0, new Date(NOW + 1000), NOW);
    scheduleDeadlineTimer('closeout', 4, new Date(NOW + deadlineHorizonMs + 1000), NOW);
    vi.stubEnv('INNGEST_EVENT_KEY', '');
    scheduleDeadlineTimer('closeout', 4, new Date(NOW + 1000), NOW);
    await flush();
    expect(state.send).not.toHaveBeenCalled();
  });
  it('a failed send is logged and swallowed (the worker stays the backstop)', async () => {
    state.send.mockRejectedValueOnce(new Error('inngest down'));
    expect(() => scheduleDeadlineTimer('booking_request', 9, new Date(NOW + 60_000), NOW)).not.toThrow();
    await flush();
    expect(state.send).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleBookingRequestTimer: the kitchen response deadline', () => {
  it('arms a timer at the booking’s response deadline for a pending, authorized request', async () => {
    state.rows = [{ id: 21, status: 'pending', paymentStatus: 'authorized', createdAt: new Date('2026-10-15T19:00:00Z'), kitchenId: 5 }];
    state.responseDeadline = new Date(Date.now() + 3_600_000);
    await scheduleBookingRequestTimer({ select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows }) }) }) } as never, 21);
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(state.send.mock.calls[0][0]).toMatchObject({ name: deadlineScheduledEvent, data: { kind: 'booking_request', id: 21, dueAt: state.responseDeadline.toISOString() } });
  });
  it('does nothing for a booking that is not an authorized, pending request', async () => {
    const reader = { select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows }) }) }) } as never;
    state.rows = [{ id: 21, status: 'confirmed', paymentStatus: 'authorized', createdAt: new Date() }];
    await scheduleBookingRequestTimer(reader, 21);
    state.rows = [{ id: 21, status: 'pending', paymentStatus: 'paid', createdAt: new Date() }];
    await scheduleBookingRequestTimer(reader, 21);
    state.rows = [];
    await scheduleBookingRequestTimer(reader, 21);
    await flush();
    expect(state.send).not.toHaveBeenCalled();
  });
  it('never fails the producing transaction when the reader errors', async () => {
    await expect(scheduleBookingRequestTimer({ select: () => { throw new Error('boom'); } } as never, 21)).resolves.toBeUndefined();
  });
});

describe('runDeadlineExpiry: the same idempotent per-item expiry the worker uses', () => {
  it('extension: expires that one id with the supplied clock', async () => {
    const now = new Date('2026-10-15T20:31:01Z');
    await expect(runDeadlineExpiry('extension', 10, now)).resolves.toEqual({ kind: 'extension', expired: true });
    expect(state.expireExtension).toHaveBeenCalledWith(expect.anything(), 10, now);
  });
  it('extension: skips (worker backstop) when Stripe is not configured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    await expect(runDeadlineExpiry('extension', 10)).resolves.toEqual({ kind: 'extension', skipped: 'stripe_unconfigured' });
    expect(state.expireExtension).not.toHaveBeenCalled();
  });
  it('booking_request: lazy-expires that booking’s authorization, and reports false once already handled', async () => {
    state.rows = [{ id: 21, status: 'pending', paymentStatus: 'authorized', createdAt: new Date(), kitchenId: 5 }];
    await expect(runDeadlineExpiry('booking_request', 21)).resolves.toEqual({ kind: 'booking_request', expired: true });
    expect(state.lazyExpire).toHaveBeenCalledWith(state.rows[0]);
    state.lazyExpire.mockResolvedValueOnce(false);
    await expect(runDeadlineExpiry('booking_request', 21)).resolves.toEqual({ kind: 'booking_request', expired: false });
    state.rows = [];
    await expect(runDeadlineExpiry('booking_request', 21)).resolves.toEqual({ kind: 'booking_request', expired: false });
    expect(state.lazyExpire).toHaveBeenCalledTimes(2);
  });
  it('closeout: saves the booking’s closeout, then offers its payout; a no-change run touches nothing', async () => {
    const now = new Date('2026-10-15T20:31:01Z');
    await expect(runDeadlineExpiry('closeout', 33, now)).resolves.toEqual({ kind: 'closeout', changed: true });
    expect(state.persist).toHaveBeenCalledWith(33, expect.anything(), now);
    expect(state.release).toHaveBeenCalledWith(33, 'closeout_timer', now);
    state.release.mockClear(); state.persist.mockResolvedValueOnce({ changed: false });
    await expect(runDeadlineExpiry('closeout', 33, now)).resolves.toEqual({ kind: 'closeout', changed: false });
    expect(state.release).not.toHaveBeenCalled();
  });
  it('closeout: a payout outage never undoes the saved closeout', async () => {
    state.release.mockRejectedValueOnce(new Error('stripe down'));
    await expect(runDeadlineExpiry('closeout', 33)).resolves.toEqual({ kind: 'closeout', changed: true });
  });
  it('an unknown kind is rejected', async () => {
    await expect(runDeadlineExpiry('mystery' as never, 1)).rejects.toThrow('Unknown');
  });
});

describe('deadline-timer Inngest function', () => {
  const load = async () => {
    vi.resetModules();
    vi.doUnmock('../lifecycle-inngest');
    vi.doMock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
    vi.doMock('./recurring-worker', () => ({ runRecurringWorker: vi.fn(), workerPool: {}, assertWorkerSessionConnection: vi.fn(), initializeWorkerSession: vi.fn() }));
    vi.doMock('./scheduled-cancellations', () => ({ processExpiredCancellationRequests: vi.fn() }));
    vi.doMock('./chat-notices', () => ({ deliverStartingChatMessage: vi.fn() }));
    return import('../lifecycle-inngest');
  };
  it('sleeps until dueAt (plus a few seconds), then runs the scoped expiry once; sleeping is the only wait', async () => {
    const { runDeadlineTimer } = await load();
    const calls: string[] = [];
    const step = { sleepUntil: vi.fn(async () => { calls.push('sleep'); }), run: vi.fn(async (_id: string, action: () => Promise<unknown>) => { calls.push('expire'); return action(); }) };
    const dueAt = '2026-10-15T20:30:56.000Z';
    state.rows = [{ id: 21 }];
    const result = await runDeadlineTimer({ event: { data: { kind: 'booking_request', id: 21, dueAt } }, step });
    expect(calls).toEqual(['sleep', 'expire']);
    expect(step.sleepUntil).toHaveBeenCalledWith('wait-for-deadline', new Date(Date.parse(dueAt) + deadlineGraceMs));
    expect(state.lazyExpire).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: 'booking_request', expired: true });
  });
  it('is idempotent when the item is already expired: the expiry runs and finds nothing to do', async () => {
    const { runDeadlineTimer } = await load();
    const step = { sleepUntil: vi.fn(async () => {}), run: vi.fn(async (_id: string, action: () => Promise<unknown>) => action()) };
    state.expireExtension.mockResolvedValueOnce({ expired: false });
    await expect(runDeadlineTimer({ event: { data: { kind: 'extension', id: 10, dueAt: '2026-10-15T20:30:56.000Z' } }, step })).resolves.toEqual({ kind: 'extension', expired: false });
  });
  it('rejects malformed events before sleeping', async () => {
    const { runDeadlineTimer } = await load();
    const step = { sleepUntil: vi.fn(), run: vi.fn() };
    for (const data of [{ kind: 'nope', id: 1, dueAt: '2026-10-15T20:30:56Z' }, { kind: 'extension', id: '1', dueAt: '2026-10-15T20:30:56Z' },
      { kind: 'extension', id: -1, dueAt: '2026-10-15T20:30:56Z' }, { kind: 'extension', id: 1, dueAt: 'soon' }, { kind: 'extension', id: 1 }])
      await expect(runDeadlineTimer({ event: { data }, step })).rejects.toThrow('Invalid');
    expect(step.sleepUntil).not.toHaveBeenCalled();
  });
  it('is registered with the serve handler, like the notice delivery function', async () => {
    const { deadlineTimer } = await load();
    expect(deadlineTimer).toBeDefined();
    const source = (await import('node:fs')).readFileSync(new URL('../lifecycle-inngest.ts', import.meta.url), 'utf8');
    expect(source).toContain('functions: [lifecycleTick, startingChatEmail, bookingNoticeDelivery, deadlineTimer]');
    expect(source).toContain('triggers: [{ event: deadlineScheduledEvent }]');
  });
});
