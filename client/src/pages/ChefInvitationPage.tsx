import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useRoute } from 'wouter';
import { CalendarClock, Loader2 } from 'lucide-react';
import ChefDashboardLayout from '@/layouts/ChefDashboardLayout';
import { useChefShellChrome } from '@/layouts/chef-shell-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { CancellationPolicySummary, type PolicyResponse } from '@/components/booking/CancellationPolicySummary';
import { CheckoutConsentNotice } from '@/components/booking/CheckoutCancellationDisclosure';
import { apiGet } from '@/lib/api';
import { formatTime } from '@/lib/formatters';
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { invitationRequest, type Invitation } from '@/lib/invitations';
import { CANCELLATION_DISCLOSURE_VERSION, DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';

type Rental = { id: number; equipmentType: string; brand?: string | null; sessionRate: number };
type DatedQuote = { subtotalCents: number; listSubtotalCents: number; kitchenCents: number; listKitchenCents: number; taxCents: number; serviceFeeCents: number; totalCents: number;
  extraTimeRateCents: number | null };

/** The chef's view of a kitchen's invitation: what, when, the exact price, the note, and pay or decline. */
export default function ChefInvitationPage() {
  const { t, i18n } = useTranslation('booking');
  const [, navigate] = useLocation();
  const [, params] = useRoute('/invitation/:id');
  const id = params?.id || '';
  const locale = i18n.resolvedLanguage || 'en-CA';
  const query = useQuery({ queryKey: ['chef-invitation', id], enabled: !!id, retry: false,
    queryFn: () => invitationRequest<Invitation>(`/api/chef/invitations/${encodeURIComponent(id)}`) });
  const [paying, setPaying] = useState(false), [declining, setDeclining] = useState(false), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [equipmentIds, setEquipmentIds] = useState<number[]>([]);
  const [equipmentByDate, setEquipmentByDate] = useState<Record<string, number[]>>({});
  const invitation = query.data;
  const dated = invitation?.dated === true;
  const payable = !!invitation && invitation.canPay !== false;
  // Rental equipment rides with this session at the kitchen's listed price; storage is booked on its own.
  const equipment = useQuery({ queryKey: ['chef-invitation-equipment', invitation?.kitchen.id], enabled: payable, retry: false,
    queryFn: () => invitationRequest<{ rental: Rental[] }>(`/api/chef/kitchens/${invitation!.kitchen.id}/equipment-listings`) });
  const policy = useQuery<PolicyResponse>({ queryKey: ['cancellation-policy', invitation?.kitchen.id], enabled: payable,
    queryFn: () => apiGet(`/kitchens/${invitation!.kitchen.id}/cancellation-policy`, false) });
  const [policyOpen, setPolicyOpen] = useState(false);
  // The chef may only change equipment per day; dates, hours and modes are the kitchen's offer.
  useEffect(() => {
    if (!invitation?.dated) return;
    setEquipmentByDate(Object.fromEntries(invitation.days.map(day => [day.date, day.equipment.map(item => item.listingId)])));
  }, [invitation?.id]);
  const equipmentKey = Object.entries(equipmentByDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, ids]) => `${date}:${ids.join(',')}`).join('|');
  const datedQuote = useQuery({ queryKey: ['chef-invitation-days-quote', id, equipmentKey], enabled: payable && dated, retry: false,
    queryFn: () => invitationRequest<DatedQuote>(`/api/chef/invitations/${encodeURIComponent(id)}/quote`,
      { equipment: Object.entries(equipmentByDate).map(([date, ids]) => ({ date, equipmentIds: ids })) }) });
  const quote = useQuery({ queryKey: ['chef-invitation-quote', id, equipmentIds], enabled: payable && !dated && equipmentIds.length > 0, retry: false,
    queryFn: () => invitationRequest<{ subtotalCents: number; taxCents: number; serviceFeeCents: number; totalCents: number }>(
      `/api/chef/invitations/${encodeURIComponent(id)}/quote`, { equipmentIds }) });
  // Stable chrome: the shell re-applies it whenever these identities change.
  const onViewChange = useCallback((view: string) => navigate(view === 'overview' ? '/dashboard' : `/dashboard?view=${view}`), [navigate]);
  const breadcrumbs = useMemo(() => [{ label: t('invChefBookings'), onClick: () => navigate('/dashboard?view=bookings') }, { label: t('invChefCrumb') }], [t, navigate]);
  const inShell = useChefShellChrome({ activeView: 'bookings', onViewChange, breadcrumbs });

  const money = (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const pay = async () => {
    if (!invitation || !policy.data?.policy || paying) return;
    setPaying(true); setError('');
    try {
      const { url } = await invitationRequest<{ url: string }>(`/api/chef/invitations/${encodeURIComponent(id)}/checkout`, dated ? {
        equipment: Object.entries(equipmentByDate).map(([date, ids]) => ({ date, equipmentIds: ids })),
        cancellationPolicyAccepted: true, cancellationPolicyVersion: policy.data.policy.version,
        cancellationDisclosureVersion: DATED_DISCLOSURE_VERSION,
      } : {
        equipmentIds, cancellationPolicyAccepted: true, cancellationPolicyVersion: policy.data.policy.version,
        cancellationDisclosureVersion: CANCELLATION_DISCLOSURE_VERSION,
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('invPayFailed')); setPolicyOpen(true);
      await Promise.all([policy.refetch(), query.refetch()]); setPaying(false);
    }
  };
  const decline = async () => {
    if (!invitation || busy) return;
    setBusy(true); setError('');
    try { await invitationRequest(`/api/chef/invitations/${encodeURIComponent(id)}/decline`, reason.trim() ? { reason: reason.trim() } : {}); setDeclining(false); await query.refetch(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('invPayFailed')); }
    finally { setBusy(false); }
  };

  const dayLabel = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));
  const dayHours = (day: Invitation['days'][number]) => day.pricingMode === 'daily' ? t('invFullDay')
    : `${formatTime(day.startTime, locale)}–${formatTime(day.endTime, locale)}`;

  let body: ReactNode;
  if (query.isPending) body = <p role="status" className="py-16 text-center text-sm text-muted-foreground">{t('invLoading')}</p>;
  else if (query.isError || !invitation) body = <div className="mx-auto max-w-md space-y-3 py-16 text-center">
    <p className="font-medium">{t('invNotFound')}</p>
    <Button asChild variant="outline"><Link href="/dashboard">{t('dcV2HoldBack')}</Link></Button>
  </div>;
  else {
    const chosen = (equipment.data?.rental || []).filter(item => equipmentIds.includes(item.id));
    const p = dated
      ? (datedQuote.data ? { ...invitation.pricing, listSubtotalCents: datedQuote.data.listSubtotalCents,
        offeredSubtotalCents: datedQuote.data.subtotalCents, taxCents: datedQuote.data.taxCents,
        serviceFeeCents: datedQuote.data.serviceFeeCents, totalCents: datedQuote.data.totalCents } : invitation.pricing)
      : equipmentIds.length && quote.data ? { ...invitation.pricing, ...quote.data } : invitation.pricing;
    const pricing = dated ? !datedQuote.data : equipmentIds.length > 0 && !quote.data;
    const extraTimeRateCents = datedQuote.data ? datedQuote.data.extraTimeRateCents : invitation.extraTimeRateCents;
    const expires = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: invitation.timezone }).format(new Date(invitation.expiresAt)) + ` (${friendlyTimezoneName(invitation.timezone, locale)})`;
    const refundDeadline = invitation.cancellation
      ? new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZone: invitation.timezone }).format(new Date(invitation.cancellation.refundDeadlineAt)) : '';
    const findTime = `/book/${invitation.kitchen.locationId}?kitchenId=${invitation.kitchen.id}`;
    const closed = !['sent', 'accepted_pending_payment'].includes(invitation.status);
    const equipmentOptions = (day: Invitation['days'][number]) => {
      const offered = day.equipment.map(item => ({ id: item.listingId, name: item.name, cents: item.cents }));
      const rentals = (equipment.data?.rental || []).map(item => ({ id: item.id, name: [item.brand, item.equipmentType].filter(Boolean).join(' '),
        cents: Math.round(Number(item.sessionRate ?? 0)) }));
      return [...offered, ...rentals].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
    };
    body = <div className="mx-auto max-w-2xl space-y-6" data-testid="chef-invitation">
      <header className="space-y-3">
        {invitation.kitchen.photoUrl && <img src={invitation.kitchen.photoUrl} alt="" className="h-40 w-full rounded-2xl object-cover" />}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('invChefTitle', { kitchen: invitation.kitchen.name })}</h1>
          <p className="text-sm text-muted-foreground">{invitation.kitchen.locationName}</p>
        </div>
        {dated ? <p className="flex items-start gap-2 text-base font-medium"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0" />
          {t('mdSelectedDays', { count: invitation.dayCount })} · {dayLabel(invitation.days[0].date)}</p>
          : <p className="flex items-start gap-2 text-base font-medium"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0" />{dayLabel(invitation.date)} · {formatTime(invitation.startTime, locale)}–{formatTime(invitation.endTime, locale)} · {friendlyTimezoneName(invitation.timezone, locale)}</p>}
      </header>

      {invitation.note && <figure className="rounded-2xl border bg-muted/30 p-4">
        <blockquote className="whitespace-pre-wrap text-sm">“{invitation.note}”</blockquote>
        <figcaption className="mt-2 text-xs text-muted-foreground">{t('invNoteFrom', { kitchen: invitation.kitchen.name })}</figcaption>
      </figure>}

      {dated && <section className="space-y-2 rounded-2xl border bg-card p-5" aria-label={t('mdYourDays')} data-testid="invitation-days">
        <h2 className="font-semibold">{t('mdYourDays')}</h2>
        <p className="text-xs text-muted-foreground">{t('invChefDaysEditable')}</p>
        <ul className="space-y-3">
          {invitation.days.map(day => <li key={day.date} className="space-y-2 rounded-xl border bg-background p-3">
            <p className="text-sm font-medium">{dayLabel(day.date)} · {dayHours(day)}</p>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-muted-foreground">{t('invEquipmentFor', { day: dayLabel(day.date) })}</legend>
              {equipmentOptions(day).length ? equipmentOptions(day).map(item => <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox checked={(equipmentByDate[day.date] ?? []).includes(item.id)} disabled={paying}
                  onCheckedChange={on => setEquipmentByDate(current => {
                    const ids = current[day.date] ?? [];
                    return { ...current, [day.date]: on ? [...ids, item.id] : ids.filter(id => id !== item.id) };
                  })} />
                {item.cents > 0 ? t('invEquipmentLine', { name: item.name, price: money(item.cents) }) : t('invEquipmentIncluded', { name: item.name })}
              </label>) : <p className="text-sm text-muted-foreground">{t('invNoEquipmentDay')}</p>}
            </fieldset>
          </li>)}
        </ul>
      </section>}

      <section className="space-y-2 rounded-2xl border bg-card p-5" aria-label={t('invSummary')}>
        <dl className="space-y-1.5 text-sm">
          {dated && datedQuote.data ? <>
            {/* Multi-day: the discount is on kitchen time only, so equipment gets its own line. */}
            <div className="flex justify-between gap-3"><dt>{t('invKitchenTime')}</dt><dd className="tabular-nums">
              {datedQuote.data.kitchenCents < datedQuote.data.listKitchenCents && <s className="mr-2 text-muted-foreground">{money(datedQuote.data.listKitchenCents)}</s>}{money(datedQuote.data.kitchenCents)}</dd></div>
            {datedQuote.data.subtotalCents > datedQuote.data.kitchenCents && <div className="flex justify-between gap-3"><dt>{t('invEquipment')}</dt>
              <dd className="tabular-nums">{money(datedQuote.data.subtotalCents - datedQuote.data.kitchenCents)}</dd></div>}
          </> : <div className="flex justify-between gap-3"><dt>{t('invKitchenTime')}</dt><dd className="tabular-nums">
            {p.offeredSubtotalCents < p.listSubtotalCents && <s className="mr-2 text-muted-foreground">{money(p.listSubtotalCents)}</s>}{money(p.offeredSubtotalCents)}</dd></div>}
          {!dated && chosen.map(item => <div key={item.id} className="flex justify-between gap-3"><dt>{[item.brand, item.equipmentType].filter(Boolean).join(' ')}</dt>
            <dd className="tabular-nums">{money(Math.round(item.sessionRate))}</dd></div>)}
          <div className="flex justify-between gap-3"><dt>{t('invTax')}</dt><dd className="tabular-nums">{money(p.taxCents)}</dd></div>
          {p.serviceFeeCents > 0 && <div className="flex justify-between gap-3"><dt>{t('invServiceFee')}</dt><dd className="tabular-nums">{money(p.serviceFeeCents)}</dd></div>}
          <div className="flex justify-between gap-3 border-t pt-1.5 text-base font-semibold"><dt>{t('invTotal')}</dt><dd className="tabular-nums">{money(p.totalCents)}</dd></div>
        </dl>
        {dated && <>
          <p className="text-xs text-muted-foreground">{t('invDiscountEquipmentHelp')}</p>
          {extraTimeRateCents != null && <p className="text-xs text-muted-foreground">{t('bpsExtraTimeRate', { amount: money(extraTimeRateCents) })}</p>}
          <p className="text-xs text-muted-foreground">{t('invOneDeadline', { deadline: refundDeadline })}</p>
          <p className="text-xs text-muted-foreground">{t('invChargedWhen')}</p>
        </>}
        {(dated ? datedQuote.isError : quote.isError) && <p role="alert" className="text-sm text-destructive">
          {((dated ? datedQuote.error : quote.error) as Error).message}</p>}
        {p.offeredSubtotalCents < p.listSubtotalCents && <p className="text-xs text-emerald-700">{t('invYouSave', { amount: money(p.listSubtotalCents - p.offeredSubtotalCents) })}</p>}
      </section>

      {invitation.status === 'accepted' && invitation.bookingId ? <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="font-medium">{t('invAcceptedChef')}</p>
        <Button asChild><Link href={`/booking/${invitation.bookingId}`}>{t('invViewBooking')}</Link></Button>
      </section> : closed ? <section className="space-y-3 rounded-2xl border bg-muted/30 p-5">
        <p className="font-medium">{invitation.status === 'unavailable' && invitation.unavailableReason ? invitation.unavailableReason : t(`invClosedChef_${invitation.status}` as 'invClosedChef_declined', { kitchen: invitation.kitchen.name })}</p>
        <Button asChild variant="outline"><Link href={findTime}>{t('bdhFindAnotherTime', { ns: 'chef' })}</Link></Button>
      </section> : <section className="space-y-4">
        <div className="space-y-1.5 text-sm">
          <p>{t('invPreApproved')}</p>
          {policy.data?.policy ? <div className="text-muted-foreground"><CancellationPolicySummary policy={policy.data.policy} timezone={policy.data.timezone} startAt={invitation.startAt} /></div>
            : policy.isError && <p className="text-muted-foreground">{t('cpError')}</p>}
          {policyOpen && <p className="text-muted-foreground">{t('cpNoShow')}</p>}
          <p className="text-muted-foreground">{t('invExpiresChef', { when: expires })}</p>
        </div>
        {!dated && !!equipment.data?.rental.length && <fieldset className="space-y-2 rounded-2xl border p-4">
          <legend className="px-1 text-sm font-medium">{t('invAddons')}</legend>
          <p className="text-xs text-muted-foreground">{t('invAddonsHelp')}</p>
          {equipment.data.rental.map(item => <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox checked={equipmentIds.includes(item.id)} disabled={paying}
              onCheckedChange={on => setEquipmentIds(ids => on ? [...ids, item.id] : ids.filter(other => other !== item.id))} />
            {t('invAddonLine', { name: [item.brand, item.equipmentType].filter(Boolean).join(' '), price: money(Math.round(item.sessionRate)) })}
          </label>)}
        </fieldset>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {declining ? <div className="space-y-3 rounded-2xl border p-4">
          <label className="block space-y-1.5 text-sm font-medium">{t('invDeclineReason', { kitchen: invitation.kitchen.name })}
            <Textarea className="mt-1" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setDeclining(false)}>{t('invKeepOffer')}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void decline()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('invDecline')}</Button>
          </div>
        </div> : <div className="flex flex-wrap gap-2">
          {invitation.canPay !== false && <Button className="min-h-11" disabled={paying || pricing || (dated ? datedQuote.isError : quote.isError) || !policy.data?.policy || policy.isFetching} onClick={() => void pay()} data-primary-action="true">
            {paying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('invPay', { amount: money(p.totalCents) })}</Button>}
          {invitation.canDecline !== false && <Button className="min-h-11" variant="outline" onClick={() => setDeclining(true)}>{t('invDecline')}</Button>}
          <Button asChild className="min-h-11" variant="ghost"><Link href="/dashboard?view=messages">{t('invAskQuestion')}</Link></Button>
        </div>}
        {!declining && invitation.canPay !== false && <div className="text-xs text-muted-foreground">
          <CheckoutConsentNotice buttonLabel={t('invPay', { amount: money(p.totalCents) })} onShowPolicy={() => setPolicyOpen(true)} /></div>}
      </section>}
    </div>;
  }
  if (inShell) return body;
  return <ChefDashboardLayout activeView="bookings" onViewChange={onViewChange} breadcrumbs={breadcrumbs}>{body}</ChefDashboardLayout>;
}
