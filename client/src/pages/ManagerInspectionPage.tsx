import { ClockCloseoutSummary } from "@/components/booking/ClockCloseoutSummary";
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useRoute, useSearch } from 'wouter';
import { ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import ManagerBookingLayout from '@/layouts/ManagerBookingLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SmartImage } from '@/components/ui/smart-image';
import { VisitAssistancePanel } from '@/components/booking/VisitAssistancePanel';
import { VisitCodePanel } from '@/components/manager/bookings/VisitCodePanel';
import { ManagerInSessionBadge, inSessionEnds } from '@/components/manager/bookings/ManagerInSessionBadge';
import { CommitmentProblems } from '@/components/support/CommitmentProblems';
import { calendarDateForOperatingTime, calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime } from '@shared/timezone-utils';
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
};

async function readDetails(bookingId: number): Promise<ManagerInspectionDetails> {
  const response = await apiClient.get(`/manager/bookings/${bookingId}/details`);
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not load inspection details.');
  if (result.id !== bookingId || !Array.isArray(result.visits) || !result.kitchen || !result.location)
    throw Error('Inspection context is incomplete. Return to the booking or contact Local Cooks.');
  if (result.inspection && !readVisitDuties(result.inspection.duties)) throw Error('Inspection requirements unavailable. Contact Local Cooks.');
  return result;
}

function EvidenceSummary({ title, section, photos, checklist, notes, timestamp, formatEvent }: {
  title: string; section?: DutySection; photos?: string[] | null;
  checklist?: Evidence['checkinChecklistItems']; notes?: string | null; timestamp?: string | null;
  formatEvent: (value?: string | null) => string;
}) {
  const requiredPhotos = section?.enabled ? section.photos.filter(photo => photo.required !== false).length : 0;
  return <section className="min-w-0 rounded-2xl border bg-card p-5 space-y-4" aria-label={`${title} evidence`}>
    <h2 className="font-semibold">{title}</h2>
    <p className="text-sm">{title === 'Departure' ? 'Inspection requested' : 'Arrival recorded'}: {formatEvent(timestamp)}</p>
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">Instructions</h3>
      <p className="whitespace-pre-wrap">{section?.instructions || 'No instructions available.'}</p>
      {!section ? <p>Checklist requirements unavailable.</p> : !section.enabled ? <p>Tracking duties disabled for this stage.</p> : <>
        {section.items.length === 0 && <p>No configured checklist items.</p>}
        <ul className="space-y-2">{section.items.map(item => {
          const answer = checklist?.find(recorded => recorded.id === item.id);
          return <li key={item.id}>{item.label} · {item.required === false ? 'Optional' : 'Required'} · {answer ? answer.checked ? 'Reported done' : 'Reported unchecked' : 'No answer recorded'}</li>;
        })}</ul>
      </>}
      {(checklist || []).filter(item => !section?.items.some(configured => configured.id === item.id)).map(item => <p key={item.id}>{item.label}: {item.checked ? 'Reported done' : 'Reported unchecked'} (recorded item)</p>)}
    </div>
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">Condition photos</h3>
      {!section ? <p>Photo requirements unavailable.</p> : !section.enabled ? <p>Photo duties disabled for this stage.</p> : <>
        <p>{requiredPhotos} required photo{requiredPhotos === 1 ? '' : 's'} configured.</p>
        {section.enabled && section.photos.map(photo => <p key={photo.id}>{photo.label} · {photo.required === false ? 'Optional' : 'Required'}</p>)}
      </>}
      {photos == null ? <p>Photo evidence unavailable.</p> : photos.length === 0 ? <p>No photos submitted. Missing photos do not establish absence, damage or liability.</p> : <>
        <p>{photos.length} submitted. Photos are not labelled by requirement in the saved record.</p>
        <div className="grid grid-cols-2 gap-2">{photos.map((url, index) => <SmartImage key={`${url}-${index}`} src={url}
          className="aspect-square w-full rounded-lg object-cover" alt={`${title} condition photo ${index + 1}`} />)}</div>
      </>}
    </div>
    <div className="text-sm"><h3 className="font-medium">Message from the person booking</h3><p className="whitespace-pre-wrap break-words">{notes || 'No message recorded.'}</p></div>
  </section>;
}

export default function ManagerInspectionPage() {
  const [, params] = useRoute('/manager/booking/:id/inspection');
  const bookingId = Number(params?.id);
  const validId = Number.isSafeInteger(bookingId) && bookingId > 0;
  const { user, loading } = useFirebaseAuth();
  const manager = user?.role === 'manager';
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [`/api/manager/bookings/${bookingId}/details`],
    queryFn: () => readDetails(bookingId), enabled: validId && !loading && manager, retry: false });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
    await queryClient.invalidateQueries({ queryKey: [`/api/manager/bookings/${bookingId}/attendance`] });
    return (await query.refetch({ throwOnError: true })).data;
  };
  if (loading) return <p role="status">Loading manager session…</p>;
  if (!manager) return <p role="alert">Manager access required. Inspection actions are unavailable in this view.</p>;
  return <ManagerBookingLayout bookingLocationId={query.data?.location.id} breadcrumbs={[
    { label: 'Bookings', href: '/manager/dashboard?view=bookings' },
    { label: 'Booking details', href: `/manager/booking/${bookingId}` }, { label: 'Visit inspection' },
  ]}>
    <div className="mx-auto max-w-5xl space-y-5">
      <Link className="inline-flex items-center gap-2 text-sm font-medium hover:underline" href={validId ? `/manager/booking/${bookingId}` : '/manager/dashboard?view=bookings'}><ArrowLeft className="h-4 w-4" />Back to booking</Link>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Visit inspection</h1>
        {validId && <Button variant="outline" disabled={query.isFetching} onClick={() => void refresh().catch(() => undefined)}><RefreshCw className="mr-2 h-4 w-4" />Refresh inspection</Button>}
      </div>
      {!validId ? <p role="alert">Invalid booking. Open a booking to inspect its visit.</p> : query.isPending ? <p role="status">Loading inspection…</p> : null}
      {query.error && <p role="alert" className="rounded-xl border p-4 text-destructive">{query.error.message} Refresh before taking action.</p>}
      {query.data && <InspectionVisits key={bookingId} booking={query.data} refresh={refresh} stale={query.isError || query.isFetching} />}
    </div>
  </ManagerBookingLayout>;
}

function InspectionVisits({ booking, refresh, stale }: { booking: ManagerInspectionDetails; refresh: () => Promise<ManagerInspectionDetails | undefined>; stale: boolean }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const visitId = new URLSearchParams(search).get('visitId') || '';
  const [notes, setNotes] = useState<Record<string, string>>({});
  const selected = booking.visits.length ? booking.visits.find(visit => String(visit.id) === visitId)
    || (!visitId && booking.visits.length === 1 ? booking.visits[0] : undefined) : !visitId ? booking : undefined;
  const timezone = booking.location.timezone;
  const noteKey = booking.visits.length ? `visit:${selected?.id || visitId}` : 'booking';
  let contextError = '';
  let formatEvent = (_value?: string | null) => 'Unavailable';
  let schedule = '';
  try {
    if (!timezone) throw Error('Kitchen timezone unavailable. Contact Local Cooks before acting.');
    const formatter = new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
    formatEvent = value => value ? Number.isFinite(Date.parse(value)) ? formatter.format(new Date(value)) : 'Unavailable' : 'Not recorded';
    if (selected) {
      const day = booking.bookingDate.slice(0, 10);
      const startDay = calendarDateForOperatingTime(day, selected.startTime, booking.operatingWindowStartTime || booking.startTime);
      const endDay = calendarDateForBookingTime(day, selected.endTime, booking.operatingWindowStartTime, booking.startTime);
      schedule = `${formatEvent(createBookingDateTime(startDay, selected.startTime, timezone).toISOString())} – ${formatEvent(createBookingDateTime(endDay, selected.endTime, timezone).toISOString())}`;
    }
  } catch (cause) { contextError = cause instanceof Error ? cause.message : 'Visit context unavailable.'; }
  return <>
    <section className="rounded-2xl border bg-card p-5 space-y-2" aria-label="Booking and visit context">
      <p className="text-lg font-semibold">{booking.kitchen.name}</p>
      <p>{booking.referenceCode || `Booking #${booking.id}`} · {booking.chef?.fullName || booking.chef?.username || 'Name unavailable'}</p>
      <p className="text-sm">{booking.location.name} · Kitchen timezone: {timezone || 'Unavailable'}</p>
      <p className="text-sm">Booking status: {booking.status}</p>
      {booking.visits.length > 1 && <div className="text-sm"><label htmlFor="inspection-visit">Visit to inspect</label>
        <select id="inspection-visit" className="ml-2 max-w-full rounded border bg-background p-2" value={visitId} disabled={stale}
          onChange={event => navigate(`/manager/booking/${booking.id}/inspection${event.target.value ? `?visitId=${event.target.value}` : ''}`)}>
          <option value="">Choose visit</option>{booking.visits.map(visit => <option key={visit.id} value={visit.id}>Visit {visit.blockIndex + 1}: {visit.startTime}–{visit.endTime}</option>)}
        </select><span className="mt-1 block text-muted-foreground">Each visit keeps its own unsent note while this page stays open.</span>
      </div>}
      {selected && <p className="text-sm">{booking.visits.length ? `Visit ${booking.visits.findIndex(visit => visit.id === selected.id) + 1} of ${booking.visits.length} · ` : ''}{schedule}</p>}
    </section>
    {contextError && <p role="alert">{contextError}</p>}
    {inSessionEnds(booking).length > 0 && <div className="flex flex-wrap gap-2">
      {inSessionEnds(booking).map(session => <ManagerInSessionBadge key={session.visitId ?? 'booking'} endsAt={session.endsAt} timezone={timezone}
        label={session.visitId && booking.visits.length > 1 ? `Visit ${(booking.visits.find(visit => visit.id === session.visitId)?.blockIndex ?? 0) + 1}` : undefined} />)}
    </div>}
    {['confirmed', 'completed'].includes(booking.status) && <VisitCodePanel bookingId={booking.id} bookingStatus={booking.status}
      customerName={booking.chef?.fullName || booking.chef?.username} kitchenName={booking.kitchen.name} timezone={timezone}
      bookingDate={booking.bookingDate} operatingWindowStartTime={booking.operatingWindowStartTime} startTime={booking.startTime} endTime={booking.endTime}
      visits={booking.visits} onChanged={async () => { await refresh(); }} />}
    {!selected ? <p role="alert">{visitId ? 'The selected visit is no longer available. Choose a current visit or return to the booking.' : 'Choose a visit to review its evidence and response deadline.'}</p> : <InspectionTask key={booking.visits.length ? selected.id : 'booking'} booking={booking} evidence={selected}
      visitId={booking.visits.length ? selected.id : undefined} formatEvent={formatEvent} refresh={refresh} blocked={stale || !!contextError}
      note={notes[noteKey] || ''} onNoteChange={value => setNotes(current => ({ ...current, [noteKey]: value }))} />}
    <Link href="/manager/dashboard?view=support" className="inline-block text-sm underline">Get help from Local Cooks</Link>
  </>;
}

function InspectionTask({ booking, evidence, visitId, formatEvent, refresh, blocked, note, onNoteChange }: {
  booking: ManagerInspectionDetails; evidence: Evidence | ManagerInspectionDetails; visitId?: number; formatEvent: (value?: string | null) => string;
  refresh: () => Promise<ManagerInspectionDetails | undefined>; blocked: boolean;
  note: string; onNoteChange: (value: string) => void;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false), [assistanceOpen, setAssistanceOpen] = useState(false);
  const issueRef = useRef<HTMLElement>(null), assistanceRef = useRef<HTMLElement>(null);
  useEffect(() => { if (issueOpen) issueRef.current?.focus(); }, [issueOpen]);
  useEffect(() => { if (assistanceOpen) assistanceRef.current?.focus(); }, [assistanceOpen]);
  const deadline = visitId ? evidence.checkoutReviewDeadline : booking.inspection?.checkoutReviewDeadline;
  const clock = visitId ? evidence.closeout as import('@shared/clock-closeout').VisitCloseout | undefined : booking.closeout?.visits[0];
  const canClear = clock ? clock.inspection.canRespond : booking.status === 'confirmed' && evidence.checkinStatus === 'checkout_requested' && !!deadline && Number.isFinite(Date.parse(deadline));
  const canAssist = booking.status === 'confirmed' && [null, undefined, 'not_checked_in', 'checked_in'].includes(evidence.checkinStatus);
  const clear = async () => {
    if (!canClear || blocked || saving || saved) return;
    if (!window.confirm(`Clear ${booking.referenceCode || `booking #${booking.id}`}${visitId ? `, visit ${booking.visits.findIndex(visit => visit.id === visitId) + 1}` : ''} with no issues observed? This closes the visit. Your message will be shared with the customer.`)) return;
    setSaving(true); setError('');
    let accepted = false;
    try {
      const current = await refresh();
      const target = visitId ? current?.visits.find(visit => visit.id === visitId) : current?.visits.length === 0 ? current : undefined;
      if (!current || !['confirmed', 'completed'].includes(current.status) || !target || target.checkinStatus !== evidence.checkinStatus
        || current.updatedAt !== booking.updatedAt || target.updatedAt !== evidence.updatedAt)
        throw Error('Visit changed. Review the refreshed evidence before taking action.');
      const currentDeadline = visitId ? target.checkoutReviewDeadline : current.inspection?.checkoutReviewDeadline;
      if (!current.inspection || !currentDeadline || !Number.isFinite(Date.parse(currentDeadline))
        || currentDeadline !== deadline || current.location.timezone !== booking.location.timezone)
        throw Error('Inspection context changed. Review the refreshed deadline and requirements before taking action.');
      const response = await apiClient.post(`/manager/bookings/${booking.id}/clear-kitchen-checkout`, { visitId, sharedManagerMessage: note });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw Error(result.error || 'Could not clear this inspection.');
      accepted = true; setSaved(true);
      await refresh();
      onNoteChange('');
    } catch (cause) {
      setError(`${accepted ? 'Clear was saved, but current results could not be refreshed. ' : ''}${cause instanceof Error ? cause.message : 'Could not save inspection.'} Your note is retained.`);
      if (!accepted) await refresh().catch(() => undefined);
    } finally { setSaving(false); }
  };
  return <>
    <section className="rounded-2xl border bg-card p-5 space-y-3" aria-label="Inspection response">
      <h2 className="font-semibold">Inspection response</h2>
      <ClockCloseoutSummary manager closeout={booking.closeout} visit={clock} />
      <p>Visit record: {evidence.checkinStatus === 'checkout_requested' ? 'Awaiting inspection' : evidence.checkinStatus === 'checked_out' ? 'Checkout closed' : evidence.checkinStatus === 'checkout_claim_filed' ? 'Handed to a claim' : 'Inspection not requested'}</p>
      {evidence.checkoutApprovedAt && <p className="text-sm">Inspection closure recorded: {formatEvent(evidence.checkoutApprovedAt)}</p>}
      <p className="font-medium">Response deadline: {deadline ? `${formatEvent(deadline)} · ${booking.location.timezone}` : evidence.checkoutRequestedAt ? 'Unavailable. Refresh or contact Local Cooks before clearing.' : 'Not started — no departure inspection request recorded.'}</p>
      <p className="text-sm text-muted-foreground">Review the arrival and departure records, then clear the visit or report an issue. If you need help, contact Local Cooks before the response deadline.</p>
      {!booking.inspection ? <p role="alert">Inspection requirements unavailable. Refresh or contact Local Cooks.</p> : !booking.inspection.dutiesSaved ? <p>Legacy reservation: these are current duty previews, not a saved booking snapshot.</p> : <p className="text-sm">Requirements saved with this reservation.</p>}
      <label className="block text-sm font-medium" htmlFor="inspection-message">Message shared with the person booking (optional)</label>
      <Textarea id="inspection-message" value={note} maxLength={2000} disabled={saving} onChange={event => onNoteChange(event.target.value)} />
      <p className="text-xs text-muted-foreground">Unsent notes stay on this page through request errors and refresh. They are not saved across reload or leaving this booking.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p role="status">Inspection cleared.</p>}
      {evidence.checkoutManagerMessage && <p className="whitespace-pre-wrap text-sm">{evidence.checkoutManagerMessage}</p>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={!canClear || blocked || saving || saved || !booking.inspection} onClick={() => void clear()}><CheckCircle2 className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Clear — No issues'}</Button>
        <Button variant="outline" disabled={saving} onClick={() => { setIssueOpen(true); issueRef.current?.focus(); }}>Damage or cleaning issue</Button>
        {canAssist && <Button variant="outline" disabled={saving || blocked} onClick={() => { setAssistanceOpen(true); assistanceRef.current?.focus(); }}>Record missed arrival or departure</Button>}
      </div>
    </section>
    <div className="grid gap-5 md:grid-cols-2">
      <EvidenceSummary title="Arrival" section={booking.inspection?.duties.arrival} timestamp={evidence.checkedInAt}
        photos={evidence.checkinPhotoUrls} checklist={evidence.checkinChecklistItems} notes={evidence.checkinNotes} formatEvent={formatEvent} />
      <EvidenceSummary title="Departure" section={booking.inspection?.duties.departure} timestamp={evidence.checkoutRequestedAt}
        photos={evidence.checkoutPhotoUrls} checklist={evidence.checkoutChecklistItems} notes={evidence.checkoutNotes} formatEvent={formatEvent} />
    </div>
    {!!evidence.assistanceHistory?.length && <section className="rounded-2xl border p-5 space-y-2" aria-label="Assistance history"><h2 className="font-semibold">Manager-reported evidence</h2>
      {evidence.assistanceHistory.map((entry, index) => <p key={index} className="whitespace-pre-wrap text-sm">{entry.action}: reported {formatEvent(entry.actualAt)}, recorded {formatEvent(entry.recordedAt)}. {entry.reason}</p>)}
    </section>}
    {assistanceOpen && <section ref={assistanceRef} tabIndex={-1} aria-label="Missed arrival or departure" className="space-y-3">
      <p className="text-sm">Assistance records reported time and evidence. It does not clear inspection or establish liability.</p>
      <VisitAssistancePanel bookingId={booking.id} updatedAt={booking.updatedAt} visits={visitId ? [evidence] : []} timezone={booking.location.timezone}
        disabled={blocked || saving || !canAssist} onSaved={async () => { await refresh(); }} />
    </section>}
    {issueOpen && <section ref={issueRef} tabIndex={-1} className="rounded-2xl border bg-card p-5 space-y-4" aria-label="Damage or cleaning issue">
      <h2 className="font-semibold">Damage or cleaning issue</h2>
      <p className="text-sm">Compare both sets of evidence and describe what you observed. Missing photos or unchecked tasks do not prove damage or liability. A support request does not file a claim or change this inspection deadline.</p>
      <p role="status" className="text-sm">Claim creation is unavailable from this page. Ask Local Cooks to review the issue before filing a claim.</p>
      <CommitmentProblems kind="booking" id={booking.id} role="manager" canReport />
    </section>}
  </>;
}
