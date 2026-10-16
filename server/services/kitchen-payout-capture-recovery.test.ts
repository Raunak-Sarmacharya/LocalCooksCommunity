import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({ row: null as any, raw: [] as Array<{ sql: string; params: unknown[] }>, saved: [] as any[], queue: vi.fn(), amounts: vi.fn(), transfer: vi.fn() }));
vi.mock('../db', () => {
  const tx: any = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: async () => [h.row], then: (r: any) => r([{ id: 10, referenceCode: 'KB-ABC123' }]) }) }) }) }),
    update: () => ({ set: (values: any) => ({ where: async () => { h.saved.push(values); h.row = { ...h.row, ...values }; } }) }),
  };
  const db: any = { ...tx, execute: async (q: any) => { h.raw.push(new PgDialect().sqlToQuery(q)); return { rows: [] }; }, transaction: async (run: any) => run(tx) };
  return { db };
});
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.queue }));
vi.mock('./stripe-service', () => ({ getStripePaymentAmounts: h.amounts }));
vi.mock('./stripe-transfer-service', () => ({ transferToManagerForBooking: h.transfer }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({}), projectBookingCloseouts: async (items: any[]) => items }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: async () => undefined }));
vi.mock('./worker-context', () => ({ workerAfter: () => undefined, workerRecord: async () => undefined, workerPageEnd: async () => undefined, isWorkerBudgetError: () => false }));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { recoverCaptureTransfer } from './kitchen-payout-service';

const base = () => ({ id: 77, bookingId: 10, paymentIntentId: 'pi_cap', managerId: 4, metadata: {}, managerRevenue: '9680', transferId: null, payoutTiming: null });
beforeEach(() => {
  h.row = base(); h.raw.length = 0; h.saved.length = 0; h.queue.mockReset(); h.transfer.mockReset();
  h.amounts.mockReset().mockResolvedValue({ chargeId: 'ch_1', stripeAmount: 10000, stripeProcessingFee: 320 });
});

describe('legacy capture-time kitchen transfers that never went out', () => {
  it('retries the original transfer and records it once it is sent', async () => {
    h.transfer.mockResolvedValue({ transferred: true, transferId: 'tr_1', transferredCents: 9680 });
    expect(await recoverCaptureTransfer(h.row)).toBe('sent');
    expect(h.transfer).toHaveBeenCalledWith(expect.objectContaining({ paymentTransactionId: 77, paymentIntentId: 'pi_cap', transferGroup: 'pi_pi_cap' }));
    expect(h.raw[0].sql).toContain("- 'transferRecovery'");
    expect(h.raw[0].params.join('')).toContain('tr_1');
    expect(h.queue).not.toHaveBeenCalled();
  });

  it('a kitchen without a Connect account sees the amount owed, the problem and where to fix it; Local Cooks is told once', async () => {
    h.transfer.mockResolvedValue({ transferred: false, transferredCents: 9680, reason: 'Manager has no Stripe Connect account — funds remain on platform balance' });
    expect(await recoverCaptureTransfer(h.row)).toBe('blocked');
    expect(h.saved[0].metadata.transferRecovery).toMatchObject({ state: 'needs_setup', amountCents: 9680, attempts: 1 });
    const [kitchen, admin] = h.queue.mock.calls;
    expect(kitchen[3]).toBe('Finish payment setup to receive your payout');
    expect(kitchen[4]).toMatch(/\$96\.80 for KB-ABC123.*Payment settings.*Contact Local Cooks/);
    expect(kitchen[6]).toMatchObject({ recipientPolicy: 'manager' });
    expect(admin[6]).toMatchObject({ recipientPolicy: 'admins', supportCase: true });
  });

  it('does not repeat the same notice on the next try, and counts attempts', async () => {
    h.transfer.mockResolvedValue({ transferred: false, transferredCents: 9680, reason: 'Manager has no Stripe Connect account — funds remain on platform balance' });
    await recoverCaptureTransfer(h.row);
    h.queue.mockClear();
    await recoverCaptureTransfer(h.row);
    expect(h.queue).not.toHaveBeenCalled();
    expect(h.row.metadata.transferRecovery.attempts).toBe(2);
  });

  it('a provider failure is recorded with its message, never retried under a different key', async () => {
    h.transfer.mockRejectedValue(new Error('Stripe is temporarily unavailable'));
    expect(await recoverCaptureTransfer(h.row)).toBe('blocked');
    expect(h.saved[0].metadata.transferRecovery).toMatchObject({ state: 'failed', problem: 'Stripe is temporarily unavailable' });
    expect(h.queue.mock.calls[0][3]).toBe('Your payout is delayed');
  });

  it('a fee that is not available yet is a quiet wait for the kitchen, with no Local Cooks alarm', async () => {
    h.transfer.mockResolvedValue({ transferred: false, transferredCents: 9680, reason: 'Actual Stripe fee not yet available (will retry on charge.updated)' });
    await recoverCaptureTransfer(h.row);
    expect(h.saved[0].metadata.transferRecovery.state).toBe('waiting_fee');
    expect(h.queue.mock.calls.filter(call => call[6].recipientPolicy === 'admins')).toHaveLength(0);
  });

  it('normal holds (refund review, deferred payout) are neither announced nor recorded as problems', async () => {
    h.transfer.mockResolvedValue({ transferred: false, transferredCents: 0, reason: 'Original refund/reversal requires recovery before new payout' });
    expect(await recoverCaptureTransfer(h.row)).toBe('skipped');
    expect(h.queue).not.toHaveBeenCalled(); expect(h.saved).toHaveLength(0);
  });

  it('a payment that nets to nothing is marked as owing the kitchen nothing', async () => {
    h.transfer.mockResolvedValue({ transferred: false, transferredCents: 0, reason: 'Computed transfer amount (-5¢) is non-positive — fees exceed charge' });
    expect(await recoverCaptureTransfer(h.row)).toBe('skipped');
    expect(h.raw[0].sql).toContain('payoutNoEntitlement');
  });
});
