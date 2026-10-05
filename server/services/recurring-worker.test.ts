import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ clock: 0, stored: null as any, lock: false, claims: 0, releases: 0, calls: [] as string[], configs: [] as any[], fail: '' }));
vi.mock('pg', () => ({ Pool: class {
  constructor(config: any) { state.configs.push(config); }
  async connect() {
    let owns = false;
    return { release: () => { if (owns) state.lock = false; state.releases++; }, query: async (query: any, params?: any[]) => {
      const text = typeof query === 'string' ? query : query.text;
      state.clock += 50;
      if (text.includes('pg_try_advisory_lock')) { owns = !state.lock; if (owns) { state.lock = true; state.claims++; } return { rows: [{ owned: owns }] }; }
      if (text.includes('pg_advisory_unlock')) { state.lock = false; return { rows: [] }; }
      if (text.startsWith('SELECT value')) return { rows: state.stored ? [{ value: JSON.stringify(state.stored) }] : [] };
      if (text.startsWith('INSERT INTO platform_settings')) state.stored = JSON.parse(params![1]);
      return { rows: [] };
    } };
  }
} }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: (client: any) => ({ execute: (query: any) => client.query(query) }) }));
const task = async (name: string) => { state.calls.push(name); state.clock += 800; if (state.fail === name) throw Error('isolated failure'); return { count: 1 }; };
vi.mock('./reminder-reconciliation', () => ({ reminderSources: ['booking', 'tour'], reconcileRecurringSource: (source: string) => task(`reconcile:${source}`) }));
vi.mock('./advance-reminders', () => ({ dispatchAdvanceReminders: () => task('advance') }));
vi.mock('./booking-lifecycle-delivery', () => ({ deliverBookingLifecycleEvents: () => task('booking') }));
vi.mock('./tour-delivery-service', () => ({ deliverTourEvents: () => task('tour') }));
vi.mock('./outcome-delivery', () => ({ deliverOutcomeEmails: () => task('outcome') }));
vi.mock('./chat-notices', () => ({ dispatchChatDigests: () => task('chat') }));
vi.mock('./overstay-penalty-service', () => ({ detectOverstays: () => task('overstays') }));
vi.mock('./damage-claim-service', () => ({ processExpiredClaims: () => task('claims') }));
vi.mock('./booking-payment-decision', () => ({ recoverPendingBookingDecisions: () => task('paymentRecovery') }));
vi.mock('./auth-expiry-service', () => ({ processExpiredAuthorizations: () => task('authorizations') }));
vi.mock('./storage-checkout-service', () => ({ processExpiredCheckoutReviews: () => task('storageCheckout') }));
vi.mock('./kitchen-checkout-service', () => ({ processExpiredKitchenCheckoutReviews: () => task('kitchenCheckout'), getCheckinSettings: async () => ({ checkoutReviewWindowMinutes: 0 }) }));
vi.mock('./kitchen-visit-lifecycle', () => ({ autoClearKitchenVisits: () => task('visitCheckout') }));
vi.mock('./tour-outcome-service', () => ({ remindUnrecordedTourOutcomes: () => task('tourOutcomes') }));
vi.mock('./kitchen-booking-changes', () => ({ expireKitchenChanges: () => task('kitchenChanges') }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import { configuredInvocationMs, runRecurringWorker, runFairTasks, workerSafetyReserveMs, workerDatabaseUrl, assertWorkerSessionConnection } from './recurring-worker';
import { assertWorkerTime, workerContext, workerAfter, workerRecord, workerPageEnd } from './worker-context';
import { kitchenBookings } from '@shared/schema';

beforeEach(() => { state.clock = 0; state.stored = null; state.lock = false; state.claims = 0; state.releases = 0; state.calls = []; state.fail = '';
  vi.stubEnv('LIFECYCLE_ENVIRONMENT', 'test');
  vi.spyOn(performance, 'now').mockImplementation(() => state.clock); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('whole invocation admission, fair checkpoints and task isolation', () => {
  it('uses a separate worker URL without changing the web database and rejects known transaction poolers without exposing credentials', () => {
    const web = 'postgresql://postgres.fixture:private-secret@aws-0-region.pooler.supabase.com:6543/postgres';
    const session = web.replace(':6543/', ':5432/');
    const env = { DATABASE_URL: web, LIFECYCLE_WORKER_DATABASE_URL: session };
    expect(workerDatabaseUrl(env)).toBe(session); expect(env.DATABASE_URL).toBe(web);
    expect(() => assertWorkerSessionConnection(session)).not.toThrow();
    expect(() => assertWorkerSessionConnection(web)).toThrow('configure LIFECYCLE_WORKER_DATABASE_URL');
    expect(() => assertWorkerSessionConnection('postgresql://u:private-secret@db.fixture.supabase.co:6543/postgres')).toThrow();
    expect(() => assertWorkerSessionConnection('postgresql://u:private-secret@ep-fixture-pooler.region.aws.neon.tech/db')).toThrow();
    expect(() => assertWorkerSessionConnection('postgresql://u:private-secret@ep-fixture.region.aws.neon.tech/db')).not.toThrow();
    expect(() => assertWorkerSessionConnection('invalid-private-secret')).toThrow('requires a valid session-capable database URL');
    expect(state.claims).toBe(0);
  });
  it('leaves continuous staging invocations disabled before any database or outbound work', async () => {
    vi.stubEnv('LIFECYCLE_ENVIRONMENT', 'staging'); vi.stubEnv('LIFECYCLE_RECURRING_ENABLED', 'false');
    expect(await runRecurringWorker(() => task('cancellations'), 0)).toEqual({ disabled: true });
    expect(state.claims).toBe(0); expect(state.calls).toEqual([]);
  });
  it('uses checked-in 30-second configuration, reserves response time and includes every protected task', async () => {
    const result = await runRecurringWorker(() => task('cancellations'), 0);
    expect(configuredInvocationMs).toBe(30_000); expect(workerSafetyReserveMs).toBe(4_000);
    expect(result).toMatchObject({ taskFailures: [], deferred: false });
    expect(state.calls).toEqual(expect.arrayContaining(['advance', 'booking', 'tour', 'outcome', 'chat', 'reconcile:booking', 'reconcile:tour',
      'overstays', 'claims', 'paymentRecovery', 'authorizations', 'storageCheckout', 'cancellations', 'kitchenCheckout', 'visitCheckout', 'tourOutcomes', 'kitchenChanges']));
    expect(state.clock).toBeLessThan(30_000); expect(state.stored.finishedAt).toBeTruthy(); expect(state.releases).toBe(1);
    expect(state.configs[0]).toMatchObject({ max: 1, connectionTimeoutMillis: 3000, statement_timeout: 1000, lock_timeout: 500 });
  });
  it('isolates failure, saves it as unhealthy and still progresses later tasks', async () => {
    state.fail = 'claims'; const result = await runRecurringWorker(() => task('cancellations'), 0);
    expect(result).toMatchObject({ taskFailures: ['expiredClaims'] }); expect(state.calls).toContain('cancellations');
    expect(state.stored.lastHealthyAt).toBeUndefined();
  });
  it('does not reset the invocation budget after setup, and resumes persisted task position on the next invocation', async () => {
    state.clock = 24_000;
    const first = await runRecurringWorker(() => task('cancellations'), 0);
    expect(first).toMatchObject({ deferred: true }); expect(state.calls).toEqual([]);
    state.clock = 0; await runRecurringWorker(() => task('cancellations'), 0); expect(state.calls).toContain('authorizations');
  });
  it('serializes competing invocations without advancing the loser checkpoint', async () => {
    state.lock = true;
    expect(await runRecurringWorker(() => task('cancellations'), 0)).toEqual({ skipped: 'competing_worker' });
    expect(state.stored).toBeNull(); expect(state.calls).toEqual([]); expect(state.releases).toBe(1);
  });
  it('checkpoints before a slow/failed task; rotation gives all tasks progress over bounded ticks', async () => {
    const checkpoint = { nextTask: 0, cursors: {} }, started: string[] = [], saved: number[] = [];
    const tasks = ['a', 'b', 'c', 'd'].map(name => ({ name, run: async () => { started.push(name); state.clock += 5_000; assertWorkerTime(); } }));
    for (let tick = 0; tick < 3; tick++) {
      state.clock = 0;
      await workerContext.run({ database: {} as any, deadline: 11_000, taskDeadline: 11_000, cursors: checkpoint.cursors, checkpoint: async () => {} },
        () => runFairTasks(tasks, checkpoint, async () => { saved.push(checkpoint.nextTask); }));
    }
    expect(new Set(started)).toEqual(new Set(['a', 'b', 'c', 'd'])); expect(saved[0]).toBe(1);
  });
  it('uses finite per-source keyset cursors and wraps empty pages; a poisoned record remains retryable on the next sweep', async () => {
    const cursors: Record<string, number> = {}, saved: [string, number][] = [];
    await workerContext.run({ database: {} as any, deadline: 26_000, taskDeadline: 26_000, cursors,
      checkpoint: async (key, id) => { saved.push([key, id]); cursors[key] = id; } }, async () => {
      await workerRecord('claims', 7); expect(workerAfter('claims', kitchenBookings.id)).toBeDefined();
      await workerPageEnd('claims', 0); expect(cursors.claims).toBe(0);
    });
    expect(saved).toEqual([['claims', 7], ['claims', 0]]);
  });
});
