import { describe, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: vi.fn() }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: vi.fn() }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
import { extensionPayoutDecision, isSessionExtensionSource } from './session-extension-payout';
import { isCancellationReservationSource } from '@shared/cancellation-refund';

const source = (extra: Record<string, unknown> = {}) => ({ payoutTiming: 'after_closeout', transferId: null, payoutReleasedAt: null, status: 'succeeded', ...extra }) as any;
const parent = (extra: Record<string, unknown> = {}) => ({ payoutTiming: 'after_closeout', transferId: null, payoutReleasedAt: null, payoutHoldReason: null, ...extra }) as any;

describe('extra-time payout follows the parent booking', () => {
  it('waits while the booking payout is deferred until closeout', () => {
    expect(extensionPayoutDecision(source(), parent())).toBe('wait_for_parent');
    expect(extensionPayoutDecision(source(), parent({ payoutReleasedAt: new Date(), payoutHoldReason: 'support_flag' }))).toBe('wait_for_parent');
  });
  it('is released together once the parent was released, or at once if it already went out', () => {
    expect(extensionPayoutDecision(source(), parent({ payoutReleasedAt: new Date() }))).toBe('release');
    expect(extensionPayoutDecision(source(), parent({ transferId: 'tr_parent' }))).toBe('release');
  });
  it('legacy at-capture timing transfers like any separate charge; sent and uncaptured are no-ops', () => {
    expect(extensionPayoutDecision(source({ payoutTiming: 'at_capture' }), parent({ payoutTiming: 'at_capture' }))).toBe('transfer');
    expect(extensionPayoutDecision(source({ transferId: 'tr_1' }), parent())).toBe('sent');
    expect(extensionPayoutDecision(source({ status: 'pending' }), parent())).toBe('not_captured');
    expect(extensionPayoutDecision(source(), undefined)).toBe('parent_missing');
  });
  it('identifies extension sources and keeps them out of cancellation refunds (non-refundable)', () => {
    const metadata = { type: 'session_extension', sessionExtensionId: 4 };
    expect(isSessionExtensionSource({ metadata })).toBe(true);
    expect(isSessionExtensionSource({ metadata: {} })).toBe(false);
    expect(isCancellationReservationSource({ paymentIntentId: 'pi_ext', metadata }, ['pi_parent'], [], 'pi_parent')).toBe(false);
  });
});
