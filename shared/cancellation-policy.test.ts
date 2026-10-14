import { describe, expect, it } from 'vitest';
import { additionalCancellationRefund, allocateCents, cancellationTiers, legacyCancellationSnapshot, quoteCancellation, type CancellationInput, type CancellationPolicySnapshot } from './cancellation-policy';
const snapshot: CancellationPolicySnapshot = { policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 50, tiers: cancellationTiers(24, 50), timezone: 'America/St_Johns',
  sessions: [{ startAt: '2026-11-01T12:00:00Z' }], disclosureVersion: 'food-corridor-v1', acceptedAt: '2026-10-30T12:00:00Z' };
const input: CancellationInput = { cancelAt: '2026-10-31T12:00:00Z', confirmedAt: '2026-10-30T12:00:00Z', capturedCents: 12305, processingFeeCents: 387,
  cause: 'chef', components: [{ id: 'kitchen:1', kind: 'kitchen', sessionIndex: 0, kitchenCents: 11500, platformCents: 805 }] };
const quote = (patch: Partial<CancellationInput> = {}, policy = snapshot) => { const result = quoteCancellation(policy, { ...input, ...patch }); if (!result.quoteReady) throw Error('Not ready'); return result; };
describe('frozen Food Corridor cancellation policy', () => {
  it('caps manager extra awards below the actual fee, funds platform share proportionally and protects used storage', () => {
    const source = { capturedCents: 12305, feeCents: 387, platformCents: 805, alreadyRefundedCents: 0, kitchenDebitedCents: 0, platformReturnedCents: 0, additionalCents: 3000 };
    expect(additionalCancellationRefund(source)).toEqual({ customerCents: 3000, kitchenCents: 2797, platformCents: 203 });
    expect(() => additionalCancellationRefund({ ...source, additionalCents: 11919 })).toThrow('exceeds');
    expect(() => additionalCancellationRefund({ ...source, additionalCents: 10000, usedStorageKitchenCents: 4000 })).toThrow('exceeds');
  });
  it.each([24, 48, 72])('derives only the two allowed knobs (%i hours)', notice => {
    for (const charge of [50, 100]) expect(cancellationTiers(notice, charge)).toEqual([{ minHoursBeforeStart: notice, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 100 - charge }]);
  });
  it.each([[0, 50], [25, 100], [24, 0], [72, 75], [NaN, 100]])('rejects unsupported %s/%s', (notice, charge) => expect(() => cancellationTiers(notice, charge)).toThrow());
  it('includes the exact threshold, using elapsed hours across Newfoundland DST', () => {
    expect(quote()).toMatchObject({ chefRefundCents: 11918, kitchenRefundCents: 11113, platformRefundCents: 805, feeRetainedCents: 387 });
    expect(quote({ cancelAt: '2026-10-31T12:00:00.001Z' })).toMatchObject({ chefRefundCents: 5959, kitchenRefundCents: 5557, platformRefundCents: 402 });
  });
  it('allows short notice without a grace period', () => expect(quote({ confirmedAt: '2026-11-01T10:00:00Z', cancelAt: '2026-11-01T10:01:00Z' }).refundPercent).toBe(50));
  it.each(['2026-11-01T12:00:00Z', '2026-11-02T12:00:00Z'])('at/after start %s is no-show treatment', cancelAt => expect(quote({ cancelAt }).chefRefundCents).toBe(0));
  it('no-show retains all even when called before start', () => expect(quote({ cause: 'no_show' }).chefRefundCents).toBe(0));
  it.each(['kitchen', 'support_exception'] as const)('fully refunds a %s remedy including fee', cause => expect(quote({ cause, cancelAt: '2026-11-02T12:00:00Z' })).toMatchObject({ chefRefundCents: 12305, feeRetainedCents: 0, kitchenRefundCents: 11113, platformRefundCents: 1192 }));
  it('releases uncaptured holds without charging fees', () => expect(quote({ capturedCents: 0, processingFeeCents: 0, components: [], confirmedAt: null }).reasonCode).toBe('hold_release'));
  it('never estimates an unknown processing fee', () => expect(quoteCancellation(snapshot, { ...input, processingFeeCents: null })).toEqual({ quoteReady: false, reasonCode: 'processing_fee_pending' }));
  it('deducts prior verified kitchen/platform refunds exactly once', () => expect(quote({ alreadyRefundedCents: 5959, alreadyKitchenRefundedCents: 5557, alreadyPlatformRefundedCents: 402 })).toMatchObject({ chefRefundCents: 5959, kitchenRefundCents: 5556, platformRefundCents: 403 }));
  it('does not claw back earlier goodwill exceeding the policy', () => expect(quote({ cancelAt: '2026-10-31T12:00:01Z', alreadyRefundedCents: 6000, alreadyKitchenRefundedCents: 5600, alreadyPlatformRefundedCents: 400 }).chefRefundCents).toBe(0));
  it('omits fee explanation for zero fees and reconciles zero platform service fee', () => expect(quote({ capturedCents: 11500, processingFeeCents: 0, components: [{ ...input.components[0], platformCents: 0 }] })).toMatchObject({ chefRefundCents: 11500, platformRefundCents: 0, explanationKeys: ['frozen_policy'] }));
  it('evaluates each session, linked add-ons and used storage separately', () => {
    const result = quote({ capturedCents: 10000, processingFeeCents: 0, cancelAt: '2026-11-01T12:00:00Z', startedComponents: ['storage:1'], components: [
      { id: 'first', kind: 'kitchen', kitchenCents: 2000, platformCents: 0, sessionIndex: 0 },
      { id: 'second', kind: 'kitchen', kitchenCents: 4000, platformCents: 0, sessionIndex: 1 },
      { id: 'equipment:1', kind: 'equipment', kitchenCents: 2000, platformCents: 0, sessionIndex: 1 },
      { id: 'storage:1', kind: 'storage', kitchenCents: 2000, platformCents: 0, sessionIndex: 1 },
    ] }, { ...snapshot, sessions: [...snapshot.sessions, { startAt: '2026-11-03T12:00:00Z' }] });
    expect(result.chefRefundCents).toBe(6000); expect(result.perComponent.map(item => item.refundPercent)).toEqual([0, 100, 100, 0]);
  });
  it('keeps original snapshot despite a later policy edit', () => { cancellationTiers(72, 100); expect(quote({ cancelAt: '2026-10-31T12:00:01Z' }).refundPercent).toBe(50); });
  it('uses legacy saved hours without imposing new terms', () => expect(quote({}, legacyCancellationSnapshot(48, snapshot.timezone, snapshot.sessions))).toMatchObject({ chefRefundCents: 0, explanationKeys: ['original_terms', 'processing_fee_kept'] }));
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid money %s', capturedCents => expect(() => quote({ capturedCents })).toThrow());
  it('rejects inconsistent totals, fee, session, IDs, refunds and malformed tiers', () => {
    for (const patch of [{ processingFeeCents: 12000 }, { alreadyRefundedCents: 12306 }, { components: [{ ...input.components[0], sessionIndex: 1 }] }, { components: [...input.components, ...input.components] }]) expect(() => quote(patch)).toThrow();
    expect(() => quote({}, { ...snapshot, tiers: [{ minHoursBeforeStart: 24, refundPercent: 101 }] })).toThrow();
  });
  it('allocates cents deterministically and conserves all money', () => {
    expect(allocateCents(1, [1, 1, 1])).toEqual([1, 0, 0]);
    for (let amount = 1; amount < 500; amount++) {
      const result = quote({ capturedCents: amount + 3, processingFeeCents: 1, components: [{ ...input.components[0], kitchenCents: amount, platformCents: 3 }], cancelAt: '2026-10-31T12:00:01Z' });
      expect(result.chefRefundCents + result.retainedCents).toBe(amount + 3);
      expect(result.kitchenRefundCents + result.platformRefundCents).toBe(result.chefRefundCents);
    }
  });
  it('does not increase a refund by splitting one charge into tiny add-ons', () => {
    const result = quote({ cancelAt: '2026-10-31T12:00:00.001Z', capturedCents: 2, processingFeeCents: 0, components: [
      { ...input.components[0], id: 'a', kitchenCents: 1, platformCents: 0 }, { ...input.components[0], id: 'b', kind: 'equipment', kitchenCents: 1, platformCents: 0 },
    ] });
    expect(result.chefRefundCents).toBe(1); expect(result.perComponent.map(item => item.refundCents)).toEqual([1, 0]);
  });
});
