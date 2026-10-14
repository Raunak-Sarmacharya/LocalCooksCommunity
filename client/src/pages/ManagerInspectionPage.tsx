import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { formatVisitTime, friendlyTimezoneName } from '@/lib/visit-time';
import { formatTime } from '@/lib/formatters';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useRoute, useSearch } from 'wouter';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import ManagerBookingLayout from '@/layouts/ManagerBookingLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SmartImage } from '@/components/ui/smart-image';
import { VisitAssistancePanel } from '@/components/booking/VisitAssistancePanel';
import { ManagerInSessionBadge, inSessionEnds } from '@/components/manager/bookings/ManagerInSessionBadge';
import { DamageClaimSheet } from '@/components/booking/DamageClaimSheet';
import { BookingDamageClaims } from '@/components/booking/DamageClaimCards';
import { claimFilingWindow } from '@shared/damage-claims';
import { recordedDepartureAt } from '@shared/clock-closeout';
import { calendarDateForOperatingTime, calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime } from '@shared/timezone-utils';
import { formatVisitWhen } from '@/lib/visit-when';
import { sentence } from '@/lib/booking-header-state';
import { bookingReference } from '@/lib/booking-reference';
import { readVisitDuties, type DutySection, type VisitDuties } from '@shared/visit-duties';

type Evidence = {
  closeout?: import("@shared/clock-closeout").VisitCloseout;
  id: number; updatedAt: string; startTime: string; endTime: string; checkinStatus?: string | null;
  checkedInAt?: string | null; checkedInMethod?: string | null; checkoutRequestedAt?: string | null;
  checkoutApprovedAt?: string | null; checkoutReviewDeadline?: string | null;
  checkinNotes?: string | null; checkoutNotes?: string | null; checkoutManagerMessage?: string | null;
  checkinPhotoUrls?: string[] | null; checkoutPhotoUrls?: string[] | null;
  checkinChecklistItems?: Array<{ id: string; label: string; checked: boolean }> | null;
  checkoutChecklistItems?: Array<{ id: string; label: string; checked: boolean }> | null;
  assistanceHistory?: Array<{ actorId: number; action: string; reason: string; actualAt?: string; recordedAt: string }>;
};
export type ManagerInspectionDetails = Omit<Evidence, "closeout"> & {
  closeout?: import("@shared/clock-closeout").BookingCloseout;
  referenceCode?: string | null; status: string; bookingDate: string; operatingWindowStartTime?: string | null;
  kitchen: { name: string }; location: { id: number; name: string; timezone: string | null };
  chef?: { fullName?: string; username: string } | null;
  visits: Array<Evidence & { blockIndex: number }>;
  inspection?: { duties: VisitDuties; dutiesSaved: boolean; checkoutReviewDeadline: string | null };
  payout?: import("@shared/kitchen-payout").KitchenPayout;
};

async function readDetails(bookingId: number): Promise<ManagerInspectionDetails> {
  const t = i18n.getFixedT(null, 'chef');
  const response = await apiClient.get(`/manager/bookings/${bookingId}/details`);
  const result = await response.json();
  if (!response.ok) throw Error(result.error || t('inspectCopy00'));
  if (result.id !== bookingId || !Array.isArray(result.visits) || !result.kitchen || !result.location)
    throw Error(t('inspectCopy01'));
  if (result.inspection && !readVisitDuties(result.inspection.duties)) throw Error(t('inspectCopy02'));
  return result;
}

function EvidenceSummary({ chef, title, section, photos, checklist, notes, timestamp, formatEvent }: {
  chef: string; title: string; section?: DutySection; photos?: string[] | null;
  checklist?: Evidence['checkinChecklistItems']; notes?: string | null; timestamp?: string | null;
  formatEvent: (value?: string | null) => string;
}) {
  const { t } = useTranslation('chef');
  const requiredPhotos = section?.enabled ? section.photos.filter(photo => photo.required !== false).length : 0;
  return <section className="min-w-0 rounded-2xl border bg-card p-5 space-y-4" aria-label={title}>
    <h2 className="font-semibold">{title}</h2>
    <p className="text-sm">{title === t('inspectDeparture') ? t('inspectCopy03') : t('inspectCopy04')}: {formatEvent(timestamp)}</p>
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">{t('inspectCopy05')}</h3>
      <p className="whitespace-pre-wrap">{section?.instructions || t('inspectCopy06')}</p>
      {!section ? <p>{t('inspectCopy07')}</p> : !section.enabled ? <p>{t('inspectCopy08')}</p> : <>
        {section.items.length === 0 && <p>{t('inspectCopy09')}</p>}
        <ul className="space-y-2">{section.items.map(item => {
          const answer = checklist?.find(recorded => recorded.id === item.id);
          return <li key={item.id}>{item.label} · {item.required === false ? t('inspectCopy10') : t('inspectCopy11')} · {answer ? answer.checked ? t('inspectCopy12') : t('inspectCopy13') : t('inspectCopy14')}</li>;
        })}</ul>
      </>}
      {(checklist || []).filter(item => !section?.items.some(configured => configured.id === item.id)).map(item => <p key={item.id}>{item.label}: {item.checked ? t('inspectCopy12') : t('inspectCopy13')} ({t('inspectEarlierItem')})</p>)}
    </div>
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">{t('inspectCopy15')}</h3>
      {!section ? <p>{t('inspectCopy16')}</p> : !section.enabled ? <p>{t('inspectCopy17')}</p> : <>
        {requiredPhotos > 0 ? <p>{t('inspectRequiredPhotos', { count: requiredPhotos })}</p> : <p>{t('inspectNoPhotosRequired')}</p>}
        {section.enabled && section.photos.map(photo => <p key={photo.id}>{photo.label} · {photo.required === false ? t('inspectCopy10') : t('inspectCopy11')}</p>)}
      </>}
      {photos == null ? <p>{t('inspectCopy18')}</p> : photos.length === 0 ? <p>{t('inspectCopy19')}</p> : <>
        <p>{t('inspectSubmittedPhotos', { count: photos.length })}</p>
        <div className="grid grid-cols-2 gap-2">{photos.map((url, index) => <SmartImage key={`${url}-${index}`} src={url}
          className="aspect-square w-full rounded-lg object-cover" alt={t('inspectPhotoAlt', { title, number: index + 1 })} />)}</div>
      </>}
    </div>
    <div className="text-sm"><h3 className="font-medium">{t('inspectChefMessage', { chef })}</h3><p className="whitespace-pre-wrap break-words">{notes || t('inspectCopy20')}</p></div>
  </section>;
}

export default function ManagerInspectionPage() {
  const { t } = useTranslation('chef');
  const [, params] = useRoute('/manager/booking/:id/inspection');
  const bookingId = Number(params?.id);
  const validId = Number.isSafeInteger(bookingId) && bookingId > 0;
  const { user, loading } = useFirebaseAuth();
  const manager = user?.role === 'manager';
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [`/api/manager/bookings/${bookingId}/details`],
    queryFn: () => readDetails(bookingId), enabled: validId && !loading && manager, retry: false, refetchOnWindowFocus: true });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
    await queryClient.invalidateQueries({ queryKey: [`/api/manager/bookings/${bookingId}/attendance`] });
    return (await query.refetch({ throwOnError: true })).data;
  };
  if (loading) return <p role="status">{t('inspectCopy21')}</p>;
  if (!manager) return <p role="alert">{t('inspectCopy22')}</p>;
  return <ManagerBookingLayout bookingLocationId={query.data?.location.id} breadcrumbs={[
    { label: t('inspectCopy23'), href: '/manager/dashboard?view=bookings' },
    { label: t('inspectCopy24'), href: `/manager/booking/${bookingId}` }, { label: t('inspectCopy25') },
  ]}>
    <div className="mx-auto max-w-5xl space-y-5">
      <Link className="inline-flex items-center gap-2 text-sm font-medium hover:underline" href={validId ? `/manager/booking/${bookingId}` : '/manager/dashboard?view=bookings'}><ArrowLeft className="h-4 w-4" />{t('inspectCopy26')}</Link>
      <h1 className="text-2xl font-semibold">{t('inspectCopy25')}</h1>
      {!validId ? <p role="alert">{t('inspectCopy28')}</p> : query.isPending ? <p role="status">{t('inspectCopy29')}</p> : null}
      {query.error && <p role="alert" className="rounded-xl border p-4 text-destructive">{query.error.message} {t('inspectRefreshFirst')}</p>}
      {query.data && <InspectionVisits key={bookingId} booking={query.data} refresh={refresh} stale={query.isError || query.isFetching} />}
    </div>
  </ManagerBookingLayout>;
}

function InspectionVisits({ booking, refresh, stale }: { booking: ManagerInspectionDetails; refresh: () => Promise<ManagerInspectionDetails | undefined>; stale: boolean }) {
  const { t, i18n } = useTranslation('chef');
  const locale = i18n?.resolvedLanguage || 'en-CA';
  const search = useSearch();
  const [, navigate] = useLocation();
  const visitId = new URLSearchParams(search).get('visitId') || '';
  const [notes, setNotes] = useState<Record<string, string>>({});
  const selected = booking.visits.length ? booking.visits.find(visit => String(visit.id) === visitId)
    || (!visitId && booking.visits.length === 1 ? booking.visits[0] : undefined) : !visitId ? booking : undefined;
  const timezone = booking.location.timezone;
  const noteKey = booking.visits.length ? `visit:${selected?.id || visitId}` : 'booking';
  let contextError = '';
  let formatEvent = (_value?: string | null) => t('inspectCopy30');
  let schedule = '';
  try {
    if (!timezone) throw Error(t('inspectCopy32'));

    formatEvent = value => value ? Number.isFinite(Date.parse(value)) ? formatVisitTime(value, timezone, locale) : t('inspectCopy30') : t('inspectCopy31');
    if (selected) {
      const day = booking.bookingDate.slice(0, 10);
      const startDay = calendarDateForOperatingTime(day, selected.startTime, booking.operatingWindowStartTime || booking.startTime);
      const endDay = calendarDateForBookingTime(day, selected.endTime, booking.operatingWindowStartTime, booking.startTime);
      schedule = formatVisitWhen(createBookingDateTime(startDay, selected.startTime, timezone), createBookingDateTime(endDay, selected.endTime, timezone), timezone, locale);
    }
  } catch (cause) { contextError = cause instanceof Error ? cause.message : t('inspectCopy33'); }
  return <>
    <section className="rounded-2xl border bg-card p-5 space-y-2" aria-label={t('inspectCopy34')}>
      <p className="text-lg font-semibold">{booking.kitchen.name}</p>
      <p>{bookingReference(booking.referenceCode, booking.id)} · {booking.chef?.fullName || booking.chef?.username || t('inspectCopy35')}</p>
      <p className="text-sm">{booking.location.name} · {timezone ? friendlyTimezoneName(timezone, locale) : t('fixTimeUnavailable')}</p>
      {booking.visits.length > 1 && <div className="text-sm"><label htmlFor="inspection-visit">{t('inspectCopy36')}</label>
        <select id="inspection-visit" className="ml-2 max-w-full rounded border bg-background p-2" value={visitId} disabled={stale}
          onChange={event => navigate(`/manager/booking/${booking.id}/inspection${event.target.value ? `?visitId=${event.target.value}` : ''}`)}>
          <option value="">{t('inspectCopy37')}</option>{booking.visits.map(visit => <option key={visit.id} value={visit.id}>{t('fixVisitRange', { number: visit.blockIndex + 1, start: formatTime(visit.startTime, locale), end: formatTime(visit.endTime, locale) })}</option>)}
        </select><span className="mt-1 block text-muted-foreground">{t('inspectCopy38')}</span>
      </div>}
      {selected && <p className="text-sm">{booking.visits.length ? t('inspectVisitOf', { number: booking.visits.findIndex(visit => visit.id === selected.id) + 1, total: booking.visits.length }) + ' · ' : ''}{schedule}</p>}
    </section>
    {contextError && <p role="alert">{contextError}</p>}
    {inSessionEnds(booking).length > 0 && <div className="flex flex-wrap gap-2">
      {inSessionEnds(booking).map(session => <ManagerInSessionBadge key={session.visitId ?? 'booking'} endsAt={session.endsAt} timezone={timezone}
        label={session.visitId && booking.visits.length > 1 ? t('inspectVisit', { number: (booking.visits.find(visit => visit.id === session.visitId)?.blockIndex ?? 0) + 1 }) : undefined} />)}
    </div>}
    {!selected ? <p role="alert">{visitId ? t('inspectCopy39') : t('inspectCopy40')}</p> : <InspectionTask key={booking.visits.length ? selected.id : 'booking'} booking={booking} evidence={selected}
      visitId={booking.visits.length ? selected.id : undefined} formatEvent={formatEvent} refresh={refresh} blocked={stale || !!contextError}
      note={notes[noteKey] || ''} onNoteChange={value => setNotes(current => ({ ...current, [noteKey]: value }))} />}
    <Link href="/manager/dashboard?view=support" className="inline-block text-sm underline">{t('inspectCopy41')}</Link>
  </>;
}

function InspectionTask({ booking, evidence, visitId, formatEvent, refresh, blocked, note, onNoteChange }: {
  booking: ManagerInspectionDetails; evidence: Evidence | ManagerInspectionDetails; visitId?: number; formatEvent: (value?: string | null) => string;
  refresh: () => Promise<ManagerInspectionDetails | undefined>; blocked: boolean;
  note: string; onNoteChange: (value: string) => void;
}) {
  const { t, i18n } = useTranslation('chef');
  const { t: claimT } = useTranslation('booking');
  const chef = booking.chef?.fullName || booking.chef?.username || t('fixChef');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false), [assistanceOpen, setAssistanceOpen] = useState(false);
  const assistanceRef = useRef<HTMLElement>(null);
  useEffect(() => { if (assistanceOpen) assistanceRef.current?.focus(); }, [assistanceOpen]);
  const deadline = visitId ? evidence.checkoutReviewDeadline : booking.inspection?.checkoutReviewDeadline;
  const clock = visitId ? evidence.closeout as import('@shared/clock-closeout').VisitCloseout | undefined : booking.closeout?.visits[0];
  const payoutNow = booking.payout?.timing === 'after_closeout' && booking.payout.status === 'scheduled' && booking.payout.amountCents > 0 ? booking.payout : null;
  const payoutAmount = payoutNow ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(payoutNow.amountCents / 100) : '';
  const canClear = clock ? clock.inspection.canRespond : booking.status === 'confirmed' && evidence.checkinStatus === 'checkout_requested' && !!deadline && Number.isFinite(Date.parse(deadline));
  const canAssist = booking.status === 'confirmed' && [null, undefined, 'not_checked_in', 'checked_in'].includes(evidence.checkinStatus);
  // Inspection and the separate 72-hour claim filing window have independent deadlines.
  const finished = saved || (clock ? clock.inspection.outcome === 'manager_cleared' : evidence.checkinStatus === 'checked_out' && !!evidence.checkoutApprovedAt);
  const canReportLater = !!clock && claimFilingWindow(new Date(clock.scheduledEndAt), recordedDepartureAt(evidence)).allowed;
  const finishedAt = (() => {
    const at = evidence.checkoutApprovedAt, zone = booking.location.timezone;
    if (!at || !zone || !Number.isFinite(Date.parse(at))) return null;
    const locale = i18n?.resolvedLanguage || 'en-CA';
    return { date: new Intl.DateTimeFormat(locale, { timeZone: zone, month: 'short', day: 'numeric' }).format(new Date(at)),
      time: new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at)) };
  })();
  const clear = async () => {
    if (!canClear || blocked || saving || saved) return;
    setSaving(true); setError('');
    let accepted = false;
    try {
      const current = await refresh();
      const target = visitId ? current?.visits.find(visit => visit.id === visitId) : current?.visits.length === 0 ? current : undefined;
      if (!current || !['confirmed', 'completed'].includes(current.status) || !target || target.checkinStatus !== evidence.checkinStatus
        || current.updatedAt !== booking.updatedAt || target.updatedAt !== evidence.updatedAt)
        throw Error(t('inspectCopy42'));
      const currentDeadline = visitId ? target.checkoutReviewDeadline : current.inspection?.checkoutReviewDeadline;
      if (!current.inspection || !currentDeadline || !Number.isFinite(Date.parse(currentDeadline))
        || currentDeadline !== deadline || current.location.timezone !== booking.location.timezone)
        throw Error(t('inspectCopy43'));
      const response = await apiClient.post(`/manager/bookings/${booking.id}/clear-kitchen-checkout`, { visitId, sharedManagerMessage: note });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw Error(result.error || t('inspectCopy44'));
      accepted = true; setSaved(true); setConfirmOpen(false);
      if (payoutNow) toast.success(t('inspectToastPayout', { amount: payoutAmount }));
      await refresh();
      onNoteChange('');
    } catch (cause) {
      setError(`${accepted ? t('inspectSavedRefresh') + ' ' : ''}${cause instanceof Error ? cause.message : t('inspectCopy45')} ${t('assistRetained')}`);
      if (!accepted) await refresh().catch(() => undefined);
    } finally { setSaving(false); }
  };
  return <>
    <Dialog open={confirmOpen} onOpenChange={value => { if (!saving) setConfirmOpen(value); }}>
      <DialogContent showCloseButton><DialogHeader><DialogTitle>{t('inspectConfirmTitle')}</DialogTitle><DialogDescription>{t('inspectConfirmBody', { chef })}</DialogDescription></DialogHeader>
        {payoutNow && <p className="text-sm font-medium">{t('inspectConfirmPayoutLine', { amount: payoutAmount })}</p>}
        {note && <blockquote className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{note}</blockquote>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirmOpen(false)}>{t('fixBack')}</Button><Button disabled={saving || blocked || !canClear} onClick={() => void clear()}>{t(saving ? 'fixSaving' : 'inspectConfirmButton')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {finished ? <section className="rounded-2xl border bg-card p-5 space-y-3" aria-label={t('inspectDoneTitle')} data-testid="inspection-done">
      <h2 className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />{t('inspectDoneTitle')}</h2>
      <p role="status">{finishedAt ? sentence(t('inspectDoneBody', { date: finishedAt.date, time: finishedAt.time, chef })) : t('inspectDoneBodyNoTime', { chef })}</p>
      {booking.payout?.timing === 'after_closeout' && booking.payout.status === 'sent' && booking.payout.sentAt && <p role="status" className="text-sm" data-testid="inspection-payout-sent">{t('inspectDonePayoutSent', { amount: new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(booking.payout.amountCents / 100), date: new Intl.DateTimeFormat(i18n.language, { timeZone: booking.location.timezone || undefined, dateStyle: 'medium' }).format(new Date(booking.payout.sentAt)) })}</p>}
      {booking.payout?.timing === 'after_closeout' && booking.payout.status === 'on_hold' && <p role="status" className="text-sm">{t('inspectDonePayoutHold')}</p>}
      {evidence.checkoutManagerMessage && <p className="whitespace-pre-wrap text-sm">{evidence.checkoutManagerMessage}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <Button asChild><Link href={`/manager/booking/${booking.id}`}>{t('inspectCopy26')}</Link></Button>
        {canReportLater && <button type="button" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setIssueOpen(true)}>{t('inspectFoundLater')}</button>}
      </div>
    </section> : <section className="rounded-2xl border bg-card p-5 space-y-3" aria-label={t('inspectCopy46')}>
      <h2 className="font-semibold">{t('inspectCopy46')}</h2>
      <p>{clock?.inspection.outcome === 'auto_closed_uninspected' ? t('clockNoInspection') : clock?.inspection.outcome === 'manager_cleared' ? t('clockManagerInspected') : clock?.inspection.outcome === 'issue_filed' ? t('clockIssueOpen') : evidence.checkinStatus === 'checkout_requested' ? t('inspectCopy47') : evidence.checkinStatus === 'checked_out' ? t('inspectCopy48') : evidence.checkinStatus === 'checkout_claim_filed' ? t('inspectCopy49') : t('inspectCopy50')}</p>
      {evidence.checkoutApprovedAt && <p className="text-sm">{t('inspectClosedAt', { time: formatEvent(evidence.checkoutApprovedAt) })}</p>}
      <p className="font-medium">{t('inspectDeadline')}: {deadline ? `${formatEvent(deadline)} · ${booking.location.timezone ? friendlyTimezoneName(booking.location.timezone, i18n.resolvedLanguage) : ''}` : evidence.checkoutRequestedAt ? t('inspectCopy51') : t('inspectCopy52')}</p>
      <p className="text-sm text-muted-foreground">{t('inspectCopy53')}</p>
      {!booking.inspection && <p role="alert">{t('inspectCopy54')}</p>}
      {booking.inspection && !booking.inspection.dutiesSaved && <p>{t('inspectCopy55')}</p>}
      <label className="block text-sm font-medium" htmlFor="inspection-message">{t('fixNoteOptional', { chef })}</label>
      <Textarea id="inspection-message" value={note} maxLength={2000} disabled={saving} onChange={event => onNoteChange(event.target.value)} />
      {error && !confirmOpen && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {evidence.checkoutManagerMessage && <p className="whitespace-pre-wrap text-sm">{evidence.checkoutManagerMessage}</p>}
      {(!canClear || blocked || !booking.inspection) && <p className="text-sm text-muted-foreground">{t(blocked ? 'inspectRefreshFirst' : clock && ['auto_closed_uninspected', 'legacy_closed', 'manager_cleared', 'issue_filed'].includes(clock.inspection.outcome) ? 'inspectWindowClosed' : 'inspectNotReady')}</p>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={!canClear || blocked || saving || saved || !booking.inspection} onClick={() => setConfirmOpen(true)}><CheckCircle2 className="mr-2 h-4 w-4" />{saving ? t('inspectCopy59') : t(payoutNow ? 'inspectFinishAndPay' : 'inspectCopy60')}</Button>
        <Button variant="outline" disabled={saving} onClick={() => setIssueOpen(true)}>{claimT('dcV2Report')}</Button>
        {canAssist && <Button variant="outline" disabled={saving || blocked} onClick={() => { setAssistanceOpen(true); assistanceRef.current?.focus(); }}>{t('inspectCopy62')}</Button>}
      </div>
    </section>}
    <div className="grid gap-5 md:grid-cols-2">
      <EvidenceSummary chef={chef} title={t('inspectArrival')} section={booking.inspection?.duties.arrival} timestamp={evidence.checkedInAt}
        photos={evidence.checkinPhotoUrls} checklist={evidence.checkinChecklistItems} notes={evidence.checkinNotes} formatEvent={formatEvent} />
      <EvidenceSummary chef={chef} title={t('inspectDeparture')} section={booking.inspection?.duties.departure} timestamp={evidence.checkoutRequestedAt}
        photos={evidence.checkoutPhotoUrls} checklist={evidence.checkoutChecklistItems} notes={evidence.checkoutNotes} formatEvent={formatEvent} />
    </div>
    {!!evidence.assistanceHistory?.length && <section className="rounded-2xl border p-5 space-y-2" aria-label={t('inspectCopy63')}><h2 className="font-semibold">{t('inspectCopy64')}</h2>
      {evidence.assistanceHistory.map((entry, index) => <p key={index} className="whitespace-pre-wrap text-sm">{t('assistHistory', { action: t(entry.action === 'arrival' ? 'assistArrivalTitle' : 'assistDepartureTitle'), time: formatEvent(entry.actualAt), updated: formatEvent(entry.recordedAt) })} {entry.reason}</p>)}
    </section>}
    {assistanceOpen && <section ref={assistanceRef} tabIndex={-1} aria-label={t('inspectCopy65')} className="space-y-3">
      <p className="text-sm">{t('inspectCopy66')}</p>
      <VisitAssistancePanel bookingId={booking.id} updatedAt={booking.updatedAt} visits={visitId ? [evidence] : []} timezone={booking.location.timezone}
        chefName={chef} fixedAction={evidence.checkinStatus === 'checked_in' ? 'departure' : 'arrival'}
        scheduledStart={evidence.checkinStatus === 'checked_in' ? undefined : clock?.scheduledStartAt}
        disabled={blocked || saving || !canAssist} onSaved={async () => { await refresh(); }} />
    </section>}
    {issueOpen && <DamageClaimSheet bookingId={booking.id} visitId={visitId} chefName={chef} open={issueOpen} hideTrigger onOpenChange={setIssueOpen} onFiled={() => void refresh()} />}
    <BookingDamageClaims bookingId={booking.id} manager />
  </>;
}
