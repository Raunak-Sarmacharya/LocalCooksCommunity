/**
 * Standalone storage-rental notices (WP-ST3).
 *
 * One outbox row per reader so each person gets copy written for them, in their own language: the chef reads the
 * kitchen's name, the kitchen reads the chef's name, and Local Cooks gets its own factual summary. In-app alerts go
 * through `notificationService`; email is queued in `email_logs` as a `lifecycle_outcome` intent and delivered by the
 * existing debounced outbox (`outcome-delivery.ts`) — no new cron. Every amount is CAD in the reader's locale and every
 * date is the rental's timezone. Stripe identifiers are never included.
 *
 * Facts carry the values this module cannot read from the rental row today (paid-through date, amounts, unit label,
 * deadlines, occurrence key) so it does not depend on the WP-ST1 columns being built in parallel.
 */
import { eq, or } from 'drizzle-orm';
import { emailLogs, kitchens, locations, storageBookings, storageListings, users } from '@shared/schema';
import { db } from '../db';
import { ensureServerI18n, tLocale } from '../i18n';
import { renderTransactionalEmail } from '../email';
import { notificationService } from './notification.service';
import { operationalEmailAllowed } from './admin-email-preferences';
import { getAppBaseUrl } from '../config';
import { getUserDisplayName } from '../utils/user-display';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { ADMIN_STORAGE_KINDS, adminStorageNotice } from './admin-booking-notice';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StorageNoticeEvent = 'requested' | 'approved' | 'declined' | 'expired' | 'withdrawn' | 'authorization_lapsed' | 'move_in_due' | 'moved_in'
  | 'ending' | 'extended' | 'grace_started' | 'holdover_started' | 'holdover_charge' | 'holdover_waived' | 'not_moved_in' | 'removal_recorded' | 'reclaim'
  | 'move_out_requested' | 'cleared' | 'reopened' | 'removal_review' | 'final_notice' | 'refund_issued'
  | 'payout_scheduled' | 'payout_released' | 'payout_on_hold' | 'kitchen_debt' | 'offer_extension';

export type StorageNoticeFacts = {
  /** Stable key for this occurrence (a date, term id or variant) so retries never queue a second email. */
  eventKey: string;
  /** The rental's timezone; falls back to the location's timezone. */
  timezone?: string;
  listingName?: string;
  unitLabel?: string;
  startOn?: string | Date;
  endOn?: string | Date;
  paidThrough?: string | Date;
  /** The one date the event is about (cleared/reopened/holdover start). */
  date?: string | Date;
  byDate?: string | Date;
  graceEndsOn?: string | Date;
  deadline?: string | Date;
  payoutDate?: string | Date;
  perishablesAfter?: string | Date;
  othersAfter?: string | Date;
  photos?: number;
  days?: number;
  amountCents?: number;
  dailyCents?: number;
  holdReason?: string | null;
  reference?: string;
};

/** Who hears about each event (the WP-ST3 event table). */
export function storageNoticeAudiences(event: StorageNoticeEvent): Array<'chef' | 'manager' | 'admins'> {
  switch (event) {
    case 'requested': return ['chef', 'manager', 'admins'];
    case 'approved': return ['chef', 'admins'];
    case 'declined': return ['chef'];
    case 'withdrawn': return ['chef', 'manager'];
    case 'authorization_lapsed': return ['chef', 'manager', 'admins'];
    case 'expired': return ['chef', 'manager', 'admins'];
    case 'move_in_due': return ['chef'];
    case 'moved_in': return ['manager'];
    case 'ending': return ['chef', 'manager'];
    case 'extended': return ['chef', 'manager', 'admins'];
    case 'grace_started': return ['chef', 'manager'];
    case 'holdover_started': return ['chef', 'manager'];
    case 'holdover_charge': case 'holdover_waived': return ['chef', 'admins'];
    case 'not_moved_in': return ['manager'];
    case 'reclaim': return ['chef', 'manager', 'admins'];
    case 'move_out_requested': case 'cleared': case 'reopened': return ['chef', 'manager'];
    case 'removal_review': case 'final_notice': return ['chef', 'manager', 'admins'];
    case 'removal_recorded': return ['chef', 'manager'];
    case 'refund_issued': return ['chef', 'manager', 'admins'];
    case 'payout_scheduled': return ['manager'];
    case 'payout_released': case 'payout_on_hold': return ['manager', 'admins'];
    case 'kitchen_debt': return ['manager', 'admins'];
    case 'offer_extension': return ['chef'];
  }
}

/** Local Cooks' tracking kind for an event, when admins should hear about it. */
const ADMIN_EVENT_KIND: Partial<Record<StorageNoticeEvent, string>> = {
  requested: 'storage_requested', expired: 'storage_expired', approved: 'storage_confirmed',
  authorization_lapsed: 'storage_payment_recovery',
  extended: 'storage_extension_paid', refund_issued: 'storage_refund_issued',
  payout_released: 'storage_payout_released', payout_on_hold: 'storage_payout_on_hold',
  holdover_charge: 'storage_holdover_raised', holdover_waived: 'storage_holdover_waived', reclaim: 'storage_reclaim_served',
  removal_review: 'storage_removal_review', final_notice: 'storage_removal_review',
  kitchen_debt: 'storage_kitchen_debt',
};

export function storageAdminKind(event: StorageNoticeEvent): string | undefined {
  const kind = ADMIN_EVENT_KIND[event];
  return kind && ADMIN_STORAGE_KINDS.has(kind) ? kind : undefined;
}

const HIGH_PRIORITY = new Set<StorageNoticeEvent>([
  'holdover_started', 'holdover_charge', 'reclaim', 'removal_review', 'final_notice', 'payout_on_hold', 'kitchen_debt',
]);

const pascal = (event: string) => event.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('');

/** `YYYY-MM-DD` dates are kitchen-local calendar dates: read them at noon UTC so the zone never shifts the day. */
function asInstant(value: string | Date | undefined) {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
}

export async function queueStorageRentalNotice(tx: Tx, rentalId: number, event: StorageNoticeEvent, facts: StorageNoticeFacts) {
  await ensureServerI18n();
  const [row] = await tx.select({
    rental: storageBookings, listingName: storageListings.name,
    kitchenName: kitchens.name, managerId: locations.managerId, timezone: locations.timezone,
  }).from(storageBookings)
    .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(storageBookings.id, rentalId)).limit(1);
  if (!row) throw new Error('Storage rental notice context missing');

  const audiences = storageNoticeAudiences(event);
  const adminKind = audiences.includes('admins') ? storageAdminKind(event) : undefined;
  const people = await tx.select().from(users).where(or(
    row.rental.chefId ? eq(users.id, row.rental.chefId) : undefined,
    row.managerId ? eq(users.id, row.managerId) : undefined,
    adminKind ? eq(users.role, 'admin') : undefined));
  const chefName = row.rental.chefId ? await getUserDisplayName(row.rental.chefId, 'chef', tx) : '';
  const managerName = row.managerId ? await getUserDisplayName(row.managerId, 'manager', tx) : '';
  const listingName = facts.listingName || row.listingName;
  const reference = facts.reference || row.rental.referenceCode || `#${rentalId}`;
  const prefix = `st${pascal(event)}`;

  for (const person of people) {
    const chef = person.id === row.rental.chefId;
    const localCooks = person.role === 'admin';
    const audience = chef ? 'chef' : localCooks ? 'admins' : 'manager';
    if (!audiences.includes(audience)) continue;
    const role = chef ? 'chef' : localCooks ? 'admin' : 'manager';
    const locale = person.preferredLocale || 'en-CA';
    const timezone = facts.timezone || row.timezone || DEFAULT_TIMEZONE;
    const date = (value?: string | Date) => {
      const instant = asInstant(value);
      return instant ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone }).format(instant) : '';
    };
    const deadline = (value?: string | Date) => {
      const instant = asInstant(value);
      return instant ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(instant) : '';
    };
    const money = (cents?: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format((cents || 0) / 100);
    const view = tLocale(locale, 'stView', { ns: 'storage' });
    const values = {
      kitchen: row.kitchenName,
      chef: chefName && chefName !== 'A chef' ? chefName : tLocale(locale, 'stTheChef', { ns: 'storage' }),
      listing: listingName,
      unit: facts.unitLabel || listingName,
      reference,
      amount: money(facts.amountCents),
      daily: money(facts.dailyCents),
      days: facts.days ?? 0,
      photos: facts.photos ?? 0,
      start: date(facts.startOn),
      end: date(facts.endOn),
      paidThrough: date(facts.paidThrough),
      byDate: date(facts.byDate),
      graceEndsOn: date(facts.graceEndsOn),
      payoutDate: date(facts.payoutDate),
      perishableDate: deadline(facts.perishablesAfter),
      otherDate: deadline(facts.othersAfter),
      date: date(facts.date),
      deadline: deadline(facts.deadline),
    };
    const copy = localCooks
      ? (adminKind ? adminStorageNotice(adminKind, { chef: values.chef, kitchen: row.kitchenName, listing: listingName,
          reference, when: [values.start, values.end].filter(Boolean).join('–'), locale, amountCents: facts.amountCents,
          days: facts.days, paidThrough: values.paidThrough, byDate: values.byDate, deadline: values.deadline,
          holdReason: facts.holdReason ?? null }) : undefined)
      : { title: tLocale(locale, `${prefix}_${chef ? 'Chef' : 'Kitchen'}_Title`, { ns: 'storage', ...values }),
          message: tLocale(locale, `${prefix}_${chef ? 'Chef' : 'Kitchen'}_Body`, { ns: 'storage', ...values }) };
    if (!copy) continue;
    const path = role === 'chef' ? `/storage/${rentalId}` : role === 'admin' ? `/admin?section=storage-rentals&rental=${rentalId}` : `/manager/storage/${rentalId}`;

    await notificationService.create({ userId: person.id, target: role === 'chef' ? 'chef' : 'manager',
      type: 'system_announcement', priority: HIGH_PRIORITY.has(event) ? 'high' : 'normal',
      title: copy.title, message: copy.message, actionUrl: path, actionLabel: view,
      metadata: { storageRentalId: rentalId, event, eventKey: facts.eventKey } }, tx);

    // Participants get email unless they've opted out; admins only when their operational-email toggle is on.
    if (!operationalEmailAllowed(person)) continue;
    const recipientName = role === 'chef' ? values.chef : role === 'manager' ? (managerName || person.username.split('@')[0]) : person.username.split('@')[0];
    const content = renderTransactionalEmail({ to: person.username, locale, recipientName, subject: copy.title, heading: copy.title,
      message: copy.message, actionLabel: view, actionUrl: `${getAppBaseUrl(role === 'chef' ? 'chef' : role === 'admin' ? 'admin' : 'kitchen')}${path}`,
      facts: [
        { label: tLocale(locale, 'stFactKitchen', { ns: 'storage' }), value: row.kitchenName },
        { label: tLocale(locale, 'stFactListing', { ns: 'storage' }), value: listingName },
        { label: tLocale(locale, 'stFactReference', { ns: 'storage' }), value: reference },
      ] });
    await tx.insert(emailLogs).values({ recipientEmail: person.username, recipientUserId: person.id, recipientRole: role,
      subject: copy.title, previewText: copy.message, category: 'lifecycle_outcome', status: 'queued',
      trackingId: `storage-rental:${rentalId}:${event}:${facts.eventKey}:${person.id}`,
      textBody: content.text, htmlBody: content.html });
  }
}
