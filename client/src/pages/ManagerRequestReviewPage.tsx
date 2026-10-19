import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useRoute } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatTime } from '@/lib/formatters';
import ManagerBookingLayout from '@/layouts/ManagerBookingLayout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { estimateCardFeeCents } from '@shared/card-fee-estimate';
import { partialAcceptanceDeadlineText } from '@shared/partial-acceptance';

type Visit = { id: number; visitDate?: string | null; startTime: string; endTime: string; pricingMode?: string | null; scheduleRevision?: number;
  scheduleState?: string; priceSnapshot?: { kitchenCents?: number } | null };
type Equipment = { id: number; kitchenBookingVisitId?: number | null; totalPrice: number; status: string;
  equipmentListing?: { equipmentType: string; brand?: string | null } };
type Details = { id: number; referenceCode?: string | null; chefId: number; status: string; paymentStatus?: string; scheduleRevision?: number;
  bookingDate: string; startTime: string; endTime: string; pricingMode?: string; totalPrice?: number; specialNotes?: string | null;
  responseDeadlineAt?: string | null; partialAcceptanceAvailable?: boolean; partialAcceptance?: { state?: string } | null;
  chef?: { fullName?: string; username: string }; kitchen?: { name: string }; location?: { id: number; timezone?: string };
  visits?: Visit[]; equipmentBookings?: Equipment[];
  paymentTransaction?: { amount: number; serviceFee?: number; cardCountry?: string | null } };
type Preview = { oldTotalCents: number; newTotalCents: number; serviceFeeCents: number; allowed: boolean; deadlineAt: string };

/**
 * The kitchen answers a booking request on one page (Airbnb / Peerspace request pages): what was asked, what the chef pays and
 * what the kitchen keeps, then Accept, Accept with changes (days or add-ons it can't do — the chef approves the new total,
 * owner Oct 17/19), or Decline — optionally suggesting other times through an invitation that replaces this request.
 */
export default function ManagerRequestReviewPage() {
  const { t, i18n } = useTranslation('manager');
  const [, params] = useRoute('/manager/booking/:id/review');
  const [, navigate] = useLocation();
  const bookingId = Number(params?.id);
  const { user, loading } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const locale = i18n.resolvedLanguage || 'en-CA';
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const dayLabel = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

  const query = useQuery({ queryKey: [`/api/manager/bookings/${bookingId}/details`], enabled: bookingId > 0 && !loading && user?.role === 'manager',
    retry: false, queryFn: async () => {
      const response = await apiClient.get(`/manager/bookings/${bookingId}/details`);
      const result = await response.json();
      if (!response.ok) throw Error(result.error || t('rrLoadFailed'));
      return result as Details;
    } });
  const booking = query.data;
  const [declinedDays, setDeclinedDays] = useState<number[]>([]);
  const [declinedItems, setDeclinedItems] = useState<number[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null), [previewError, setPreviewError] = useState('');
  const [declining, setDeclining] = useState<null | 'decline' | 'suggest'>(null), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  const chef = booking?.chef?.fullName || booking?.chef?.username || t('rrTheChef');
  const dated = (booking?.scheduleRevision ?? 0) > 0;
  const days = useMemo(() => {
    if (!booking) return [];
    const equipment = (booking.equipmentBookings || []).filter(item => item.status !== 'cancelled');
    const name = (item: Equipment) => [item.equipmentListing?.brand, item.equipmentListing?.equipmentType].filter(Boolean).join(' ') || t('rrEquipment');
    if (!dated) {
      const items = equipment.map(item => ({ id: item.id, name: name(item), cents: Number(item.totalPrice) || 0 }));
      return [{ id: 0, date: String(booking.bookingDate).slice(0, 10), start: booking.startTime, end: booking.endTime, fullDay: booking.pricingMode === 'daily',
        kitchenCents: Number(booking.totalPrice || 0) - items.reduce((sum, item) => sum + item.cents, 0), items }];
    }
    return (booking.visits || []).filter(visit => visit.visitDate && visit.scheduleRevision === booking.scheduleRevision && visit.scheduleState === 'active')
      .sort((a, b) => String(a.visitDate).localeCompare(String(b.visitDate)))
      .map(visit => ({ id: visit.id, date: String(visit.visitDate).slice(0, 10), start: visit.startTime, end: visit.endTime, fullDay: visit.pricingMode === 'daily',
        kitchenCents: visit.priceSnapshot?.kitchenCents ?? 0,
        items: equipment.filter(item => item.kitchenBookingVisitId === visit.id).map(item => ({ id: item.id, name: name(item), cents: Number(item.totalPrice) || 0 })) }));
  }, [booking, dated, t]);

  const changed = declinedDays.length > 0 || declinedItems.length > 0;
  // A day's items go with it: an item is "can't provide" on its own only on a day the kitchen keeps.
  const itemDeclines = declinedItems.filter(id => !days.some(day => declinedDays.includes(day.id) && day.items.some(item => item.id === id)));
  useEffect(() => {
    if (!changed || !booking) { setPreview(null); setPreviewError(''); return; }
    let stale = false;
    const timer = setTimeout(() => void (async () => {
      const response = await apiClient.post(`/manager/bookings/${booking.id}/partial-acceptance/preview`, { equipmentBookingIds: itemDeclines, declinedVisitIds: declinedDays });
      const result = await response.json().catch(() => ({}));
      if (stale) return;
      if (!response.ok) { setPreview(null); setPreviewError(result.error || t('rrError')); return; }
      setPreview(result); setPreviewError('');
    })().catch(() => { if (!stale) setPreviewError(t('rrError')); }), 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [booking?.id, changed, declinedDays.join(), itemDeclines.join()]);

  if (loading || query.isPending) return <p role="status" className="p-6">{t('rrLoading')}</p>;
  const pending = booking?.status === 'pending' && booking.paymentStatus === 'authorized' && booking.partialAcceptance?.state !== 'waiting';
  const txn = booking?.paymentTransaction;
  const timeForChanges = booking?.partialAcceptanceAvailable !== false && (!preview || preview.allowed);
  const chefPays = changed && preview ? preview.newTotalCents : txn?.amount ?? 0;
  const serviceFee = changed && preview ? preview.serviceFeeCents : txn?.serviceFee ?? 0;
  const cardFee = estimateCardFeeCents(chefPays, txn?.cardCountry);
  const deadline = booking?.responseDeadlineAt ? partialAcceptanceDeadlineText(booking.responseDeadlineAt, locale, booking.location?.timezone) : null;
  const toggle = (list: number[], set: (next: number[]) => void, id: number) => set(list.includes(id) ? list.filter(value => value !== id) : [...list, id]);

  const decide = async (status: 'confirmed' | 'cancelled', suggest = false) => {
    if (!booking) return;
    setBusy(true); setError('');
    try {
      const response = await apiClient.put(`/manager/bookings/${booking.id}/status`, status === 'confirmed'
        ? { status, equipmentActions: itemDeclines.map(id => ({ equipmentBookingId: id, action: 'cancelled' })), declinedVisitIds: declinedDays }
        : suggest ? { status, suggestOtherTimes: true } : { status, message: message.trim() || undefined });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || t('rrError'));
      await queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      toast.success(suggest ? t('rrDeclinedSuggest', { chef }) : status === 'cancelled' ? t('rrDeclined') : result.proposal ? t('rrChangesSent', { chef }) : t('rrAccepted'));
      // Declined to suggest other times: the request's days are free now, so the invitation can offer them again.
      navigate(suggest ? `/manager/invitations/new?chefId=${booking.chefId}&location=${booking.location?.id ?? ''}&fromBooking=${booking.id}` : `/manager/booking/${booking.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('rrError'));
      await query.refetch();
    } finally { setBusy(false); }
  };

  return <ManagerBookingLayout bookingLocationId={booking?.location?.id} breadcrumbs={[
    { label: t('rrBookings'), href: '/manager/dashboard?view=bookings' },
    { label: booking?.referenceCode || `#${bookingId}`, href: `/manager/booking/${bookingId}` }, { label: t('rrCrumb') }]}>
    <div className="mx-auto max-w-5xl space-y-5 pb-32">
      <Link className="inline-flex items-center gap-2 text-sm font-medium hover:underline" href={`/manager/booking/${bookingId}`}><ArrowLeft className="h-4 w-4" />{t('rrBack')}</Link>
      {query.error && <p role="alert" className="rounded-xl border p-4 text-destructive">{query.error.message}</p>}
      {booking && <>
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">{t('rrTitle', { chef })}</h1>
          <p className="text-sm text-muted-foreground">{[booking.kitchen?.name, booking.referenceCode].filter(Boolean).join(' · ')}</p>
          {pending && deadline && <p className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-900">
            <Clock className="h-4 w-4" aria-hidden />{t('rrRespondBy', { deadline })}</p>}
        </header>
        {!pending && <p role="status" className="rounded-xl border p-4 text-sm">{t('rrNotPending')} <Link className="underline" href={`/manager/booking/${booking.id}`}>{t('rrBack')}</Link></p>}
        {pending && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <section className="rounded-2xl border bg-card p-5" aria-labelledby="rr-days">
              <h2 id="rr-days" className="text-base font-semibold">{t(dated ? 'rrDaysTitle' : 'rrTimeTitle')}</h2>
              {dated && days.length > 1 && <p className="mt-1 text-sm text-muted-foreground">{t('rrDaysHelp')}</p>}
              <ul className="mt-3 divide-y">{days.map(day => {
                const dayOff = declinedDays.includes(day.id);
                const lastKept = !dayOff && days.length - declinedDays.length <= 1;
                return <li key={day.id} className={`space-y-2 py-4 ${dayOff ? 'opacity-60' : ''}`} data-testid="rr-day">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{dayLabel(day.date)}</p>
                      <p className="text-sm text-muted-foreground">{day.fullDay ? t('rrFullDay') : `${formatTime(day.start, locale)} – ${formatTime(day.end, locale)}`}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm tabular-nums ${dayOff ? 'line-through' : ''}`}>{money(day.kitchenCents + day.items.reduce((sum, item) => sum + item.cents, 0))}</p>
                      {dated && days.length > 1 && <label className="mt-1 flex items-center justify-end gap-2 text-sm">
                        <Checkbox checked={dayOff} disabled={!timeForChanges || lastKept || busy} onCheckedChange={() => toggle(declinedDays, setDeclinedDays, day.id)} />
                        {t('rrCantHost')}</label>}
                    </div>
                  </div>
                  {day.items.length > 0 && <ul className="space-y-1.5 rounded-xl bg-muted/40 p-3">{day.items.map(item => {
                    const off = dayOff || declinedItems.includes(item.id);
                    return <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className={off ? 'line-through text-muted-foreground' : ''}>{item.name} · {item.cents ? money(item.cents) : t('rrIncluded')}</span>
                      <label className="flex items-center gap-2"><Checkbox checked={off} disabled={dayOff || !timeForChanges || busy}
                        onCheckedChange={() => toggle(declinedItems, setDeclinedItems, item.id)} />{t('rrCantProvide')}</label>
                    </li>;
                  })}</ul>}
                </li>;
              })}</ul>
              {!timeForChanges && <p className="mt-2 text-sm text-muted-foreground">{t('rrNoTimeForChanges')}</p>}
            </section>
            {booking.specialNotes && <section className="rounded-2xl border bg-card p-5"><h2 className="text-base font-semibold">{t('rrChefNote', { chef })}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">{booking.specialNotes}</p></section>}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <section className="rounded-2xl border bg-card p-5 text-sm" aria-labelledby="rr-money" data-testid="rr-money">
              <h2 id="rr-money" className="text-base font-semibold">{t('rrMoneyTitle')}</h2>
              <div className="mt-3 space-y-2">
                <p className="flex justify-between gap-3"><span>{t('rrChefPays')}</span><span className="tabular-nums">
                  {changed && preview && preview.newTotalCents !== preview.oldTotalCents && <span className="mr-2 text-muted-foreground line-through">{money(preview.oldTotalCents)}</span>}
                  {money(chefPays)}</span></p>
                <p className="flex justify-between gap-3 text-muted-foreground"><span>{t('rrBookingAmount')}</span><span className="tabular-nums">{money(chefPays - serviceFee)}</span></p>
                <p className="flex justify-between gap-3 text-muted-foreground"><span>{t('rrEstFee')}</span><span className="tabular-nums">−{money(cardFee)}</span></p>
                <p className="flex justify-between gap-3 border-t pt-2 font-semibold"><span>{t('rrEstReceive')}</span><span className="tabular-nums">{money(chefPays - serviceFee - cardFee)}</span></p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('rrFeeNote')}</p>
              {previewError && <p role="alert" className="mt-2 text-sm text-destructive">{previewError}</p>}
            </section>
            {changed && preview && <p className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950" data-testid="rr-changes-note">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{t('rrChangesNote', { chef, deadline: partialAcceptanceDeadlineText(preview.deadlineAt, locale, booking.location?.timezone) })}</p>}
          </aside>
        </div>}
        {pending && <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 backdrop-blur" data-testid="rr-actions">
          <div className="mx-auto max-w-5xl space-y-3">
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {declining ? <div className="space-y-3">
              <p className="font-medium">{t('rrDeclineTitle')}</p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                {(['decline', 'suggest'] as const).map(option => <button key={option} type="button" role="radio" aria-checked={declining === option}
                  onClick={() => setDeclining(option)} className={`rounded-xl border p-3 text-left text-sm ${declining === option ? 'border-primary ring-1 ring-primary' : ''}`}>
                  <span className="block font-medium">{t(option === 'decline' ? 'rrDeclineOnly' : 'rrDeclineSuggest')}</span>
                  <span className="block text-muted-foreground">{t(option === 'decline' ? 'rrDeclineOnlyHelp' : 'rrDeclineSuggestHelp')}</span></button>)}
              </div>
              {declining === 'decline' && <Textarea value={message} maxLength={500} onChange={event => setMessage(event.target.value)}
                aria-label={t('rrMessage', { chef })} placeholder={t('rrMessage', { chef })} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" disabled={busy} onClick={() => setDeclining(null)}>{t('rrBackToReview')}</Button>
                {declining === 'decline'
                  ? <Button variant="destructive" disabled={busy} onClick={() => void decide('cancelled')}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t('rrConfirmDecline')}</Button>
                  : <Button disabled={busy} onClick={() => void decide('cancelled', true)}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t('rrContinueInvite')}</Button>}
              </div>
            </div> : <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button variant="outline" disabled={busy} onClick={() => setDeclining('decline')}>{t('rrDecline')}</Button>
              <Button disabled={busy || (changed && (!preview || !preview.allowed))} onClick={() => void decide('confirmed')} data-testid="rr-accept">
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{changed ? t('rrSendChanges', { chef }) : t('rrAccept')}</Button>
            </div>}
          </div>
        </div>}
      </>}
    </div>
  </ManagerBookingLayout>;
}
