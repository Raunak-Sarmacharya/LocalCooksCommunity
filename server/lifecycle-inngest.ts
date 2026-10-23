import { AsyncLocalStorage } from 'node:async_hooks';
import { timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import { Inngest } from 'inngest';
import { serve } from 'inngest/express';
import { runRecurringWorker } from './services/recurring-worker';
import { processExpiredCancellationRequests } from './services/scheduled-cancellations';
import { workerPool, assertWorkerSessionConnection, initializeWorkerSession } from './services/recurring-worker';
import { deliverStartingChatMessage } from './services/chat-notices';
import { deadlineGraceMs, deadlineKinds, deadlineScheduledEvent, runDeadlineExpiry, type DeadlineKind } from './services/deadline-timer';

const requestClock = new AsyncLocalStorage<number>();
export const workerRequestStarted = () => requestClock.getStore() || performance.now();
export function recurringCronEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.LIFECYCLE_RECURRING_ENABLED === 'true' &&
    ((env.LIFECYCLE_ENVIRONMENT === 'production' && env.VERCEL_ENV === 'production') ||
      (env.LIFECYCLE_ENVIRONMENT === 'staging' && env.LIFECYCLE_STAGING_REHEARSAL === 'true'));
}
/** Worker cadence. A 2-minute tick on dev alone used ~7.8 of the 4 Active CPU
 * hours a Vercel Hobby team gets per month, and that budget is shared with
 * production. Booking notices are delivered by event (bookingNoticeDelivery),
 * so the tick is only a backstop for time-based work: every 15 min in
 * production, every 30 min in staging. LIFECYCLE_CRON overrides it with
 * `*\/N * * * *` (N 1-30) or `0 * * * *` (hourly). */
export function recurringCronSchedule(env: NodeJS.ProcessEnv = process.env) {
  const value = env.LIFECYCLE_CRON?.trim();
  const step = value?.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (step && Number(step[1]) >= 1 && Number(step[1]) <= 30 || value === '0 * * * *') return value!;
  return env.LIFECYCLE_ENVIRONMENT === 'production' ? '*/15 * * * *' : '*/30 * * * *';
}
export const inngest = new Inngest({ id: process.env.LIFECYCLE_ENVIRONMENT === 'staging' ? 'localcooks-lifecycle-staging' : 'localcooks-lifecycle', isDev: false });
export const lifecycleTick = inngest.createFunction({ id: 'lifecycle-recurring-worker',
  concurrency: { limit: 1 }, retries: 1,
  triggers: recurringCronEnabled() ? [{ cron: recurringCronSchedule() }] : [{ event: 'localcooks/staging.lifecycle.rehearsal' }],
}, async ({ step }) => step.run('bounded-current-source-worker', async () => {
  if (process.env.LIFECYCLE_RECURRING_ENABLED !== 'true') return { disabled: true };
  const result = await runRecurringWorker(processExpiredCancellationRequests, requestClock.getStore());
  if ('taskFailures' in result && result.taskFailures.length) throw Error(`Lifecycle tasks require recovery: ${result.taskFailures.join(', ')}`);
  return result;
}));

export const bookingNoticeEvent = 'localcooks/booking.notice.queued';
/** Delivers a booking's queued notices shortly after they are recorded, instead of
 * waiting for the backstop tick. The debounce coalesces bursts per booking and
 * lands well after the producing transaction commits; a rolled-back producer
 * leaves nothing to deliver. */
export const bookingNoticeDelivery = inngest.createFunction({ id: 'booking-notice-delivery', retries: 2,
  debounce: { key: 'event.data.bookingId', period: '10s' },
  triggers: [{ event: bookingNoticeEvent }],
}, async ({ event, step }) => {
  const bookingId = Number(event.data?.bookingId);
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) throw Error('Invalid booking notice identity');
  return step.run('deliver-booking-notices', async () => {
    const { deliverBookingLifecycleEvents } = await import('./services/booking-lifecycle-delivery');
    return deliverBookingLifecycleEvents(10, 20_000, bookingId);
  });
});

export const invitationNoticeEvent = 'localcooks/invitation.notice.queued';
/** Invitation notices go out seconds after they're recorded (a chef shouldn't wait for the backstop tick to hear of an offer). */
export const invitationNoticeDelivery = inngest.createFunction({ id: 'invitation-notice-delivery', retries: 2,
  debounce: { key: 'event.data.invitationId', period: '10s' },
  triggers: [{ event: invitationNoticeEvent }],
}, async ({ step }) => step.run('deliver-invitation-notices', async () =>
  (await import('./services/kitchen-invitations')).deliverKitchenInvitationEvents(10)));

/** Exact deadlines: sleeps (no compute) until `dueAt`, then runs the worker's own idempotent expiry for that one item.
 * Gated like bookingNoticeDelivery (event-triggered; producers only send when INNGEST_EVENT_KEY is set). The recurring
 * tick stays the backstop, so a lost event only delays expiry to the next tick. */
export async function runDeadlineTimer({ event, step }: {
  event: { data: { kind?: unknown; id?: unknown; dueAt?: unknown } };
  step: { sleepUntil: (id: string, time: Date) => Promise<unknown>; run: (id: string, action: () => Promise<unknown>) => Promise<unknown> };
}) {
  const { kind, id, dueAt } = event.data ?? {};
  const due = typeof dueAt === 'string' ? Date.parse(dueAt) : NaN;
  if (!deadlineKinds.includes(kind as DeadlineKind) || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(due))
    throw Error('Invalid deadline timer identity');
  await step.sleepUntil('wait-for-deadline', new Date(due + deadlineGraceMs));
  const result = await step.run('expire-at-deadline', () => runDeadlineExpiry(kind as DeadlineKind, id));
  // An expiry can queue outcome notices (claim, payment, overstay); send them now rather than on a later tick.
  await step.run('deliver-new-outcomes', async () => (await import('./services/outcome-delivery')).deliverOutcomeEmails(5, 15_000, undefined, true));
  return result;
}
export const deadlineTimer = inngest.createFunction({ id: 'deadline-timer', retries: 3,
  triggers: [{ event: deadlineScheduledEvent }],
}, runDeadlineTimer);

export async function runStartingChatEmail({ event, step }: {
  event: { data: { conversationId: string; messageId: string; senderId: number; recipientRole?: 'chef' | 'manager' } };
  step: { sleep: (id: string, duration: '15s') => Promise<unknown>; run: (id: string, action: () => Promise<unknown>) => Promise<unknown> };
}) {
  const { conversationId, messageId, senderId, recipientRole } = event.data;
  if (typeof conversationId !== 'string' || !conversationId || conversationId.includes('/') ||
      typeof messageId !== 'string' || !messageId || messageId.includes('/') || !Number.isSafeInteger(senderId) || senderId <= 0 ||
      (recipientRole !== undefined && !['chef', 'manager'].includes(recipientRole)))
    throw Error('Invalid starting chat message identity');
  await step.sleep('allow-recipient-to-read', '15s');
  return step.run('deliver-original-starting-message', async () => {
    const result = recipientRole ? await deliverStartingChatMessage(conversationId, messageId, senderId, recipientRole)
      : await deliverStartingChatMessage(conversationId, messageId, senderId);
    if (result.errors) throw Error('Starting message email remains retryable');
    return result;
  });
}
export const startingChatEmail = inngest.createFunction({ id: 'starting-chat-message-email', retries: 3,
  concurrency: { limit: 1, key: 'event.data.conversationId' },
  triggers: [{ event: 'localcooks/chat.message.start' }],
}, runStartingChatEmail);

export function registerInngest(app: Express) {
  const handler = serve({ client: inngest, functions: [lifecycleTick, startingChatEmail, bookingNoticeDelivery, invitationNoticeDelivery, deadlineTimer],
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
