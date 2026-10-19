import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useRoute } from 'wouter';
import { Check, Clock, Loader2, X } from 'lucide-react';
import ChefDashboardLayout from '@/layouts/ChefDashboardLayout';
import { useChefShellChrome } from '@/layouts/chef-shell-context';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/lib/api';
import { formatTime } from '@/lib/formatters';
import { friendlyDateTime } from '@/lib/friendly-date';
import { partialAcceptanceDeadlineText, type PartialAcceptance } from '@shared/partial-acceptance';

type Details = { id: number; status: string; paymentStatus?: string; scheduleRevision?: number; bookingDate: string; startTime: string; endTime: string;
  pricingMode?: string; kitchen?: { name: string; photos?: string[] }; location?: { timezone?: string };
  partialAcceptance?: PartialAcceptance | null; paymentTransaction?: { amount: number };
  cancellationPolicySnapshot?: { noticeHours: number; sessions: Array<{ startAt: string }> } | null;
  visits?: Array<{ id: number; visitDate?: string | null; startTime: string; endTime: string; pricingMode?: string | null; scheduleRevision?: number; scheduleState?: string }>;
  equipmentBookings?: Array<{ id: number; kitchenBookingVisitId?: number | null; totalPrice: number; equipmentListing?: { equipmentType: string; brand?: string | null } }> };

/**
 * The kitchen answered with changes (owner, Oct 17/19; Airbnb shows a host's offer on its own page): the chef sees every
 * requested day and add-on as kept or not available, the old and new total, then accepts and pays or declines.
 */
export default function ChefOfferPage() {
  const { t, i18n } = useTranslation('booking');
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [, params] = useRoute('/booking/:id/offer');
  const bookingId = Number(params?.id);
  const locale = i18n.resolvedLanguage || 'en-CA';
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const dayLabel = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  const query = useQuery({ queryKey: ['chef-offer', bookingId], enabled: bookingId > 0, retry: false, queryFn: async () => {
    const response = await apiClient.get(`/chef/bookings/${bookingId}/details`);
    const result = await response.json();
    if (!response.ok) throw Error(result.error || t('paOfferClosed'));
    return result as Details;
  } });
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null), [confirmDecline, setConfirmDecline] = useState(false), [error, setError] = useState('');
  const onViewChange = useCallback((view: string) => navigate(view === 'overview' ? '/dashboard' : `/dashboard?view=${view}`), [navigate]);
  const breadcrumbs = useMemo(() => [{ label: t('invChefBookings'), onClick: () => navigate('/dashboard?view=bookings') },
    { label: t('paOfferBack'), onClick: () => navigate(`/booking/${bookingId}`) }, { label: t('paOfferCrumb') }], [t, navigate, bookingId]);
  const inShell = useChefShellChrome({ activeView: 'bookings', onViewChange, breadcrumbs });

  const booking = query.data, offer = booking?.partialAcceptance;
  const open = !!offer && offer.state === 'waiting' && booking?.status === 'pending';
  const answer = async (choice: 'accept' | 'decline') => {
    if (!offer) return;
    setBusy(choice); setError('');
    try {
      const response = await apiClient.post(`/chef/bookings/${bookingId}/partial-acceptance`, { proposalId: offer.id, answer: choice });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || t('paAnswerFailed'));
      toast({ title: t(choice === 'accept' ? 'paAcceptedToast' : 'paDeclinedToast', choice === 'accept' ? { amount: money(offer.newTotalCents) } : undefined) });
      navigate(`/booking/${bookingId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('paAnswerFailed')); await query.refetch();
    } finally { setBusy(null); }
  };

  let body: ReactNode;
  if (query.isPending) body = <p role="status" className="py-16 text-center text-sm text-muted-foreground">{t('invLoading')}</p>;
  else if (!booking || !offer || !open) body = <div className="mx-auto max-w-md space-y-3 py-16 text-center">
    <p className="font-medium">{t('paOfferClosed')}</p>
    <Button asChild variant="outline"><Link href={`/booking/${bookingId}`}>{t('paOfferBack')}</Link></Button>
  </div>;
  else {
    const zone = booking.location?.timezone;
    const declinedItems = new Set(offer.equipment.filter(item => item.status === 'cancelled').map(item => item.id));
    const declinedDays = new Set(offer.declinedVisitIds ?? []);
    const name = (item: NonNullable<Details['equipmentBookings']>[number]) => [item.equipmentListing?.brand, item.equipmentListing?.equipmentType].filter(Boolean).join(' ');
    const equipment = (booking.equipmentBookings || []).filter(item => offer.equipment.some(row => row.id === item.id));
    const days = booking.scheduleRevision
      ? (booking.visits || []).filter(visit => visit.visitDate && visit.scheduleRevision === booking.scheduleRevision && visit.scheduleState === 'active')
        .sort((a, b) => String(a.visitDate).localeCompare(String(b.visitDate)))
        .map(visit => ({ id: visit.id, date: String(visit.visitDate).slice(0, 10), start: visit.startTime, end: visit.endTime, daily: visit.pricingMode === 'daily',
          items: equipment.filter(item => item.kitchenBookingVisitId === visit.id) }))
      : [{ id: 0, date: String(booking.bookingDate).slice(0, 10), start: booking.startTime, end: booking.endTime, daily: booking.pricingMode === 'daily', items: equipment }];
    // If accepted, the one refund deadline is before the first day the chef keeps (sessions follow the requested days in order).
    const firstKept = days.findIndex(day => !declinedDays.has(day.id));
    const snapshot = booking.cancellationPolicySnapshot, session = snapshot?.sessions?.[firstKept];
    const refundDeadline = snapshot && session ? friendlyDateTime(new Date(Date.parse(session.startAt) - snapshot.noticeHours * 3_600_000), locale, zone) : null;
    const deadline = partialAcceptanceDeadlineText(offer.deadlineAt, locale, zone);
    const held = booking.paymentTransaction?.amount ?? offer.oldTotalCents;
    const status = (off: boolean, label: string) => <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${off ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
      {off ? <X className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}{label}</span>;
    body = <div className="mx-auto max-w-2xl space-y-6 pb-8" data-testid="chef-offer">
      <header className="space-y-3">
        {booking.kitchen?.photos?.[0] && <img src={booking.kitchen.photos[0]} alt="" className="h-40 w-full rounded-2xl object-cover" />}
        <h1 className="text-2xl font-semibold">{t('paChefCardTitle', { kitchen: booking.kitchen?.name })}</h1>
        <p className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-900">
          <Clock className="h-4 w-4" aria-hidden />{t('paOfferAnswerBy', { deadline })}</p>
      </header>
      <section className="space-y-3 rounded-2xl border bg-card p-5" aria-labelledby="offer-changes">
        <h2 id="offer-changes" className="font-semibold">{t('paOfferWhatChanges')}</h2>
        <ul className="divide-y">{days.map(day => {
          const dayOff = declinedDays.has(day.id);
          return <li key={day.id} className="space-y-2 py-3" data-testid="offer-day">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={dayOff ? 'text-muted-foreground line-through' : ''}><p className="text-sm font-medium">{dayLabel(day.date)}</p>
                <p className="text-sm">{day.daily ? t('invFullDay') : `${formatTime(day.start, locale)}–${formatTime(day.end, locale)}`}</p></div>
              {status(dayOff, t(dayOff ? 'paOfferNotAvailable' : 'paOfferKept'))}
            </div>
            {day.items.length > 0 && <ul className="space-y-1 pl-3">{day.items.map(item => {
              const off = dayOff || declinedItems.has(item.id);
              return <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className={off ? 'text-muted-foreground line-through' : ''}>{name(item)}{Number(item.totalPrice) ? ` · ${money(Number(item.totalPrice))}` : ''}</span>
                {!dayOff && status(off, t(off ? 'paOfferNotProvided' : 'paOfferKept'))}</li>;
            })}</ul>}
          </li>;
        })}</ul>
      </section>
      <section className="space-y-2 rounded-2xl border bg-card p-5 text-sm" aria-labelledby="offer-money" data-testid="offer-money">
        <h2 id="offer-money" className="font-semibold">{t('paOfferMoney')}</h2>
        <div className="flex justify-between gap-3 text-muted-foreground"><span>{t('paOfferOriginal')}</span><s className="tabular-nums">{money(offer.oldTotalCents)}</s></div>
        <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold"><span>{t('paOfferNewTotal')}</span><span className="tabular-nums">{money(offer.newTotalCents)}</span></div>
        <p className="text-muted-foreground">{t('paOfferCharged', { amount: money(offer.newTotalCents), released: money(Math.max(0, held - offer.newTotalCents)) })}</p>
        {refundDeadline && <p className="text-muted-foreground">{t('paOfferDeadline', { deadline: refundDeadline })}</p>}
      </section>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {confirmDecline ? <div className="space-y-3 rounded-2xl border p-4" role="group" aria-label={t('paChefDeclineConfirm')}>
        <p className="text-sm font-medium">{t('paChefDeclineConfirm')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!busy} onClick={() => setConfirmDecline(false)}>{t('paChefDeclineBack')}</Button>
          <Button variant="destructive" disabled={!!busy} onClick={() => void answer('decline')}>{busy === 'decline' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('paChefDeclineYes')}</Button>
        </div>
      </div> : <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={!!busy} onClick={() => void answer('accept')} data-testid="offer-accept">
            {busy === 'accept' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('paOfferAccept', { amount: money(offer.newTotalCents) })}</Button>
          <Button className="min-h-11" variant="outline" disabled={!!busy} onClick={() => setConfirmDecline(true)}>{t('paChefDecline')}</Button>
          <Button asChild className="min-h-11" variant="ghost"><Link href="/dashboard?view=messages">{t('invAskQuestion')}</Link></Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('paOfferNoAnswer', { deadline })}</p>
      </div>}
    </div>;
  }
  if (inShell) return body;
  return <ChefDashboardLayout activeView="bookings" onViewChange={onViewChange} breadcrumbs={breadcrumbs}>{body}</ChefDashboardLayout>;
}
