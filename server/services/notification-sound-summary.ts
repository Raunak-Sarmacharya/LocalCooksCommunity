import { sql } from 'drizzle-orm';
import { db } from '../db';

/** A single database snapshot drives the badge and sound; read mutations are not events. */
export async function getUnreadNotificationSummary(role: 'chef' | 'manager', ownerId: number, locationId?: number) {
  const table = sql.identifier(role === 'chef' ? 'chef_notifications' : 'manager_notifications');
  const owner = sql.identifier(role === 'chef' ? 'chef_id' : 'manager_id');
  const location = role === 'manager' && locationId !== undefined
    ? sql`AND (location_id = ${locationId} OR location_id IS NULL)` : sql``;
  const result = await db.execute(sql`
    WITH recent AS (
      SELECT id, created_at, is_read, is_archived FROM ${table}
      WHERE ${owner} = ${ownerId}
        AND (expires_at IS NULL OR expires_at > NOW())
        AND created_at >= NOW() - INTERVAL '2 minutes'
        ${location}
      ORDER BY created_at DESC, id DESC LIMIT 20
    )
    SELECT COUNT(*) AS count, NOW() AS sampled_at,
      COALESCE((SELECT json_agg(recent) FROM recent), '[]'::json) AS recent
    FROM ${table}
    WHERE ${owner} = ${ownerId}
      AND is_read = false AND is_archived = false
      AND (expires_at IS NULL OR expires_at > NOW())
      ${location}
  `);
  const row = result.rows[0] as {
    count: string; sampled_at: Date | string;
    recent: { id: number; created_at: string; is_read: boolean; is_archived: boolean }[];
  };
  return { count: Number(row.count), sampledAt: row.sampled_at, recent: row.recent };
}
