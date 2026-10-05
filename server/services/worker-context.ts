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
export const deliveryReserve = () => inRecurringWorker() ? 2_000 : 10_000;
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
  await workerContext.getStore()!.checkpoint(key, id);
}
export async function workerPageEnd(key: string, count: number) {
  if (inRecurringWorker() && !count) await workerContext.getStore()!.checkpoint(key, 0);
}
