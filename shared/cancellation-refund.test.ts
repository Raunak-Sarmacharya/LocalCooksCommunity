import { describe, expect, it } from 'vitest';
import { cancellationSourceQuote, isCancellationReservationSource } from './cancellation-refund';
const base = { captured: 12200, processingCost: 384, serviceFee: 700, refunded: 0, refunds: [] };
const receipt = (id: string, manager: number, platform: number) => ({ id, status: 'succeeded', amount: manager + platform,
  metadata: { customer_receives: String(manager + platform), manager_debited: String(manager), platform_service_fee_returned: String(platform) } });
describe('captured cancellation allocation', () => {
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
