/**
 * Test support: a real in-process Postgres (PGlite) with the tables the booking-change engine touches, created straight from the
 * Drizzle schema. Real transactions, real FOR UPDATE / advisory locks / savepoints, real unique indexes - no hand-rolled fake rows.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect, PgEnumColumn, type PgTable } from 'drizzle-orm/pg-core';
import { is, SQL } from 'drizzle-orm';
import * as schema from '@shared/schema';

const dialect = new PgDialect();
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function columnDefault(column: any): string {
  if (!column.hasDefault || column.default === undefined) return '';
  const value = column.default;
  if (is(value, SQL)) return ` DEFAULT ${dialect.sqlToQuery(value).sql.replace(/\$\d+/g, 'NULL')}`;
  if (value === null) return ' DEFAULT NULL';
  if (typeof value === 'string') return ` DEFAULT '${value.replace(/'/g, "''")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return ` DEFAULT ${value}`;
  if (typeof value === 'object') return ` DEFAULT '${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return '';
}

export function ddlFor(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map(column => {
    const type = column.getSQLType();
    const serial = /^(big)?serial$/.test(type);
    return `${quote(column.name)} ${type}${serial ? '' : column.notNull ? ' NOT NULL' : ''}${serial ? '' : columnDefault(column)}${column.primary ? ' PRIMARY KEY' : ''}`;
  });
  return `CREATE TABLE ${quote(config.name)} (${columns.join(', ')})`;
}

export async function createTestDatabase(tables: PgTable[], extraSql: string[] = []) {
  const client = new PGlite();
  const enums = new Set<string>();
  for (const table of tables) for (const column of getTableConfig(table).columns) if (is(column, PgEnumColumn)) enums.add(column.enum.enumName + '|' + column.enum.enumValues.join(','));
  for (const entry of Array.from(enums)) {
    const [name, values] = entry.split('|');
    await client.exec(`CREATE TYPE ${quote(name)} AS ENUM (${values.split(',').map((value: string) => `'${value.replace(/'/g, "''")}'`).join(', ')})`);
  }
  for (const table of tables) await client.exec(ddlFor(table));
  for (const statement of extraSql) await client.exec(statement);
  return { client, db: drizzle(client, { schema }) };
}
