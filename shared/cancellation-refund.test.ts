import { describe, expect, it } from 'vitest';
import { cancellationSourceQuote, isCancellationReservationSource, verifiedReservedRefund } from './cancellation-refund';
const base = { captured: 12200, processingCost: 384, serviceFee: 700, refunded: 0, refunds: [] };
const receipt = (id: string, manager: number, platform: number) => ({ id, status: 'succeeded', amount: manager + platform,
  metadata: { customer_receives: String(manager + platform), manager_debited: String(manager), platform_service_fee_returned: String(platform) } });
describe('captured cancellation allocation', () => {
  it('keeps goodwill funded by Local Cooks without consuming the manager share or service fee', () => {
    const goodwill = { id: 're_goodwill', status: 'succeeded', amount: 1000,
      metadata: { customer_receives: '1000', manager_debited: '0', platform_service_fee_returned: '0', platform_goodwill_cents: '1000' } };
    expect(cancellationSourceQuote({ ...base, refunded: 1000, refunds: [goodwill] })).toMatchObject({ managerRefund: 11116, serviceFeeReview: 700, alreadyRefunded: 1000 });
  });
  it('records the Local Cooks processing cost for a full kitchen-caused refund', () => {
    const full = { id: 're_full', status: 'succeeded', amount: 12200,
      metadata: { customer_receives: '12200', manager_debited: '11116', platform_service_fee_returned: '700', platform_processing_cost_cents: '384' } };
    expect(cancellationSourceQuote({ ...base, refunded: 12200, refunds: [full] })).toMatchObject({ managerRefund: 0, serviceFeeReview: 0, alreadyRefunded: 12200 });
  });
  it('retains actual processing cost and separates manager authority from platform fees', () => {
    const quote = cancellationSourceQuote(base);
    expect(quote.managerRefund).toBe(11116); expect(quote.serviceFeeReview).toBe(700);
    expect(quote.managerRefund + quote.serviceFeeReview).toBe(11816);
  });
  it('supports manager refund followed by only admin service-fee return', () => {
    const manager = receipt('re_manager', 11116, 0);
    expect(cancellationSourceQuote({ ...base, refunded: 11116, refunds: [manager] })).toMatchObject({ managerRefund: 0, serviceFeeReview: 700 });
    expect(cancellationSourceQuote({ ...base, refunded: 11816, refunds: [manager, receipt('re_admin', 0, 700)] })).toMatchObject({ managerRefund: 0, serviceFeeReview: 0 });
  });
  it('recovers prior partial component receipts from verified provider metadata after aggregate webhook', () => {
    expect(cancellationSourceQuote({ ...base, refunded: 2300, refunds: [receipt('re_prior', 2300, 0)] })).toMatchObject({ managerRefund: 8816, serviceFeeReview: 700 });
  });
  it('keeps verified used component payments retained rather than prorating use', () => {
    expect(cancellationSourceQuote({ ...base, retainedUsedAddonCents: 2000 }).managerRefund).toBe(9116);
  });
  it.each(['pending', 'failed', 'requires_action', 'canceled'])('does not certify or spend a source with a %s refund', status => {
    expect(() => cancellationSourceQuote({ ...base, refunds: [{ ...receipt('re_prior', 2300, 0), status }] })).toThrow('reconcile');
  });
  it('rejects aggregate-only history instead of guessing manager debits', () => {
    expect(() => cancellationSourceQuote({ ...base, refunded: 2300, refunds: [{ id: 're_unknown', amount: 2300, status: 'succeeded', metadata: {} }] })).toThrow('unverified');
  });
  it('rejects mismatched local and provider allocations', () => {
    expect(() => cancellationSourceQuote({ ...base, refunded: 2300, refunds: [receipt('re_prior', 2300, 0)],
      localReceipts: [{ id: 're_prior', customerReceived: 2300, managerDebited: 1600, platformServiceFeeReturned: 700 }] })).toThrow('disagree');
  });
  it.each(['damage_claim', 'overstay_penalty'])('excludes %s even if it shares the booking identity', type => {
    expect(isCancellationReservationSource({ paymentIntentId: 'pi_original', metadata: { type } }, ['pi_original'], [], 'pi_original')).toBe(false);
  });
  it('includes original, extension and recorded adjustment sources; ambiguous legacy requires review', () => {
    expect(isCancellationReservationSource({ paymentIntentId: 'pi_extension', metadata: {} }, ['pi_original'], ['pi_extension'], 'pi_original')).toBe(true);
    expect(isCancellationReservationSource({ paymentIntentId: 'pi_change', metadata: { kitchenChangeId: 'old', originalBookingPaymentIntentId: 'pi_original' } }, ['pi_original'], [], 'pi_original')).toBe(true);
    expect(() => isCancellationReservationSource({ paymentIntentId: 'pi_unknown', metadata: {} }, ['pi_original'], [], 'pi_original')).toThrow('Ambiguous');
  });
});

describe('reserved refund receipt evidence', () => {
  const source = { id: 8, paymentIntentId: 'pi_one', currency: 'CAD', amount: '10000' };
  const operation = { id: 'chef-addon-original', intentId: 'pi_one', customerRefund: 2055, managerRefund: 1933, platformRefund: 122 };
  const matching = { id: 're_one', amount: 2055, status: 'succeeded', currency: 'cad', charge: 'ch_one', payment_intent: 'pi_one', metadata: {
    refund_operation_id: operation.id, transaction_id: '8', customer_receives: '2055', manager_debited: '1933', platform_service_fee_returned: '122' } };
  const facts = { captured: 10000, currency: 'cad', chargeId: 'ch_one', refunds: [matching] };
  it('accepts exactly one successful receipt matching identity, source, amount, currency and allocations', () => {
    expect(verifiedReservedRefund(source, operation, facts)).toBe(matching);
  });
  it('accepts one successful retry after a failed attempt under the same reservation', () => {
    expect(verifiedReservedRefund(source, operation, { ...facts, refunds: [{ ...matching, id: 're_failed', status: 'failed' }, matching] })).toBe(matching);
  });
  it.each([
    { name: 'missing', refunds: [] },
    { name: 'pending', refunds: [{ ...matching, status: 'pending' }] },
    { name: 'wrong amount', refunds: [{ ...matching, amount: 2054 }] },
    { name: 'wrong source', refunds: [{ ...matching, payment_intent: 'pi_other' }] },
    { name: 'conflicting', refunds: [matching, { ...matching, id: 're_two' }] },
  ])('rejects $name evidence', ({ refunds }) => {
    expect(() => verifiedReservedRefund(source, operation, { ...facts, refunds })).toThrow();
  });
});
