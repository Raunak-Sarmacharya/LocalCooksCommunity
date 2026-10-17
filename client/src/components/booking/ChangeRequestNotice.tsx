import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { getAuthHeaders } from '@/lib/api';
import type { DatedDay } from './dated-booking-draft';

/** What the chef is changing: the earlier pending request, read from their own booking page data. */
export interface ReplacedRequest {
  id: number;
  referenceCode: string | null;
  status: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  holdCents: number | null;
  days?: DatedDay[];
}

export function useReplacedRequest(bookingId?: number) {
  return useQuery<ReplacedRequest | null>({
    queryKey: ['change-request-source', bookingId], enabled: !!bookingId, retry: false, staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/chef/bookings/${bookingId}/details`, { headers: await getAuthHeaders(), credentials: 'include' });
      if (!response.ok) return null;
      const data = await response.json();
      const amount = Number(data?.paymentTransaction?.amount);
      const days = data.scheduleRevision ? (data.visits ?? []).filter((visit: any) => visit.scheduleRevision === data.scheduleRevision && visit.scheduleState === 'active')
        .map((visit: any) => ({ date: visit.visitDate.slice(0, 10), pricingMode: visit.pricingMode, slots: visit.selectedSlots,
          equipmentIds: (data.equipmentBookings ?? []).filter((item: any) => item.kitchenBookingVisitId === visit.id && item.status !== 'cancelled').map((item: any) => item.equipmentListingId) })) : undefined;
      return { id: Number(data.id), referenceCode: data.referenceCode ?? null, status: String(data.status || ''), bookingDate: String(data.bookingDate || ''),
        startTime: String(data.startTime || ''), endTime: String(data.endTime || ''), holdCents: Number.isFinite(amount) && amount > 0 ? amount : null, days };
    },
  });
}

/** "Oct 17, 10:00 a.m.–12:00 p.m." in the viewer's language; operating dates and clock times are kitchen-local, so read them as UTC. */
export function changeRequestWhen(request: Pick<ReplacedRequest, 'bookingDate' | 'startTime' | 'endTime' | 'days'>, language: string): string {
  if (request.days?.length) return request.days.map(day => changeRequestWhen({ bookingDate: day.date, startTime: day.slots[0]?.startTime ?? '', endTime: day.slots[day.slots.length - 1]?.endTime ?? '' }, language)).join(' · ');
  const date = request.bookingDate.slice(0, 10);
  const at = (time: string) => new Date(`${date}T${time.slice(0, 5)}:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(at(request.startTime).getTime()) || !Number.isFinite(at(request.endTime).getTime())) return '';
  const day = new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(at(request.startTime));
  const clock = new Intl.DateTimeFormat(language, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  return `${day}, ${clock.format(at(request.startTime))}–${clock.format(at(request.endTime))}`;
}

/** Top of the booking flow while changing a request. */
export function ChangeRequestBanner({ request }: { request: ReplacedRequest }) {
  const { t, i18n } = useTranslation('booking');
  return <div role="status" data-testid="change-request-banner" className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm leading-relaxed text-sky-950">
    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <div>
      <p className="font-medium">{t('crBanner', { ref: request.referenceCode || '', when: changeRequestWhen(request, i18n.resolvedLanguage || 'en-CA') })}</p>
      <p>{t('crBannerStay')}</p>
    </div>
  </div>;
}

/** One line in the consent block: what happens to the earlier request and its card hold. */
export function ChangeRequestConsentLine({ request }: { request: ReplacedRequest }) {
  const { t, i18n } = useTranslation('booking');
  const ref = request.referenceCode || '';
  const amount = request.holdCents == null ? null : new Intl.NumberFormat(i18n.resolvedLanguage || 'en-CA', { style: 'currency', currency: 'CAD' }).format(request.holdCents / 100);
  return <p className="text-xs leading-relaxed text-muted-foreground sm:text-center" data-testid="change-request-consent">
    {amount ? t('crConsent', { ref, amount }) : t('crConsentNoAmount', { ref })}
  </p>;
}
