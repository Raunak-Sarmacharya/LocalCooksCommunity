import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ source: null as any, booking: {} as any, visits: [] as any[], notices: [] as any[], facts: {} as any,
  closeout: {} as any, log: [] as string[], raw: [] as string[], due: [] as any[], extensions: [] as any[],
  queue: vi.fn(), guard: vi.fn(), amounts: vi.fn(), transfer: vi.fn() }));
vi.mock('../db', () => {
  const db: any = {
    transaction: async (run: any) => run(db),
    execute: async (query: any) => { const text = new PgDialect().sqlToQuery(query).sql; state.raw.push(text); return { rows: [state.facts] }; },
    select: (fields?: any) => { let table: any, condition: any, rowLimit: number | undefined; const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => chain,
      where: (value: any) => { condition = value; return chain; }, orderBy: () => chain, limit: (value: number) => { rowLimit = value; return chain; }, for: () => chain,
      then: (resolve: any) => { const name = getTableName(table);
        const rows = name === 'kitchen_bookings' ? fields && 'referenceCode' in fields ? [{ id: state.booking.id, referenceCode: state.booking.referenceCode }]
            : [{ booking: state.booking, timezone: 'America/St_Johns', locationId: 3 }]
          : name === 'kitchen_booking_visits' ? state.visits : name === 'booking_lifecycle_events' ? state.notices.filter(event => !condition || event.metadata?.releaseTick === new PgDialect().sqlToQuery(condition).params.at(-1))
          : name === 'payment_transactions' ? fields?.bookingId && 'extensionId' in fields ? state.due : state.source ? [state.source, ...state.extensions].filter(row => { const q = condition && new PgDialect().sqlToQuery(condition); const match = q && /\"payment_transactions\"\.\"id\" = \$(\d+)/.exec(q.sql); return !match || row.id === q.params[Number(match[1]) - 1]; }) : [] : [];
        resolve(rowLimit === undefined ? rows : rows.slice(0, rowLimit)); } };
      return chain; },
    update: () => ({ set: (values: any) => { if (values.payoutReleasedAt) state.log.push('decision');
      return { where: (condition: any) => {
        const q = new PgDialect().sqlToQuery(condition); const id = q.params[0];
        const apply = () => { const row = [state.source, ...state.extensions].find(row => row.id === id)!; const updated = { ...row, ...values, ...(values.metadata?.queryChunks ? { metadata: { ...row.metadata, payoutSent: { ...row.metadata.payoutSent, noticeQueued: true } } } : {}) }; if (row.id === state.source.id) state.source = updated; else state.extensions = state.extensions.map(item => item.id === row.id ? updated : item); return [updated]; };
        return { returning: async () => apply(), then: (resolve: any) => resolve(apply()) };
      } }; } }),
  };
  return { db };
});
vi.mock('@shared/clock-closeout', () => ({ savedCloseout: () => ({}), makeCloseoutSnapshot: () => ({}), reduceClockCloseout: () => state.closeout }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({}), projectBookingCloseouts: async (items: any[]) => items }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: state.guard }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./stripe-service', () => ({ getStripePaymentAmounts: state.amounts }));
vi.mock('./stripe-transfer-service', () => ({ transferToManagerForBooking: state.transfer }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./worker-context', () => ({ workerAfter: () => undefined, workerRecord: async () => {}, workerPageEnd: async () => {}, isWorkerBudgetError: () => false }));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { db } from '../db';
import { releaseDuePayouts, releaseKitchenPayout, recordReleasedPayout, flushReleasedPayoutNotices, scheduleKitchenPayout, readKitchenPayout, upcomingKitchenPayouts, recoverCaptureTransfer } from './kitchen-payout-service';

const visit = (outcome: string, deadline = '2026-10-15T10:30:00.000Z') => ({ attendance: 'recorded', inspection: { outcome, deadline } });
const now = new Date('2026-10-15T11:00:00Z');
beforeEach(() => {
  vi.clearAllMocks(); state.log = []; state.raw = []; state.notices = []; state.due = []; state.visits = []; state.extensions = [];
  state.queue.mockImplementation(async (_tx, _bookingId, _kind, _title, _message, _actorId, metadata) => { state.notices.push({ id: state.notices.length + 1, metadata }); });
  state.booking = { id: 7, referenceCode: 'KB-7', status: 'completed', visitDuties: {} };
  state.closeout = { serviceEndedAt: '2026-10-14T13:15:00.000Z', serverNow: now.toISOString(), status: 'completed', visits: [visit('manager_cleared')] };
  state.facts = { flag: false, issue: false, resolved: false };
  state.source = { id: 11, bookingId: 7, bookingType: 'kitchen', status: 'succeeded', paymentIntentId: 'pi_7', payoutTiming: 'after_closeout',
    transferId: null, payoutReleasedAt: null, payoutHoldReason: null, payoutEligibleAt: null, amount: '12000', baseAmount: '11300', serviceFee: '700',
    stripeProcessingFee: '358', metadata: { approvedSubtotal: 10000, approvedTax: 1300, platformCommission: 700 } };
  state.amounts.mockImplementation(async () => { state.log.push('provider'); return { chargeId: 'ch_7', stripeAmount: 12000, stripeProcessingFee: 358 }; });
  state.transfer.mockImplementation(async () => { state.log.push('transfer'); return { transferred: true, transferId: 'tr_7', transferredCents: 10942 }; });
});

describe('releaseKitchenPayout', () => {
  it('defers per_day sources before scheduling, release overrides or capture-transfer recovery can reach a provider', async () => {
    state.source.payoutPartition = 'per_day';
    await scheduleKitchenPayout(7, db as any, now);
    expect(await releaseKitchenPayout(7, 'support_override', now, { override: true })).toMatchObject({ deferred: true });
    expect(await recoverCaptureTransfer(state.source)).toBe('skipped');
    expect(state.amounts).not.toHaveBeenCalled(); expect(state.transfer).not.toHaveBeenCalled(); expect(state.log).toEqual([]);
  });
  it('does not look at manager damage claims and holds only chef-reported kitchen problems', async () => {
    state.closeout.visits = [visit('issue_filed')];
    expect((await releaseKitchenPayout(7, 'manager_claim', now)).transferred).toBe(true);
    expect(state.raw.join(' ')).not.toContain('FROM damage_claims');
    expect(state.raw.join(' ')).toContain('p.reported_by = kb.chef_id');
  });
  it('releases after a clear inspection: the decision is committed before any provider call', async () => {
    const result = await releaseKitchenPayout(7, 'inspection_clear', now);
    expect(result).toMatchObject({ success: true, transferred: true, transferId: 'tr_7' });
    expect(state.log).toEqual(['decision', 'provider', 'transfer']);
    expect(state.source.payoutReleasedAt).toEqual(now);
    expect(state.source.metadata.payoutRelease).toMatchObject({ reason: 'inspection_clear', decidedAt: now.toISOString() });
    expect(state.transfer).toHaveBeenCalledWith(expect.objectContaining({ paymentTransactionId: 11, paymentIntentId: 'pi_7', chargeId: 'ch_7',
      actualStripeFeeCents: 358, transferGroup: 'pi_pi_7' }));
  });
  it('releases when the inspection window auto-closes (sweep reason)', async () => {
    state.closeout.visits = [visit('auto_closed_uninspected')];
    expect((await releaseKitchenPayout(7, 'closeout_sweep', now)).transferred).toBe(true);
  });
  it('is idempotent: a retry keeps the first decision and re-enters the same transfer engine; a sent payout is never touched', async () => {
    state.transfer.mockRejectedValueOnce(Error('Stripe timeout'));
    await expect(releaseKitchenPayout(7, 'inspection_clear', now)).rejects.toThrow('Stripe timeout');
    const decidedAt = state.source.payoutReleasedAt;
    await releaseKitchenPayout(7, 'closeout_sweep', new Date('2026-10-15T12:00:00Z'));
    expect(state.source.payoutReleasedAt).toEqual(decidedAt);
    expect(state.source.metadata.payoutRelease.reason).toBe('inspection_clear');
    expect(state.transfer).toHaveBeenCalledTimes(2);
    state.source.transferId = 'tr_7'; state.amounts.mockClear(); state.transfer.mockClear();
    expect(await releaseKitchenPayout(7, 'closeout_sweep', now)).toMatchObject({ success: true, transferred: true, transferId: 'tr_7' });
    expect(state.amounts).not.toHaveBeenCalled(); expect(state.transfer).not.toHaveBeenCalled();
  });
  it('waits for every visit without any provider call', async () => {
    state.closeout.visits = [visit('manager_cleared'), visit('due')];
    expect(await releaseKitchenPayout(7, 'inspection_clear', now)).toMatchObject({ success: false, deferred: true });
    expect(state.amounts).not.toHaveBeenCalled(); expect(state.source.payoutReleasedAt).toBeNull();
    expect(state.source.payoutEligibleAt).toEqual(new Date('2026-10-15T10:30:00.000Z'));
  });
  it('holds on an open issue report and tells the manager once', async () => {
    state.facts.issue = true;
    expect(await releaseKitchenPayout(7, 'closeout_sweep', now)).toMatchObject({ success: false, deferred: true, reason: 'On hold: reported_issue' });
    await releaseKitchenPayout(7, 'closeout_sweep', now);
    expect(state.source.payoutHoldReason).toBe('reported_issue');
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue.mock.calls[0].slice(2, 4)).toEqual(['payout_on_hold', 'Your payout is on hold']);
    expect(state.queue.mock.calls[0][4]).toContain('KB-7 is on hold while Local Cooks reviews the reported issue');
    expect(state.queue.mock.calls[0][6]).toMatchObject({ recipientPolicy: 'manager' });
    expect(state.amounts).not.toHaveBeenCalled();
  });
  it('holds on an open support flag, even for a support release', async () => {
    state.facts.flag = true;
    expect(await releaseKitchenPayout(7, 'support:op', now, { override: true })).toMatchObject({ success: false, overrideRecorded: false });
    expect(state.source.payoutHoldReason).toBe('support_flag'); expect(state.transfer).not.toHaveBeenCalled();
  });
  it('the release_payout support action releases over a reported-issue hold', async () => {
    state.facts.issue = true; state.closeout.visits = [visit('issue_filed')];
    expect(await releaseKitchenPayout(7, 'support:op-1', now, { override: true })).toMatchObject({ success: true, transferred: true });
    expect(state.source.metadata.payoutRelease).toMatchObject({ override: true, supportReason: 'support:op-1' });
    expect(state.source.payoutHoldReason).toBeNull();
  });
  it('a support release before the other visits close is saved for the sweep', async () => {
    state.facts.issue = true; state.closeout.visits = [visit('issue_filed'), visit('due')];
    expect(await releaseKitchenPayout(7, 'support:op-2', now, { override: true })).toMatchObject({ success: false, overrideRecorded: true });
    expect(state.source.payoutReleasedAt).toBeNull(); expect(state.source.metadata.payoutRelease.override).toBe(true);
    state.closeout.visits = [visit('issue_filed'), visit('auto_closed_uninspected')];
    expect((await releaseKitchenPayout(7, 'closeout_sweep', now)).transferred).toBe(true);
  });
  it('never moves a legacy at_capture payment or one still needing refund review', async () => {
    state.source.payoutTiming = null;
    expect(await releaseKitchenPayout(7, 'inspection_clear', now)).toMatchObject({ success: false, notApplicable: true });
    state.source.payoutTiming = 'after_closeout'; state.source.metadata = { cancellationRefundOperation: { status: 'pending' } };
    expect(await releaseKitchenPayout(7, 'inspection_clear', now)).toMatchObject({ deferred: true });
    expect(state.amounts).not.toHaveBeenCalled(); expect(state.guard).toHaveBeenCalledTimes(1);
  });
  it('a kitchen-caused cancellation releases at the scheduled end and records that nothing is owed', async () => {
    state.booking.status = 'cancelled'; state.source.status = 'refunded';
    state.transfer.mockResolvedValue({ transferred: false, transferredCents: 0, reason: 'Computed transfer amount (0¢) is non-positive — fees exceed charge' });
    expect(await releaseKitchenPayout(7, 'closeout_sweep', now)).toMatchObject({ success: true, notApplicable: true });
    expect(state.raw.some(text => text.includes('payoutNoEntitlement'))).toBe(true);
  });
  it('defers without error when Stripe has not reported the processing fee', async () => {
    state.amounts.mockResolvedValue({ chargeId: 'ch_7', stripeAmount: 12000, stripeProcessingFee: 0 });
    expect(await releaseKitchenPayout(7, 'inspection_clear', now)).toMatchObject({ success: false, deferred: true });
    expect(state.transfer).not.toHaveBeenCalled(); expect(state.source.payoutReleasedAt).toEqual(now);
  });
});

describe('closeout scheduling, notice and sweep', () => {
  it('schedules locally at closeout without any provider call', async () => {
    state.closeout.visits = [visit('due', '2026-10-16T10:30:00.000Z')];
    await scheduleKitchenPayout(7, db as any, now);
    expect(state.source.payoutEligibleAt).toEqual(new Date('2026-10-16T10:30:00.000Z'));
    expect(state.amounts).not.toHaveBeenCalled(); expect(state.transfer).not.toHaveBeenCalled();
  });
  it('records the sent payout and queues the manager notice once', async () => {
    state.source.payoutReleasedAt = now;
    const result = { transferred: true, transferId: 'tr_7', transferredCents: 10942, originalManagerNetCents: 10942,
      actualStripeFeeCents: 358, platformCommissionCents: 700, feeWithheldCents: 1058 };
    await recordReleasedPayout(11, result, db as any);
    expect(state.source).toMatchObject({ transferId: 'tr_7', managerRevenue: '10942', payoutHoldReason: null });
    expect(state.source.metadata.payoutSent).toMatchObject({ amountCents: 10942 });
    expect(state.queue).not.toHaveBeenCalled();
    await flushReleasedPayoutNotices(7);
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), 7, 'payout_released', expect.stringContaining('$109.42'), expect.stringContaining('$109.42'),
      undefined, expect.objectContaining({ recipientPolicy: 'manager', transactionIds: [11], amountCents: 10942 }));
    state.notices = [{ id: 1 }]; state.queue.mockClear();
    await recordReleasedPayout(11, result, db as any);
    await flushReleasedPayoutNotices(7);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('batches three committed lines in one release tick and never notifies on replay', async () => {
    state.source.payoutReleasedAt = now;
    state.extensions = [21, 22].map((id, index) => ({ ...structuredClone(state.source), id, amount: '3000',
      metadata: { sessionExtensionId: id, extensionKind: index ? 'extra_time' : 'request', minutes: 60 } }));
    const result = { transferred: true, transferId: 'tr', transferredCents: 2732, originalManagerNetCents: 2732, actualStripeFeeCents: 100, platformCommissionCents: 100 };
    vi.useFakeTimers(); vi.setSystemTime(now);
    try {
      await recordReleasedPayout(11, result, db as any);
      await recordReleasedPayout(21, result, db as any);
      await recordReleasedPayout(22, { ...result, transferredCents: 1328 }, db as any);
      expect(state.queue).not.toHaveBeenCalled();
      await flushReleasedPayoutNotices(7);
      expect(state.queue).toHaveBeenCalledTimes(1);
      expect(state.queue.mock.calls[0][3]).toContain('$67.92');
      expect(state.queue.mock.calls[0][6]).toMatchObject({ amountCents: 6792, transactionIds: [11, 21, 22], releaseTick: now.toISOString(),
        lines: [{ kind: 'booking', amountCents: 2732 }, { kind: 'extension', amountCents: 2732 }, { kind: 'charge', amountCents: 1328 }] });
      state.queue.mockClear();
      await recordReleasedPayout(21, result, db as any); await flushReleasedPayoutNotices(7);
      expect(state.queue).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('announces extensions committed after a replay flush already announced their parent tick', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    try {
      state.source.payoutReleasedAt = now;
      state.extensions = [21, 22].map(id => ({ ...structuredClone(state.source), id,
        metadata: { sessionExtensionId: id, minutes: 30 } }));
      const result = { transferred: true, transferId: 'tr', transferredCents: 2000,
        actualStripeFeeCents: 100, platformCommissionCents: 100 };
      await recordReleasedPayout(11, result, db as any);
      // Invocation A has committed its parent; replay B flushes before A's extensions commit.
      await releaseKitchenPayout(7, 'replay', now);
      expect(state.notices).toHaveLength(1);
      expect(state.notices[0].metadata.transactionIds).toEqual([11]);
      expect(state.extensions.every(row => !row.metadata.payoutSent?.noticeQueued)).toBe(true);
      await recordReleasedPayout(21, result, db as any);
      await recordReleasedPayout(22, { ...result, transferredCents: 1000 }, db as any);
      await flushReleasedPayoutNotices(7);
      expect(state.notices).toHaveLength(2);
      expect(state.notices[1].metadata).toMatchObject({ releaseTick: now.toISOString(),
        noticeKey: `${now.toISOString()}:21,22`, transactionIds: [21, 22], amountCents: 3000 });
      expect(state.extensions.every(row => row.metadata.payoutSent.noticeQueued)).toBe(true);
      expect(state.notices.reduce((sum, event) => sum + event.metadata.amountCents, 0)).toBe(5000);
      await flushReleasedPayoutNotices(7);
      expect(state.queue).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('recognizes IDs in every supplemental event on replay and leaves failed supplements retryable', async () => {
    const tick = now.toISOString();
    state.source.transferId = 'tr';
    state.source.metadata.payoutSent = { noticeTick: tick, amountCents: 2000 };
    state.extensions = [21, 22].map(id => ({ ...structuredClone(state.source), id,
      metadata: { sessionExtensionId: id, payoutSent: { noticeTick: tick, amountCents: 1000 } } }));
    state.notices = [{ metadata: { releaseTick: tick, transactionIds: [11] } },
      { metadata: { releaseTick: tick, noticeKey: `${tick}:21`, transactionIds: [21] } }];
    state.queue.mockRejectedValueOnce(Error('outbox unavailable'));
    await expect(flushReleasedPayoutNotices(7)).rejects.toThrow('outbox unavailable');
    expect(state.extensions[1].metadata.payoutSent.noticeQueued).toBeUndefined();
    await flushReleasedPayoutNotices(7);
    expect(state.notices).toHaveLength(3);
    expect(state.notices[2].metadata).toMatchObject({ noticeKey: `${tick}:22`, transactionIds: [22], amountCents: 1000 });
    // Stale markers must be acknowledged from both the original and supplemental events without duplicates.
    for (const row of [state.source, ...state.extensions]) row.metadata.payoutSent.noticeQueued = false;
    state.queue.mockClear();
    await flushReleasedPayoutNotices(7);
    expect(state.queue).not.toHaveBeenCalled();
    expect([state.source, ...state.extensions].every(row => row.metadata.payoutSent.noticeQueued)).toBe(true);
  });
  it('refuses to record a payout without a durable release decision', async () => {
    await expect(recordReleasedPayout(11, { transferred: true } as any, db as any)).rejects.toThrow('durable payout release decision');
  });
  it('bounds the sweep to three and exits early when nothing is due', async () => {
    await expect(releaseDuePayouts(4)).rejects.toThrow('between one and three');
    expect(await releaseDuePayouts(3)).toEqual({ processed: 0, released: 0, errors: 0 });
    expect(state.amounts).not.toHaveBeenCalled();
    state.due = [{ id: 11, bookingId: 7 }];
    expect(await releaseDuePayouts(3)).toEqual({ processed: 1, released: 1, errors: 0 });
  });
  it('the manager payload shows a scheduled payout with its expected time', async () => {
    state.closeout.visits = [visit('due', '2026-10-16T10:30:00.000Z')];
    expect(await readKitchenPayout(7)).toEqual({ timing: 'after_closeout', status: 'scheduled', holdReason: null,
      expectedAt: '2026-10-16T10:30:00.000Z', sentAt: null, amountCents: 10942 });
  });
});

describe('session-extension charges in payout totals', () => {
  // A paid +30 min extension: its own PaymentIntent on the same booking; kitchen share 2825 - 117 = 2708.
  const extension = (extra: Record<string, unknown> = {}) => ({ id: 12, bookingId: 7, bookingType: 'kitchen', status: 'succeeded', paymentIntentId: 'pi_ext',
    payoutTiming: 'after_closeout', transferId: null, payoutReleasedAt: null, payoutHoldReason: null, payoutEligibleAt: null,
    amount: '3000', baseAmount: '2825', serviceFee: '175', stripeProcessingFee: '117',
    metadata: { type: 'session_extension', sessionExtensionId: 5, approvedSubtotal: 2500, approvedTax: 325, platformCommission: 175, capturedAmount: 3000 }, ...extra });
  it('the booking payout and upcoming payouts count the parent and the extension once each', async () => {
    state.extensions = [extension()];
    state.closeout.visits = [visit('due', '2026-10-16T10:30:00.000Z')];
    expect(await readKitchenPayout(7)).toMatchObject({ status: 'scheduled', amountCents: 10942 + 2708 });
    const upcoming = await upcomingKitchenPayouts(2);
    expect(upcoming.payouts).toHaveLength(1);
    expect(upcoming.payouts[0]).toMatchObject({ bookingId: 7, amountCents: 10942 + 2708 });
    expect(upcoming.totalCents).toBe(10942 + 2708);
  });
  it('an extension still owed after the booking payout was sent is upcoming on its own; once sent, nothing is upcoming', async () => {
    state.source = { ...state.source, transferId: 'tr_7', metadata: { ...state.source.metadata, payoutSent: { sentAt: '2026-10-15T11:00:00.000Z', amountCents: 10942 } } };
    state.extensions = [extension()];
    expect(await readKitchenPayout(7)).toMatchObject({ status: 'sent', amountCents: 10942 });
    expect(await upcomingKitchenPayouts(2)).toMatchObject({ totalCents: 2708, payouts: [{ bookingId: 7, status: 'scheduled', amountCents: 2708 }] });
    state.extensions = [extension({ transferId: 'tr_ext', metadata: { ...extension().metadata, payoutSent: { amountCents: 2708 } } })];
    expect(await readKitchenPayout(7)).toMatchObject({ status: 'sent', amountCents: 10942 + 2708 });
    expect(await upcomingKitchenPayouts(2)).toEqual({ totalCents: 0, payouts: [] });
  });
  it('counts all 21 adjustment sources for one booking', async () => {
    state.extensions = Array.from({ length: 21 }, (_, index) => extension({ id: 20 + index, paymentIntentId: `pi_adjustment_${index}` }));
    const each = 2708;
    expect(await readKitchenPayout(7)).toMatchObject({ amountCents: 10942 + 21 * each });
    expect(await upcomingKitchenPayouts(2)).toMatchObject({ totalCents: 10942 + 21 * each });
  });
});
