import type { BookingCloseout } from './clock-closeout';
// Pure math (no DB/Stripe imports); the client only imports types from this file.
import { computeManagerGrossAndCommission } from '../server/services/manager-payout-math';

export type PayoutTiming = 'at_capture' | 'after_closeout';
export type PayoutStatus = 'scheduled' | 'on_hold' | 'sent' | 'not_applicable';
/** support_flag: an open booking_flags row; reported_issue: an unresolved CHEF-reported kitchen problem. */
export type PayoutHoldReason = 'support_flag' | 'reported_issue';
export type KitchenPayout = { timing: PayoutTiming; status: PayoutStatus; holdReason: PayoutHoldReason | null;
  expectedAt: string | null; sentAt: string | null; amountCents: number };
export type PayoutSource = { payoutTiming?: string | null; payoutEligibleAt?: Date | string | null;
  payoutReleasedAt?: Date | string | null; payoutHoldReason?: string | null; transferId?: string | null;
  amount: string | number; baseAmount: string | number; serviceFee: string | number;
  stripeProcessingFee?: string | number | null; managerRevenue?: string | number | null; metadata?: unknown };
export type PayoutFacts = { openIssue: boolean; openFlag: boolean; resolvedIssue: boolean; supportReleased: boolean };
type PayoutMeta = { refunds?: Array<{ managerDebited?: number }>; payoutSent?: { sentAt?: string; amountCents?: number };
  payoutRelease?: { override?: boolean }; payoutNoEntitlement?: boolean; transfer?: { transferredAt?: string; transferredCents?: number };
  approvedSubtotal?: number; approvedTax?: number; platformCommission?: number; capturedAmount?: number; originalAuthorizedAmount?: number };

/** Snapshot for NEW captures. Anything other than an explicit opt-in keeps the legacy at-capture transfer. */
export function kitchenPayoutTiming(value: string | undefined = process.env.KITCHEN_PAYOUT_TIMING): PayoutTiming {
  return value?.trim() === 'after_closeout' ? 'after_closeout' : 'at_capture';
}
const meta = (source: Pick<PayoutSource, 'metadata'>) => (source.metadata || {}) as PayoutMeta;
/** Kitchen share still owed: the transfer engine's split, minus the kitchen share of refunds already made. */
export function unpaidKitchenEntitlement(source: PayoutSource) {
  const saved = meta(source);
  const split = computeManagerGrossAndCommission({ chargeAmountCents: Number(source.amount), platformCommissionRate: 0,
    approvedSubtotalCents: saved.approvedSubtotal, approvedTaxCents: saved.approvedTax, platformCommissionCents: saved.platformCommission,
    capturedAmountCents: saved.capturedAmount, originalAuthorizedAmountCents: saved.originalAuthorizedAmount,
    storedBaseAmountCents: Number(source.baseAmount), storedServiceFeeCents: Number(source.serviceFee) });
  const debits = Array.isArray(saved.refunds) ? saved.refunds.reduce((sum, item) => sum + Math.max(0, Number(item?.managerDebited || 0)), 0) : 0;
  return Math.max(0, split.managerGrossCents - Number(source.stripeProcessingFee || 0) - debits);
}
/** Refund ceilings start from the original share; callers subtract the saved manager debits once. */
export function originalKitchenEntitlement(source: PayoutSource) {
  return unpaidKitchenEntitlement({ ...source, metadata: { ...(source.metadata as object || {}), refunds: [] } });
}
/** True when support explicitly released this payout over a reported-issue hold. */
export const supportReleased = (source: Pick<PayoutSource, 'metadata'>) => meta(source).payoutRelease?.override === true;

const closedOutcomes = ['manager_cleared', 'legacy_closed', 'auto_closed_uninspected'];
/**
 * Release rules (build-payout-after-closeout.md, Decisions 1-3):
 * - confirmed/completed: every visit's inspection is closed (cleared, auto-closed, legacy) and nothing is held;
 * - cancelled with a retained share: at the scheduled end + service grace;
 * - an open support flag always holds; an open or unresolved issue holds unless support released it.
 */
export function payoutEligibility(status: string, closeout: BookingCloseout, facts: PayoutFacts) {
  const expectedAt = status === 'cancelled' || !closeout.visits.length ? closeout.serviceEndedAt
    : new Date(Math.max(...closeout.visits.map(visit => new Date(visit.inspection.deadline).getTime()))).toISOString();
  const holdReason: PayoutHoldReason | null = facts.openFlag ? 'support_flag'
    : !facts.supportReleased && facts.openIssue ? 'reported_issue' : null;
  const ready = !holdReason && (status === 'cancelled' ? new Date(closeout.serverNow) >= new Date(expectedAt)
    : ['confirmed', 'completed'].includes(status) && closeout.visits.length > 0
      // A manager's damage/cleaning claim closes inspection but does not hold the booking payout.
      && closeout.visits.every(visit => closedOutcomes.includes(visit.inspection.outcome) || visit.inspection.outcome === 'issue_filed'));
  return { expectedAt, holdReason, ready };
}
/** Manager-facing payout state. `eligibility` is the live projection; the saved columns are the fallback. */
export function kitchenPayout(source?: PayoutSource | null, eligibility?: { expectedAt: string | null; holdReason: PayoutHoldReason | null }): KitchenPayout {
  const timing: PayoutTiming = source?.payoutTiming === 'after_closeout' ? 'after_closeout' : 'at_capture';
  if (!source) return { timing, status: 'not_applicable', holdReason: null, expectedAt: null, sentAt: null, amountCents: 0 };
  const saved = meta(source);
  const iso = (value?: Date | string | null) => value ? new Date(value).toISOString() : null;
  if (source.transferId) return { timing, status: 'sent', holdReason: null, expectedAt: null,
    sentAt: saved.payoutSent?.sentAt || saved.transfer?.transferredAt || iso(source.payoutReleasedAt),
    amountCents: saved.payoutSent?.amountCents ?? saved.transfer?.transferredCents ?? unpaidKitchenEntitlement(source) };
  const amountCents = unpaidKitchenEntitlement(source);
  if (timing !== 'after_closeout' || amountCents === 0 || saved.payoutNoEntitlement)
    return { timing, status: 'not_applicable', holdReason: null, expectedAt: null, sentAt: null, amountCents: timing === 'after_closeout' ? 0 : amountCents };
  const holdReason = eligibility ? eligibility.holdReason : (source.payoutHoldReason as PayoutHoldReason | null) ?? null;
  return { timing, status: holdReason ? 'on_hold' : 'scheduled', holdReason,
    expectedAt: eligibility?.expectedAt ?? iso(source.payoutEligibleAt), sentAt: null, amountCents };
}

/** A separately charged session extension / extra-time payment (same booking id, its own PaymentIntent). */
export const isSessionExtensionPayment = (source: Pick<PayoutSource, 'metadata'>) => {
  const saved = (source.metadata || {}) as { type?: unknown; sessionExtensionId?: unknown };
  return saved.type === 'session_extension' || saved.sessionExtensionId != null;
};
/** Kitchen shares of a booking's extension charges, each counted once: still owed vs already transferred. */
export function extensionPayoutShares(extensions: PayoutSource[]) {
  let pendingCents = 0, sentCents = 0;
  for (const source of extensions) {
    if (!isSessionExtensionPayment(source)) continue;
    const saved = meta(source);
    if (source.transferId) sentCents += saved.payoutSent?.amountCents ?? saved.transfer?.transferredCents ?? unpaidKitchenEntitlement(source);
    else if (!saved.payoutNoEntitlement) pendingCents += unpaidKitchenEntitlement(source);
  }
  return { pendingCents, sentCents };
}
/**
 * The booking's payout including its extension charges, which are released with (or right after) the booking payout.
 * `trailingCents` is extension money still owed after the booking payout itself was sent (shown separately as upcoming).
 */
export function withExtensionPayouts(payout: KitchenPayout, extensions: PayoutSource[]): KitchenPayout & { trailingCents: number } {
  const { pendingCents, sentCents } = extensionPayoutShares(extensions);
  if (payout.status === 'scheduled' || payout.status === 'on_hold') return { ...payout, amountCents: payout.amountCents + pendingCents + sentCents, trailingCents: 0 };
  if (payout.status === 'sent') return { ...payout, amountCents: payout.amountCents + sentCents, trailingCents: pendingCents };
  // at_capture: the amount is the booking's kitchen share; after_closeout with nothing owed stays at zero.
  return { ...payout, amountCents: payout.timing === 'at_capture' ? payout.amountCents + pendingCents + sentCents : payout.amountCents, trailingCents: 0 };
}
