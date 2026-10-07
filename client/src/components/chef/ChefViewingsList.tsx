import { TourIntakeDetails } from "@/components/tour/TourIntakeDetails";
import { KitchenTour } from "@/components/ui/manager-icons";
import { TourChatButton } from '@/components/chat/TourChatButton';
import { TourAttendancePanel } from '@/components/tour/TourAttendancePanel';
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoChip } from "@/components/chef/info-chip";
import { Loader2, ChevronDown, MapPin, Download, CalendarDays, Clock3, X } from "lucide-react";
import { Icon } from "@iconify/react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tt } from "@/i18n/common-ns";
import { ChefTourRow, chefTourRowHasDetails, chefTourVisitAction, formatTourWhen, normalizeChefTourRow, viewingStatusBadge } from "@/lib/chef-viewing-display";
import { tourAvailableDate } from "@/lib/tour-available-date";
import { Link, useLocation, useSearch } from "wouter";
import { useTourClock } from "@/hooks/use-tour-clock";
import { formatTourSlotRange } from '@shared/tour-time';
import { CommitmentProblems } from '@/components/support/CommitmentProblems';
import { canChefRequestReschedule } from '@shared/tour-reschedule';

function TourDownloadButton({ tour, t }: { tour: ChefTourRow; t: (key: string, defaultValue?: string | Record<string, unknown>) => string }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const downloadConfirmation = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Sign in to download your confirmation.");
      const response = await fetch(`/api/viewings/chef/${tour.id}/confirmation`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("This tour is no longer confirmed. Refresh My Tours for its current status.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `TOUR-${tour.id}-confirmation.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not download the confirmation.");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="space-y-1" onClick={(event) => event.stopPropagation()}>
      <Button size="sm" className="h-9 gap-2 whitespace-nowrap" onClick={() => void downloadConfirmation()} disabled={downloading}>
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t("tourDetailDownload", "Download confirmation")}
      </Button>
      {downloadError && <p role="alert" className="text-xs text-destructive">{downloadError}</p>}
    </div>
  );
}

function TourDetailPanel({
  tour,
  t,
}: {
  tour: ChefTourRow;
  t: (key: string, defaultValue?: string | Record<string, unknown>) => string;
}) {
  const pastEnd = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000 < Date.now();
  const expired = ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() < Date.now();
  return (
    <div className="space-y-5 text-sm">
      {(tour.checkedInAt || (tour.status === 'confirmed' && tour.attendance && Date.now() >= Date.parse(tour.attendance.checkInOpensAt))) && <TourAttendancePanel id={tour.id} role="chef" version={tour.updatedAt} />}
      {(tour.arrivalNotes || tour.departureNotes) && <section className="space-y-3 rounded-lg border bg-background p-4">
        <h4 className="font-semibold text-foreground">{t("tourVisitNotes", "Tour arrival and departure notes")}</h4>
        {tour.arrivalNotes && <div><p className="text-sm font-medium">{t("tourArrivalNotes", "Arrival notes")}</p><p className="whitespace-pre-wrap text-muted-foreground">{tour.arrivalNotes}</p></div>}
        {tour.departureNotes && <div><p className="text-sm font-medium">{t("tourDepartureNotes", "Departure notes")}</p><p className="whitespace-pre-wrap text-muted-foreground">{tour.departureNotes}</p></div>}
      </section>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3">
          <h4 className="font-semibold text-foreground">{t("tourVisitDetails", "Visit details")}</h4>
          <div className="space-y-2 text-muted-foreground">
            <p><span className="text-foreground">{t("tourDetailTime", "Tour time")}: </span>{formatTourWhen(tour.scheduledAt, tour.durationMinutes, tour.timezone)}</p>
            {tour.locationAddress && <p><span className="text-foreground">{t("tourAddress", "Address")}: </span>{tour.locationAddress}</p>}
            {tour.managerName && <p><span className="text-foreground">{t("tourDetailManager", "Kitchen manager")}: </span>{tour.managerName}</p>}
            {tour.status === "confirmed" && <div className="flex flex-wrap gap-x-4 gap-y-1">{tour.locationContactPhone && <a className="text-foreground underline underline-offset-2" href={`tel:${tour.locationContactPhone}`}>{tour.locationContactPhone}</a>}{tour.locationContactEmail && <a className="break-all text-foreground underline underline-offset-2" href={`mailto:${tour.locationContactEmail}`}>{tour.locationContactEmail}</a>}</div>}
          </div>
        </section>
        <section className="space-y-3">
          <h4 className="font-semibold text-foreground">{t("tourRequestDetails", "Request details")}</h4>
          <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
            <p><span className="block text-xs">{t("tourDetailReference", "Tour reference")}</span><span className="font-medium text-foreground">TOUR-{tour.id}</span></p>
            <p><span className="block text-xs">{t("tourDetailSubmitted", "Request submitted")}</span><span className="font-medium text-foreground">{tour.submittedAt ? formatTourWhen(tour.submittedAt, null, tour.timezone) : t("tourDetailDateUnavailable", "Date unavailable")}</span></p>
            {tour.chefName && <p><span className="block text-xs">{t("tourDetailChef", "Chef")}</span><span className="font-medium text-foreground">{tour.chefName}</span></p>}
            {tour.chefEmail && <p><span className="block text-xs">{t("tourDetailEmail", "Account email")}</span><span className="break-all font-medium text-foreground">{tour.chefEmail}</span></p>}
            {tour.cancelledAt && <p><span className="block text-xs">{t("tourDetailCancelled", "Cancelled")}</span><span className="font-medium text-foreground">{formatTourWhen(tour.cancelledAt, null, tour.timezone)}</span></p>}
            {tour.completedAt && <p><span className="block text-xs">{t("tourDetailCompleted", "Completed")}</span><span className="font-medium text-foreground">{formatTourWhen(tour.completedAt, null, tour.timezone)}</span></p>}
          </div>
        </section>
      </div>
      {tour.requestedRescheduleAt && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("tourChangeRequested", "Reschedule requested for")} {formatTourWhen(tour.requestedRescheduleAt, tour.durationMinutes, tour.timezone)}. {t("tourOriginalTimeHeld", "Your original time remains confirmed until the manager accepts.")}</p>}

      {(tour.chefNotes?.trim() || tour.intakeEntries.length > 0 || tour.sharedManagerNotes || tour.cancellationReason || tour.noShowReason || tour.disruptionReason) && <section className="rounded-xl border bg-background p-4 sm:p-5"><h4 className="font-semibold text-foreground">{t("tourMoreRequestInfo", "Notes and updates")}</h4><div className="mt-4 space-y-4 divide-y [&>div:not(:first-child)]:pt-4">
      {tour.chefNotes?.trim() && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
            {t("tourListYourNotes", "Your notes")}
          </p>
          <p className="text-foreground whitespace-pre-wrap">{tour.chefNotes.trim()}</p>
        </div>
      )}

      {tour.intakeEntries.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("tourListIntakeTitle", "What you shared")}
          </p>
          <TourIntakeDetails data={Object.fromEntries(tour.intakeEntries)} />
        </div>
      )}

      {tour.cancellationReason && (
        <div>
          <p className="font-medium text-destructive text-xs mb-0.5">
            {t("tourListCancelReason", "Cancellation reason")}
          </p>
          <p className="text-muted-foreground">{tour.cancellationReason}</p>
        </div>
      )}

      {tour.sharedManagerNotes && (
        <div>
          <p className="font-medium text-foreground text-xs mb-0.5">
            {t("tourListManagerMessage", {
              name: tour.managerName || "Manager",
              defaultValue: `Message from ${tour.managerName || "Manager"}`,
            })}
          </p>
          <p className="text-muted-foreground">{tour.sharedManagerNotes}</p>
        </div>
      )}
      {expired && <p className="rounded-xl border bg-muted/50 px-3 py-2 text-sm">{t("tourExpiredHelp", "The requested time passed before confirmation. If you have not applied, you can request another tour from the kitchen page.")}</p>}
      {tour.disruptionReason && <p>{t("tourDisruptionReason", "Reason the tour couldn’t take place")}: {tour.disruptionReason.replace(/_/g, " ")}</p>}
      {tour.noShowReason && <div><p className="font-medium text-xs">{t("tourDetailNoShowReason", "No-show reason")}</p><p className="text-muted-foreground">{tour.noShowReason.replace(/_/g, " ")}</p></div>}
      </div></section>}
      {["pending_local_cooks", "pending"].includes(tour.status) && !expired && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("tourListPending", "Your tour request is pending. We’ll notify you when it’s confirmed or declined.")}</p>}
      <CommitmentProblems kind="tour" id={tour.id} canReport />
      {tour.status === "confirmed" && !pastEnd && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-950">{t("tourListConfirmedNext", "Tour confirmed. Arrive on time and bring questions about equipment, storage, and access.")}</p>}
    </div>
  );
}

function TourRescheduleDialog({ tour, t, onClose, onReschedule, onReviewProposal, rescheduling, rescheduleError, onRestoreFocus }: {
  tour: ChefTourRow; t: (key: string, defaultValue?: string | Record<string, unknown>) => string; onClose: () => void;
  onReschedule: (tour: ChefTourRow, scheduledAt: string) => void;
  onReviewProposal: (tour: ChefTourRow, decision: 'accept' | 'decline', scheduledAt?: string) => void;
  rescheduling: boolean; rescheduleError?: string; onRestoreFocus: () => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [proposalSlot, setProposalSlot] = useState("");
  const hasProposal = tour.rescheduleProposedSlots.length > 0;
  const pendingRequest = ['pending_local_cooks', 'pending'].includes(tour.status);
  const canRequestChange = canChefRequestReschedule(tour) && !tour.disruptionReason && !hasProposal;
  const canReviewProposal = hasProposal && ['pending', 'confirmed'].includes(tour.status) && !tour.checkedInAt && !tour.disruptionReason && new Date(tour.scheduledAt).getTime() > Date.now();
  useEffect(() => { setDate(''); setSlot(''); setProposalSlot(''); }, [tour.updatedAt]);
  const { data: calendarAvailability, isFetching: loadingCalendar, error: calendarError } = useQuery({
    queryKey: [`/api/viewings/calendar-availability/${tour.targetedKitchenId}`, tour.id, tour.updatedAt],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/calendar-availability/${tour.targetedKitchenId}?viewingId=${tour.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) throw new Error("Could not load tour availability");
      return response.json();
    },
    enabled: !!tour.targetedKitchenId && canRequestChange,
  });
  const { data: slots = [], isFetching: loadingSlots, error: slotsError } = useQuery<{ scheduledAt: string; startTime: string }[]>({
    queryKey: ["/api/viewings/available-slots", tour.id, tour.updatedAt, date],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/available-slots/${tour.targetedKitchenId}?date=${date}&viewingId=${tour.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) throw new Error("Could not load available times");
      const data = await response.json();
      return (Array.isArray(data) ? data : data.slots || []).filter((item: { scheduledAt: string }) => Date.parse(item.scheduledAt) > Date.now() && Date.parse(item.scheduledAt) !== Date.parse(tour.scheduledAt));
    },
    enabled: !!date && !!tour.targetedKitchenId && canRequestChange,
  });
  return <Dialog open onOpenChange={open => { if (!open && !rescheduling) onClose(); }}>
    <DialogContent aria-busy={rescheduling} className="max-w-xl gap-0 overflow-hidden p-0" onEscapeKeyDown={event => { if (rescheduling) event.preventDefault(); }} onPointerDownOutside={event => { if (rescheduling) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader className="relative border-b bg-muted/20 px-5 py-5 pr-14 text-left sm:px-6 sm:pr-14">
        <DialogTitle>{hasProposal ? t('tourReviewSuggestedTimes', 'Review suggested times') : pendingRequest ? t('tourEditRequest', 'Edit tour request') : t('tourRequestNewTime', 'Reschedule tour')}</DialogTitle>
        <DialogDescription>{tour.locationName} · TOUR-{tour.id}</DialogDescription>
        <Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label={t('close', 'Close')} disabled={rescheduling} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
      </DialogHeader>
      <div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="rounded-xl border bg-muted/20 p-4"><p className="mb-1 text-xs font-medium text-muted-foreground">{pendingRequest ? t('tourRequestedTime', 'Requested time') : t('tourDetailTime', 'Tour time')}</p><p className="text-sm font-medium">{formatTourWhen(tour.scheduledAt, tour.durationMinutes, tour.timezone)}</p></div>
        {rescheduleError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{rescheduleError}</p>}
      {hasProposal && canReviewProposal && <section className="space-y-4" aria-label={t('tourProposedTimes', 'Choose a new tour time')}>
        <div className="space-y-1"><h4 className="font-semibold">{t('tourProposedTimes', 'Choose a new tour time')}</h4><p className="text-sm text-muted-foreground">{pendingRequest ? t('tourPendingProposalHelp', 'Your manager offered these available times. Choose one to confirm your tour, or keep your original request pending. Respond before your original requested start time; the request expires then.') : t('tourProposalOriginalHeld', 'Your manager suggested these alternatives. Your original tour stays confirmed until you accept a new time.')}</p></div>
        <fieldset className="space-y-2" disabled={rescheduling}><legend className="sr-only">{t('tourProposedTimes', 'Choose a new tour time')}</legend>{tour.rescheduleProposedSlots.map(time => <label key={time} className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-background p-3 ${proposalSlot === time ? 'border-primary ring-1 ring-primary' : ''}`}><input type="radio" name={`tour-proposal-${tour.id}`} value={time} checked={proposalSlot === time} onChange={() => setProposalSlot(time)} disabled={Date.parse(time) <= Date.now()} /><span>{formatTourWhen(time, tour.durationMinutes, tour.timezone)}</span></label>)}</fieldset>
        <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="h-11 w-full" disabled={rescheduling} onClick={() => onReviewProposal(tour, 'decline')}>{pendingRequest ? t('tourKeepOriginalRequest', 'Keep original request') : t('tourKeepOriginalTime', 'Keep original time')}</Button><Button className="h-11 w-full" disabled={rescheduling || !proposalSlot || !tour.rescheduleProposedSlots.includes(proposalSlot) || Date.parse(proposalSlot) <= Date.now()} onClick={() => onReviewProposal(tour, 'accept', proposalSlot)}>{rescheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pendingRequest ? t('tourAcceptAndConfirm', 'Accept and confirm tour') : t('tourAcceptNewTime', 'Accept new time')}</Button></div>
      </section>}
      {canRequestChange && !tour.requestedRescheduleAt && (
        <section className="space-y-5">
          <p className="mt-2 text-sm text-muted-foreground">{pendingRequest ? t('tourEditRequestHelp', 'Choose a different available date and time. Your request will remain pending until it is confirmed.') : t('tourRescheduleDeadline', 'Request a change before the start of your tour day. Your original time stays confirmed until the manager accepts.')}</p>
          {(calendarError || slotsError) && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{(calendarError || slotsError)?.message}</p><Button variant="outline" size="sm" disabled={rescheduling} onClick={() => { void queryClient.invalidateQueries({ queryKey: [`/api/viewings/calendar-availability/${tour.targetedKitchenId}`, tour.id] }); void queryClient.invalidateQueries({ queryKey: ['/api/viewings/available-slots', tour.id] }); }}>{t('tourTryAgain', 'Try again')}</Button></div>}
          <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><label className="mb-1 block text-xs font-medium" htmlFor={`tour-date-${tour.id}`}>{t("tourNewDate", "New date")}</label><DateField id={`tour-date-${tour.id}`} value={date} onChange={(value) => { setDate(value); setSlot(""); }} placeholder={t("tourChooseDate", "Choose a date")} disabled={rescheduling || loadingCalendar || !!calendarError || !calendarAvailability} disabledDate={(day) => !tourAvailableDate(day, calendarAvailability)} /></div>
          <div className="space-y-1"><label className="mb-1 block text-xs font-medium" htmlFor={`tour-time-${tour.id}`}>{t("tourAvailableTime", "Available time")}</label><Select value={slot} onValueChange={setSlot} disabled={rescheduling || !date || loadingSlots || !!slotsError || slots.length === 0}><SelectTrigger id={`tour-time-${tour.id}`}><SelectValue placeholder={loadingSlots ? t("tourLoadingTimes", "Loading…") : t("tourChooseTime", "Choose a time")} /></SelectTrigger><SelectContent>{slots.map((item) => <SelectItem key={item.scheduledAt} value={item.scheduledAt}>{formatTourSlotRange(item.scheduledAt, tour.durationMinutes ?? 30)}</SelectItem>)}</SelectContent></Select></div>

          </div>
          {date && !loadingSlots && !slotsError && slots.length === 0 && <p role="status" className="mt-2 text-sm text-muted-foreground">{t('tourNoAvailableTimes', 'No available times on this date. Choose another date.')}</p>}
          <div className="grid gap-2 border-t pt-4 sm:grid-cols-2"><Button variant="outline" className="h-11 w-full" disabled={rescheduling} onClick={onClose}>{t("cancel", "Cancel")}</Button>          <Button className="h-11 w-full" disabled={!slot || rescheduling || loadingSlots || !!slotsError || !!calendarError || !slots.some(item => item.scheduledAt === slot)} onClick={() => onReschedule(tour, slot)}>{rescheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pendingRequest ? t('tourSaveRequest', 'Save request') : t("tourRequestNewTime", "Reschedule tour")}</Button></div>
        </section>
      )}
        {!canRequestChange && !(hasProposal && canReviewProposal) && <div className="space-y-4"><p role="status" className="text-sm text-muted-foreground">{t('tourActionNoLongerAvailable', 'This action is no longer available. Your tour details have been refreshed.')}</p><Button variant="outline" className="h-11 w-full" onClick={onClose} disabled={rescheduling}>{t('close', 'Close')}</Button></div>}
      </div>
    </DialogContent>
  </Dialog>;
}

export default function ChefViewingsList({ onExploreKitchens }: { onExploreKitchens?: () => void }) {
  useTourClock();
  const { user } = useFirebaseAuth();
  const { t } = useTranslation("chef");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const search = useSearch();
  const [location] = useLocation();
  const linkParams = new URLSearchParams(search);
  const linkedTourId = Number(linkParams.get('viewing'));
  const linkedAction = linkParams.get('action');
  const handledActionLink = useRef<string | null>(null);
  useEffect(() => { if (Number.isInteger(linkedTourId) && linkedTourId > 0) setExpandedId(linkedTourId); }, [linkedTourId]);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const listContainer = useRef<HTMLDivElement | null>(null);
  const [rescheduleTargetId, setRescheduleTargetId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ChefTourRow | null>(null);
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);
  const [rescheduleError, setRescheduleError] = useState<{ id: number; message: string } | null>(null);
  const queryClient = useQueryClient();
  const requestReschedule = async (tour: ChefTourRow, scheduledAt: string) => {
    setReschedulingId(tour.id);
    setRescheduleError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/chef/${tour.id}/reschedule`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ scheduledAt, expectedUpdatedAt: tour.updatedAt }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['/api/viewings', 'chef'] }),
          queryClient.invalidateQueries({ queryKey: [`/api/viewings/calendar-availability/${tour.targetedKitchenId}`, tour.id] }),
          queryClient.invalidateQueries({ queryKey: ['/api/viewings/available-slots', tour.id] }),
        ]);
        throw new Error(body.error || "Could not request a new time");
      }
      if (body.notificationDeliveryFailed) window.alert(t("tourSavedDeliveryFailed", "Your change is saved, but some notifications could not be delivered."));
      await queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] });
      setRescheduleTargetId(null);
    } catch (error) { setRescheduleError({ id: tour.id, message: error instanceof Error ? error.message : "Could not request a new time" }); }
    finally { setReschedulingId(null); }
  };
  const reviewProposal = async (tour: ChefTourRow, decision: 'accept' | 'decline', scheduledAt?: string) => {
    setReschedulingId(tour.id);
    setRescheduleError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/chef/${tour.id}/reschedule-proposal`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ decision, ...(decision === 'accept' ? { scheduledAt } : {}), expectedUpdatedAt: tour.updatedAt }) });
      const body = await response.json().catch(() => ({}));
      await queryClient.invalidateQueries({ queryKey: ['/api/viewings', 'chef'] });
      if (!response.ok) throw new Error(body.error || t('tourRescheduleDecisionFailed', 'Could not update your tour. Refresh and try again.'));
      if (body.notificationDeliveryFailed) window.alert(t('tourSavedDeliveryFailed', 'Your change is saved, but some notifications could not be delivered.'));
      setRescheduleTargetId(null);
    } catch (error) { setRescheduleError({ id: tour.id, message: error instanceof Error ? error.message : t('tourRescheduleDecisionFailed', 'Could not update your tour. Refresh and try again.') }); }
    finally { setReschedulingId(null); }
  };
  const cancelTour = async (tour: ChefTourRow) => {
    setCancellingId(tour.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/${tour.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ status: "cancelled", cancellationReason: "Tour cancelled", expectedUpdatedAt: tour.updatedAt }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { await queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] }); throw new Error(body.error || "Could not cancel tour"); }
      if (body.notificationDeliveryFailed) window.alert(t("tourSavedDeliveryFailed", "Your change is saved, but some notifications could not be delivered."));
      await queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Could not cancel tour"); }
    finally { setCancellingId(null); setCancelTarget(null); }
  };

  const { data: rawViewings = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["/api/viewings", "chef", user?.uid],
    queryFn: async () => {
      if (!user) return [];
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/viewings/chef", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(tt("failedToFetchViewings"));
      return res.json();
    },
    enabled: !!user?.uid,
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const data = useMemo(
    () =>
      (rawViewings as unknown[])
        .map(normalizeChefTourRow)
        .filter((row): row is ChefTourRow => row != null)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || b.id - a.id),
    [rawViewings]
  );

  useEffect(() => {
    if (!user?.uid || isLoading || isFetching || error || location !== '/dashboard' || new URLSearchParams(search).get('view') !== 'viewings' || !Number.isSafeInteger(linkedTourId) || linkedTourId <= 0) return;
    const linkKey = `${user.uid}:${location}:${search}`;
    if (handledActionLink.current === linkKey) return;
    const tour = data.find(item => item.id === linkedTourId);
    if (!tour) return;
    handledActionLink.current = linkKey;
    const hasProposal = tour.rescheduleProposedSlots.length > 0;
    const canReview = hasProposal && ['pending', 'confirmed'].includes(tour.status) && !tour.checkedInAt && !tour.disruptionReason && Date.parse(tour.scheduledAt) > Date.now();
    if ((linkedAction === 'review-times' && canReview) || (linkedAction === 'reschedule' && !hasProposal && canChefRequestReschedule(tour) && !tour.disruptionReason)) {
      actionTrigger.current = null;
      setRescheduleError(null);
      setRescheduleTargetId(tour.id);
    } else if (linkedAction === 'cancel' && ['pending_local_cooks', 'pending', 'confirmed'].includes(tour.status) && Date.parse(tour.scheduledAt) > Date.now()) {
      actionTrigger.current = null;
      setCancelTarget(tour);
    }
  }, [user?.uid, isLoading, isFetching, error, location, search, linkedTourId, linkedAction, data]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading kitchen tours">
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 w-full rounded-xl" />)}
      </div>
    );
  }

  if (error) {
    return <Card className="shadow-none"><CardContent className="space-y-3 p-8 text-center"><p>We couldn’t load your kitchen tours right now.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></CardContent></Card>;
  }

  if (linkedTourId > 0 && !data.some(tour => tour.id === linkedTourId)) {
    return <Card><CardContent role="alert" className="space-y-3 p-8 text-center"><p>This tour is unavailable. Check your account or try again.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></CardContent></Card>;
  }

  if (data.length === 0) {
    return (
      <Card className="border-dashed shadow-none" data-testid="chef-viewings-list-empty">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <KitchenTour className="mb-4 h-6 w-6 text-muted-foreground" />
          <h3 className="text-lg font-medium">
            {t("tourListEmptyTitle", "No kitchen tours yet")}
          </h3>
          <p className="text-muted-foreground mt-1 max-w-sm">
            {t(
              "tourListEmptyBody",
              "Request a tour from Discover to walk a kitchen before you apply."
            )}
          </p>
          {onExploreKitchens && (
            <Button className="mt-4" onClick={onExploreKitchens}>
              <Icon icon="mdi:magnify" className="size-4" aria-hidden />
              {t("tourListExploreCta", "Discover Kitchens")}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div ref={listContainer} tabIndex={-1} className="space-y-4 outline-none" data-testid="chef-viewings-list">
      <div className="space-y-3">
        {data.map((tour) => {
          const open = expandedId === tour.id;
          const hasDetails = chefTourRowHasDetails(tour);
          const pastEnd = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000 < Date.now();
          const expired = ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() < Date.now();
          const badge = viewingStatusBadge(tour.status, tour.adminReviewDecision, tour.cancelledBy, tour.disruptionReason);
          const visitAction = chefTourVisitAction(tour);
          const hasProposal = tour.rescheduleProposedSlots.length > 0 && ["pending", "confirmed"].includes(tour.status) && !tour.checkedInAt && !tour.disruptionReason && Date.parse(tour.scheduledAt) > Date.now();
          const canEdit = canChefRequestReschedule(tour) && !tour.disruptionReason;
          return (
            <article key={tour.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">TOUR-{tour.id}</p>
                    <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{tour.locationName}</h3>
                    {tour.kitchenName && <p className="text-sm text-muted-foreground">{tour.kitchenName}</p>}
                  </div>
                  <InfoChip variant={expired ? "warning" : pastEnd && tour.status === "confirmed" ? "info" : badge.variant}>
                    {expired ? t("tourExpired", "Request expired") : pastEnd && tour.status === "confirmed" ? t("tourScheduledTimeEnded", "Tour time ended") : t(badge.labelKey, badge.defaultLabel)}
                  </InfoChip>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-foreground sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                  <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{formatTourWhen(tour.scheduledAt, null, tour.timezone)}</span></p>
                  <p className="flex items-start gap-2"><Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{tour.durationMinutes ? t("tourListDurationMins", { count: tour.durationMinutes, defaultValue: `${tour.durationMinutes} min` }) : t("tourListDurationDefault", "About 30 min")}</span></p>
                  {tour.locationAddress && <p className="flex min-w-0 items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tour.locationAddress)}`} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-foreground underline underline-offset-2">{tour.locationAddress}</a></p>}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
                  {visitAction && !open && <Button variant="outline" size="sm" className="h-9" onClick={() => setExpandedId(tour.id)}>{visitAction === 'arrival' ? t('tourRecordArrival', 'Record arrival') : t('tourRecordDeparture', 'Record departure')}</Button>}
                  {(hasProposal || canEdit) && <Button variant="outline" size="sm" className="h-9" disabled={reschedulingId !== null || cancellingId !== null} onClick={event => { actionTrigger.current = event.currentTarget; setRescheduleError(null); setRescheduleTargetId(tour.id); }}>{hasProposal ? t('tourReviewSuggestedTimes', 'Review suggested times') : ['pending_local_cooks', 'pending'].includes(tour.status) ? t('tourEditRequest', 'Edit tour request') : t('tourRequestNewTime', 'Reschedule tour')}</Button>}
                  {["pending_local_cooks", "pending", "confirmed"].includes(tour.status) && new Date(tour.scheduledAt).getTime() > Date.now() && <Button variant="outline" size="sm" className="h-9 text-destructive hover:text-destructive" disabled={cancellingId !== null || reschedulingId !== null} onClick={event => { actionTrigger.current = event.currentTarget; setCancelTarget(tour); }}>{t("tourCancel", "Cancel tour")}</Button>}
                  <TourChatButton tour={tour} role="chef" openFromLink={location === "/dashboard" && linkParams.get("view") === "viewings"} buttonClassName="h-9" />
                  {tour.locationId && (tour.status === 'completed' || (tour.status === 'confirmed' && pastEnd)) &&
                    <Button asChild variant="outline" size="sm" className="h-9"><Link href={`/apply-kitchen/${tour.locationId}${tour.targetedKitchenId ? `?kitchenId=${tour.targetedKitchenId}` : ''}`}>{t('tourApplyNext', 'Apply to this kitchen')}</Link></Button>}
                  <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                  {tour.status === "confirmed" && !pastEnd && <TourDownloadButton tour={tour} t={t as any} />}
                  {hasDetails && <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" aria-expanded={open} aria-controls={`tour-details-${tour.id}`} onClick={() => setExpandedId(open ? null : tour.id)}>{open ? t("tourHideDetails", "Hide details") : t("tourShowDetails", "View details")}{open ? <ChevronDown className="size-4 rotate-180" /> : <ChevronDown className="size-4" />}</Button>}
                  </div>
                </div>
              </div>
              {open && <div id={`tour-details-${tour.id}`} className="border-t bg-muted/20 p-4 sm:p-5"><TourDetailPanel tour={tour} t={t as any} /></div>}
            </article>
          );
        })}
      </div>
      {rescheduleTargetId !== null && data.find(tour => tour.id === rescheduleTargetId) && <TourRescheduleDialog tour={data.find(tour => tour.id === rescheduleTargetId)!} t={t as any} onClose={() => setRescheduleTargetId(null)} onRestoreFocus={() => { if (actionTrigger.current?.isConnected) actionTrigger.current.focus(); else listContainer.current?.focus(); }} onReschedule={(item, time) => void requestReschedule(item, time)} onReviewProposal={(item, decision, time) => void reviewProposal(item, decision, time)} rescheduling={reschedulingId !== null} rescheduleError={rescheduleError?.id === rescheduleTargetId ? rescheduleError.message : undefined} />}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open && cancellingId === null) setCancelTarget(null); }}>
        <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); if (actionTrigger.current?.isConnected) actionTrigger.current.focus(); else listContainer.current?.focus(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tourCancelConfirmTitle", "Cancel this tour?")}</AlertDialogTitle>
            <AlertDialogDescription>{cancelTarget?.locationName} · {cancelTarget && formatTourWhen(cancelTarget.scheduledAt, null, cancelTarget.timezone)}. {t("tourCancelConfirmBody", "The kitchen will be notified, and you can request another available time.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancellingId !== null}>{t("keepTour", "Keep tour")}</AlertDialogCancel>
            <Button variant="destructive" disabled={cancellingId !== null} onClick={() => { if (cancelTarget) void cancelTour(cancelTarget); }}>{t("tourCancel", "Cancel tour")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
