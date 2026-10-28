import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ enabled: true, worker: vi.fn(), auth: vi.fn(), admin: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: state.auth, requireAdmin: state.admin }));
vi.mock('../services/qa-test-clock', () => ({ TestClockError: class extends Error {}, jumpTour: vi.fn(), readTourClock: vi.fn(), testClockEnabled: () => state.enabled }));
vi.mock('../services/qa-test-clock-booking', () => ({ jumpBooking: vi.fn(), readBookingClock: vi.fn() }));
vi.mock('../services/recurring-worker', () => ({ runRecurringWorker: state.worker }));
vi.mock('../services/scheduled-cancellations', () => ({ processExpiredCancellationRequests: vi.fn() }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
import router from './admin-test-clock';

const layers = (router as any).stack;
const gate = layers.find((layer: any) => !layer.route);
const worker = layers.find((layer: any) => layer.route?.path === '/admin/test-clock/worker' && layer.route.methods.post).route.stack.at(-1).handle;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); state.enabled = true; });

it('is behind the dev-only gate, then Firebase auth and admin', () => {
  expect(gate.regexp.test('/admin/test-clock/worker')).toBe(true);
  state.enabled = false;
  const res = response(), next = vi.fn();
  gate.handle({ url: '/admin/test-clock/worker', originalUrl: '/admin/test-clock/worker', method: 'POST', baseUrl: '' }, res, next);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(next).not.toHaveBeenCalled();
});

it('runs the background worker and says plainly what happened (QA Oct 28)', async () => {
  for (const [result, expected] of [
    [{ deferred: false, taskFailures: [] }, { ran: true, deferred: false, failures: 0 }],
    [{ deferred: true, taskFailures: [{}] }, { ran: true, deferred: true, failures: 1 }],
    [{ skipped: 'competing_worker' }, { ran: false, reason: 'busy' }],
    [{ disabled: true }, { ran: false, reason: 'disabled' }],
  ] as const) {
    state.worker.mockResolvedValueOnce(result);
    const res = response();
    await worker({ neonUser: { id: 1 } }, res);
    expect(res.json).toHaveBeenCalledWith(expected);
  }
});
