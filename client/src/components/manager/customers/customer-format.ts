import { friendlyTimezoneName } from '@shared/timezone-utils';
import { formatVisitWhen } from '@/lib/visit-when';
import { timeRange } from '@/lib/booking-header-state';
import type { CustomerNextAction, CustomerNextBooking, CustomerStatus } from './customer-types';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

const valid = (iso: string | null | undefined) => {
  const date = iso ? new Date(iso) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

/** "Wed, Oct 15, 9:00 p.m. · Newfoundland time": a moment in the kitchen's own time, with the zone in words. */
export function formatMoment(iso: string | null | undefined, timezone: string, locale: string) {
  const date = valid(iso);
  if (!date) return '';
  try {
    const when = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
    return `${when} · ${friendlyTimezoneName(timezone, locale)}`;
  } catch { return ''; }
}

/** A visit as "Wed, Oct 14 · 9–11 a.m. · Newfoundland time". */
export function formatVisit(startsAt: string | null | undefined, endsAt: string | null | undefined, timezone: string, locale: string) {
  const start = valid(startsAt), end = valid(endsAt);
  if (!start || !end) return '';
  const when = formatVisitWhen(start, end, timezone, locale);
  return when ? `${when} · ${friendlyTimezoneName(timezone, locale)}` : '';
}

export function formatDay(iso: string | null | undefined, timezone: string, locale: string) {
  const date = valid(iso);
  if (!date) return '';
  try { return new Intl.DateTimeFormat(locale, { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric' }).format(date); } catch { return ''; }
}

/** Calendar dates ("2026-10-20") must never pass through the browser's zone. */
export function formatCalendarDay(value: string | null | undefined, locale: string) {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)));
}

export function formatMoney(cents: number, locale: string, currency = 'CAD') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);
}

const documentLabelKey = (key: string | null) => key === 'foodEstablishmentCert' ? 'cuDocEstablishment' : key === 'insurance' ? 'cuDocInsurance' : 'cuDocFoodSafety';
/** A built-in document by its translated name; one the kitchen added by the name the kitchen gave it. */
export const documentLabel = (t: Translate, key: string | null, own?: string | null) => key?.startsWith('custom:') ? own || t('cuDocOther') : t(documentLabelKey(key));

export const statusLabelKey: Record<CustomerStatus, string> = {
  applied: 'cuStatusApplied', in_review: 'cuStatusInReview', approved: 'cuStatusApproved', suspended: 'cuStatusSuspended',
  revoked: 'cuStatusRevoked', former: 'cuStatusFormer', prospect: 'cuStatusProspect',
};
export const statusVariant: Record<CustomerStatus, 'success' | 'warning' | 'info' | 'destructive' | 'outline'> = {
  approved: 'success', in_review: 'warning', applied: 'info', suspended: 'warning', revoked: 'destructive', former: 'outline', prospect: 'outline',
};

/** The sentence for a next action, without whose turn it is. */
export function nextActionText(t: Translate, next: CustomerNextAction, nextBooking: Pick<CustomerNextBooking, 'startsAt' | 'endsAt' | 'timezone'> | null, timezone: string, locale: string) {
  const when = formatMoment(next.deadlineAt, timezone, locale);
  switch (next.code) {
    case 'problem': return t(next.owner === 'you' ? 'cuNextProblemYou' : 'cuNextProblemLocalCooks');
    case 'booking_request': return when ? t('cuNextBookingRequestBy', { when }) : t('cuNextBookingRequest');
    case 'inspection': return when ? t('cuNextInspectionBy', { when }) : t('cuNextInspection');
    case 'payment_recovery': return t('cuNextPaymentRecovery');
    case 'documents_review': return t('cuNextDocumentsReview');
    case 'cancellation_request': return t('cuNextCancellation');
    case 'tour_request': return when ? t('cuNextTourRequestBy', { when }) : t('cuNextTourRequest');
    case 'tour_reschedule': return when ? t('cuNextTourRescheduleBy', { when }) : t('cuNextTourReschedule');
    case 'tour_feedback': return t('cuNextTourFeedback');
    case 'document_expiring': return t('cuNextDocExpiring', { document: documentLabel(t, next.documentKey, next.documentLabel), days: Math.max(next.documentDays ?? 0, 0) });
    case 'document_expired': return t('cuNextDocExpired', { document: documentLabel(t, next.documentKey, next.documentLabel) });
    case 'waiting_documents': return t('cuNextWaitingDocuments');
    case 'local_cooks_review': return t('cuNextLocalCooksReview');
    case 'next_booking': {
      const visit = nextBooking ? formatVisit(nextBooking.startsAt, nextBooking.endsAt, nextBooking.timezone, locale) : '';
      return visit ? t('cuNextBooking', { when: visit }) : t('cuNextNone');
    }
    default: return t('cuNextNone');
  }
}

/** One line for the list: "Your turn · Respond to a booking request by …". */
export function nextActionLine(t: Translate, next: CustomerNextAction, name: string, timezone: string, locale: string) {
  const text = nextActionText(t, next, null, timezone, locale);
  if (next.owner === 'you') return `${t('cuOwnerYou')} · ${text}`;
  if (next.owner === 'customer') return `${t('cuOwnerCustomer', { name })} · ${text}`;
  return text;
}

export function targetHref(target: CustomerNextAction['target']) {
  if (!target) return null;
  switch (target.kind) {
    case 'booking': return `/manager/booking/${target.id}`;
    case 'inspection': return `/manager/booking/${target.id}/inspection`;
    case 'application': return `/manager/dashboard?view=applications&application=${target.id}`;
    case 'tour': return `/manager/tours/${target.id}`;
  }
}
export const targetLabelKey = { booking: 'cuOpenBooking', inspection: 'cuOpenInspection', application: 'cuOpenApplication', tour: 'cuOpenTour' } as const;

export const customerHref = (chefId: number, locationId: number) => `/manager/customers/${chefId}?location=${locationId}`;

const zoneDay = (date: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const clock = (date: Date, timezone: string, locale: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(date);

/** "Today", "Tomorrow" or "Thu, Oct 22", in the kitchen's zone. */
export function relativeDay(t: Translate, iso: string | null | undefined, timezone: string, locale: string, now = new Date(), inline = false) {
  const date = valid(iso);
  if (!date) return '';
  try {
    const key = zoneDay(date, timezone);
    // Inline ("last visit today") reads lower-case in English; each locale words both forms.
    if (key === zoneDay(now, timezone)) return t(inline ? 'cpTodayInline' : 'cpToday');
    if (key === zoneDay(new Date(now.getTime() + 86_400_000), timezone)) return t(inline ? 'cpTomorrowInline' : 'cpTomorrow');
    if (key === zoneDay(new Date(now.getTime() - 86_400_000), timezone)) return t(inline ? 'cpYesterdayInline' : 'cpYesterday');
    return new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  } catch { return ''; }
}

/** "10:00–11:00 a.m." */
export function clockRange(startsAt: string | null | undefined, endsAt: string | null | undefined, timezone: string, locale: string) {
  const start = valid(startsAt), end = valid(endsAt);
  if (!start || !end) return '';
  try { return timeRange(clock(start, timezone, locale), clock(end, timezone, locale)); } catch { return ''; }
}

/** "Tomorrow, 10:00–11:00 a.m."; a visit over several days keeps both ends: "Sun, Oct 18, 5:00 p.m. – Fri, Oct 23, 6:00 p.m.". */
export function visitLine(t: Translate, startsAt: string | null | undefined, endsAt: string | null | undefined, timezone: string, locale: string, now = new Date(), inline = false) {
  const start = valid(startsAt), end = valid(endsAt);
  if (!start || !end) return '';
  try {
    const day = (iso: string | null | undefined) => relativeDay(t, iso, timezone, locale, now, inline);
    if (zoneDay(start, timezone) === zoneDay(end, timezone)) return `${day(startsAt)}, ${clockRange(startsAt, endsAt, timezone, locale)}`;
    return `${day(startsAt)}, ${clock(start, timezone, locale)} – ${day(endsAt)}, ${clock(end, timezone, locale)}`;
  } catch { return ''; }
}

/** Calendar dates as a span: "Oct 16–23", "Oct 29 – Nov 5". */
export function dateSpan(first: string | null | undefined, last: string | null | undefined, locale: string) {
  const a = first?.slice(0, 10), b = last?.slice(0, 10);
  if (!a) return '';
  const format = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' });
  try {
    if (!b || a === b) return format.format(new Date(`${a}T12:00:00Z`));
    const [from, to = ''] = format.formatRange(new Date(`${a}T12:00:00Z`), new Date(`${b}T12:00:00Z`)).split(/\s*–\s*/);
    // Tight between numbers ("Oct 16–23"), spaced between two dates ("Oct 29 – Nov 5").
    return /[^\d\s.]/.test(from) && /[^\d\s.]/.test(to) ? `${from} – ${to}` : `${from}–${to}`;
  } catch { return ''; }
}

/** "Oct 21, 8:17 p.m." in the kitchen's zone. */
export function shortMoment(iso: string | null | undefined, timezone: string, locale: string) {
  const date = valid(iso);
  if (!date) return '';
  try { return new Intl.DateTimeFormat(locale, { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date); } catch { return ''; }
}

/** "8:17 p.m." */
export function clockOf(iso: string | null | undefined, timezone: string, locale: string) {
  const date = valid(iso);
  if (!date) return '';
  try { return clock(date, timezone, locale); } catch { return ''; }
}
