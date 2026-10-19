import { describe, expect, it, vi } from 'vitest';
import { chargeKind, readAdditionalCharges, toAdditionalCharges } from './booking-additional-charges';

const row = (extra: Record<string, unknown> = {}) => ({ id: 1, amount: '1438', managerRevenue: '1250', baseAmount: '1250', serviceFee: '188', refundAmount: '0', status: 'succeeded',
  paidAt: new Date('2026-10-14T23:00:00Z'), paymentIntentId: 'pi_ext', metadata: { type: 'session_extension', sessionExtensionId: 7, extensionKind: 'extend', minutes: 30 }, ...extra }) as any;

describe('booking additional charges', () => {
  it('classifies extensions, extra time and claims; ignores everything else', () => {
    expect(chargeKind({ type: 'session_extension', sessionExtensionId: 1, extensionKind: 'extend' })).toBe('extension');
    expect(chargeKind({ sessionExtensionId: 1, extensionKind: 'extra_time' })).toBe('extra_time');
    expect(chargeKind({ type: 'damage_claim', damage_claim_id: '9' })).toBe('damage_claim');
    expect(chargeKind({ kitchenChangeId: 'change-3' })).toBe('kitchen_change');
    expect(chargeKind(null)).toBeNull();
  });
  it('chef sees what they paid, never the kitchen share', () => {
    const [line] = toAdditionalCharges([row()], 'chef');
    expect(line).toEqual({ id: 1, kind: 'extension', minutes: 30, amountCents: 1438, refundedCents: 0, subtotalCents: 1250, taxCents: 0, serviceFeeCents: 188,
      paidAt: '2026-10-14T23:00:00.000Z', status: 'succeeded' });
    for (const hidden of ['kitchenShareCents', 'cardFeeCents', 'refundShareCents']) expect(line).not.toHaveProperty(hidden);
  });
  it('manager: a booking change splits into before-tax, tax and service fee; card fee and the kitchen share of its refunds (Oct 19 statement)', () => {
    const [line] = toAdditionalCharges([row({ id: 198, amount: '3050', baseAmount: '2875', taxAmount: '375', serviceFee: '175', stripeProcessingFee: '143',
      managerRevenue: '2732', refundAmount: '2907', status: 'refunded', metadata: { kitchenChangeId: 'c1', refunds: [{ id: 're_1', customerReceived: 2907, managerDebited: 2732, platformServiceFeeReturned: 175 }] } })], 'manager');
    expect(line).toMatchObject({ kind: 'kitchen_change', subtotalCents: 2500, taxCents: 375, serviceFeeCents: 175, cardFeeCents: 143, refundShareCents: 2732, refundedCents: 2907 });
  });
  it('manager also gets the kitchen share; a Local Cooks-funded claim row is not kitchen money', () => {
    const lines = toAdditionalCharges([row(),
      row({ id: 2, amount: '9000', managerRevenue: '9000', paymentIntentId: 'pi_claim', metadata: { type: 'damage_claim', damage_claim_id: '9', fundedBy: 'chef' } }),
      row({ id: 3, amount: '4500', managerRevenue: '0', paymentIntentId: 'pi_claim2', metadata: { type: 'damage_claim', damage_claim_id: '10', fundedBy: 'local_cooks', platformRecovery: true } })], 'manager');
    expect(lines.map(line => [line.kind, line.amountCents, line.kitchenShareCents, line.minutes])).toEqual([
      ['extension', 1438, 1250, 30], ['damage_claim', 9000, 9000, null], ['damage_claim', 4500, 0, null]]);
  });
  it('kitchen share of an extension is net of its own processing fee; claims carry none (live #166: $14.38 − $0.86)', () => {
    const lines = toAdditionalCharges([row({ amount: '1526', managerRevenue: '1438', baseAmount: '1438', serviceFee: '88', stripeProcessingFee: '86' }),
      row({ id: 2, amount: '9000', managerRevenue: '9000', stripeProcessingFee: '291', paymentIntentId: 'pi_claim', metadata: { type: 'damage_claim', damage_claim_id: '9' } })], 'manager');
    expect(lines.map(line => line.kitchenShareCents)).toEqual([1352, 9000]);
  });
  it('after the transfer the share is what was sent, not reduced again (live #175: net $13.52 stored, fee $0.86)', () => {
    const sent = row({ amount: '1526', managerRevenue: '1352', baseAmount: '1438', serviceFee: '88', stripeProcessingFee: '86', transferId: 'tr_x',
      payoutTiming: 'after_closeout', metadata: { type: 'session_extension', sessionExtensionId: 7, extensionKind: 'offer', minutes: 30,
        payoutSent: { sentAt: '2026-10-15T18:32:17.022Z', amountCents: 1352 } } });
    expect(toAdditionalCharges([sent], 'manager')[0].kitchenShareCents).toBe(1352);
    const synced = row({ amount: '1526', managerRevenue: '1352', baseAmount: '1438', serviceFee: '88', stripeProcessingFee: '86' });
    expect(toAdditionalCharges([synced], 'manager')[0].kitchenShareCents).toBe(1352);
  });
  it('leaves out the parent charge, unpaid rows and unrelated rows; keeps refunds visible', () => {
    expect(toAdditionalCharges([row({ paymentIntentId: 'pi_parent' })], 'chef', 'pi_parent')).toEqual([]);
    expect(toAdditionalCharges([row({ status: 'pending' }), row({ status: 'failed' })], 'chef')).toEqual([]);
    expect(toAdditionalCharges([row({ metadata: { unrelated: 4 } })], 'chef')).toEqual([]);
    expect(toAdditionalCharges([row({ status: 'partially_refunded', refundAmount: '500' })], 'chef')[0]).toMatchObject({ refundedCents: 500, status: 'partially_refunded' });
  });
  it('reads only this booking, kitchen rows, paid statuses (read-only select)', async () => {
    const chain: any = {};
    chain.select = vi.fn(() => chain); chain.from = vi.fn(() => chain); chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(async () => [row(), row({ id: 2, paymentIntentId: 'pi_parent' })]);
    chain.insert = vi.fn(); chain.update = vi.fn(); chain.delete = vi.fn();
    const lines = await readAdditionalCharges(chain, 159, 'manager', 'pi_parent');
    expect(lines.map(line => line.id)).toEqual([1]);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.insert).not.toHaveBeenCalled(); expect(chain.update).not.toHaveBeenCalled(); expect(chain.delete).not.toHaveBeenCalled();
  });
  it('counts captured booking changes and their refunds; kitchen shares deduct only the kitchen refund', () => {
    const change = row({ id: 197, amount: '3050', baseAmount: '2875', serviceFee: '175', stripeProcessingFee: '118',
      managerRevenue: '2875', paymentIntentId: 'pi_change', status: 'partially_refunded', refundAmount: '500',
      metadata: { kitchenChangeId: 'change-197', refunds: [{ managerDebited: 450, platformServiceFeeReturned: 50 }] } });
    expect(toAdditionalCharges([change], 'chef')[0]).toMatchObject({ kind: 'kitchen_change', minutes: null, amountCents: 3050, refundedCents: 500 });
    expect(toAdditionalCharges([change], 'chef')[0]).not.toHaveProperty('kitchenShareCents');
    expect(toAdditionalCharges([change], 'manager')[0].kitchenShareCents).toBe(2307);
    expect(toAdditionalCharges([row({ ...change, status: 'authorized' })], 'chef')).toEqual([]);
    expect(toAdditionalCharges([change], 'chef', 'pi_change')).toEqual([]);
  });
});
