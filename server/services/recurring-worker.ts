import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import runtime from '../../vercel.json';
import { workerContext, WorkerBudgetExhausted, workerRemaining, isWorkerBudgetError } from './worker-context';
import { reminderSources, reconcileRecurringSource } from './reminder-reconciliation';
import { dispatchAdvanceReminders } from './advance-reminders';
import { deliverBookingLifecycleEvents } from './booking-lifecycle-delivery';
import { deliverTourEvents } from './tour-delivery-service';
import { deliverOutcomeEmails } from './outcome-delivery';
import { dispatchChatDigests } from './chat-notices';
import { logger } from '../logger';

export const configuredInvocationMs = runtime.functions['api/index.js'].maxDuration * 1000;
// The reserve includes final checkpoint, lock release, response and framework work.
export const workerSafetyReserveMs = 4_000;
const stateKey = 'lifecycle_worker_v2';
const lockKey = 'localcooks:lifecycle-worker:v2';
export const workerDatabaseUrl = (env: NodeJS.ProcessEnv = process.env) => env.LIFECYCLE_WORKER_DATABASE_URL || env.DATABASE_URL;
const connectionString = workerDatabaseUrl();
/** A pg.Pool client does not pin the backend behind a transaction pooler.
 * Validate at invocation time so a worker setup error cannot stop portal startup. */
export function assertWorkerSessionConnection(value = connectionString) {
  let endpoint: URL;
  try { endpoint = new URL(value || ''); }
  catch { throw Error('Lifecycle worker requires a valid session-capable database URL'); }
  const transactionPooler = endpoint.hostname.endsWith('.neon.tech') && endpoint.hostname.includes('-pooler') ||
    /(?:^|\.)supabase\.(?:co|com)$/.test(endpoint.hostname) && endpoint.port === '6543';
  if (transactionPooler) throw Error('Lifecycle worker requires a direct or session-pooler connection; configure LIFECYCLE_WORKER_DATABASE_URL for the same database');
}
/** Session poolers can ignore driver startup GUCs. Apply real server deadlines
 * after connecting, before locks or business work, on this session only. */
export async function initializeWorkerSession(client: Pick<PoolClient, 'query'>) {
  await client.query("SELECT set_config('statement_timeout', '1000', false), set_config('lock_timeout', '500', false), set_config('idle_in_transaction_session_timeout', '10000', false)");
}
// One dedicated connection per process; SMTP attempt logs use this same scoped
// database, avoiding a second pooled connection while a row lock is held.
export const workerPool = new Pool({ connectionString, max: 1,
  connectionTimeoutMillis: 3_000, idleTimeoutMillis: 10_000,
  statement_timeout: 1_000, lock_timeout: 500, idle_in_transaction_session_timeout: 10_000,
  application_name: 'localcooks-lifecycle-worker' });
export type WorkerState = { nextTask: number; cursors: Record<string, number>; startedAt?: string;
  deliveryNext?: number; finishedAt?: string; lastHealthyAt?: string; failures?: string[]; deferred?: boolean };
type Task = { name: string; run: () => Promise<unknown> };

/** All operations are awaited. Budget exhaustion is a checkpoint, never a race
 * against continuing database/financial work. The driver enforces statement and
 * lock deadlines; provider helpers own socket/HTTP aborts. */
export async function runFairTasks(tasks: Task[], state: WorkerState, save: () => Promise<void>, phaseDeadline = Infinity) {
  const results: Record<string, unknown> = {}, failures: string[] = [];
  const start = state.nextTask % tasks.length;
  for (let offset = 0; offset < tasks.length && Math.min(workerRemaining(), phaseDeadline - performance.now()) >= 2_500; offset++) {
    const index = (start + offset) % tasks.length, task = tasks[index];
    state.nextTask = (index + 1) % tasks.length;
    await save(); // A killed task cannot monopolize the next invocation.
    const scope = workerContext.getStore()!;
    const databaseFailures = scope.databaseFailures || 0;
    scope.taskDeadline = Math.min(scope.deadline, phaseDeadline, performance.now() + 5_000);
    try {
      const result = await task.run();
      results[task.name] = result;
      const reportedError = result && typeof result === 'object' && ('errors' in result && Number(result.errors) > 0 ||
        Array.isArray(result) && result.some(row => row.action === 'error'));
      if (reportedError || (scope.databaseFailures || 0) > databaseFailures) failures.push(task.name);
    }
    catch (error) {
      if (isWorkerBudgetError(error)) results[task.name] = { checkpoint: true };
      else { failures.push(task.name); logger.error(`[Worker] Task ${task.name} requires recovery`, error); }
    }
    scope.taskDeadline = scope.deadline;
  }
  return { results, failures };
}

export async function runRecurringWorker(cancellations: () => Promise<unknown>, requestStarted = performance.now()) {
  if (process.env.LIFECYCLE_ENVIRONMENT === 'staging' && process.env.LIFECYCLE_RECURRING_ENABLED !== 'true') return { disabled: true };
  assertWorkerSessionConnection();
  const deadline = requestStarted + configuredInvocationMs - workerSafetyReserveMs;
  if (performance.now() >= deadline) throw new WorkerBudgetExhausted();
  const client = await workerPool.connect();
  const rawQuery = client.query.bind(client);
  let locked = false;
  try {
    await initializeWorkerSession(client);
    const lock = await rawQuery('SELECT pg_try_advisory_lock(hashtext($1)) AS owned', [lockKey]);
    if (!lock.rows[0].owned) return { skipped: 'competing_worker' };
    locked = true;
    const stored = await rawQuery('SELECT value FROM platform_settings WHERE key = $1', [stateKey]);
    const state: WorkerState = stored.rows[0] ? JSON.parse(stored.rows[0].value) : { nextTask: 0, cursors: {} };
    const save = async () => {
      await rawQuery(`INSERT INTO platform_settings (key, value, description) VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [stateKey, JSON.stringify(state), 'Recurring lifecycle worker checkpoints and health; Local Cooks owns recovery']);
    };
    // Drizzle transactions still run on this client. Allow rollback after the
    // work cutoff, while reserving its bounded query time before host termination.
    client.query = function (...args: any[]) {
      const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (!/^rollback\b/i.test(text || '') && workerRemaining() < 750) throw new WorkerBudgetExhausted();
      return (rawQuery as any)(...args).catch((error: unknown) => {
        const scope = workerContext.getStore();
        if (scope) scope.databaseFailures = (scope.databaseFailures || 0) + 1;
        throw error;
      });
    } as PoolClient['query'];
    return await workerContext.run({ database: drizzle(client, { schema }), deadline, taskDeadline: deadline,
      cursors: state.cursors, checkpoint: async (key, id) => { state.cursors[key] = id; await save(); } }, async () => {
      state.startedAt = new Date().toISOString();
      await save();
      const tasks: Task[] = [
        ...reminderSources.map(source => ({ name: `reconcile:${source}`,
          run: () => reconcileRecurringSource(source, state.cursors[`reconcile:${source}`] || 0) })),
        { name: 'overstays', run: async () => (await import('./overstay-penalty-service')).detectOverstays() },
        { name: 'expiredClaims', run: async () => (await import('./damage-claim-service')).processExpiredClaims() },
        { name: 'paymentRecovery', run: async () => (await import('./booking-payment-decision')).recoverPendingBookingDecisions(3) },
        { name: 'kitchenChanges', run: async () => (await import('./kitchen-booking-changes')).expireKitchenChanges(3) },
        { name: 'authorizations', run: async () => (await import('./auth-expiry-service')).processExpiredAuthorizations() },
        { name: 'storageCheckout', run: async () => (await import('./storage-checkout-service')).processExpiredCheckoutReviews() },
        { name: 'cancellations', run: cancellations },
        { name: 'kitchenCheckout', run: async () => (await import('./kitchen-checkout-service')).processExpiredKitchenCheckoutReviews() },
        { name: 'visitCheckout', run: async () => {
          const { getCheckinSettings } = await import('./kitchen-checkout-service');
          return (await import('./kitchen-visit-lifecycle')).autoClearKitchenVisits((await getCheckinSettings()).checkoutReviewWindowMinutes);
        } },
        { name: 'tourOutcomes', run: async () => (await import('./tour-outcome-service')).remindUnrecordedTourOutcomes({ budgetMs: 5_000, maxTours: 3 }) },
      ];
      // Every tick reserves delivery opportunities. Background reconciliation and
      // business tasks rotate through durable checkpoints in the remaining time.
      const deliveryState = { nextTask: state.deliveryNext || 0, cursors: {} };
      const delivery = await runFairTasks([
        { name: 'advance', run: () => dispatchAdvanceReminders({ limit: 3, budgetMs: 5_000 }) },
        { name: 'booking', run: () => deliverBookingLifecycleEvents(1, 5_000) },
        { name: 'tour', run: () => deliverTourEvents(undefined, 1, 5_000) },
        { name: 'outcome', run: () => deliverOutcomeEmails(1, 5_000) },
        { name: 'chat', run: () => dispatchChatDigests(1, 5_000) },
      ], deliveryState, async () => { state.deliveryNext = deliveryState.nextTask; await save(); }, deadline - 10_000);
      const background = await runFairTasks(tasks, state, save);
      state.failures = [...delivery.failures, ...background.failures];
      state.finishedAt = new Date().toISOString();
      state.deferred = Object.keys(background.results).length < tasks.length;
      if (!state.failures.length) state.lastHealthyAt = state.finishedAt;
      await save();
      return { elapsedMs: Math.round(performance.now() - requestStarted), configuredInvocationMs,
        deferred: state.deferred, taskFailures: state.failures, delivery: delivery.results, background: background.results };
    });
  } finally {
    client.query = rawQuery as PoolClient['query'];
    try { if (locked) await rawQuery('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]); }
    finally { client.release(true); } // Destroy also releases any leaked session/transaction lock.
  }
}
