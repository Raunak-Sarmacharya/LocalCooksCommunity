import { describe, expect, it, vi } from 'vitest';
import { chargeKind, readAdditionalCharges, toAdditionalCharges } from './booking-additional-charges';

const row = (extra: Record<string, unknown> = {}) => ({ id: 1, amount: '1438', managerRevenue: '1250', refundAmount: '0', status: 'succeeded',
  paidAt: new Date('2026-10-14T23:00:00Z'), paymentIntentId: 'pi_ext', metadata: { type: 'session_extension', sessionExtensionId: 7, extensionKind: 'extend', minutes: 30 }, ...extra }) as any;

describe('booking additional charges', () => {
  it('classifies extensions, extra time and claims; ignores everything else', () => {
    expect(chargeKind({ type: 'session_extension', sessionExtensionId: 1, extensionKind: 'extend' })).toBe('extension');
    expect(chargeKind({ sessionExtensionId: 1, extensionKind: 'extra_time' })).toBe('extra_time');
    expect(chargeKind({ type: 'damage_claim', damage_claim_id: '9' })).toBe('damage_claim');
    expect(chargeKind({ kitchenChangeId: 3 })).toBeNull();
    expect(chargeKind(null)).toBeNull();
  });
  it('chef sees what they paid, never the kitchen share', () => {
    const [line] = toAdditionalCharges([row()], 'chef');
    expect(line).toEqual({ id: 1, kind: 'extension', minutes: 30, amountCents: 1438, refundedCents: 0, paidAt: '2026-10-14T23:00:00.000Z', status: 'succeeded' });
    expect(line).not.toHaveProperty('kitchenShareCents');
  });
  it('manager also gets the kitchen share; a Local Cooks-funded claim row is not kitchen money', () => {
    const lines = toAdditionalCharges([row(),
      row({ id: 2, amount: '9000', managerRevenue: '9000', paymentIntentId: 'pi_claim', metadata: { type: 'damage_claim', damage_claim_id: '9', fundedBy: 'chef' } }),
      row({ id: 3, amount: '4500', managerRevenue: '0', paymentIntentId: 'pi_claim2', metadata: { type: 'damage_claim', damage_claim_id: '10', fundedBy: 'local_cooks', platformRecovery: true } })], 'manager');
    expect(lines.map(line => [line.kind, line.amountCents, line.kitchenShareCents, line.minutes])).toEqual([
      ['extension', 1438, 1250, 30], ['damage_claim', 9000, 9000, null], ['damage_claim', 4500, 0, null]]);
  });
  it('leaves out the parent charge, unpaid rows and unrelated rows; keeps refunds visible', () => {
    expect(toAdditionalCharges([row({ paymentIntentId: 'pi_parent' })], 'chef', 'pi_parent')).toEqual([]);
    expect(toAdditionalCharges([row({ status: 'pending' }), row({ status: 'failed' })], 'chef')).toEqual([]);
    expect(toAdditionalCharges([row({ metadata: { kitchenChangeId: 4 } })], 'chef')).toEqual([]);
    expect(toAdditionalCharges([row({ status: 'partially_refunded', refundAmount: '500' })], 'chef')[0]).toMatchObject({ refundedCents: 500, status: 'partially_refunded' });
  });
  it('reads only this booking, kitchen rows, paid statuses (read-only select)', async () => {
    const chain: any = {};
    chain.select = vi.fn(() => chain); chain.from = vi.fn(() => chain); chain.where = vi.fn(() => chain); chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(async () => [row(), row({ id: 2, paymentIntentId: 'pi_parent' })]);
    chain.insert = vi.fn(); chain.update = vi.fn(); chain.delete = vi.fn();
    const lines = await readAdditionalCharges(chain, 159, 'manager', 'pi_parent');
    expect(lines.map(line => line.id)).toEqual([1]);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.insert).not.toHaveBeenCalled(); expect(chain.update).not.toHaveBeenCalled(); expect(chain.delete).not.toHaveBeenCalled();
  });
});
