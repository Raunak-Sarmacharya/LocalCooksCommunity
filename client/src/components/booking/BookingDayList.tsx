import { useTranslation } from 'react-i18next';
import { formatTime } from '@/lib/formatters';
import { Card } from '@/components/ui/card';

export type BookingDayVisit = { id: number; visitDate?: string | null; startTime: string; endTime: string;
  scheduleRevision?: number | null; scheduleState?: string | null; pricingMode?: string | null; checkinStatus?: string | null;
  operatingWindowStartTime?: string | null; closeout?: { scheduledStartAt?: string; scheduledEndAt?: string } };

export function currentBookingDays<V extends BookingDayVisit>(visits: V[], revision: number) {
  return visits.filter(visit => visit.visitDate && visit.scheduleRevision === revision && visit.scheduleState !== 'superseded')
    .sort((a, b) => a.visitDate!.localeCompare(b.visitDate!));
}

export function BookingDayList({ bookingId, visits, timezone, status }: { bookingId: number; visits: BookingDayVisit[]; timezone: string; status: string }) {
  const { t, i18n } = useTranslation('booking');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name: string) => parts.find(value => value.type === name)?.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  return <Card className="rounded-2xl border-border/70 p-4 shadow-none sm:p-6" data-testid="booking-day-list">
    <h2 className="mb-3 text-base font-semibold">{t('mdYourDays')}</h2>
    <ul className="divide-y">{visits.map(visit => {
      const date = visit.visitDate!.slice(0, 10);
      const cancelled = status === 'cancelled' || visit.scheduleState === 'cancelled';
      const inProgress = !!visit.closeout?.scheduledStartAt && !!visit.closeout?.scheduledEndAt
        && Date.now() >= Date.parse(visit.closeout.scheduledStartAt) && Date.now() < Date.parse(visit.closeout.scheduledEndAt);
      const isToday = date === today || inProgress;
      const state = cancelled ? 'mdDayCancelled' : visit.checkinStatus === 'checked_out' || date < today && !inProgress ? 'mdDayDone' : isToday ? 'mdDayToday' : 'mdDayUpcoming';
      return <li key={visit.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="text-sm font-semibold">{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))}</p>
          <p className="text-sm text-muted-foreground">{visit.pricingMode === 'daily' ? t('sheetDailyRate') : `${formatTime(visit.startTime, i18n.language)} – ${formatTime(visit.endTime, i18n.language)}`}</p>
          <span className="text-sm">{t(state)}</span></div>
        {!cancelled && isToday && status === 'confirmed' && visit.checkinStatus !== 'checked_out' &&
          <a className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href={`/booking/${bookingId}/visit?visitId=${visit.id}`}>{t('mdOpenVisit')}</a>}
      </li>;
    })}</ul>
  </Card>;
}
