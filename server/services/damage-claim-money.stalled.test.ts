import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claim: null as any, intents: [] as any[], listError: null as Error | null, updates: [] as any[], events: vi.fn(),
}));
vi.mock('stripe', () => ({ default: class { paymentIntents = { list: () => {
  if (h.listError) throw h.listError;
  return (async function* () { for (const row of h.intents) yield row; })();
} }; } }));
vi.mock('../db', () => {
  const tx: any = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ bookingId: h.claim.kitchenBookingId }] }) }) }),
    update: () => ({ set: (values: any) => ({ where: async () => { h.updates.push(values); if (values.paymentOperation) h.claim.paymentOperation = values.paymentOperation; } }) }),
    execute: async () => ({ rows: [] }),
  };
  return { db: { transaction: async (run: any) => run(tx) } };
});
vi.mock('./damage-claims-v2', () => ({ lockClaim: async () => h.claim, claimHistory: vi.fn(), chefCanSeeClaim: () => true, DamageClaimError: class extends Error {} }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => undefined }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: async () => undefined }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.events }));
vi.mock('./worker-context', () => ({ assertWorkerTime: () => undefined, workerAfter: () => undefined, workerPageEnd: async () => undefined,
  workerRecord: async () => undefined, isWorkerBudgetError: () => false }));
import { resolveStalledClaimCreation } from './damage-claim-money';

const key = 'claim:5:pay:1';
const op = () => ({ key, state: 'pending', amountCents: 8000, customerId: 'cus_1', startedAt: '2026-09-01T10:00:00.000Z', attemptedAt: '2026-09-01T10:00:00.000Z' });
const intent = (patch: any = {}) => ({ id: 'pi_found', amount: 8000, currency: 'cad', customer: 'cus_1', status: 'requires_payment_method',
  metadata: { claim_operation_key: key, damage_claim_id: '5', chef_id: '3', booking_id: '10' }, ...patch });

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  h.claim = { id: 5, chefId: 3, managerId: 4, kitchenBookingId: 10, referenceCode: 'DC-FIX', paymentOperation: op() };
  h.intents = []; h.listError = null; h.updates = []; h.events.mockReset();
});

describe('a claim payment whose creation was never confirmed and is too old to retry', () => {
  it('attaches the one verified original found by its operation key', async () => {
    h.intents = [intent({ id: 'pi_other', metadata: { claim_operation_key: 'claim:9:pay:1' } }), intent()];
    const result = await resolveStalledClaimCreation(5, op(), h.claim);
    expect(result).toMatchObject({ kind: 'found', intent: { id: 'pi_found' } });
    expect(h.claim.paymentOperation).toMatchObject({ intentId: 'pi_found', state: 'ready', key });
  });

  it('starts a new attempt only when a complete listing shows nothing was ever created', async () => {
    h.intents = [intent({ id: 'pi_other', metadata: { claim_operation_key: 'claim:9:pay:1' } })];
    expect(await resolveStalledClaimCreation(5, op(), h.claim)).toEqual({ kind: 'reset' });
    expect(h.claim.paymentOperation).toMatchObject({ state: 'cancelled', error: expect.stringContaining('No payment was created') });
  });

  it('treats a cancelled original as never charged and resets', async () => {
    h.intents = [intent({ status: 'canceled' })];
    expect((await resolveStalledClaimCreation(5, op(), h.claim)).kind).toBe('reset');
  });

  it('never infers non-execution when the provider cannot be read: keeps it for Local Cooks, once', async () => {
    h.listError = new Error('timeout');
    const result = await resolveStalledClaimCreation(5, op(), h.claim);
    expect(result).toMatchObject({ kind: 'review', reason: expect.stringContaining('could not be reached') });
    expect(h.claim.paymentOperation).toMatchObject({ state: 'pending', error: expect.stringContaining('could not be reached') });
    expect(h.events).toHaveBeenCalledTimes(1);
    expect(h.events.mock.calls[0][6]).toMatchObject({ recipientPolicy: 'admins', supportCase: true });
    await resolveStalledClaimCreation(5, h.claim.paymentOperation, h.claim);
    expect(h.events).toHaveBeenCalledTimes(1);
  });

  it('refuses a match whose amount, customer or claim does not agree, and conflicting matches', async () => {
    h.intents = [intent({ amount: 9000 })];
    expect((await resolveStalledClaimCreation(5, op(), h.claim)).kind).toBe('review');
    h.claim.paymentOperation = op(); h.intents = [intent({ customer: 'cus_other' })];
    expect((await resolveStalledClaimCreation(5, op(), h.claim)).kind).toBe('review');
    h.claim.paymentOperation = op(); h.intents = [intent(), intent({ id: 'pi_two' })];
    expect(await resolveStalledClaimCreation(5, op(), h.claim)).toMatchObject({ kind: 'review', reason: expect.stringContaining('More than one') });
    expect(h.claim.paymentOperation.intentId).toBeUndefined();
  });
});
