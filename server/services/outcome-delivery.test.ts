import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
import { scheduleAdvanceReminders } from './advance-reminders';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AsyncLocalStorage } from 'node:async_hooks';

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, send: vi.fn(), alerts: [] as any[],
  failIntent: false, failAcknowledgment: false, db: null as any, inTransaction: false, locked: new Set<number>() }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_, key) => state.db[key] }) }));
vi.mock('../email', async original => ({ ...await original<typeof import('../email')>(), sendEmail: state.send }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./damage-claim-limits-service', () => ({ validateClaimAmount: async () => ({ valid: true }),
  getDamageClaimLimits: async () => ({ claimSubmissionDeadlineDays: 7, chefResponseDeadlineHours: 48 }) }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (alert: any, tx: any) => {
  if (tx !== state.db || !state.inTransaction) throw Error('Notice must share the outcome transaction');
  state.alerts.push(alert);
} } }));
import { chefRespondToClaim } from './damage-claim-service';
import { decideDamageClaim } from './damage-claims-v2';
import { attemptOutcomeDelivery } from './outcome-delivery';
import { processKitchenCheckoutClear } from './kitchen-checkout-service';
import { deliverOutcomeEmails, queueStorageVisitAction } from './outcome-delivery';
import { deliverBookingLifecycleEvents } from './booking-lifecycle-delivery';
import { retryFailedEmail } from './email-log-service';
import { updatePaymentTransaction } from './payment-transactions-service';
import { addPaymentHistory } from './payment-transactions-service';
import { processManagerDecision } from './overstay-penalty-service';
import { createProblem } from './commitment-problems';
describe('checkout incident outcome delivery', () => {
  it.each([false, true])('delivers a queued checkout outcome only while its recipient still matches (changed=%s)', async changed => {
    state.tables.kitchen_checkout_incidents = [{ id: 12, chefId: 3, sessionId: 'cs_original', outcome: 'inventory_conflict',
      inventoryConflict: true, moneyStatus: 'refunded', amountCents: 2440, currency: 'cad', operatingDate: '2099-01-01' }];
    state.tables.email_logs = [{ id: 1, recipientEmail: changed ? 'former@example.com' : 'chef@example.com', recipientUserId: 3, recipientRole: 'chef',
      category: 'lifecycle_outcome', status: 'queued', subject: 'Kitchen checkout update', trackingId: 'checkout-outcome:12:inventory_conflict:refunded:3',
      textBody: 'Checkout reference: cs_original', createdAt: new Date(), retryCount: 0 }];
    state.send.mockResolvedValue(true);
    expect(await deliverOutcomeEmails(1)).toEqual({ completed: changed ? 0 : 1 });
    if (changed) expect(state.send).not.toHaveBeenCalled();
    else expect(state.send.mock.calls[0][0].text).toContain('Your refund of $24.40 was sent');
  });
});
describe('standalone storage rental outcome delivery', () => {
  // The stored notice already has its own shell; delivery re-checks the recipient and resends it verbatim.
  it.each([false, true])('delivers a queued storage notice only while its recipient still belongs to the rental (changed=%s)', async changed => {
    state.tables.storage_bookings = [{ id: 5, chefId: changed ? 99 : 3, managerId: 2 }];
    state.tables.email_logs = [{ id: 1, recipientEmail: 'chef@example.com', recipientUserId: 3, recipientRole: 'chef',
      category: 'lifecycle_outcome', status: 'queued', subject: 'Paid through Oct 27, 2026',
      trackingId: 'storage-rental:5:ending:d14:3', textBody: 'Paid through Oct 27, 2026 · Extend 14 days · $140.00.',
      htmlBody: '<p>Paid through Oct 27, 2026 · Extend 14 days · $140.00.</p>', createdAt: new Date(), retryCount: 0 }];
    state.send.mockResolvedValue(true);
    expect(await deliverOutcomeEmails(1)).toEqual({ completed: changed ? 0 : 1 });
    if (changed) expect(state.send).not.toHaveBeenCalled();
    else {
      const [content] = state.send.mock.calls[0];
      expect(content.text).toContain('Extend 14 days');
      expect(content.text).not.toContain('Recorded outcome notice');
      expect(content.html).toContain('Extend 14 days');
    }
  });
  it('a synthetic .test account is skipped by policy, not failed: no retries and no recovery alert (QA walk Oct 28)', async () => {
    state.tables.storage_bookings = [{ id: 5, chefId: 3, managerId: 2 }];
    state.tables.email_logs = [{ id: 1, recipientEmail: 'phase0-chef@localcooks.test', recipientUserId: 3, recipientRole: 'chef',
      category: 'lifecycle_outcome', status: 'queued', subject: 'Move in', trackingId: 'storage-rental:5:move_in_due:1:2026-10-27:3',
      textBody: 'Move in', htmlBody: '<p>Move in</p>', createdAt: new Date(), retryCount: 0 }];
    state.send.mockResolvedValue(false);
    await deliverOutcomeEmails(1);
    expect(state.tables.email_logs[0]).toMatchObject({ status: 'skipped_policy' });
  });
});
vi.mock('./overstay-defaults-service', () => ({ getOverstayDisputeWindowHours: async () => 48 }));

const name = (table: any) => table[Symbol.for('drizzle:Name')];
const dialect = new PgDialect();
const lockContext = new AsyncLocalStorage<number[]>();
function matches(table: string, condition: any, rows: any[]) {
  if (!condition) return rows;
  const query = dialect.sqlToQuery(condition);
  for (const column of (table === 'users' ? [] : ['id', 'tracking_id', 'recipient_email', 'status', 'category', 'retry_count'])) {
    const regex = new RegExp(`"${table}"\\."${column}" = \\$(\\d+)`, 'g');
    const values = [...query.sql.matchAll(regex)].map(match => query.params[Number(match[1]) - 1]);
    if (values.length) rows = rows.filter(row => values.includes(row[column.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]));
  }
  if (table === 'users') rows = rows.filter(row => query.params.includes(row.id) || query.params.includes(row.role));
  if (table === 'email_logs' && query.sql.includes("LIKE 'claim-outcome:%'")) {
    rows = rows.filter(row => row.category === 'lifecycle_outcome' && ['queued', 'failed'].includes(row.status));
    const excluded = /NOT IN \(([^)]+)\)/.exec(query.sql)?.[1];
    if (excluded) { const ids = [...excluded.matchAll(/\$(\d+)/g)].map(match => query.params[Number(match[1]) - 1]); rows = rows.filter(row => !ids.includes(row.id)); }
    const cap = /"email_logs"\."retry_count" < \$(\d+)/.exec(query.sql);
    if (cap) rows = rows.filter(row => (row.retryCount ?? 0) < query.params[Number(cap[1]) - 1]);
    rows = [...rows].sort((a, b) => (a.retryCount ?? 0) - (b.retryCount ?? 0) || a.id - b.id);
  }
  return rows;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0'); vi.stubEnv('NODE_ENV', 'development');
  state.failIntent = false; state.failAcknowledgment = false; state.inTransaction = false; state.alerts = [];
  state.locked.clear();
  state.tables = {
    damage_claims: [{ id: 7, managerId: 2, chefId: 3, status: 'draft', bookingType: 'kitchen', kitchenBookingId: 10,
      claimTitle: 'Cleaning damage', claimedAmountCents: 1000, adminNotes: 'INTERNAL SECRET' }],
    kitchen_bookings: [{ id: 10, status: 'confirmed', chefId: 3, managerId: 2, kitchenId: 4,
      bookingDate: new Date(), startTime: '09:00', endTime: '10:00', timezone: 'America/St_Johns',
      checkinStatus: 'checkout_requested', updatedAt: new Date() }],
    damage_evidence: [{ evidenceType: 'photo_before' }, { evidenceType: 'photo_after' }, { evidenceType: 'receipt' }],
    users: [{ id: 3, username: 'chef@example.com', email: 'chef@example.com', role: 'chef' },
      { id: 2, username: 'manager@example.com', email: 'manager@example.com', role: 'manager' },
      { id: 1, username: 'admin@example.com', email: 'admin@example.com', role: 'admin', adminEmailNotifications: true }],
    damage_claim_history: [], email_logs: [], booking_lifecycle_events: [], payment_history: [],
  };
  state.db = {
    execute: async () => ({ rows: [] }),
    transaction: async (run: any) => lockContext.run([], async () => {
      const saved = structuredClone(state.tables), alerts = [...state.alerts], parent = state.inTransaction;
      state.inTransaction = true;
      try { return await run(state.db); }
      catch (error) { state.tables = saved; state.alerts = alerts; throw error; }
      finally { for (const id of lockContext.getStore()!) state.locked.delete(id); state.inTransaction = parent; }
    }),
    execute: async (query: any) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      if (text.includes('FROM payment_transactions')) return { rows: state.tables.payment_transactions };
      if (text.includes('UPDATE payment_transactions')) { Object.assign(state.tables.payment_transactions[0], { status: 'refunded', refund_amount: 500, refund_id: 're_fixture' }); return { rows: state.tables.payment_transactions }; }
      if (text.includes('INSERT INTO payment_history')) { const row = { id: state.tables.payment_history.length + 1, params, eventType: params[3] }; state.tables.payment_history.push(row); return { rows: [row] }; }
      if (text.includes('FROM payment_history')) return { rows: state.tables.payment_history.slice(-1) };
      return { rows: [] };
    },
    select: () => {
      let table = '', condition: any, limit = Infinity, lock = false;
      const chain: any = { from: (value: any) => { table = name(value); return chain; }, where: (value: any) => { condition = value; return chain; },
        innerJoin: () => chain, leftJoin: () => chain, orderBy: () => chain, for: () => { lock = true; return chain; },
        limit: (value: number) => { limit = value; return chain; },
        then: (resolve: any) => {
          const rows = matches(table, condition, state.tables[table] || []).filter(row => !lock || table !== 'email_logs' || !state.locked.has(row.id)).slice(0, limit);
          if (lock && table === 'email_logs') for (const row of rows) { state.locked.add(row.id); lockContext.getStore()?.push(row.id); }
          return resolve(rows.map(row => ({ ...row })));
        } };
      return chain;
    },
    insert: (table: any) => ({ values: (value: any) => {
      const save = () => { if (['email_logs', 'booking_lifecycle_events'].includes(name(table)) && state.failIntent) throw Error('intent unavailable');
      const row = { id: (state.tables[name(table)] || []).length + 1, createdAt: new Date(), retryCount: 0, retriedAt: null,
          ...(name(table) === 'commitment_problems' ? { status: 'reported', revision: 1 } : {}),
          deliveredEmailKeys: [], metadata: {}, ...value };
        (state.tables[name(table)] ||= []).push(row); return [row]; };
      return { returning: async () => save(), then: (resolve: any, reject: any) => { try { resolve(save()); } catch (error) { reject(error); } } };
    } }),
    update: (table: any) => ({ set: (value: any) => ({ where: (condition: any) => {
      const save = () => { if (name(table) === 'email_logs' && value.status === 'sent' && state.failAcknowledgment) throw Error('ack unavailable');
        const rows = matches(name(table), condition, state.tables[name(table)] || []); rows.forEach(row => Object.assign(row, value)); return rows; };
      return { returning: async () => save(), then: (resolve: any, reject: any) => { try { resolve(save()); } catch (error) { reject(error); } } };
    } }) }),
  };
  state.send.mockResolvedValue(false);
});

// Delivery fixtures start at the admin's reviewed decision; filing/evidence validation is covered by the real v2 service suite.
async function submitClaim(_id: number, _managerId: number) {
  Object.assign(state.tables.damage_claims[0], { status: 'in_review', claimVersion: 2, chefVisibleAt: null,
    chefResponseDeadline: new Date(), visitEvidence: { timezone: 'America/St_Johns', kitchenName: 'Harbour Kitchen' } });
  try {
    await decideDamageClaim(10, 1, { claimId: 7, type: 'claim_send', reasonCode: 'evidence', note: 'Documents reviewed by Local Cooks.',
      publicMessage: 'The receipt supports this cleaning cost.', requestSource: 'proactive', operationKey: 'reviewed:claim:fixture' });
    await attemptOutcomeDelivery();
    return { success: true };
  } catch { return { success: false }; }
}

describe('actual producer → persisted intent → worker → admin replay', () => {
  it('legacy draft handoffs notify only the kitchen until Local Cooks sends an approved claim', async () => {
    state.tables.storage_bookings = [{ id: 8, managerId: 2, storage: { id: 8, chefId: 3, updatedAt: new Date() } }];
    await state.db.transaction((tx: any) => queueStorageVisitAction(tx, 8, 'draft_claim', 2));
    expect(state.alerts.map(alert => alert.userId)).toEqual([2]);
    expect(state.tables.email_logs.map(log => log.recipientUserId)).toEqual([2]);
  });
  it('renders a current problem with category, kitchen, local reported time and its current destination', async () => {
    state.tables.kitchen_bookings = [{ id: 10, booking: state.tables.kitchen_bookings[0], managerId: 2,
      timezone: 'America/St_Johns', kitchenName: 'Harbour Kitchen' }];
    state.tables.commitment_problems = [{ id: 7, bookingId: 10, category: 'equipment', status: 'acknowledged',
      createdAt: new Date('2026-10-04T12:10:00Z'), description: 'The cooler stopped working.',
      history: [{ action: 'reply', note: 'A repair is scheduled.' }] }];
    state.tables.email_logs = [{ id: 1, recipientEmail: 'chef@example.com', recipientUserId: 3, recipientRole: 'chef',
      category: 'lifecycle_outcome', status: 'queued', subject: 'Equipment problem reported · Booking #10',
      trackingId: 'problem-outcome:7:1:3', textBody: 'Old support request', createdAt: new Date(), retryCount: 0 }];
    state.send.mockResolvedValue(true);
    expect(await deliverOutcomeEmails(1)).toEqual({ completed: 1 });
    const email = state.send.mock.calls[0][0];
    expect(email.html).toContain('class="email-title"');
    expect(email.html).toContain('max-width:560px');
    expect(email.text).toContain('Category: Equipment');
    expect(email.text).toContain('Harbour Kitchen');
    expect(email.text).toContain('9:40 a.m.');
    expect(email.text).toContain('Newfoundland Time');
    expect(email.text).toContain('A repair is scheduled.');
    expect(email.text).toContain('/booking/10');
    expect(email.text).not.toContain('America/St_Johns');
  });
  it('queues schedule impacts for opted-in admins and participants, while keeping all admin bell alerts', async () => {
    state.tables.kitchen_bookings = [{ id: 10, booking: state.tables.kitchen_bookings[0], managerId: 2, timezone: 'America/St_Johns' }];
    state.tables.users.push({ id: 4, username: 'off-admin@example.com', role: 'admin', adminEmailNotifications: false });
    state.tables.commitment_problems = [];
    await state.db.transaction((tx: any) => createProblem(tx, { kind: 'schedule', commitment: 'booking', id: 10,
      actor: { id: 2, role: 'manager' }, sourceKey: 'schedule-fixture', description: 'Operating hours changed' }));
    expect(state.alerts.map(alert => alert.userId)).toEqual([3, 2, 1, 4]);
    expect(state.tables.email_logs.map(log => log.recipientEmail)).toEqual(['chef@example.com', 'manager@example.com', 'admin@example.com']);
    expect(state.tables.email_logs.find(log => log.recipientUserId === 1)).toMatchObject({ recipientRole: 'admin', trackingId: 'problem-outcome:1:1:1' });
    state.send.mockResolvedValue(true);
    await deliverOutcomeEmails(3);
    expect(state.send).toHaveBeenCalledTimes(3);
    expect(state.send.mock.calls.some(([content]) => content.to === 'support@localcook.shop')).toBe(false);
  });
  it('reroutes a pending legacy support copy once and lets admin replay send only its replacement', async () => {
    state.tables.kitchen_bookings = [{ id: 10, booking: state.tables.kitchen_bookings[0], managerId: 2, timezone: 'America/St_Johns' }];
    state.tables.commitment_problems = [{ id: 7, bookingId: 10, status: 'reported', description: 'Closure changed', history: [] }];
    state.tables.email_logs = [{ id: 1, recipientEmail: 'support@localcook.shop', recipientRole: 'admin', recipientUserId: null,
      category: 'lifecycle_outcome', status: 'failed', subject: 'Review affected visit', trackingId: 'problem-outcome:7:1:support',
      textBody: 'Recorded schedule impact', createdAt: new Date(), retryCount: 1 }];
    expect(await retryFailedEmail(1)).toMatchObject({ success: true });
    expect(state.tables.email_logs[0].status).toBe('skipped_policy');
    expect(state.tables.email_logs).toHaveLength(2);
    expect(state.tables.email_logs[1]).toMatchObject({ recipientUserId: 1, recipientEmail: 'admin@example.com', trackingId: 'problem-outcome:7:1:1' });
    expect(state.send).not.toHaveBeenCalled();
    expect(await retryFailedEmail(1)).toMatchObject({ success: true });
    expect(state.tables.email_logs).toHaveLength(2);
    state.send.mockResolvedValue(true);
    expect(await deliverOutcomeEmails(1)).toEqual({ completed: 1 });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0]).toMatchObject({ to: 'admin@example.com' });
    expect(state.send.mock.calls[0][0].text).toContain('Closure changed');
  });
  it.each(['opted_out', 'already_accepted'])('suppresses a legacy support copy without another admin send when %s', async mode => {
    state.tables.email_logs = [{ id: 1, recipientEmail: 'support@localcook.shop', recipientUserId: null,
      category: 'lifecycle_outcome', status: 'queued', subject: 'Schedule impact', trackingId: 'problem-outcome:7:1:support' }];
    if (mode === 'opted_out') state.tables.users[2].adminEmailNotifications = false;
    else state.tables.email_logs.push({ id: 2, recipientUserId: 1, recipientEmail: 'admin@example.com',
      category: 'lifecycle_outcome', status: 'sent', trackingId: 'problem-outcome:7:1:1' });
    await deliverOutcomeEmails(1);
    expect(state.tables.email_logs[0].status).toBe('skipped_policy');
    expect(state.tables.email_logs).toHaveLength(mode === 'opted_out' ? 1 : 2);
    expect(state.send).not.toHaveBeenCalled();
  });
  it('persists independent storage assistance receipts and manager email with owned recovery', async () => {
    state.tables.storage_bookings = [{ id: 30, storage: { id: 30, chefId: 3, updatedAt: new Date('2026-10-02') }, managerId: 2 }];
    await state.db.transaction(async (tx: any) => queueStorageVisitAction(tx, 30, 'departure', 2,
      { reason: 'Reported departure after upload failed', actualAt: '2026-10-02T19:30:00Z' }));
    expect(state.alerts.map(row => row.userId)).toEqual([3, 2]);
    expect(state.tables.email_logs).toHaveLength(1);
    expect(state.tables.email_logs[0]).toMatchObject({ recipientUserId: 2, recipientRole: 'manager', status: 'queued' });
    expect(state.tables.email_logs[0].textBody).toContain('not clearance or a charge');
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(state.db, 'storage_arrival', 30);
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(state.db, 'storage_review', 30);
    await deliverOutcomeEmails(2);
    expect(state.tables.email_logs[0].status).toBe('failed');
    state.send.mockResolvedValue(true);
    expect(await retryFailedEmail(state.tables.email_logs[0].id)).toEqual({ success: true });
    expect(state.tables.email_logs[0].status).toBe('sent');
  });
  it('delivers immediate cancellation despite future or failed ordinary reminder rows', async () => {
    state.tables.email_logs = [{ id: 1, category: 'advance_reminder', status: 'scheduled', trackingId: 'advance:booking:10:future',
      textBody: JSON.stringify({ due: '2099-01-01T00:00:00Z' }) }, { id: 2, category: 'advance_reminder', status: 'failed', trackingId: 'advance:booking:10:poison' }];
    state.tables.booking_lifecycle_events = [{ id: 5, bookingId: 10, kind: 'cancelled', createdAt: new Date(), title: 'Cancelled', message: 'Current cancellation; refund separate', metadata: {},
      emails: [{ key: '3', to: 'chef@example.com', url: 'https://chef.example.test/booking/10' }], deliveredEmailKeys: [] }];
    state.send.mockResolvedValue(true);
    expect(await deliverBookingLifecycleEvents(1)).toEqual({ completed: 1 });
    expect(state.send.mock.calls[0][0].subject).toBe('Cancelled');
    expect(state.tables.email_logs.slice(0, 2).map(row => row.status)).toEqual(['scheduled', 'failed']);
  });
  it('commits claim state/history/notice intent through SMTP failure without changing its deadline', async () => {
    expect(await submitClaim(7, 2)).toEqual({ success: true });
    expect(state.tables.support_actions[0].actionType).toBe('claim_send');
    expect(state.tables.damage_claims[0].status).toBe('submitted');
    expect(state.tables.damage_claim_history).toHaveLength(1);
    expect(state.tables.email_logs).toHaveLength(2);
    const claim = state.tables.damage_claims[0], deadline = claim.chefResponseDeadline.getTime();
    expect(deadline - claim.chefVisibleAt.getTime()).toBe(72 * 3600000);
    expect(state.tables.email_logs.map(row => row.status)).toEqual(['failed', 'failed']);
    expect(state.alerts.some(row => row.metadata.recoveryOwnerId === 1)).toBe(true);
    expect(state.tables.email_logs[0].textBody).not.toContain('INTERNAL SECRET');
    // Original intent is reconciled, with its stable key, after the action has already moved to review.
    claim.status = 'under_review'; state.send.mockResolvedValue(true);
    expect(await retryFailedEmail(1)).toEqual({ success: true });
    expect(state.tables.email_logs[0].status).toBe('sent');
    expect(state.send.mock.calls.at(-1)?.[1].trackingId).toBe('claim-outcome:7:1:3');
    expect(state.send.mock.calls.at(-1)?.[0].text).toContain('open the page for the latest status');
    expect(claim.chefResponseDeadline.getTime()).toBe(deadline);
    const count = state.send.mock.calls.length;
    expect(await retryFailedEmail(1)).toEqual({ success: true });
    expect(state.send).toHaveBeenCalledTimes(count);
  });
  it('rolls back submission and all history/alerts when intent persistence fails', async () => {
    state.failIntent = true;
    expect((await submitClaim(7, 2)).success).toBe(false);
    expect(state.tables.damage_claims[0].status).toBe('in_review');
    expect(state.tables.damage_claim_history).toEqual([]); expect(state.alerts).toEqual([]);
    expect(state.send).not.toHaveBeenCalled();
  });
  it('commits the actual chef dispute and one review outcome for each intended recipient', async () => {
    state.tables.damage_claims[0].status = 'submitted';
    state.tables.damage_claims[0].chefVisibleAt = new Date();
    state.tables.damage_claims[0].claimVersion = 2;
    state.tables.damage_claims[0].chefResponseDeadline = new Date();
    expect(await chefRespondToClaim(7, 3, { action: 'dispute', response: 'The photos do not show damage from my visit.' })).toEqual({ success: true });
    expect(state.tables.damage_claims[0].status).toBe('under_review');
    expect(state.tables.damage_claim_history).toHaveLength(1);
    expect(state.tables.email_logs).toHaveLength(3); // chef, manager, Local Cooks reviewer
    // Each side is addressed as itself (batch D / lead): the chef reviews their dispute, the kitchen learns of the dispute.
    const body = (role: string) => state.tables.email_logs.find(row => row.recipientRole === role)!.textBody;
    expect(body('chef')).toContain('Local Cooks is reviewing your dispute');
    expect(body('manager')).toMatch(/disputed your claim\. Local Cooks is reviewing both sides/);
    expect(body('admin')).toContain('Local Cooks is reviewing both sides');
  });
  it('suppresses previously queued admin outcomes when the current preference is disabled', async () => {
    state.tables.users[2].adminEmailNotifications = false;
    state.tables.email_logs.push({ id: 1, recipientEmail: 'admin@example.com', recipientUserId: 1, recipientRole: 'admin',
      category: 'lifecycle_outcome', status: 'queued', subject: 'Review damage claim', trackingId: 'claim-outcome:7:1:1', retryCount: 0 });
    expect(await deliverOutcomeEmails(1)).toEqual({ completed: 0 });
    expect(state.send).not.toHaveBeenCalled();
    expect(state.tables.email_logs[0].status).toBe('skipped_preference');
    expect(state.tables.damage_claims[0].status).toBe('draft');
  });
  it('sends a never-tried notice before older retries and stops retrying after four refusals', async () => {
    const row = (id: number, retryCount: number, email: string) => ({ id, recipientEmail: email, recipientUserId: null, recipientRole: 'manager',
      category: 'lifecycle_outcome', status: retryCount ? 'failed' : 'queued', subject: `Notice ${id}`, trackingId: `claim-outcome:7:${id}:2`, retryCount, retriedAt: null });
    state.tables.email_logs.push(row(1, 2, 'old@example.com'), row(2, 4, 'gone@example.com'), row(3, 0, 'new@example.com'), row(4, 3, 'last@example.com'));
    const tries = () => state.tables.email_logs.filter(item => item.id <= 4).map(item => item.retryCount);
    await deliverOutcomeEmails(1);
    expect(tries()).toEqual([2, 4, 1, 3]);
    await deliverOutcomeEmails(10);
    expect(tries()).toEqual([3, 4, 2, 4]);
    expect(state.tables.email_logs.find(item => item.id === 4)).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('automatic retries stopped') });
    // After an action, a timer or a webhook only never-tried notices go; retries stay with the worker.
    state.tables.email_logs.push(row(5, 0, 'fresh@example.com'));
    await deliverOutcomeEmails(10, 20_000, undefined, true);
    expect(tries()).toEqual([3, 4, 2, 4]);
    expect(state.tables.email_logs.find(item => item.id === 5)!.retryCount).toBe(1);
    expect(state.tables.email_logs.find(item => item.id === 2)!.retryCount).toBe(4);
  });
  it('commits clearance with its chef notice and rolls back when the outbox fails', async () => {
    // Clearance now runs through clock-closeout.recordKitchenInspection, which reads the booking joined to its
    // location (zone, manager) and its visit rows, and only accepts a response once the inspection is due.
    // The booking row doubles as that joined row, so the writes land on the booking the test asserts on.
    const booking: any = { ...state.tables.kitchen_bookings[0], bookingDate: new Date('2026-10-13'), startTime: '09:00', endTime: '10:00',
      checkoutRequestedAt: new Date('2026-10-13T12:20:00Z'), visitDuties: null, locationId: 1, timezone: 'America/St_Johns', managerId: 2, kitchen: { id: 4, locationId: 1 } };
    booking.booking = booking;
    state.tables.kitchen_bookings = [booking];
    state.tables.kitchen_booking_visits = [];
    // Cutover before the visit so the service-ended notice is queued; 12:50Z is after service end (10:00 local + 15 min = 12:45Z).
    state.tables.platform_settings = [{ key: 'closeout_notifications_from', value: '2026-10-01T00:00:00.000Z' }];
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:50:00Z'));
    try {
      expect((await processKitchenCheckoutClear(10, 2)).success).toBe(true);
      expect(state.tables.kitchen_bookings[0].status).toBe('completed');
      expect(state.tables.kitchen_bookings[0]).toMatchObject({ checkinStatus: 'checked_out', checkoutApprovedBy: 2 });
      const [cleared, ended] = state.tables.booking_lifecycle_events;
      expect(cleared.kind).toBe('visit_closed');
      expect(cleared.emails).toHaveLength(0);
      expect(state.alerts.filter(alert => alert.userId === 3)).toHaveLength(1);
      expect(ended.kind).toBe('service_ended');
      expect(ended.emails.map((email: any) => email.to).sort()).toEqual(['chef@example.com', 'manager@example.com']);
      booking.status = 'confirmed'; booking.checkinStatus = 'checkout_requested'; booking.visitDuties = null;
      const events = state.tables.booking_lifecycle_events.length;
      state.failIntent = true;
      expect((await processKitchenCheckoutClear(10, 2)).success).toBe(false);
      expect(state.tables.kitchen_bookings[0].status).toBe('confirmed');
      expect(state.tables.kitchen_bookings[0].checkinStatus).toBe('checkout_requested');
      expect(state.tables.booking_lifecycle_events).toHaveLength(events);
    } finally { vi.useRealTimers(); }
  });
  it('reconciles acceptance after a DB acknowledgment interruption without another send', async () => {
    vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '1'); await submitClaim(7, 2); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0');
    state.send.mockImplementationOnce(async (_content, options) => {
      state.tables.email_logs.push({ id: 99, recipientEmail: 'chef@example.com', trackingId: options.trackingId, status: 'sent', category: 'lifecycle_outcome_attempt' });
      return true;
    });
    state.failAcknowledgment = true;
    await expect(deliverOutcomeEmails(1, 20000, 1)).rejects.toThrow('ack unavailable');
    // SMTP log committed outside the intent transaction in production.
    state.tables.email_logs.push({ id: 99, recipientEmail: 'chef@example.com', trackingId: 'claim-outcome:7:1:3', status: 'sent', category: 'lifecycle_outcome_attempt' });
    state.failAcknowledgment = false;
    expect(await retryFailedEmail(1)).toEqual({ success: true });
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('records refund history and recipients in the payment update transaction', async () => {
    state.tables.payment_transactions = [{ id: 20, status: 'succeeded', amount: 500, refund_amount: 0,
      chef_id: 3, manager_id: 2, currency: 'CAD', payment_intent_id: 'pi_fixture' }];
    await updatePaymentTransaction(20, { status: 'refunded', refundAmount: 500, refundId: 're_fixture' }, state.db);
    expect(state.tables.payment_history.length).toBeGreaterThan(0);
    expect(state.tables.email_logs.map(row => row.trackingId)).toEqual(['payment-outcome:20:2:3', 'payment-outcome:20:2:2']);
    expect(state.tables.email_logs[0].textBody).toContain('re_fixture');
  });
  it.each(['cancelled', 'completed'])('replays a %s booking receipt without reissuing its calendar action', async status => {
    state.tables.kitchen_bookings[0].status = status;
    state.tables.booking_lifecycle_events.push({ id: 5, bookingId: 10, kind: 'confirmed', createdAt: new Date(),
      metadata: {}, title: 'Confirmed', message: 'Recorded paid confirmation', deliveredEmailKeys: [],
      emails: [{ key: '3', to: 'chef@example.com', url: 'https://chef.example.test/booking/10',
        content: { to: 'chef@example.com', subject: 'Confirmed',
          text: 'Payment captured: CAD $10.00\nAdd to calendar: https://calendar.google.com/calendar/render?action=TEMPLATE',
          html: '<p>Payment captured: CAD $10.00</p><a href="https://calendar.google.com/calendar/render?action=TEMPLATE">Add to calendar</a>',
          attachments: [{ filename: 'recorded.ics', content: 'immutable calendar' },
            { filename: 'receipt.pdf', content: 'immutable receipt', contentType: 'application/pdf' }] } }] });
    state.tables.email_logs.push({ id: 1, status: 'failed', category: 'booking', trackingId: 'booking-event:5:3', recipientEmail: 'chef@example.com' });
    state.send.mockResolvedValue(true);
    expect(await retryFailedEmail(1)).toEqual({ success: true });
    expect(state.tables.booking_lifecycle_events[0].deliveredEmailKeys).toEqual(['3']);
    const [content, options] = state.send.mock.calls[0];
    expect(content.text).toContain(`Current booking status: ${status}`);
    expect(content.text).toContain('Total paid: CAD $10.00');
    expect(content.text).toContain('Current booking: https://chef.example.test/booking/10');
    expect(content.text).not.toContain('https://calendar.google.com');
    expect(content.html).not.toContain('https://calendar.google.com');
    expect(content.attachments).toEqual([{ filename: 'receipt.pdf', content: 'immutable receipt', contentType: 'application/pdf' }]);
    expect(options.trackingId).toBe('booking-event:5:3');
    expect(state.tables.booking_lifecycle_events[0].emails[0].content.text).toContain('Payment captured: CAD $10.00');
    expect(state.tables.booking_lifecycle_events[0].emails[0].content.attachments[0].content).toBe('immutable calendar');
    expect(await retryFailedEmail(1)).toEqual({ success: true });
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('blocks legacy claim replay without an original intent instead of sending an obsolete action', async () => {
    state.tables.email_logs.push({ id: 1, status: 'failed', category: 'damage_claim', textBody: 'Old Pay Now link' });
    expect((await retryFailedEmail(1)).error).toContain('no durable intent');
    expect(state.send).not.toHaveBeenCalled();
  });
  it('coordinates simultaneous due workers on the same recipient intent', async () => {
    vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '1'); await submitClaim(7, 2); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0');
    let release!: () => void;
    state.send.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = () => resolve(true); }));
    const first = deliverOutcomeEmails(1, 20000, 1);
    for (let count = 0; !release && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(release).toBeTypeOf('function');
    expect(await deliverOutcomeEmails(1, 20000, 1)).toEqual({ completed: 0 });
    release(); expect(await first).toEqual({ completed: 1 });
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('persists standalone storage penalty decision, dispute deadline and intent in one transaction', async () => {
    state.tables.storage_bookings = [{ id: 8, chefId: 3, managerId: 2, kitchenBookingId: null }];
    state.tables.storage_overstay_records = [{ id: 9, idempotencyKey: 'overstay:9', storageBookingId: 8, status: 'pending_review', itemsRemovedAt: new Date(), calculatedPenaltyCents: 500 }];
    state.tables.storage_overstay_history = [];
    expect(await processManagerDecision({ overstayRecordId: 9, managerId: 2, action: 'approve' })).toEqual({ success: true });
    const record = state.tables.storage_overstay_records[0];
    expect(record.chefDisputeDeadline.getTime() - record.penaltyNoticeSentAt.getTime()).toBe(48 * 3600000);
    expect(state.tables.storage_overstay_history).toHaveLength(1);
    expect(state.tables.email_logs).toHaveLength(2);
    expect(state.tables.email_logs[0].textBody).toContain('Recorded dispute deadline');
    expect(state.tables.email_logs[1].textBody).toContain('view=overstays');
    expect(state.tables.email_logs.every(row => row.status === 'failed')).toBe(true);
  });
  it('queues a refund request for the actual Local Cooks reviewers without claiming money was returned', async () => {
    state.tables.payment_transactions = [{ id: 20, status: 'succeeded', amount: 500, refund_amount: 0,
      chef_id: 3, manager_id: 2, currency: 'CAD', payment_intent_id: 'pi_fixture' }];
    await state.db.transaction((tx: any) => addPaymentHistory(20, { previousStatus: 'succeeded', newStatus: 'succeeded', eventType: 'full_refund_requested' }, tx));
    expect(state.tables.email_logs).toHaveLength(3);
    expect(state.tables.email_logs[0].textBody).toContain('pending Local Cooks review');
    expect(state.tables.payment_transactions[0].refund_amount).toBe(0);
    expect(state.tables.payment_transactions[0].status).toBe('succeeded');
  });
});
