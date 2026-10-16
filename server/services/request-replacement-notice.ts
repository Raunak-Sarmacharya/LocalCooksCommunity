import { ensureServerI18n, tLocale } from '../i18n';

/**
 * Notices for a chef who changed a pending request by sending a new one first ("rebook first, old one closes after").
 * Raw facts travel in the event metadata; wording and formats are resolved per recipient locale here.
 */
export type ReplacementNoticeVariant =
  /** Kitchen: one notice for the pair, on the new request. */
  | 'changed'
  /** Chef: the earlier request was withdrawn and its hold released. */
  | 'updated'
  /** Chef: the kitchen accepted the original request first, so both bookings exist. */
  | 'two_bookings'
  /** Chef: the earlier request had already been answered or expired; nothing to withdraw. */
  | 'ended'
  /** Chef: the new request stands but the earlier hold is still being released. */
  | 'releasing';

export type ReplacementNotice = {
  variant: ReplacementNoticeVariant;
  oldRef?: string; newRef?: string;
  /** Cents of the earlier card hold that was (or is being) released. */
  holdCents?: number;
  /** ISO instant the kitchen must answer the new request by. */
  deadlineAt?: string;
  /** Operating dates (YYYY-MM-DD) and HH:MM times of the earlier and the new request. */
  old?: { date: string; startTime: string; endTime: string };
  next?: { date: string; startTime: string; endTime: string };
  /** `updated`: the new request (the chef's notice opens it) and its card hold in cents. */
  newBookingId?: number; newHoldCents?: number;
};

function when(locale: string, value?: ReplacementNotice['old']) {
  if (!value) return '';
  const at = (time: string) => new Date(`${value.date}T${time.slice(0, 5)}:00Z`);
  const day = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(at(value.startTime));
  const clock = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  return `${day}, ${clock.format(at(value.startTime))}–${clock.format(at(value.endTime))}`;
}

export async function requestReplacementNotice(locale: string | null | undefined, notice: ReplacementNotice,
  names: { chefName?: string; kitchenName: string; timezone?: string | null }) {
  const built = await build(locale, notice, names);
  // A time that ends in "a.m." / "p.m." must not leave a doubled full stop.
  return { ...built, message: built.message.replace(/\.\.(?=\s|$)/g, '.') };
}

async function build(locale: string | null | undefined, notice: ReplacementNotice,
  names: { chefName?: string; kitchenName: string; timezone?: string | null }) {
  await ensureServerI18n();
  const lng = locale || 'en-CA';
  const t = (key: string, values?: Record<string, unknown>) => tLocale(locale, key, { ns: 'booking', ...values });
  const money = (cents = 0) => new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const deadline = notice.deadlineAt && Number.isFinite(Date.parse(notice.deadlineAt))
    // "Oct 17, 2026, 10:19 a.m. Newfoundland Time": a deadline always names its zone.
    ? new Intl.DateTimeFormat(lng, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'longGeneric',
      timeZone: names.timezone || 'America/St_Johns' }).format(new Date(notice.deadlineAt)) : '';
  const kitchen = names.kitchenName;
  const refs = { oldRef: notice.oldRef || '', newRef: notice.newRef || '' };
  switch (notice.variant) {
    case 'changed': {
      const values = { now: when(lng, notice.next), was: when(lng, notice.old), deadline };
      return { title: t('rpChangedTitle', { chef: names.chefName || t('dcV2Chef') }), message: t(deadline ? 'rpChangedBody' : 'rpChangedBodyNoDeadline', values) };
    }
    case 'updated': {
      const values = { kitchen, deadline, amount: money(notice.holdCents), now: when(lng, notice.next), newAmount: money(notice.newHoldCents) };
      // Name the new request (when and what is on hold) whenever the producer recorded it.
      const full = deadline && notice.next && notice.newHoldCents;
      return { title: t('rpUpdatedTitle'), message: t(full ? 'rpUpdatedBodyFull' : deadline ? 'rpUpdatedBody' : 'rpUpdatedBodyNoDeadline', values) };
    }
    case 'two_bookings':
      return { title: t('rpTwoTitle'), message: t('rpTwoBody', { kitchen, ...refs }) };
    case 'ended':
      return { title: t('rpEndedTitle'), message: t(deadline ? 'rpEndedBody' : 'rpEndedBodyNoDeadline', { kitchen, deadline, ...refs }) };
    case 'releasing':
      return { title: t('rpReleasingTitle'), message: t('rpReleasingBody', refs) };
  }
}
