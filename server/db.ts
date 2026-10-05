import { Pool } from 'pg';
import * as schema from "@shared/schema";
import { drizzle } from 'drizzle-orm/node-postgres';
import { workerContext } from './services/worker-context';

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const applicationDb = drizzle(pool, { schema });
// Worker helpers reuse the same services on a bounded, dedicated connection.
// Web requests retain their existing pool/transaction behavior.
export const db: typeof applicationDb = new Proxy(applicationDb, {
  get(target, key) {
    const database = workerContext.getStore()?.database || target;
    const value = Reflect.get(database, key);
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

/** Drizzle ≥0.44 wraps driver errors; PG code/message live on `.cause`. */
export function getDbError(error: unknown): { code?: string; message?: string } {
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null | undefined;
  return {
    code: e?.cause?.code ?? e?.code,
    message: e?.cause?.message ?? e?.message,
  };
}
