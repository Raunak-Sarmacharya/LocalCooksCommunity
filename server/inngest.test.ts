import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
const worker = vi.hoisted(() => ({ run: vi.fn(), query: vi.fn(), connect: vi.fn(), initialize: vi.fn(), chat: vi.fn() }));
vi.mock('./services/recurring-worker', () => ({ runRecurringWorker: worker.run, workerPool: { query: worker.query, connect: worker.connect }, assertWorkerSessionConnection: vi.fn(), initializeWorkerSession: worker.initialize }));
vi.mock('./services/scheduled-cancellations', () => ({ processExpiredCancellationRequests: vi.fn() }));
vi.mock('./services/chat-notices', () => ({ deliverStartingChatMessage: worker.chat }));
import { recurringCronEnabled, registerInngest, registerLifecycleWorkerEndpoints, runStartingChatEmail } from './lifecycle-inngest';
afterEach(() => vi.unstubAllEnvs());
describe('thin Inngest entry point and existing protected worker routes', () => {
  it('durably waits 15 seconds, delivers only the persisted starting message and retries unaccepted delivery', async () => {
    const calls: string[] = [];
    const step = { sleep: vi.fn(async () => { calls.push('grace'); }), run: vi.fn(async (_id: string, action: () => Promise<unknown>) => { calls.push('delivery'); return action(); }) };
    const event = { data: { conversationId: 'thread', messageId: 'first', senderId: 3 } };
    worker.chat.mockResolvedValueOnce({ completed: 1, errors: 0 }).mockResolvedValueOnce({ completed: 0, errors: 1 });
    await runStartingChatEmail({ event, step });
    expect(calls).toEqual(['grace', 'delivery']); expect(step.sleep).toHaveBeenCalledWith('allow-recipient-to-read', '15s');
    expect(worker.chat).toHaveBeenCalledWith('thread', 'first', 3);
    await expect(runStartingChatEmail({ event, step })).rejects.toThrow('retryable');
    await expect(runStartingChatEmail({ event: { data: { ...event.data, messageId: 'foreign/path' } }, step })).rejects.toThrow('Invalid');
  });
  it('keeps staging cron disabled by default, including staging deployed as a Vercel production project', () => {
    expect(recurringCronEnabled({ LIFECYCLE_RECURRING_ENABLED: 'true', VERCEL_ENV: 'preview' })).toBe(false);
    expect(recurringCronEnabled({ LIFECYCLE_RECURRING_ENABLED: 'false', VERCEL_ENV: 'production' })).toBe(false);
    expect(recurringCronEnabled({ LIFECYCLE_RECURRING_ENABLED: 'true', VERCEL_ENV: 'production', LIFECYCLE_ENVIRONMENT: 'staging' })).toBe(false);
    expect(recurringCronEnabled({ LIFECYCLE_RECURRING_ENABLED: 'true', VERCEL_ENV: 'production', LIFECYCLE_ENVIRONMENT: 'production' })).toBe(true);
    expect(recurringCronEnabled({ LIFECYCLE_RECURRING_ENABLED: 'true', VERCEL_ENV: 'preview', LIFECYCLE_ENVIRONMENT: 'staging', LIFECYCLE_STAGING_REHEARSAL: 'true' })).toBe(true);
  });
  it('delivers broadcast wakeups independently by validated recipient role', async () => {
    const step = { sleep: vi.fn(async () => {}), run: vi.fn(async (_id: string, action: () => Promise<unknown>) => action()) };
    worker.chat.mockReset().mockResolvedValue({ completed: 1, errors: 0 });
    for (const recipientRole of ['chef', 'manager'] as const) {
      await runStartingChatEmail({ event: { data: { conversationId: 'thread', messageId: 'broadcast', senderId: 1, recipientRole } }, step });
      expect(worker.chat).toHaveBeenCalledWith('thread', 'broadcast', 1, recipientRole);
    }
    await expect(runStartingChatEmail({ event: { data: { conversationId: 'thread', messageId: 'broadcast', senderId: 1, recipientRole: 'admin' as any } }, step })).rejects.toThrow('Invalid');
    expect(worker.chat).toHaveBeenCalledTimes(2);
  });
  it('rejects unsigned Inngest execution and unauthenticated legacy aliases; valid Bearer retains callable recovery', async () => {
    vi.stubEnv('CRON_SECRET', 'controlled-local-secret');
    vi.stubEnv('INNGEST_SIGNING_KEY', `signkey-test-${'a'.repeat(64)}`);
    worker.run.mockResolvedValue({ taskFailures: [], elapsedMs: 50 });
    const app = express(); registerLifecycleWorkerEndpoints(app); app.use(express.json()); registerInngest(app);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = (server.address() as any).port, base = `http://127.0.0.1:${port}`;
    try {
      for (const path of ['/api/detect-overstays', '/api/viewings/delivery-worker', '/api/lifecycle-worker-health'])
        expect((await fetch(`${base}${path}`)).status).toBe(401);
      expect((await fetch(`${base}/api/inngest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
      expect((await fetch(`${base}/api/inngest`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-inngest-signature': 't=0&s=invalid' }, body: '{}' })).status).toBe(401);
      expect(worker.run).not.toHaveBeenCalled();
      expect((await fetch(`${base}/api/detect-overstays`, { headers: { Authorization: 'Bearer controlled-local-secret' } })).status).toBe(200);
      expect(worker.run).toHaveBeenCalledTimes(1);
      vi.stubEnv('INNGEST_SIGNING_KEY', '');
      expect((await fetch(`${base}/api/inngest`, { method: 'POST' })).status).toBe(503);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('checks health with bounded session setup, reports missing/failed runs and always releases its connection', async () => {
    vi.stubEnv('CRON_SECRET', 'controlled-local-secret');
    worker.initialize.mockClear();
    const release = vi.fn();
    const query = vi.fn().mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: JSON.stringify({ finishedAt: new Date().toISOString(), failures: [] }) }] })
      .mockResolvedValueOnce({ rows: [{ value: JSON.stringify({ finishedAt: new Date().toISOString(), failures: ['overstays'] }) }] });
    worker.connect.mockResolvedValue({ query, release });
    const app = express(); registerLifecycleWorkerEndpoints(app);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/lifecycle-worker-health`;
    try {
      const request = () => fetch(url, { headers: { Authorization: 'Bearer controlled-local-secret' } });
      const missing = await request(); expect(missing.status).toBe(503); expect((await missing.json()).missingRun).toBe(true);
      expect((await request()).status).toBe(200);
      expect((await request()).status).toBe(503);
      expect(worker.initialize).toHaveBeenCalledTimes(3); expect(release).toHaveBeenCalledTimes(3);
      expect(release).toHaveBeenCalledWith(true);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
