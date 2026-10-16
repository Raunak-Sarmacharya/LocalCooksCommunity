export type CancellationTier = { minHoursBeforeStart: number; refundPercent: number };
export type CancellationPolicySnapshot = { policyId: number | null; version: number; noticeHours: number; lateChargePercent: number;
  tiers: CancellationTier[]; timezone: string; sessions: Array<{ startAt: string; endAt?: string; nonRefundable?: boolean; amountCents?: number }>; disclosureVersion: string; acceptedAt: string | null };
/**
 * v2 (WP-N, owner Oct 15): the accepted terms also say "No-shows aren't refunded." for every policy (checkbox consent).
 * v3 (#52): same terms; consent is given by selecting Checkout under "By selecting Checkout, you agree to…" (no checkbox).
 */
export const CANCELLATION_DISCLOSURE_VERSION = 'food-corridor-v3';
/** The checkbox disclosure, recorded for checkouts from clients that predate v3 (they send no disclosure version). */
export const CHECKBOX_DISCLOSURE_VERSION = 'food-corridor-v2';
/** Checkouts opened before a disclosure bump still fulfil under the version the chef actually accepted. */
export const ACCEPTED_DISCLOSURE_VERSIONS: readonly string[] = ['food-corridor-v1', CHECKBOX_DISCLOSURE_VERSION, CANCELLATION_DISCLOSURE_VERSION];
export const NOTICE_OPTIONS = [24, 48, 72] as const;
export const CHARGE_OPTIONS = [50, 100] as const;
export function cancellationTiers(notice: number, charge: number): CancellationTier[] {
  if (!NOTICE_OPTIONS.includes(notice as 24) || !CHARGE_OPTIONS.includes(charge as 50)) throw Error('Choose a published cancellation policy');
  return [{ minHoursBeforeStart: notice, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 100 - charge }];
}
export function legacyCancellationSnapshot(hours: number | null | undefined, timezone: string, sessions: Array<{ startAt: string }>): CancellationPolicySnapshot {
  const noticeHours = hours ?? 24;
  if (!Number.isFinite(noticeHours) || noticeHours < 0) throw Error('Original booking terms need review');
  return { policyId: null, version: 0, noticeHours, lateChargePercent: 100,
    tiers: [{ minHoursBeforeStart: noticeHours, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 0 }],
    timezone, sessions, disclosureVersion: 'legacy-original-terms', acceptedAt: null };
}
const cents = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) throw Error('Verified integer cents required'); return n; };
const instant = (value: string | Date) => { const ms = new Date(value).getTime(); if (!Number.isFinite(ms)) throw Error('Valid cancellation instants required'); return ms; };
export function roundRatio(amount: number, numerator: number, denominator: number) {
  cents(amount); cents(numerator); cents(denominator);
  if (!denominator) return 0;
  return Number((BigInt(amount) * BigInt(numerator) * BigInt(2) + BigInt(denominator)) / (BigInt(2) * BigInt(denominator)));
}
/** Stable largest-remainder allocation; input order breaks ties. */
export function allocateCents(total: number, weights: number[]) {
  cents(total); weights.forEach(cents);
  const sum = weights.reduce((a, b) => a + b, 0); cents(sum);
  if (!sum) { if (total) throw Error('Nonzero amount has no component allocation'); return weights.map(() => 0); }
  const rows = weights.map((weight, index) => ({ index, amount: Number(BigInt(total) * BigInt(weight) / BigInt(sum)), remainder: BigInt(total) * BigInt(weight) % BigInt(sum) }));
  let left = total - rows.reduce((a, b) => a + b.amount, 0);
  for (const row of [...rows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) { if (!left) break; row.amount++; left--; }
  return rows.map(row => row.amount);
}
/** Extra manager award is a customer amount, funded from the remaining original shares. */
export function additionalCancellationRefund(input: { capturedCents: number; feeCents: number; platformCents: number; alreadyRefundedCents: number;
  kitchenDebitedCents: number; platformReturnedCents: number; additionalCents: number; usedStorageKitchenCents?: number; usedStoragePlatformCents?: number }) {
  Object.values(input).forEach(cents);
  const kitchen = input.capturedCents - input.feeCents - input.platformCents - (input.usedStorageKitchenCents ?? 0);
  const platform = input.platformCents - (input.usedStoragePlatformCents ?? 0), cap = kitchen + platform;
  if (kitchen < 0 || platform < 0 || input.additionalCents <= 0 || input.alreadyRefundedCents + input.additionalCents > cap) throw Error('The extra refund exceeds the remaining payment minus the card processing fee');
  const kitchenCents = Math.min(input.additionalCents, Math.max(0, roundRatio(input.alreadyRefundedCents + input.additionalCents, kitchen, cap) - input.kitchenDebitedCents));
  const platformCents = input.additionalCents - kitchenCents;
  if (kitchenCents > kitchen - input.kitchenDebitedCents || platformCents > platform - input.platformReturnedCents) throw Error('Prior refund funding needs review');
  return { customerCents: input.additionalCents, kitchenCents, platformCents };
}
export type CancellationComponent = { id: string; kind: 'kitchen' | 'equipment' | 'storage'; sessionIndex: number; kitchenCents: number; platformCents: number };
export type CancellationInput = { cancelAt: string | Date; confirmedAt: string | Date | null; capturedCents: number; processingFeeCents: number | null;
  components: CancellationComponent[]; startedComponents?: string[]; cause: 'chef' | 'kitchen' | 'no_show' | 'support_exception';
  alreadyRefundedCents?: number; alreadyKitchenRefundedCents?: number; alreadyPlatformRefundedCents?: number };
export function quoteCancellation(snapshot: CancellationPolicySnapshot, input: CancellationInput) {
  const cancelAt = instant(input.cancelAt), captured = cents(input.capturedCents);
  const refunded = cents(input.alreadyRefundedCents ?? 0), kitchenRefunded = cents(input.alreadyKitchenRefundedCents ?? 0), platformRefunded = cents(input.alreadyPlatformRefundedCents ?? 0);
  if (refunded > captured || kitchenRefunded + platformRefunded > refunded) throw Error('Prior refunds require reconciliation');
  if (!snapshot.sessions.length || !snapshot.tiers.length) throw Error('Frozen policy needs sessions and tiers');
  snapshot.sessions.forEach(session => instant(session.startAt));
  snapshot.tiers.forEach((tier, index) => {
    if (!Number.isFinite(tier.minHoursBeforeStart) || tier.minHoursBeforeStart < 0 || !Number.isInteger(tier.refundPercent) || tier.refundPercent < 0 || tier.refundPercent > 100
      || index && (tier.minHoursBeforeStart >= snapshot.tiers[index - 1].minHoursBeforeStart && !(snapshot.version === 0 && tier.minHoursBeforeStart === 0)
        || tier.refundPercent > snapshot.tiers[index - 1].refundPercent)) throw Error('Invalid frozen policy tiers');
  });
  if (snapshot.tiers.at(-1)!.minHoursBeforeStart !== 0) throw Error('Policy needs a terminal tier');
  const remedy = input.cause === 'kitchen' || input.cause === 'support_exception';
  const authorized = input.confirmedAt === null && captured === 0;
  if (input.confirmedAt) instant(input.confirmedAt);
  if (input.processingFeeCents === null && captured > 0) return { reasonCode: 'processing_fee_pending' as const, quoteReady: false as const };
  const fee = cents(input.processingFeeCents ?? 0);
  const kitchen = input.components.reduce((sum, item) => sum + cents(item.kitchenCents), 0), platform = input.components.reduce((sum, item) => sum + cents(item.platformCents), 0);
  if (new Set(input.components.map(item => item.id)).size !== input.components.length || kitchen + platform !== captured || fee > kitchen) throw Error('Captured component allocations require review');
  const fees = allocateCents(fee, input.components.map(item => item.kitchenCents));
  const components = input.components.map((item, index) => {
    const startAt = snapshot.sessions[item.sessionIndex]?.startAt;
    if (!startAt) throw Error('Component session is missing');
    const started = input.startedComponents?.includes(item.id) || cancelAt >= instant(startAt);
    const tier = snapshot.tiers.find(tier => instant(startAt) - cancelAt >= tier.minHoursBeforeStart * 3600000) ?? snapshot.tiers.at(-1)!;
    const percent = remedy ? 100 : input.cause === 'no_show' || started || snapshot.sessions[item.sessionIndex]?.nonRefundable ? 0 : tier.refundPercent;
    const pool = item.kitchenCents - fees[index] + item.platformCents;
    return { ...item, tier, refundPercent: percent, pool,
      feeCents: fees[index], reasonCode: started && !remedy ? item.kind === 'storage' ? 'used_storage' : 'session_started' : 'policy_tier' };
  });
  // Round once for the charge, then distribute its cents; splitting into add-ons must not increase a refund.
  const numerators = components.map(item => BigInt(item.pool) * BigInt(item.refundPercent));
  const cumulativeTarget = Number((numerators.reduce((sum, item) => sum + item, BigInt(0)) + BigInt(50)) / BigInt(100));
  const refunds = numerators.map(numerator => Number(numerator / BigInt(100)));
  let rounding = cumulativeTarget - refunds.reduce((sum, item) => sum + item, 0);
  const order = numerators.map((numerator, index) => ({ index, remainder: numerator % BigInt(100) })).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const row of order) { if (!rounding) break; refunds[row.index]++; rounding--; }
  const perComponent = components.map(({ pool, ...item }, index) => {
    const refundCents = refunds[index], kitchenRefundCents = roundRatio(refundCents, item.kitchenCents - item.feeCents, pool);
    return { ...item, refundCents, kitchenRefundCents, platformRefundCents: refundCents - kitchenRefundCents };
  });
  const target = remedy ? captured : perComponent.reduce((sum, item) => sum + item.refundCents, 0);
  const kitchenTarget = perComponent.reduce((sum, item) => sum + item.kitchenRefundCents, 0);
  const chefRefundCents = Math.max(0, target - refunded);
  // A prior platform-funded goodwill can exceed a policy target. Never debit a kitchen twice or invent funding.
  const kitchenRefundCents = Math.min(chefRefundCents, Math.max(0, kitchenTarget - kitchenRefunded));
  const platformRefundCents = chefRefundCents - kitchenRefundCents;
  if (platformRefundCents > Math.max(0, platform - platformRefunded) + (remedy ? fee : 0)) throw Error('Prior refund funding requires review');
  return { quoteReady: true as const, tier: perComponent[0]?.tier ?? snapshot.tiers[0], refundPercent: perComponent.length && perComponent.every(item => item.refundPercent === perComponent[0].refundPercent) ? perComponent[0].refundPercent : null,
    chefRefundCents, kitchenRefundCents, platformRefundCents, feeRetainedCents: remedy || authorized ? 0 : fee,
    kitchenShareRetainedCents: Math.max(0, kitchen - fee - kitchenRefunded - kitchenRefundCents),
    platformShareRetainedCents: Math.max(0, platform - platformRefunded - Math.min(platformRefundCents, platform)),
    capturedCents: captured, alreadyRefundedCents: refunded, retainedCents: captured - refunded - chefRefundCents, perComponent,
    reasonCode: authorized ? 'hold_release' : remedy ? 'full_remedy' : perComponent.every(item => !item.refundPercent) ? 'no_refund' : 'policy_refund',
    explanationKeys: [snapshot.version === 0 ? 'original_terms' : 'frozen_policy', ...(fee && !remedy ? ['processing_fee_kept'] : [])] };
}

