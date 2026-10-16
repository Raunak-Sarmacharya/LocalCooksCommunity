import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../db', () => ({ db: { execute: h.execute } }));
import { claimStripeWebhookEvent, markStripeWebhookEventProcessed } from './stripe-webhook-events';

const dialect = new PgDialect();
const statement = (call: number) => dialect.sqlToQuery(h.execute.mock.calls[call][0]);

beforeEach(() => h.execute.mockReset());

describe('stripe webhook event ledger', () => {
  it('records a new event and reports it as not yet processed', async () => {
    h.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ processed_at: null }] });
    await expect(claimStripeWebhookEvent('evt_1', 'payment_intent.succeeded')).resolves.toEqual({ alreadyProcessed: false });
    expect(statement(0).sql).toMatch(/insert into stripe_webhook_events/i);
    expect(statement(0).sql).toMatch(/on conflict \(id\) do nothing/i);
    expect(statement(0).params).toEqual(['evt_1', 'payment_intent.succeeded']);
  });

  it('reports a redelivery of a finished event as already processed', async () => {
    h.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ processed_at: new Date() }] });
    await expect(claimStripeWebhookEvent('evt_1', 'payment_intent.succeeded')).resolves.toEqual({ alreadyProcessed: true });
  });

  it('runs an event again when an earlier attempt failed before it was marked processed', async () => {
    h.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ processed_at: null }] });
    await expect(claimStripeWebhookEvent('evt_1', 'charge.refunded')).resolves.toEqual({ alreadyProcessed: false });
  });

  it('marks an event processed once, keeping the first timestamp', async () => {
    h.execute.mockResolvedValue({ rows: [] });
    await markStripeWebhookEventProcessed('evt_1');
    expect(statement(0).sql).toMatch(/processed_at = COALESCE\(processed_at, now\(\)\)/i);
    expect(statement(0).params).toEqual(['evt_1']);
  });
});
