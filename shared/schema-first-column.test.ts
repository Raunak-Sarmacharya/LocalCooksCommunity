import { describe, expect, it } from 'vitest';
import { getTableColumns, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema';

describe('schema column order', () => {
  // Drizzle returns a left-joined table as null when its first column is null.
  it('starts every table with a non-null column', () => {
    const nullableFirst = Object.entries(schema).filter(([, t]) => is(t as any, PgTable))
      .filter(([, t]) => !(Object.values(getTableColumns(t as any))[0] as any).notNull).map(([name]) => name);
    expect(nullableFirst).toEqual([]);
  });
});
