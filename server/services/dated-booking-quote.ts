import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { calculateKitchenBasePrice } from '@shared/kitchen-booking-rate';
import { assertConsecutiveBookingSlots } from '@shared/consecutive-booking-slots';
import { validateBookingDaysContract } from '@shared/booking-days-contract';
import { capturedComponentAllocations } from '@shared/captured-component-allocations';
import { allocateCents, cancellationTiers, DATED_DISCLOSURE_VERSION, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import type { ValidatedBookingDay } from './booking-days-validation';
import { policySessionStart } from './cancellation-policy-settings';

export const DATED_BOOKING_CONTRACT = 'kitchen-days-v1';
export type PricedBookingDay = ValidatedBookingDay & {
  rateCents: number; kitchenCents: number;
  equipment: Array<{ listingId: number; name: string; cents: number }>;
};
/** The invitation's one offered booking subtotal and its deterministic per-day split (CP10). */
export type InvitationQuoteBlock = {
  id: string; version: number; listKitchenCents: number; offeredKitchenCents: number;
  days: Array<{ date: string; listKitchenCents: number; offeredKitchenCents: number }>;
};
export type DatedBookingManifest = {
  contract: typeof DATED_BOOKING_CONTRACT; headId: string; chefId: number; kitchenId: number; managerId: number;
  destination: string; timezone: string; bufferMinutes: number; createdAt: string; checkoutExpiresAt: number;
  days: PricedBookingDay[]; subtotalCents: number; taxCents: number; serviceFeeCents: number; totalCents: number;
  taxRatePercent: number; serviceFeeRate: number; policy: CancellationPolicySnapshot;
  specialNotes: string | null; replacesBookingId?: number; invitation?: InvitationQuoteBlock;
};
export type DatedQuote = { manifest: DatedBookingManifest; hash: string };
const cents = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid dated quote cents'); return n; };

// JSONB does not preserve object key order. Arrays retain the canonical date/component tie order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const datedManifestHash = (manifest: DatedBookingManifest) => createHash('sha256').update(canonical(manifest)).digest('hex');

export function priceBookingDays(days: ValidatedBookingDay[], rates: { hourlyRate: number; dailyRate: number },
  listings: Array<{ id: number; equipmentType: string; availabilityType: string | null; sessionRate: string | null }>,
  keptPrices = new Map<string, Pick<PricedBookingDay, 'kitchenCents' | 'equipment'>>()): PricedBookingDay[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
    assertConsecutiveBookingSlots(day.slots, day.windowStartTime);
    const kept = keptPrices.get(day.date);
    const rateCents = kept ? (day.pricingMode === 'daily' ? kept.kitchenCents : Math.round(kept.kitchenCents / day.slots.length))
      : cents(day.pricingMode === 'daily' ? rates.dailyRate : rates.hourlyRate);
    if (!kept && !rateCents) throw Error(`This kitchen does not offer ${day.pricingMode} booking`);
    if (new Set(day.equipmentIds).size !== day.equipmentIds.length) throw Error('Choose each equipment item once per day');
    const equipment = [...day.equipmentIds].sort((a, b) => a - b).map(id => {
      const listing = listings.find(row => row.id === id);
      if (!listing) throw Error('Quoted equipment is unavailable');
      return { listingId: id, name: listing.equipmentType, cents: kept?.equipment.find(item => item.listingId === id)?.cents
        ?? (listing.availabilityType === 'included' ? 0 : cents(Number(listing.sessionRate ?? 0))) };
    });
    return { ...day, equipmentIds: equipment.map(item => item.listingId), rateCents, equipment,
      kitchenCents: cents(kept?.kitchenCents ?? calculateKitchenBasePrice(day.pricingMode, rates.hourlyRate, rates.dailyRate, day.slots.length)) };
  });
}

/**
 * A discounted invitation quote is still one dated contract: the same schedule, tax, fee and policy evidence, with the
 * kitchen's single offered booking subtotal split over the listed day prices. The split must be the deterministic
 * largest-remainder allocation, never an ad-hoc per-day price.
 */
export function verifyInvitationBlock(block: InvitationQuoteBlock, days: PricedBookingDay[]) {
  if (!block || typeof block.id !== 'string' || !block.id || !Number.isSafeInteger(block.version) || block.version < 1
    || block.days.length !== days.length || block.days.some((day, i) => day.date !== days[i].date)) throw Error('Invitation quote days need review');
  const list = block.days.map(day => cents(day.listKitchenCents));
  const offered = block.days.map(day => cents(day.offeredKitchenCents));
  const listTotal = list.reduce((sum, value) => sum + value, 0), offeredTotal = offered.reduce((sum, value) => sum + value, 0);
  if (listTotal !== cents(block.listKitchenCents) || offeredTotal !== cents(block.offeredKitchenCents)
    || offeredTotal < 100 || offeredTotal > listTotal || offered.some((value, i) => value > list[i])
    || days.some((day, i) => day.kitchenCents !== offered[i])) throw Error('Invitation quote allocation needs review');
  const expected = allocateCents(offeredTotal, list);
  if (expected.some((value, i) => value !== offered[i])) throw Error('Invitation quote allocation needs review');
}

export function verifyDatedQuote(value: unknown): DatedQuote {
  const quote = value as DatedQuote;
  const m = quote?.manifest;
  if (!m || m.contract !== DATED_BOOKING_CONTRACT || datedManifestHash(m) !== quote.hash) throw Error('Dated quote hash needs review');
  const contract = validateBookingDaysContract(m.days, { maxBookingDays: 14, multidayCreationEnabled: true });
  if (!contract.ok || m.days.some((day, index) => day.date !== contract.days[index].date)) throw Error('Dated quote schedule needs review');
  for (const id of [m.chefId, m.kitchenId, m.managerId]) if (!Number.isSafeInteger(id) || id <= 0) throw Error('Dated quote ownership needs review');
  if (!m.headId || !m.destination || ![0, 60, 120].includes(m.bufferMinutes) || !Number.isFinite(Date.parse(m.createdAt))
    || !Number.isSafeInteger(m.checkoutExpiresAt)) throw Error('Dated quote context needs review');
  if (m.invitation) verifyInvitationBlock(m.invitation, m.days);
  let subtotal = 0;
  for (const day of m.days) {
    assertConsecutiveBookingSlots(day.slots, day.windowStartTime);
    if (!day.slots.length || day.startTime !== day.slots[0].startTime || day.endTime !== day.slots.at(-1)!.endTime
      || (cents(day.rateCents) === 0 && !m.invitation) || (!m.invitation
        && day.kitchenCents !== calculateKitchenBasePrice(day.pricingMode, day.rateCents, day.rateCents, day.slots.length))
      || new Set(day.equipmentIds).size !== day.equipmentIds.length || day.equipment.length !== day.equipmentIds.length
      || day.equipment.some((item, i) => item.listingId !== day.equipmentIds[i] || !Number.isSafeInteger(item.listingId) || item.listingId <= 0
        || i > 0 && item.listingId <= day.equipment[i - 1].listingId)) throw Error('Dated component prices need review');
    subtotal += cents(day.kitchenCents) + day.equipment.reduce((sum, item) => sum + cents(item.cents), 0);
  }
  if (!Number.isFinite(m.taxRatePercent) || m.taxRatePercent < 0 || m.taxRatePercent > 100
    || !Number.isFinite(m.serviceFeeRate) || m.serviceFeeRate < 0 || m.serviceFeeRate > 1
    || cents(subtotal) !== m.subtotalCents || subtotal <= 0 || Math.round(subtotal * m.taxRatePercent / 100) !== cents(m.taxCents)
    || Math.round(subtotal * m.serviceFeeRate) !== cents(m.serviceFeeCents)
    || cents(m.totalCents) !== subtotal + m.taxCents + m.serviceFeeCents) throw Error('Dated aggregate prices need review');
  const p = m.policy;
  const sessions = m.days.map(day => ({ startAt: policySessionStart(day.date, day.startTime, day.windowStartTime, m.timezone) }));
  if (p.deadlineBasis !== 'booking_first_day' || p.disclosureVersion !== DATED_DISCLOSURE_VERSION || p.timezone !== m.timezone
    || canonical(p.sessions) !== canonical(sessions)
    || !p.policyId || !p.version || !p.acceptedAt || !Number.isFinite(Date.parse(p.acceptedAt))
    || canonical(p.tiers) !== canonical(cancellationTiers(p.noticeHours, p.lateChargePercent))) throw Error('Dated cancellation acceptance needs review');
  return quote;
}

/** Scalar routing/identity + aggregate cents only; no day JSON or lossy legacy reconstruction fields. */
export function datedCheckoutMetadata(quote: DatedQuote): Record<string, string> {
  const { manifest: m, hash } = verifyDatedQuote(quote);
  return { type: 'kitchen_booking', booking_contract: m.contract, hold_id: m.headId, quote_hash: hash,
    chef_id: String(m.chefId), kitchen_id: String(m.kitchenId), total_price_cents: String(m.subtotalCents),
    tax_cents: String(m.taxCents), platform_fee_cents: String(m.serviceFeeCents), booking_price_cents: String(m.totalCents) };
}
const ref = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id;
export function verifyDatedCheckout(quote: DatedQuote, session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent, allowReleased = false) {
  const expected = datedCheckoutMetadata(quote), m = quote.manifest;
  if (Object.entries(expected).some(([k, v]) => session.metadata?.[k] !== v || intent.metadata?.[k] !== v)
    || ref(session.payment_intent) !== intent.id || session.status !== 'complete' || session.mode !== 'payment'
    || session.currency !== 'cad' || intent.currency !== 'cad' || session.amount_total !== m.totalCents || intent.amount !== m.totalCents
    || intent.capture_method !== 'manual' || !(['requires_capture', 'succeeded'].includes(intent.status)
      || allowReleased && intent.status === 'canceled' && intent.amount_received === 0)
    || intent.status === 'requires_capture' && intent.amount_capturable !== m.totalCents
    // After acceptance the capture may be the chef-approved smaller total; its exact amount is verified with the allocation source.
    || intent.status === 'succeeded' && !(intent.amount_received > 0 && intent.amount_received <= m.totalCents)) throw Error('Dated checkout payment evidence needs review');
}

export type DayComponent = { visitId: number; sessionIndex: number; componentKey: string; kind: 'kitchen' | 'equipment'; bookingId: number; subtotalCents: number };
/** One source, one aggregate tax, service fee and actual provider fee. Stable date then component order breaks ties. */
export function allocateDatedCapture(components: DayComponent[], m: DatedBookingManifest, actualFee: number | null) {
  const tax = capturedComponentAllocations(components, m.taxCents);
  const service = allocateCents(m.serviceFeeCents, tax.map(item => item.managerGrossCents));
  const fees = actualFee === null ? components.map(() => null) : allocateCents(cents(actualFee), tax.map(item => item.managerGrossCents));
  const result = components.map((item, i) => ({ ...item, taxCents: tax[i].taxCents, managerGrossCents: tax[i].managerGrossCents,
    serviceFeeCents: service[i], stripeFeeCents: fees[i] }));
  if (result.reduce((sum, row) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0) !== m.totalCents
    || actualFee !== null && (result.reduce((sum, row) => sum + row.stripeFeeCents!, 0) !== actualFee
      || result.reduce((sum, row) => sum + row.subtotalCents + row.taxCents - row.stripeFeeCents!, 0) !== m.totalCents - m.serviceFeeCents - actualFee))
    throw Error('Dated capture allocation does not conserve the source');
  return result;
}
