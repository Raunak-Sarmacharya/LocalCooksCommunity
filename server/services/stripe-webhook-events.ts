import { sql } from 'drizzle-orm';
import { db } from '../db';

/**
 * Stripe retries a webhook for up to three days and does not guarantee order, so every delivery is recorded by
 * event id. A row is created on receipt; `processed_at` is set only after the handler finished without throwing,
 * which means a failed delivery stays unprocessed and the retry runs the handler again.
 */
export async function claimStripeWebhookEvent(eventId: string, eventType: string): Promise<{ alreadyProcessed: boolean }> {
  await db.execute(sql`INSERT INTO stripe_webhook_events (id, type) VALUES (${eventId}, ${eventType}) ON CONFLICT (id) DO NOTHING`);
  const result = await db.execute(sql`SELECT processed_at FROM stripe_webhook_events WHERE id = ${eventId}`);
  return { alreadyProcessed: !!(result.rows[0] as { processed_at?: Date | string | null } | undefined)?.processed_at };
}

export async function markStripeWebhookEventProcessed(eventId: string): Promise<void> {
  await db.execute(sql`UPDATE stripe_webhook_events SET processed_at = COALESCE(processed_at, now()) WHERE id = ${eventId}`);
}
