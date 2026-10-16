import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ flags: [] as any[], queue: vi.fn(), execute: vi.fn(), source: { bookingId: 1, bookingType: 'kitchen' },
  notify: vi.fn(), email: vi.fn(), db: null as any, currentDispute: { id: 'dp_one', payment_intent: 'pi_one', charge: 'ch_one', status: 'needs_response' } }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => state.db.select(...args), transaction: (run: any) => run(state.db) } }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./notification.service', () => ({ notificationService: { createForManager: state.notify } }));
vi.mock('./admin-email-preferences', () => ({ sendAdminNotificationEmail: state.email }));
vi.mock('../email', () => ({ renderTransactionalEmail: (input: any) => input }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://admin.example.test' }));
const params = (value: any) => new PgDialect().sqlToQuery(value).params;
const database: any = {
  execute: state.execute, transaction: (run: any) => run(database),
  select: () => {
    let table: any, values: any[] = [];
    const chain: any = { from: (value: any) => { table = value; return chain; }, where: (condition: any) => { values = params(condition); return chain; },
      for: () => chain, limit: () => chain,
      then: (resolve: any) => {
        const name = getTableName(table);
        resolve(name === 'booking_flags' ? state.flags.filter(row => row.bookingId === values[0] && row.kind === values[1] && row.providerRef === values[2])
          : name === 'kitchen_bookings' ? [{ id: 1, referenceCode: 'KB-TEST' }] : name === 'payment_transactions' ? [state.source]
          : name === 'users' ? [{ id: 2, email: 'owner@example.test' }] : []);
      } }; return chain;
  },
  insert: () => ({ values: (values: any) => {
    const row = { id: state.flags.length + 1, resolvedAt: null, ...values }; state.flags.push(row);
    return { returning: async () => [row] };
  } }),
  update: () => ({ set: (values: any) => ({ where: async (condition: any) => { Object.assign(state.flags.find(row => row.id === params(condition)[0]), values); } }) }),
};
import { chargebackCopy, changeBookingFlag, handleBookingSupportWebhook } from './booking-support-flags';
const event = (type: string, object: any, account?: string) => ({ id: 'evt_one', type, data: { object }, account } as any);
const stripe = () => ({ disputes: { retrieve: vi.fn(async () => state.currentDispute) },
  charges: { retrieve: vi.fn(async (id: string) => id === 'py_one' ? { source_transfer: 'tr_one' } : { status: 'succeeded', paid: true }) },
  balanceTransactions: { list: vi.fn(() => (async function* () { yield { source: 'py_one' }; })()) } } as any);
beforeEach(() => {
  vi.clearAllMocks(); state.flags = []; state.db = database; state.execute.mockResolvedValue({ rows: [] });
  state.currentDispute = { id: 'dp_one', payment_intent: 'pi_one', charge: 'ch_one', status: 'needs_response' };
});
describe('verified financial webhooks', () => {
  it('opens a dispute flag once and queues admin email/in-app delivery only', async () => {
    await handleBookingSupportWebhook(event('charge.dispute.created', { id: 'dp_one' }), stripe());
    await handleBookingSupportWebhook(event('charge.dispute.updated', { id: 'dp_one' }), stripe());
    expect(state.flags).toHaveLength(1); expect(state.flags[0].kind).toBe('chargeback'); expect(state.flags[0].resolvedAt).toBeNull();
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue.mock.calls[0][6]).toMatchObject({ recipientPolicy: 'admins', supportCase: true });
    expect(state.execute).toHaveBeenCalled();
  });
  it.each(['won', 'warning_closed'])('resolves %s disputes without reopening on old events', async status => {
    await handleBookingSupportWebhook(event('charge.dispute.created', { id: 'dp_one' }), stripe());
    state.currentDispute.status = status;
    await handleBookingSupportWebhook(event('charge.dispute.closed', { id: 'dp_one' }), stripe());
    expect(state.flags[0].resolvedAt).toBeInstanceOf(Date);
    await handleBookingSupportWebhook(event('charge.dispute.created', { id: 'dp_one', status: 'needs_response' }), stripe());
    expect(state.flags).toHaveLength(1); expect(state.queue).toHaveBeenCalledTimes(2);
  });
  it('pilot policy: a lost dispute closes the flag (Local Cooks absorbs it) and tells admins plainly', async () => {
    await handleBookingSupportWebhook(event('charge.dispute.created', { id: 'dp_one' }), stripe());
    state.currentDispute.status = 'lost';
    await handleBookingSupportWebhook(event('charge.dispute.closed', { id: 'dp_one' }), stripe());
    expect(state.flags[0].resolvedAt).toBeInstanceOf(Date);
    expect(state.queue.mock.calls[1][3]).toMatch(/^Chargeback lost · /);
  });
  it('the opening notice says the amount, reason, Stripe deadline and that the kitchen is still paid', () => {
    const copy = chargebackCopy({ id: 'du_1', amount: 3050, currency: 'cad', reason: 'fraudulent', status: 'needs_response', livemode: false,
      balance_transactions: [{ fee: 1500 }], evidence_details: { due_by: 1792886399 } } as any);
    expect(copy.title).toBe('Chargeback · {reference} · $30.50');
    expect(copy.message).toContain('(fraudulent)');
    expect(copy.message).toMatch(/Respond in Stripe by Oct 24, 2026, 9:29\sp\.m\. Newfoundland Time/);
    expect(copy.message).toContain('the kitchen is still paid');
    expect(copy.message).toContain('https://dashboard.stripe.com/test/disputes/du_1');
    expect(chargebackCopy({ id: 'du_1', amount: 3050, currency: 'cad', status: 'lost', livemode: false, balance_transactions: [{ fee: 1500 }] } as any).message)
      .toContain('Local Cooks absorbs $30.50 plus the $15.00 dispute fee');
  });
  it('records a terminal incident first as a tombstone', async () => {
    state.currentDispute.status = 'won';
    await handleBookingSupportWebhook(event('charge.dispute.closed', { id: 'dp_one' }), stripe());
    expect(state.flags[0].resolvedAt).toBeInstanceOf(Date);
  });
  it('ignores ordinary refund/automatic-reconciliation reversals', async () => {
    await handleBookingSupportWebhook(event('transfer.reversed', { id: 'tr_one', source_transaction: 'ch_one', amount_reversed: 500 }), stripe());
    expect(state.flags).toHaveLength(0); expect(state.queue).not.toHaveBeenCalled();
  });
  it('flags a reversal only when its source charge failed', async () => {
    const provider = stripe(); provider.charges.retrieve.mockResolvedValue({ status: 'failed', paid: false });
    await handleBookingSupportWebhook(event('transfer.reversed', { id: 'tr_one', source_transaction: 'ch_one', amount_reversed: 10000 }), provider);
    expect(state.flags[0].kind).toBe('transfer_failed');
  });
  it('links automatic Connect payout entries to transfers and gives the manager calm guidance', async () => {
    const provider = stripe();
    await handleBookingSupportWebhook(event('payout.failed', { id: 'po_one', automatic: true }, 'acct_one'), provider);
    expect(provider.balanceTransactions.list).toHaveBeenCalledWith({ payout: 'po_one', limit: 100 }, { stripeAccount: 'acct_one' });
    expect(state.flags[0].kind).toBe('payout_failed');
    expect(state.queue.mock.calls[1][4]).toContain('update your payout details');
    expect(state.queue.mock.calls[1][6].recipientPolicy).toBe('manager');
  });
  it('does not guess booking attribution for a manual payout; alerts the existing admin path', async () => {
    const result = await handleBookingSupportWebhook(event('payout.failed', { id: 'po_one', automatic: false }, 'acct_one'), stripe());
    expect(result.linkedBookings).toBe(0); expect(state.flags).toHaveLength(0); expect(state.notify).toHaveBeenCalled();
    expect(state.email.mock.calls[0][0].actionUrl).toBe('https://admin.example.test/admin?section=booking-support');
  });
  it('allows staff resolution of a payment failure with their identity retained', async () => {
    await changeBookingFlag(1, 'payout_failed', 'po_one');
    await changeBookingFlag(1, 'payout_failed', 'po_one', true, 77);
    expect(state.flags[0].resolvedBy).toBe(77); expect(state.flags[0].resolvedAt).toBeInstanceOf(Date);
  });
});
