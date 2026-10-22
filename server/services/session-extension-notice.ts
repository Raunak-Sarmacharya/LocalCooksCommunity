/**
 * Session-extension notices (docs/architecture/phase0/build-session-extensions.md).
 * One outbox event per audience so every recipient reads copy written for them, in their own language,
 * with kitchen-local 12-hour times. Emails use the standard notice shell; the call to action always opens
 * the booking page (decisions are never made through a link).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchens, locations, users, type kitchenBookingExtensions } from '@shared/schema';
import { ensureServerI18n } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { kitchenClockWithZone } from './kitchen-payout-notice';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Extension = typeof kitchenBookingExtensions.$inferSelect;
export type SessionExtensionNoticeEvent = 'requested' | 'instant' | 'confirmed' | 'declined' | 'expired' | 'offered'
  | 'extra_time' | 'paid' | 'disputed' | 'escalated' | 'card_failed' | 'granted' | 'early_offered' | 'refunded' | 'withdrawn';
type Audience = 'chef' | 'manager' | 'admins';
type Facts = { chef: string; kitchen: string; reference: string; end: string; originalEnd: string; expires: string; amount: string;
  payout: string; duration: string; billed: string; stayed: string; early: string; note: string | null };

/** Which audiences hear about each event, and which copy each of them reads. */
export function sessionExtensionAudiences(event: SessionExtensionNoticeEvent, kind: Extension['kind']): Array<[Audience, string]> {
  if (event === 'refunded') return [['chef', 'sxRefundedChef']];
  if (kind === 'early_start') switch (event) {
    case 'granted': return [['chef', 'sxGrantedStartChef']];
    case 'early_offered': return [['chef', 'sxEarlyOfferedChef']];
    case 'confirmed': return [['chef', 'sxEarlyConfirmedChef'], ['manager', 'sxEarlyAcceptedManager']];
    case 'declined': return [['manager', 'sxEarlyDeclinedManager']];
    case 'expired': return [['manager', 'sxEarlyExpiredManager']];
    case 'card_failed': return [['chef', 'sxCardFailedChef']];
    default: return [];
  }
  switch (event) {
    case 'granted': return [['chef', kind === 'request' ? 'sxGrantedRequestChef' : 'sxGrantedEndChef']];
    case 'early_offered': return [];
    case 'requested': return [['manager', 'sxRequested']];
    case 'instant': return [['chef', 'sxConfirmedChef'], ['manager', 'sxInstantManager']];
    case 'confirmed': return kind === 'offer' ? [['chef', 'sxConfirmedChef'], ['manager', 'sxOfferAcceptedManager']] : [['chef', 'sxConfirmedChef']];
    case 'declined': return kind === 'offer' ? [['manager', 'sxOfferDeclinedManager']] : [['chef', 'sxDeclinedChef']];
    case 'expired': return kind === 'offer' ? [['manager', 'sxOfferExpiredManager']] : [['chef', 'sxRequestExpiredChef'], ['manager', 'sxRequestExpiredManager']];
    case 'offered': return [['chef', 'sxOfferedChef']];
    case 'extra_time': return [['chef', 'sxExtraTimeChef']];
    case 'withdrawn': return [['chef', 'sxWithdrawnChef']];
    case 'paid': return [['chef', 'sxPaidChef'], ['manager', 'sxPaidManager']];
    case 'disputed': return [['chef', 'sxDisputedChef'], ['manager', 'sxDisputedManager'], ['admins', 'sxSupportDisputed']];
    case 'escalated': return [['chef', 'sxEscalatedChef'], ['manager', 'sxEscalatedManager'], ['admins', 'sxSupportUnanswered']];
    case 'card_failed': return [['chef', 'sxCardFailedChef']];
  }
}

/** Pure copy builder; `prefix` selects the Title/Body pair. */
export function sessionExtensionCopy(prefix: string, locale: string | null | undefined, facts: Facts) {
  const language = locale || 'en-CA';
  const message = tEmail(language, `${prefix}Body`, facts);
  const note = facts.note && ['sxExtraTimeChef', 'sxEscalatedChef', 'sxSupportDisputed', 'sxSupportUnanswered', 'sxDisputedManager'].includes(prefix)
    ? `\n${tEmail(language, prefix.startsWith('sxSupport') || prefix === 'sxDisputedManager' ? 'sxChefNoteLine' : 'sxNoteLine', { kitchen: facts.kitchen, chef: facts.chef, note: facts.note })}` : '';
  return { title: tEmail(language, `${prefix}Title`, facts), message: `${message}${note}` };
}

function money(cents: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}
function duration(minutes: number, locale: string) {
  return [30, 60, 120].includes(minutes) ? tEmail(locale, `sxDuration${minutes}`) : tEmail(locale, 'sxMinutes', { minutes });
}

export async function queueSessionExtensionNotices(tx: Tx, extension: Extension, event: SessionExtensionNoticeEvent, actorId?: number, extra: { disputeNote?: string } = {}) {
  await ensureServerI18n();
  const [row] = await tx.select({ booking: kitchenBookings, kitchenName: kitchens.name, timezone: locations.timezone, managerId: locations.managerId })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, extension.bookingId)).limit(1);
  if (!row?.timezone) throw Error('Session-extension notice needs the kitchen timezone');
  const people = row.booking.chefId ? await tx.select({ id: users.id, locale: users.preferredLocale }).from(users).where(eq(users.id, row.booking.chefId)) : [];
  const managers = row.managerId ? await tx.select({ id: users.id, locale: users.preferredLocale }).from(users).where(eq(users.id, row.managerId)) : [];
  const { getUserDisplayName } = await import('../utils/user-display');
  const chefName = row.booking.chefId ? await getUserDisplayName(row.booking.chefId, 'chef').catch(() => '') : '';
  const quote = extension.quote as Extension['quote'] & { actualMinutes?: number };
  const factsFor = (locale: string): Facts => ({
    chef: chefName && chefName !== 'A chef' ? chefName : tEmail(locale, 'payoutChefFallback'),
    kitchen: row.kitchenName, reference: row.booking.referenceCode || `#${row.booking.id}`,
    end: kitchenClockWithZone(extension.endAt, row.timezone!, locale), originalEnd: kitchenClockWithZone(extension.originalEndAt, row.timezone!, locale),
    expires: kitchenClockWithZone(extension.expiresAt, row.timezone!, locale),
    amount: money(extension.amountCents, row.booking.currency, locale), payout: money(quote.kitchenGrossCents, row.booking.currency, locale),
    duration: duration(extension.minutes, locale), billed: tEmail(locale, 'sxMinutes', { minutes: extension.minutes }),
    stayed: tEmail(locale, 'sxMinutes', { minutes: quote.actualMinutes ?? extension.minutes }), early: tEmail(locale, 'sxMinutes', { minutes: extension.minutes }),
    note: extra.disputeNote || extension.note || null });
  for (const [audience, prefix] of sessionExtensionAudiences(event, extension.kind)) {
    const locale = (audience === 'chef' ? people[0]?.locale : audience === 'manager' ? managers[0]?.locale : null) || 'en-CA';
    const copy = sessionExtensionCopy(prefix, locale, factsFor(locale));
    await queueBookingLifecycleEvent(tx, extension.bookingId, `session_extension_${event}`, copy.title, copy.message, actorId,
      { recipientPolicy: audience, extensionId: extension.id, event, kind: extension.kind, minutes: extension.minutes, amountCents: extension.amountCents,
        kitchenGrossCents: quote.kitchenGrossCents, endAt: extension.endAt.toISOString(), ...(audience === 'admins' ? { supportCase: true } : {}) });
  }
}
