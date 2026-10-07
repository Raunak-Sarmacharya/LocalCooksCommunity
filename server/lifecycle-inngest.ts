import { AsyncLocalStorage } from 'node:async_hooks';
import { timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import { Inngest } from 'inngest';
import { serve } from 'inngest/express';
import { runRecurringWorker } from './services/recurring-worker';
import { processExpiredCancellationRequests } from './services/scheduled-cancellations';
import { workerPool, assertWorkerSessionConnection, initializeWorkerSession } from './services/recurring-worker';
import { deliverStartingChatMessage } from './services/chat-notices';

const requestClock = new AsyncLocalStorage<number>();
export const workerRequestStarted = () => requestClock.getStore() || performance.now();
export function recurringCronEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.LIFECYCLE_RECURRING_ENABLED === 'true' &&
    ((env.LIFECYCLE_ENVIRONMENT === 'production' && env.VERCEL_ENV === 'production') ||
      (env.LIFECYCLE_ENVIRONMENT === 'staging' && env.LIFECYCLE_STAGING_REHEARSAL === 'true'));
}
export const inngest = new Inngest({ id: process.env.LIFECYCLE_ENVIRONMENT === 'staging' ? 'localcooks-lifecycle-staging' : 'localcooks-lifecycle', isDev: false });
export const lifecycleTick = inngest.createFunction({ id: 'lifecycle-recurring-worker',
  concurrency: { limit: 1 }, retries: 1,
  triggers: recurringCronEnabled() ? [{ cron: '*/2 * * * *' }] : [{ event: 'localcooks/staging.lifecycle.rehearsal' }],
}, async ({ step }) => step.run('bounded-current-source-worker', async () => {
  if (process.env.LIFECYCLE_RECURRING_ENABLED !== 'true') return { disabled: true };
  const result = await runRecurringWorker(processExpiredCancellationRequests, requestClock.getStore());
  if ('taskFailures' in result && result.taskFailures.length) throw Error(`Lifecycle tasks require recovery: ${result.taskFailures.join(', ')}`);
  return result;
}));

export async function runStartingChatEmail({ event, step }: {
  event: { data: { conversationId: string; messageId: string; senderId: number } };
  step: { sleep: (id: string, duration: '15s') => Promise<unknown>; run: (id: string, action: () => Promise<unknown>) => Promise<unknown> };
}) {
  const { conversationId, messageId, senderId } = event.data;
  if (typeof conversationId !== 'string' || !conversationId || conversationId.includes('/') ||
      typeof messageId !== 'string' || !messageId || messageId.includes('/') || !Number.isSafeInteger(senderId) || senderId <= 0)
    throw Error('Invalid starting chat message identity');
  await step.sleep('allow-recipient-to-read', '15s');
  return step.run('deliver-original-starting-message', async () => {
    const result = await deliverStartingChatMessage(conversationId, messageId, senderId);
    if (result.errors) throw Error('Starting message email remains retryable');
    return result;
  });
}
export const startingChatEmail = inngest.createFunction({ id: 'starting-chat-message-email', retries: 3,
  concurrency: { limit: 1, key: 'event.data.conversationId' },
  triggers: [{ event: 'localcooks/chat.message.start' }],
}, runStartingChatEmail);

export function registerInngest(app: Express) {
  const handler = serve({ client: inngest, functions: [lifecycleTick, startingChatEmail],
    servePath: '/api/inngest', serveOrigin: process.env.INNGEST_SERVE_ORIGIN });
  app.use('/api/inngest', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Fail closed. SDK validates POST execution and PUT registration signatures.
    // Its GET metadata endpoint alone cannot run the worker.
    if (!process.env.INNGEST_SIGNING_KEY) return res.status(503).json({ error: 'Inngest is not configured' });
    if (req.method !== 'GET' && !req.headers['x-inngest-signature']) return res.status(401).json({ error: 'Signed Inngest request required' });
    return requestClock.run(workerRequestStarted(), () => handler(req, res, next));
  });
}

export function registerLifecycleWorkerEndpoints(app: Express) {
  // Capture before JSON parsing/authentication so worker budgets include request
  // setup. Secret/signature-protected routes run before DB-backed rate limiting.
  app.use((req, _res, next) => requestClock.run(performance.now(), next));
  const authenticated = (authorization?: string) => {
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(secret ? `Bearer ${secret}` : ''), received = Buffer.from(authorization || '');
    return !!secret && received.length === expected.length && timingSafeEqual(received, expected);
  };
  for (const path of ['/api/detect-overstays', '/api/viewings/delivery-worker']) app.all(path, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!authenticated(req.headers.authorization)) return res.status(401).json({ error: 'Unauthorized' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
    try {
      const result = await runRecurringWorker(processExpiredCancellationRequests, workerRequestStarted());
      return res.status('taskFailures' in result && result.taskFailures.length ? 503 : 200).json(result);
    } catch { return res.status(503).json({ error: 'Lifecycle worker unavailable; persisted work remains retryable' }); }
  });
  app.get('/api/lifecycle-worker-health', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!authenticated(req.headers.authorization)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      assertWorkerSessionConnection();
      const client = await workerPool.connect();
      try {
        await initializeWorkerSession(client);
        const result = await client.query("SELECT value FROM platform_settings WHERE key = 'lifecycle_worker_v2'");
        const state = result.rows[0] ? JSON.parse(result.rows[0].value) : null;
        const missingRun = !state?.finishedAt || Date.now() - Date.parse(state.finishedAt) > 10 * 60_000;
        return res.status(missingRun || state?.failures?.length ? 503 : 200).json({ missingRun, state, owner: 'Local Cooks operations' });
      } finally { client.release(true); }
    } catch { return res.status(503).json({ error: 'Worker health unavailable', owner: 'Local Cooks operations' }); }
  });
}
