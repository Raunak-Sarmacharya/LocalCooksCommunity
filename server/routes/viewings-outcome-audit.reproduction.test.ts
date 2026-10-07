// Audit existing tour authorization and lifecycle gaps. No live database writes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const audit = vi.hoisted(() => ({ tour: {} as any, update: vi.fn(), writes: [] as any[] }));
vi.mock('../services/recurring-worker', () => ({ runRecurringWorker: vi.fn(async () => ({ reminded: 0, delivered: 0, errors: 0 })) }));
vi.mock('../services/scheduled-cancellations', () => ({ processExpiredCancellationRequests: vi.fn() }));
vi.mock('../services/tour-delivery-service', () => ({ queueTourEvent: vi.fn(), attemptTourDelivery: vi.fn(async () => ({ failed: true })), deliverTourEvents: vi.fn() }));
vi.mock('../db', () => {
  const db: any = {
    execute: vi.fn(),
    transaction: (run: any) => run(db),
    select: () => {
      let table: any;
      const rows = () => table?.[Symbol.for('drizzle:Name')] === 'locations'
        ? [{ managerId: 1, name: 'Audit kitchen' }] : [{ ...audit.tour }];
      const chain: any = { from: (value: any) => { table = value; return chain; }, where: () => chain,
        limit: () => chain, for: () => chain, then: (resolve: any) => resolve(rows()) };
      return chain;
    }, update: audit.update,
  };
  return { db };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
// Simulate an unavailable delivery channel: the saved outcome must still succeed.
vi.mock('../services/notification.service', () => ({ notificationService: { createForChef: vi.fn().mockRejectedValue(new Error('Delivery unavailable')) } }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/tour-confirmation-pdf', () => ({ buildTourConfirmationPdf: vi.fn(), tourReference: vi.fn() }));
vi.mock('../email', () => ({}));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn() }));
vi.mock('../phone-utils', () => ({ getChefPhone: vi.fn() }));

import router from './viewings';
import { readFileSync } from 'node:fs';
vi.mock('../services/tour-outcome-service', () => ({ remindUnrecordedTourOutcomes: vi.fn(async () => ({ reminded: 0, delivered: 0, errors: 0 })) }));
import { runRecurringWorker } from '../services/recurring-worker';
describe('Hobby tour recovery endpoint', () => {
  const worker = (router as any).stack.find((entry: any) => entry.route?.path === '/delivery-worker').route.stack.at(-1).handle;
  it('rejects missing, incorrect and Unicode credentials', async () => {
    vi.stubEnv('CRON_SECRET', 'audit-secret');
    try {
      for (const authorization of [undefined, 'Bearer wrong', 'Bearer éééééééééééé']) {
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        await worker({ headers: { authorization } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
      }
    } finally { vi.unstubAllEnvs(); }
  });
  it('runs the authenticated bounded tour worker', async () => {
    vi.stubEnv('CRON_SECRET', 'audit-secret');
    try {
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
      await worker({ headers: { authorization: 'Bearer audit-secret' } }, res);
      expect(runRecurringWorker).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.json).toHaveBeenCalledWith({ reminded: 0, delivered: 0, errors: 0 });
    } finally { vi.unstubAllEnvs(); }
  });
  it('schedules the dedicated worker once daily within the configured function limit', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(config.crons.filter((cron: any) => cron.path === '/api/viewings/delivery-worker')).toEqual([{ path: '/api/viewings/delivery-worker', schedule: '0 9 * * *' }]);
    expect(config.functions['api/index.js'].maxDuration).toBe(30);
  });
});
const handler = (router as any).stack.find((entry: any) =>
  entry.route?.path === '/:id/status' && entry.route.methods.patch).route.stack.at(-1).handle;
async function request(status: string, user = { id: 1, role: 'admin' }, body = {}) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ params: { id: '10' }, neonUser: user, body: { status, expectedUpdatedAt: audit.tour.updatedAt.toISOString(), sharedManagerNotes: 'Final outcome verified by Local Cooks', ...body } }, res);
  return res;
}
describe('tour outcome audit reproductions', () => {
  beforeEach(() => {
    vi.clearAllMocks(); audit.writes = [];
    audit.tour = { id: 10, managerId: 1, chefId: 8, status: 'confirmed',
      locationId: 33, targetedKitchenId: 40, updatedAt: new Date('2026-10-01T10:00:00Z'), scheduledAt: new Date(Date.now() - 86400000), durationMinutes: 30 };
    audit.update.mockImplementation(() => ({ set: (value: any) => { audit.writes.push(value); return { where: () => ({ returning: async () => [{ ...audit.tour, ...value }] }) }; } }));
  });
  it('blocks chefs from certifying completion', async () => {
    expect((await request('completed', { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(403);
    expect(audit.update).not.toHaveBeenCalled();
  });
  it('blocks recording attendance before the scheduled tour ends', async () => {
    audit.tour.scheduledAt = new Date(Date.now() + 86400000);
    expect((await request('completed')).status).toHaveBeenCalledWith(409);
  });
  it('allows a manager to close an expired pending request', async () => {
    audit.tour.status = 'pending';
    const res = await request('cancelled', {id:1,role:'manager'}, { cancellationReason: 'The kitchen is unavailable' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', outcomeHistory: [] }));
    expect(audit.writes.at(-1)).toMatchObject({ outcomeRecordedBy: 1 });
  });
  it('cannot confirm an expired pending request through the status endpoint', async () => {
    audit.tour.status = 'pending';
    expect((await request('confirmed')).status).toHaveBeenCalledWith(409);
  });
  it('lets an admin correct a mistaken no-show with an explanation and audit history', async () => {
    audit.tour.status = 'no_show';
    audit.tour.outcomeHistory = [{ from: 'confirmed', to: 'no_show' }];
    const res = await request('completed', { id: 2, role: 'admin' }, { sharedManagerNotes: 'Attendance confirmed with the manager' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', noShowAt: null, noShowReason: null, outcomeNotificationPending: false,
      outcomeHistory: [expect.objectContaining({ from: 'confirmed' }), expect.objectContaining({ from: 'no_show', to: 'completed', actorId: 2 })] }));
  });
  it('requires a reason before recording a no-show', async () => {
    expect((await request('no_show')).status).toHaveBeenCalledWith(400);
    expect(audit.update).not.toHaveBeenCalled();
  });
  it('keeps result corrections admin-only even with a manager explanation', async()=>{
    audit.tour.status='no_show';audit.tour.outcomeHistory=[{from:'confirmed',to:'no_show'}];
    expect((await request('completed',{id:1,role:'manager'},{sharedManagerNotes:'Visitor attended late'})).status).toHaveBeenCalledWith(403);
    expect(audit.update).not.toHaveBeenCalled();
  });
  it('requires an explanation for an admin correction', async () => {
    audit.tour.status = 'no_show';
    audit.tour.outcomeHistory = [{ from: 'confirmed', to: 'no_show' }];
    expect((await request('completed', { id: 2, role: 'admin' },{sharedManagerNotes:''})).status).toHaveBeenCalledWith(400);
  });
  it.each(['completed', 'no_show'])('rejects attendance %s for unconfirmed requests', async status => {
    audit.tour.status = 'pending';
    expect((await request(status, undefined, { noShowReason: 'visitor_absent' })).status).toHaveBeenCalledWith(409);
    expect(audit.update).not.toHaveBeenCalled();
  });
  it.each(['manager_no_show', 'weather', 'rescheduled_by_manager', 'chef_no_response'])('rejects legacy reason %s on new no-show reports', async noShowReason => {
    expect((await request('no_show', undefined, { noShowReason })).status).toHaveBeenCalledWith(400);
    expect(audit.update).not.toHaveBeenCalled();
  });
  it('records access failure as disruption with actor/history, not no-show', async () => {
    const res = await request('cancelled', undefined, { disruptionReason: 'access_unavailable', sharedManagerNotes: 'The entrance was inaccessible' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', disruptionReason: 'access_unavailable', noShowReason: null,
      outcomeHistory: [expect.objectContaining({actorRole:'admin',disruptionReason:'access_unavailable'})] }));
    expect(audit.writes.at(-1).outcomeHistory).toEqual([expect.objectContaining({ from: 'confirmed', to: 'cancelled', actorId: 1, disruptionReason: 'access_unavailable' })]);
  });
  it('rejects a stale outcome version before writing', async () => {
    audit.tour.status = 'no_show';
    audit.tour.outcomeHistory = [{ from: 'confirmed', to: 'no_show' }];
    expect((await request('completed', undefined, { expectedUpdatedAt: '2025-01-01T00:00:00.000Z' })).status).toHaveBeenCalledWith(409);
    expect(audit.update).not.toHaveBeenCalled();
  });
  it('rejects manager writes to internal notes', async () => {
    expect((await request('completed', {id:1,role:'manager'}, { managerNotes: 'Private' })).status).toHaveBeenCalledWith(403);
    expect(audit.update).not.toHaveBeenCalled();
  });
  it('requires historical confirmation evidence before correcting legacy outcomes', async () => {
    audit.tour.status = 'no_show';
    expect((await request('completed', { id: 2, role: 'admin' }, { sharedManagerNotes: 'Claimed attendance' })).status).toHaveBeenCalledWith(409);
  });
});
