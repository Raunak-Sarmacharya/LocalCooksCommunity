import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const execute = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ db: { execute } }));
import { getUnreadNotificationSummary } from './notification-sound-summary';

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue({ rows: [{ count: '3', sampled_at: '2026-10-08T12:00:00Z', recent: [] }] });
});
describe('notification sound summaries', () => {
  it.each(['chef', 'manager'] as const)('scopes %s badge and bounded event snapshots to the authenticated owner', async role => {
    expect(await getUnreadNotificationSummary(role, 42)).toEqual({ count: 3, sampledAt: '2026-10-08T12:00:00Z', recent: [] });
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain(`"${role}_notifications"`);
    expect(query.sql.match(new RegExp(`"${role}_id" =`, 'g'))).toHaveLength(2);
    expect(query.params).toEqual([42, 42]);
    expect(query.sql).toContain('LIMIT 20');
    expect(query.sql).toContain("INTERVAL '2 minutes'");
    expect(query.sql).toContain('is_read = false AND is_archived = false');
    expect(query.sql).toContain('expires_at > NOW()');
    expect(query.sql).toContain('NOW() AS sampled_at');
    // Recent read/archived identities also reach the observer so restoring them is silent.
    expect(query.sql).toContain('SELECT id, created_at, is_read, is_archived');
  });
  it('includes location and global alerts in both manager queries', async () => {
    await getUnreadNotificationSummary('manager', 42, 7);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.params).toEqual([42, 7, 42, 7]);
    expect(query.sql.match(/OR location_id IS NULL/g)).toHaveLength(2);
  });
});
