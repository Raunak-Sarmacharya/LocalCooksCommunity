import { AsyncLocalStorage } from 'node:async_hooks';
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@shared/schema';

export class WorkerBudgetExhausted extends Error {
  constructor() { super('Worker checkpoint reached; resume on next tick'); }
}
export function isWorkerBudgetError(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    if (error instanceof WorkerBudgetExhausted) return true;
    seen.add(error);
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}
type Context = {
  database: NodePgDatabase<typeof schema>; deadline: number; taskDeadline: number;
  cursors: Record<string, number>; checkpoint: (key: string, id: number) => Promise<void>;
  databaseFailures?: number;
  /** Keys whose page came back short this tick → records still to attempt. The cursor advances per record as usual and
   * wraps to the start only when the LAST record of the short page is reached (not before: a slow first record must not
   * starve the rest of the page on the next tick). */
  shortPages?: Map<string, number>;
};
export const workerContext = new AsyncLocalStorage<Context>();
export const inRecurringWorker = () => !!workerContext.getStore();
export function workerRemaining() {
  const scope = workerContext.getStore();
  return scope ? Math.max(0, Math.min(scope.deadline, scope.taskDeadline) - performance.now()) : Infinity;
}
export function assertWorkerTime(reserve = 750) {
  if (workerRemaining() < reserve) throw new WorkerBudgetExhausted();
}
export const smtpAttemptMs = 8_000;
export const smtpAcknowledgmentReserveMs = 4_000;
export const deliveryReserve = () => smtpAttemptMs + smtpAcknowledgmentReserveMs;
export const deliveryLeaseMs = () => inRecurringWorker() ? 60_000 : 600_000;
export const workerBatch = () => inRecurringWorker() ? 3 : 2_147_483_647;
/** Keyset pages wrap on the next invocation. Failure advances the cursor but
 * retains eligibility, so one bad record cannot monopolize every page. */
export function workerAfter(key: string, column: PgColumn): SQL | undefined {
  const scope = workerContext.getStore();
  return scope ? sql`${column} > ${scope.cursors[key] || 0}` : undefined;
}
export async function workerRecord(key: string, id: number) {
  if (!inRecurringWorker()) return;
  assertWorkerTime(2_000);
  const scope = workerContext.getStore()!;
  const left = scope.shortPages?.get(key);
  if (left !== undefined) scope.shortPages!.set(key, left - 1);
  await scope.checkpoint(key, left === 1 ? 0 : id);
}
/** Pass `pageSize` (the query's limit): a short page means nothing eligible is left past it, so the next tick starts from the
 * beginning instead of spending a tick on an empty page (a booking due just under the cursor otherwise waits an extra tick). */
export async function workerPageEnd(key: string, count: number, pageSize?: number) {
  if (!inRecurringWorker()) return;
  const scope = workerContext.getStore()!;
  if (!count) await scope.checkpoint(key, 0);
  else if (pageSize && count < pageSize) (scope.shortPages ??= new Map()).set(key, count);
}
