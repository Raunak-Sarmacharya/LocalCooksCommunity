import { ensureServerI18n, tLocale } from '../i18n';
import { partialAcceptanceDeadlineText } from '@shared/partial-acceptance';

/**
 * The kitchen accepted a request without some equipment and the chef must approve the new total (owner, Oct 17).
 * Raw facts travel in the event metadata; wording and formats are resolved per recipient locale here.
 */
export type PartialAcceptanceNotice = {
  variant: 'proposed' | 'declined' | 'expired' | 'hold_ended';
  /** Declined equipment; `date` (YYYY-MM-DD) names the day of a dated booking. */
  items: Array<{ name: string; date?: string }>;
  /** Multi-day (owner, Oct 19): the days the kitchen can't host (YYYY-MM-DD). */
  days?: string[];
  newCents: number; oldCents: number;
  /** ISO instant the chef must answer by. */
  deadlineAt: string;
};

export async function partialAcceptanceNotice(role: 'chef' | 'manager', locale: string | null | undefined, notice: PartialAcceptanceNotice,
  names: { chefName?: string; kitchenName: string; timezone?: string | null }) {
  await ensureServerI18n();
  const lng = locale || 'en-CA';
  const t = (key: string, values?: Record<string, unknown>) => tLocale(locale, key, { ns: 'booking', ...values });
  const money = (cents: number) => new Intl.NumberFormat(lng, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const day = (date: string) => new Intl.DateTimeFormat(lng, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  const items = new Intl.ListFormat(lng, { type: 'conjunction' }).format(notice.items.map(item => item.date ? `${item.name} (${day(item.date)})` : item.name));
  // A deadline always names the kitchen's zone ("Tue, Oct 21, 9:00 p.m. Newfoundland Time").
  const deadline = partialAcceptanceDeadlineText(notice.deadlineAt, lng, names.timezone);
  // What changes, days first: "not on Wed, Nov 25; without Mixer (Mon, Nov 23)".
  const changes = [...(notice.days ?? []).map(date => t('paChangeNotOn', { day: day(date) })), ...(notice.items.length ? [t('paChangeWithout', { items })] : [])].join('; ');
  const values = { kitchen: names.kitchenName, chef: names.chefName || t('paTheChef'), items, changes, newTotal: money(notice.newCents), oldTotal: money(notice.oldCents), deadline };
  const variant = notice.variant === 'hold_ended' ? 'HoldEnded' : `${notice.variant[0].toUpperCase()}${notice.variant.slice(1)}`;
  const key = `pa${role === 'chef' ? 'Chef' : 'Kitchen'}${variant}`;
  return { title: t(`${key}Title`, values), message: t(`${key}Body`, values).replace(/\.\.(?=\s|$)/g, '.'),
    ...(role === 'chef' && notice.variant === 'proposed' ? { actionLabel: t('paChefProposedAction') } : {}) };
}
