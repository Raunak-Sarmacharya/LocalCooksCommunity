import { describe, expect, it } from 'vitest';
import { approvedClaimAmount, claimBookingHeld, claimFilingWindow, claimNeedsEscalation, claimResponseDeadline,
  claimSupportInput, claimKitchenAccounting, validateClaimLines } from './damage-claims';

const end = new Date('2026-10-10T18:00:00Z');
const line = { type: 'damage', description: 'Replace cracked tray', amountCents: 25000,
  document: { fileUrl: 'https://example.invalid/quote.pdf', fileName: 'quote.pdf' } };
describe('damage and cleaning rules', () => {
  it('reports full kitchen income, no income for a platform repayment, and retains income after a platform-funded withdrawal refund', () => {
    expect(claimKitchenAccounting({ damage_claim_v2: 'true' }, 2000, 0)).toMatchObject({ managerRevenueCents: 2000, managerRefundCents: 0 });
    expect(claimKitchenAccounting({ damage_claim_v2: 'true', platformRecovery: true }, 0, 0)?.managerRevenueCents).toBe(0);
    expect(claimKitchenAccounting({ damage_claim_v2: 'true', kitchenRetainsTransfer: true }, 2000, 2000)).toEqual({ managerRevenueCents: 2000, managerRefundCents: 0, retainRevenueAfterRefund: true });
    expect(claimKitchenAccounting({ type: 'kitchen_booking' }, 2000, 0)).toBeNull();
  });
  it('uses actual departure and includes the exact 72-hour deadline', () => {
    const actual = new Date('2026-10-10T17:00:00Z');
    expect(claimFilingWindow(end, actual, new Date('2026-10-13T17:00:00Z')).allowed).toBe(true);
    expect(claimFilingWindow(end, actual, new Date('2026-10-13T17:00:00.001Z')).allowed).toBe(false);
    expect(claimFilingWindow(end, null, new Date('2026-10-10T17:59:59Z')).allowed).toBe(false);
    expect(claimFilingWindow(end, null, new Date('2026-10-13T18:00:00Z')).allowed).toBe(true);
  });
  it('requires an uploaded cost document on every valid line and caps the total', () => {
    expect(validateClaimLines([line])).toHaveLength(1);
    for (const lines of [[], [{ ...line, document: undefined }], [{ ...line, type: 'fine' }],
      [{ ...line, type: 'lost_revenue' }], [{ ...line, amountCents: 1.5 }], [{ ...line, amountCents: 0 }],
      [line, { ...line, amountCents: 1 }]]) expect(() => validateClaimLines(lines)).toThrow();
  });
  it('escalates at 72 hours and never escalates an already decided claim', () => {
    const due = claimResponseDeadline(end);
    expect(due.toISOString()).toBe('2026-10-13T18:00:00.000Z');
    expect(claimNeedsEscalation('submitted', due, new Date(due.getTime() - 1))).toBe(false);
    expect(claimNeedsEscalation('submitted', due, due)).toBe(true);
    expect(claimNeedsEscalation('approved', due, due)).toBe(false);
  });
  it('holds only unpaid upheld claims after seven days and lifts for every resolution', () => {
    const claim = { status: 'approved', upheldAt: end, chefOwes: true };
    const due = new Date('2026-10-17T18:00:00Z');
    expect(claimBookingHeld(claim, new Date(due.getTime() - 1))).toBe(false);
    expect(claimBookingHeld(claim, due)).toBe(true);
    for (const patch of [{ chefOwes: false }, { resolvedAt: due }, { holdReleasedAt: due }, { chargeSucceededAt: due },
      { status: 'rejected' }, { status: 'resolved' }, { upheldAt: null }]) expect(claimBookingHeld({ ...claim, ...patch }, due)).toBe(false);
  });
  it('prevents increased awards and requires compensation debt choice plus public/private reasons', () => {
    expect(approvedClaimAmount(20000, 10000)).toBe(10000);
    for (const amount of [0, -1, 20001, 1.1]) expect(() => approvedClaimAmount(20000, amount)).toThrow();
    const action = { type: 'claim_compensate', claimId: 1, amountCents: 1000, reasonCode: 'evidence',
      note: 'Internal evidence reviewed', publicMessage: 'We reviewed both statements.', requestSource: 'proactive', operationKey: 'claim:compensate:1' };
    expect(claimSupportInput.safeParse(action).success).toBe(false);
    expect(claimSupportInput.safeParse({ ...action, chefStillOwes: false }).success).toBe(true);
  });
});
