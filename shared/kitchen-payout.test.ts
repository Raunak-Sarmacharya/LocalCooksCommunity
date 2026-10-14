import { describe, expect, it } from 'vitest';
import { extensionPayoutShares, kitchenPayout, kitchenPayoutTiming, originalKitchenEntitlement, payoutEligibility, unpaidKitchenEntitlement, withExtensionPayouts, type PayoutFacts } from './kitchen-payout';
import type { BookingCloseout, InspectionOutcome } from './clock-closeout';

const facts = (extra: Partial<PayoutFacts> = {}): PayoutFacts => ({ openIssue: false, openFlag: false, resolvedIssue: false, supportReleased: false, ...extra });
const closeout = (outcomes: InspectionOutcome[], now = '2026-10-15T12:00:00.000Z', status = 'completed'): BookingCloseout => ({
  phase: 'ended', serviceEndedAt: '2026-10-14T13:15:00.000Z', timezone: 'America/St_Johns', status, serverNow: now, nextDueAt: null,
  visits: outcomes.map((outcome, index) => ({ key: String(index + 1), clockKey: `k${index}`, blockIndex: index, localDate: '2026-10-14',
    startTime: '09:00', endTime: '11:00', scheduledStartAt: '2026-10-14T11:30:00.000Z', scheduledEndAt: '2026-10-14T13:30:00.000Z',
    phase: 'ended', arrivalRecorded: true, attendance: 'recorded',
    inspection: { outcome, dueAt: '2026-10-14T13:30:00.000Z', deadline: `2026-10-15T1${index}:30:00.000Z`, closedAt: null, canRespond: false } })),
});
// $100 subtotal + $13 HST, $7 commission; Stripe fee $3.58.
const source = (extra: Record<string, unknown> = {}) => ({ payoutTiming: 'after_closeout', amount: '12000', baseAmount: '11300', serviceFee: '700',
  stripeProcessingFee: '358', managerRevenue: '11300', transferId: null, metadata: { approvedSubtotal: 10000, approvedTax: 1300, platformCommission: 700 }, ...extra });

describe('rollout safety: payout timing snapshot', () => {
  it('defaults to at_capture unless the env explicitly opts in', () => {
    for (const value of [undefined, '', 'at_capture', 'AFTER_CLOSEOUT', 'yes']) expect(kitchenPayoutTiming(value)).toBe('at_capture');
    expect(kitchenPayoutTiming('after_closeout')).toBe('after_closeout');
    expect(kitchenPayoutTiming(' after_closeout ')).toBe('after_closeout');
  });
});

describe('release rules (Decisions 1-3)', () => {
  it('releases once every visit is cleared or auto-closed, at the later inspection deadline', () => {
    expect(payoutEligibility('completed', closeout(['manager_cleared']), facts())).toEqual({ expectedAt: '2026-10-15T10:30:00.000Z', holdReason: null, ready: true });
    expect(payoutEligibility('completed', closeout(['manager_cleared', 'auto_closed_uninspected']), facts()))
      .toMatchObject({ expectedAt: '2026-10-15T11:30:00.000Z', ready: true });
  });
  it('waits while any visit inspection is still open', () => {
    expect(payoutEligibility('confirmed', closeout(['manager_cleared', 'due']), facts())).toMatchObject({ holdReason: null, ready: false });
    expect(payoutEligibility('confirmed', closeout(['not_due']), facts())).toMatchObject({ ready: false });
  });
  it('holds on a filed issue until it is resolved or support releases it', () => {
    expect(payoutEligibility('completed', closeout(['issue_filed']), facts())).toMatchObject({ holdReason: 'reported_issue', ready: false });
    expect(payoutEligibility('completed', closeout(['manager_cleared']), facts({ openIssue: true }))).toMatchObject({ holdReason: 'reported_issue', ready: false });
    expect(payoutEligibility('completed', closeout(['issue_filed']), facts({ resolvedIssue: true }))).toMatchObject({ holdReason: null, ready: true });
    expect(payoutEligibility('completed', closeout(['issue_filed']), facts({ openIssue: true, supportReleased: true }))).toMatchObject({ holdReason: null, ready: true });
  });
  it('an open support flag always holds, even over a support release', () => {
    expect(payoutEligibility('completed', closeout(['manager_cleared']), facts({ openFlag: true, supportReleased: true })))
      .toMatchObject({ holdReason: 'support_flag', ready: false });
  });
  it('a no-show or unknown attendance still releases when the window auto-closes', () => {
    const projection = closeout(['auto_closed_uninspected']);
    projection.visits[0].attendance = 'no_show';
    expect(payoutEligibility('completed', projection, facts())).toMatchObject({ ready: true });
  });
  it('a cancellation with a retained share releases at the scheduled end plus grace; a pending request waits unheld', () => {
    expect(payoutEligibility('cancelled', closeout(['not_due'], '2026-10-14T13:00:00.000Z', 'cancelled'), facts()))
      .toEqual({ expectedAt: '2026-10-14T13:15:00.000Z', holdReason: null, ready: false });
    expect(payoutEligibility('cancelled', closeout(['not_due'], '2026-10-14T13:15:00.000Z', 'cancelled'), facts())).toMatchObject({ ready: true });
    expect(payoutEligibility('cancellation_requested', closeout(['manager_cleared']), facts())).toMatchObject({ holdReason: null, ready: false });
  });
});

describe('amount (Decision 6) and goodwill (Decision 4)', () => {
  it('is the existing split minus the actual Stripe fee and the kitchen share of earlier refunds', () => {
    expect(unpaidKitchenEntitlement(source())).toBe(11300 - 358);
    const refunded = source({ metadata: { ...source().metadata, refunds: [{ managerDebited: 2000, customerReceived: 2000 }] } });
    expect(unpaidKitchenEntitlement(refunded)).toBe(11300 - 358 - 2000);
    expect(originalKitchenEntitlement(refunded)).toBe(11300 - 358);
  });
  it('a Local Cooks goodwill refund never reduces the kitchen share', () => {
    expect(unpaidKitchenEntitlement(source({ metadata: { ...source().metadata,
      refunds: [{ managerDebited: 0, customerReceived: 2500, platformGoodwillCents: 2500 }] } }))).toBe(11300 - 358);
  });
  it('a kitchen-caused cancellation leaves nothing owed', () => {
    expect(kitchenPayout(source({ metadata: { ...source().metadata, refunds: [{ managerDebited: 10942 }] } })))
      .toMatchObject({ status: 'not_applicable', amountCents: 0 });
  });
});

describe('payload states', () => {
  it('scheduled, on hold, sent and legacy', () => {
    expect(kitchenPayout(source(), { expectedAt: '2026-10-15T10:30:00.000Z', holdReason: null }))
      .toEqual({ timing: 'after_closeout', status: 'scheduled', holdReason: null, expectedAt: '2026-10-15T10:30:00.000Z', sentAt: null, amountCents: 10942 });
    expect(kitchenPayout(source(), { expectedAt: '2026-10-15T10:30:00.000Z', holdReason: 'reported_issue' })).toMatchObject({ status: 'on_hold', holdReason: 'reported_issue' });
    expect(kitchenPayout(source({ payoutHoldReason: 'support_flag', payoutEligibleAt: new Date('2026-10-15T10:30:00Z') })))
      .toMatchObject({ status: 'on_hold', holdReason: 'support_flag', expectedAt: '2026-10-15T10:30:00.000Z' });
    expect(kitchenPayout(source({ transferId: 'tr_1', metadata: { payoutSent: { sentAt: '2026-10-15T11:00:00.000Z', amountCents: 10942 } } })))
      .toMatchObject({ status: 'sent', sentAt: '2026-10-15T11:00:00.000Z', amountCents: 10942 });
    expect(kitchenPayout(source({ payoutTiming: null, transferId: 'tr_legacy' }))).toMatchObject({ timing: 'at_capture', status: 'sent' });
    expect(kitchenPayout(source({ payoutTiming: null }))).toMatchObject({ timing: 'at_capture', status: 'not_applicable' });
    expect(kitchenPayout(null)).toMatchObject({ status: 'not_applicable', amountCents: 0 });
  });
});

describe('session-extension kitchen shares (separate charges on the same booking)', () => {
  // +30 min: $25 subtotal + $3.25 HST, $1.75 commission; Stripe fee $1.17 -> kitchen share 2708.
  const extension = (extra: Record<string, unknown> = {}) => source({ amount: '3000', baseAmount: '2825', serviceFee: '175', stripeProcessingFee: '117',
    metadata: { type: 'session_extension', sessionExtensionId: 5, approvedSubtotal: 2500, approvedTax: 325, platformCommission: 175, capturedAmount: 3000 }, ...extra });
  it('counts each extension share once and ignores the booking payment itself', () => {
    expect(extensionPayoutShares([extension(), source()])).toEqual({ pendingCents: 2708, sentCents: 0 });
    expect(extensionPayoutShares([extension({ transferId: 'tr_x', metadata: { sessionExtensionId: 5, payoutSent: { amountCents: 2708 } } })]))
      .toEqual({ pendingCents: 0, sentCents: 2708 });
  });
  it('a waiting booking payout includes its extension share exactly once', () => {
    expect(withExtensionPayouts(kitchenPayout(source()), [extension()])).toMatchObject({ status: 'scheduled', amountCents: 10942 + 2708, trailingCents: 0 });
  });
  it('after the booking payout was sent, a still-owed extension share is trailing, not added to the sent amount', () => {
    const sent = kitchenPayout(source({ transferId: 'tr_1', metadata: { payoutSent: { amountCents: 10942 } } }));
    expect(withExtensionPayouts(sent, [extension()])).toMatchObject({ status: 'sent', amountCents: 10942, trailingCents: 2708 });
    expect(withExtensionPayouts(sent, [extension({ transferId: 'tr_2', metadata: { sessionExtensionId: 5, payoutSent: { amountCents: 2708 } } })]))
      .toMatchObject({ status: 'sent', amountCents: 10942 + 2708, trailingCents: 0 });
  });
});
