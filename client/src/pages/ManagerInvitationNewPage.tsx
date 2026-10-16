import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import ManagerBookingLayout from '@/layouts/ManagerBookingLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatTime } from '@/lib/formatters';
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { getAuthHeaders } from '@/lib/api';
import { addHours, invitationOpen, invitationRequest, type Invitation, type InvitationDraft, type InvitationPreview } from '@/lib/invitations';

type Kitchen = { id: number; name: string };
const START_TIMES = Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`);
const EXPIRY = [24, 48, 168] as const;

/**
 * "Invite to book": the kitchen offers a time (optionally at a lower kitchen price) to one approved chef. Nothing is reserved
 * by sending; the chef reviews the full price and pays to confirm (Airbnb special offer / Peerspace invite-to-book).
 */
export default function ManagerInvitationNewPage() {
  const { t, i18n } = useTranslation('booking');
  const search = new URLSearchParams(useSearch());
  const locationId = Number(search.get('locationId')) || 0;
  const queryClient = useQueryClient();
  const locale = i18n.resolvedLanguage || 'en-CA';
  const money = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);

  const [chefId, setChefId] = useState(Number(search.get('chefId')) || 0);
  const [kitchenId, setKitchenId] = useState(0);
  const [date, setDate] = useState(''), [start, setStart] = useState('10:00'), [hours, setHours] = useState(2);
  const [discountType, setDiscountType] = useState<'none' | 'amount' | 'percent'>('none'), [discountValue, setDiscountValue] = useState('');
  const [expires, setExpires] = useState<24 | 48 | 168>(48), [note, setNote] = useState('');
  const [preview, setPreview] = useState<InvitationPreview | null>(null), [previewError, setPreviewError] = useState('');
  const [sending, setSending] = useState(false), [sendError, setSendError] = useState(''), [sent, setSent] = useState<Invitation | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const chefs = useQuery({ queryKey: ['invitation-chefs', locationId], enabled: locationId > 0,
    queryFn: () => invitationRequest<{ chefs: Array<{ id: number; name: string }> }>(`/api/manager/invitations/eligible-chefs?locationId=${locationId}`) });
  const kitchens = useQuery({ queryKey: ['invitation-kitchens', locationId], enabled: locationId > 0, queryFn: async () => {
    const response = await fetch(`/api/manager/kitchens/${locationId}`, { headers: await getAuthHeaders(), credentials: 'include' });
    if (!response.ok) throw new Error(t('invLoadFailed'));
    return (await response.json()) as Kitchen[];
  } });
  useEffect(() => { if (!kitchenId && kitchens.data?.length) setKitchenId(kitchens.data[0].id); }, [kitchens.data, kitchenId]);
  const sentList = useQuery({ queryKey: ['invitations-sent', locationId, chefId], enabled: locationId > 0 && chefId > 0,
    queryFn: () => invitationRequest<{ invitations: Invitation[] }>(`/api/manager/invitations?locationId=${locationId}&chefId=${chefId}`) });

  const amount = Number(discountValue);
  const discount = discountType === 'none' || !(amount > 0) ? undefined
    : { type: discountType, value: discountType === 'amount' ? Math.round(amount * 100) : amount } as const;
  const draft: InvitationDraft | null = useMemo(() => chefId && kitchenId && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? { chefId, kitchenId, date, startTime: start, endTime: addHours(start, hours), expiresInHours: expires, ...(discount ? { discount } : {}), ...(note.trim() ? { note: note.trim() } : {}) }
    : null, [chefId, kitchenId, date, start, hours, expires, discount?.type, discount?.value, note]);

  // Live preview: the exact price the chef will see, availability, and the kitchen's estimated payout.
  useEffect(() => {
    if (!draft) { setPreview(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewError('');
      invitationRequest<InvitationPreview>('/api/manager/invitations/preview', draft)
        .then(result => { if (!cancelled) setPreview(result); })
        .catch(error => { if (!cancelled) { setPreview(null); setPreviewError(error.message); } });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [draft]);

  const chefName = chefs.data?.chefs.find(chef => chef.id === chefId)?.name || '';
  const kitchenName = kitchens.data?.find(kitchen => kitchen.id === kitchenId)?.name || '';
  const send = async () => {
    if (!draft || !preview?.available || sending) return;
    setSending(true); setSendError('');
    try {
      const invitation = await invitationRequest<Invitation>('/api/manager/invitations', { ...draft, requestKey });
      setSent(invitation); setRequestKey(crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: ['invitations-sent'] });
    } catch (error) { setSendError(error instanceof Error ? error.message : t('invSendFailed')); }
    finally { setSending(false); }
  };
  const withdraw = async (invitation: Invitation) => {
    try { await invitationRequest(`/api/manager/invitations/${invitation.id}/withdraw`, { version: invitation.version }); }
    catch (error) { setSendError(error instanceof Error ? error.message : t('invSendFailed')); }
    void queryClient.invalidateQueries({ queryKey: ['invitations-sent'] });
  };
  const when = (invitation: Pick<Invitation, 'date' | 'startTime' | 'endTime' | 'timezone'>) => t('invWhen', {
    day: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${invitation.date}T12:00:00Z`)),
    start: formatTime(invitation.startTime, locale), end: formatTime(invitation.endTime, locale), zone: friendlyTimezoneName(invitation.timezone, locale) });
  const expiresText = (iso: string, timezone?: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(iso));
  const backHref = chefId && locationId ? `/manager/customers/${chefId}?location=${locationId}` : '/manager/dashboard?view=bookings';

  const field = 'block space-y-1.5 text-sm font-medium';
  const box = 'mt-1 block min-h-11 w-full rounded-md border bg-background px-3 text-sm';
  return <ManagerBookingLayout bookingLocationId={locationId || undefined} breadcrumbs={[
    { label: t('invCustomers'), href: '/manager/dashboard?view=customers' }, ...(chefName ? [{ label: chefName, href: backHref }] : []), { label: t('invTitle') }]}>
    <div className="mx-auto max-w-5xl space-y-6">
      <Link className="inline-flex items-center gap-2 text-sm font-medium hover:underline" href={backHref}><ArrowLeft className="h-4 w-4" />{t('invBack')}</Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('invTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('invIntro')}</p>
      </div>
      {!locationId ? <p role="alert">{t('invNoLocation')}</p> : sent ? (
        <section className="space-y-4 rounded-2xl border bg-card p-6" data-testid="invitation-sent">
          <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{t('invSentTitle', { chef: chefName || t('invTheChef') })}</p>
          <p className="text-sm">{t('invSentBody', { kitchen: sent.kitchen.name, when: when(sent), total: money(sent.pricing.totalCents), expires: expiresText(sent.expiresAt, sent.timezone) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={backHref}>{t('invBackTo', { chef: chefName || t('invTheChef') })}</Link></Button>
            <Button onClick={() => { setSent(null); setPreview(null); }}>{t('invSendAnother')}</Button>
          </div>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <form className="space-y-6" onSubmit={event => { event.preventDefault(); void send(); }}>
            <section className="space-y-4 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">{t('invWhoWhere')}</h2>
              <label className={field}>{t('invChef')}
                <select className={box} value={chefId || ''} onChange={event => setChefId(Number(event.target.value))} required>
                  <option value="" disabled>{chefs.isPending ? t('invLoading') : t('invChooseChef')}</option>
                  {chefs.data?.chefs.map(chef => <option key={chef.id} value={chef.id}>{chef.name}</option>)}
                </select></label>
              {chefs.data && !chefs.data.chefs.length && <p className="text-sm text-muted-foreground">{t('invNoChefs')}</p>}
              <label className={field}>{t('invKitchen')}
                <select className={box} value={kitchenId || ''} onChange={event => setKitchenId(Number(event.target.value))} required>
                  {kitchens.data?.map(kitchen => <option key={kitchen.id} value={kitchen.id}>{kitchen.name}</option>)}
                </select></label>
            </section>
            <section className="space-y-4 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">{t('invWhen_title')}</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className={field}>{t('invDate')}<Input type="date" className="mt-1 min-h-11" value={date} onChange={event => setDate(event.target.value)} required /></label>
                <label className={field}>{t('invStart')}
                  <select className={box} value={start} onChange={event => setStart(event.target.value)}>
                    {START_TIMES.map(time => <option key={time} value={time}>{formatTime(time, locale)}</option>)}
                  </select></label>
                <label className={field}>{t('invLength')}
                  <select className={box} value={hours} onChange={event => setHours(Number(event.target.value))}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{t('chgHoursOption', { count: n })}</option>)}
                  </select></label>
              </div>
            </section>
            <section className="space-y-4 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">{t('invPrice')}</h2>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('invPrice')}>
                {(['none', 'amount', 'percent'] as const).map(kind => <Button key={kind} type="button" role="radio" aria-checked={discountType === kind}
                  variant={discountType === kind ? 'default' : 'outline'} className="min-h-11" onClick={() => setDiscountType(kind)}>{t(`invDiscount_${kind}`)}</Button>)}
              </div>
              {discountType !== 'none' && <label className={field}>{t(discountType === 'amount' ? 'invDiscountAmount' : 'invDiscountPercent')}
                <Input inputMode="decimal" className="mt-1 min-h-11 max-w-[10rem]" value={discountValue} onChange={event => setDiscountValue(event.target.value.replace(/[^\d.]/g, ''))} /></label>}
              <p className="text-xs text-muted-foreground">{t('invDiscountHelp')}</p>
              <label className={field}>{t('invNote')}
                <Textarea className="mt-1" maxLength={500} value={note} placeholder={t('invNotePlaceholder')} onChange={event => setNote(event.target.value)} /></label>
              <div className="space-y-1.5"><p className="text-sm font-medium">{t('invExpires')}</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('invExpires')}>
                  {EXPIRY.map(value => <Button key={value} type="button" role="radio" aria-checked={expires === value} variant={expires === value ? 'default' : 'outline'}
                    className="min-h-11" onClick={() => setExpires(value)}>{t(`invExpires_${value}`)}</Button>)}
                </div></div>
            </section>
          </form>
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <section className="space-y-3 rounded-2xl border bg-card p-5" data-testid="invitation-preview" aria-live="polite">
              <h2 className="font-semibold">{t('invSummary')}</h2>
              {!draft ? <p className="text-sm text-muted-foreground">{t('invSummaryEmpty')}</p>
                : previewError ? <p role="alert" className="text-sm text-destructive">{previewError}</p>
                : !preview ? <Loader2 className="h-5 w-5 animate-spin" aria-label={t('invLoading')} />
                : <>
                  <p className="text-sm">{kitchenName} · {new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${draft.date}T12:00:00Z`))}, {formatTime(draft.startTime, locale)}–{formatTime(draft.endTime, locale)}</p>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><dt>{t('invKitchenTime')}</dt><dd className="tabular-nums">
                      {preview.pricing.offeredSubtotalCents < preview.pricing.listSubtotalCents && <s className="mr-2 text-muted-foreground">{money(preview.pricing.listSubtotalCents)}</s>}
                      {money(preview.pricing.offeredSubtotalCents)}</dd></div>
                    <div className="flex justify-between gap-3"><dt>{t('invTax')}</dt><dd className="tabular-nums">{money(preview.pricing.taxCents)}</dd></div>
                    {preview.pricing.serviceFeeCents > 0 && <div className="flex justify-between gap-3"><dt>{t('invServiceFee')}</dt><dd className="tabular-nums">{money(preview.pricing.serviceFeeCents)}</dd></div>}
                    <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold"><dt>{t('invTheyPay', { chef: chefName || t('invTheChef') })}</dt><dd className="tabular-nums">{money(preview.pricing.totalCents)}</dd></div>
                    {typeof preview.pricing.managerEstimatedPayoutCents === 'number' && <div className="flex justify-between gap-3 text-muted-foreground"><dt>{t('invYouReceive')}</dt><dd className="tabular-nums">{money(preview.pricing.managerEstimatedPayoutCents)}</dd></div>}
                  </dl>
                  <p className="text-xs text-muted-foreground">{t('invExpiresAt', { when: expiresText(preview.expiresAt) })}</p>
                  {preview.warnings.map(warning => <p key={warning} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{warning}</p>)}
                  {!preview.available && <p role="alert" className="text-sm text-destructive">{preview.unavailableReason || t('invUnavailable')}</p>}
                </>}
              {sendError && <p role="alert" className="text-sm text-destructive">{sendError}</p>}
              <Button className="min-h-11 w-full" disabled={!draft || !preview?.available || sending} onClick={() => void send()}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('invSend')}</Button>
              <p className="text-xs text-muted-foreground">{t('invHowItWorks')}</p>
            </section>
          </aside>
        </div>
      )}
      {chefId > 0 && !!sentList.data?.invitations.length && <section className="space-y-3" data-testid="invitations-sent-list">
        <h2 className="font-semibold">{t('invSentList', { chef: chefName || t('invTheChef') })}</h2>
        <ul className="divide-y rounded-2xl border bg-card">
          {sentList.data.invitations.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">{invitation.kitchen.name} · {when(invitation)}</p>
              <p className="text-muted-foreground">{money(invitation.pricing.totalCents)} · {t(`invStatus_${invitation.status}`)}
                {invitationOpen(invitation) && ` · ${t('invExpiresAt', { when: expiresText(invitation.expiresAt, invitation.timezone) })}`}</p>
            </div>
            <div className="flex gap-2">
              {invitation.bookingId && <Button asChild variant="outline" size="sm"><Link href={`/manager/booking/${invitation.bookingId}`}>{t('invViewBooking')}</Link></Button>}
              {invitation.canWithdraw && <Button variant="ghost" size="sm" onClick={() => void withdraw(invitation)}>{t('invWithdraw')}</Button>}
            </div>
          </li>)}
        </ul>
      </section>}
    </div>
  </ManagerBookingLayout>;
}
