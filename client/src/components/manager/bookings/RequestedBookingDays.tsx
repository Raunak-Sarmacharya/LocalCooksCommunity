import { useTranslation } from 'react-i18next';
import { formatTime } from '@/lib/formatters';
import { currentBookingDays, type BookingDayVisit } from '@/components/booking/BookingDayList';

export type RequestedDay = BookingDayVisit & { priceSnapshot?: { subtotalCents?: number } | null };

/** The request is one decision; these rows describe the individual visits it includes. */
export function RequestedBookingDays({ visits, revision, equipment = [] }: {
  visits?: RequestedDay[]; revision?: number;
  equipment?: Array<{ name: string; visitDate?: string | null; rejected?: boolean }>;
}) {
  const { t, i18n } = useTranslation('manager');
  if (!revision) return null;
  const days = currentBookingDays(visits || [], revision);
  return <section className="space-y-2" aria-label={t('mdDays')}>
    <p className="text-sm font-medium">{t('mdOneDecision')}</p>
    <ul className="divide-y rounded-xl border px-4">{days.map(day => <li key={day.id} className="space-y-1 py-3 text-sm">
      <p className="font-semibold">{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day.visitDate!.slice(0, 10)}T12:00:00Z`))}</p>
      <p>{day.pricingMode === 'daily' ? t('kitchenSessionFullDay') : `${formatTime(day.startTime, i18n.language)} – ${formatTime(day.endTime, i18n.language)}`}</p>
      {equipment.filter(item => item.visitDate?.slice(0, 10) === day.visitDate!.slice(0, 10) && !item.rejected).map((item, i) => <p key={i} className="text-muted-foreground">{item.name}</p>)}
      {day.priceSnapshot?.subtotalCents != null && <p>{t('mdDaySubtotal', { amount: new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(day.priceSnapshot.subtotalCents / 100) })}</p>}
    </li>)}</ul>
  </section>;
}
