import { Input } from "@/components/ui/input";
import { TourIntakeDetails } from "@/components/tour/TourIntakeDetails";
import { KitchenTour } from "@/components/ui/manager-icons";
import { TourChatButton } from '@/components/chat/TourChatButton';
import { TourHistoryPanel } from '@/components/tour/TourHistoryPanel';
import { tourCanReportLate } from '@shared/tour-late';
import { hasTourConfirmation } from '@shared/tour-outcome';
import { TourFeedbackPanel } from '@/components/tour/TourFeedbackPanel';
import { ChefTourRepeatPermissionPanel } from '@/components/tour/TourRepeatPermissionPanel';
import { tourFeedbackOpen } from '@shared/tour-feedback';
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, ArrowRight, CalendarCheck, Check, CheckCircle2, Download, X } from "lucide-react";
import { Icon } from "@iconify/react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDialogBody, AppDialogContent, AppDialogHeader } from "@/components/ui/app-dialog";
import { tt } from "@/i18n/common-ns";
import { ChefTourRow, chefTourCard, chefTourTimes, chefTourWhen, normalizeChefTourRow } from "@/lib/chef-viewing-display";
import { tourAvailableDate } from "@/lib/tour-available-date";
import { Link, useLocation, useSearch } from "wouter";
import { useTourClock } from "@/hooks/use-tour-clock";
import { TourSupportCard } from '@/components/tour/TourSupportCard';
import { canChefRequestReschedule } from '@shared/tour-reschedule';
import { TourApplicationButton } from '@/components/tour/TourApplicationButton';
import { useTourRequestAccess } from '@/hooks/use-tour-request-access';
import { KitchenInventoryModals, type EquipmentListing, type StorageListing } from "@/components/kitchen-application/KitchenInventory";

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
      <Button size="sm" className="h-auto min-h-11 w-full gap-2 whitespace-normal rounded-xl py-2 sm:w-auto" onClick={() => void downloadConfirmation()} disabled={downloading}>
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t("tourDetailDownload", "Download")}
      </Button>
      {downloadError && <p role="alert" className="text-xs text-destructive">{downloadError}</p>}
    </div>
  );
}

const DOT = { green: "bg-emerald-600", amber: "bg-amber-500", grey: "bg-muted-foreground/50" } as const;
const DISRUPTION = {
  manager_absent: ['tourChefDisruption_manager_absent', 'No one from the kitchen was there'],
  access_unavailable: ['tourChefDisruption_access_unavailable', 'The kitchen couldn’t be opened'],
  weather: ['tourChefDisruption_weather', 'Weather prevented the tour'],
  other: ['tourChefDisruption_other', 'Another problem'],
} as const;

function TourDetailPanel({
  tour,
  t,
}: {
  tour: ChefTourRow;
  t: (key: string, defaultValue?: string | Record<string, unknown>) => string;
}) {
  const { i18n } = useTranslation();
  const locale = i18n?.language || "en-CA";
  const disruptionLabel = (reason: string) => { const [key, english] = DISRUPTION[reason as keyof typeof DISRUPTION] ?? DISRUPTION.other; return t(key, english); };
  const declined = tour.status === 'cancelled' && (tour.cancelledBy === 'manager_declined' || tour.adminReviewDecision === 'denied');
  const expired = !!tour.requestExpiredAt || ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() <= Date.now();
  const preparation = useQuery<{ equipment: { name: string }[]; storage: StorageListing[]; inventory: { equipment: { included: EquipmentListing[]; rental: EquipmentListing[] }; storage: StorageListing[] } }>({
    queryKey: ['tour-preparation-listings', tour.targetedKitchenId],
    enabled: tour.status === 'confirmed' && !!tour.targetedKitchenId, retry: false,
    queryFn: async () => {
      const [equipmentResponse, storageResponse] = await Promise.all([
        fetch(`/api/public/kitchens/${tour.targetedKitchenId}/equipment-listings`),
        fetch(`/api/public/kitchens/${tour.targetedKitchenId}/storage-listings`),
      ]);
      if (!equipmentResponse.ok || !storageResponse.ok) throw new Error('Listing information unavailable');
      const [equipment, storage] = await Promise.all([equipmentResponse.json(), storageResponse.json()]);
      const mapEquipment = (items: EquipmentListing[]) => items.map(item => ({ ...item, sessionRate: item.sessionRate ? item.sessionRate / 100 : undefined }));
      const inventory = {
        equipment: { included: mapEquipment(equipment.included || []), rental: mapEquipment(equipment.rental || []) },
        storage: (storage || []).map((item: StorageListing) => ({ ...item, basePrice: item.basePrice != null ? item.basePrice / 100 : undefined, pricePerCubicFoot: item.pricePerCubicFoot != null ? item.pricePerCubicFoot / 100 : undefined })),
      };
      return { equipment: [...inventory.equipment.included, ...inventory.equipment.rental].map(item => ({ name: (item.equipmentType || '').replace(/[_-]/g, ' ') })).filter(item => item.name), storage: inventory.storage, inventory };
    },
  });
  const intendedUse = tour.intakeEntries.find(([key]) => key === 'intendedUse')?.[1];
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [showStorageModal, setShowStorageModal] = useState(false);
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-2">
      {tour.status === "confirmed" && <section aria-label={t("tourArrivalNotes", "Arrival notes")} className="space-y-3 rounded-xl border bg-card p-5 sm:col-span-2 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">{t("tourArrivalNotes", "Arrival notes")}</h2>
        <p className="whitespace-pre-wrap text-muted-foreground">{tour.arrivalNotes?.trim() || t("tourArrivalNotesEmpty", "The kitchen hasn’t shared arrival instructions yet. Message the kitchen if you need help finding the entrance or meeting point.")}</p>
      </section>}
      {(tour.status === 'confirmed' && Date.parse(tour.scheduledAt) > Date.now() || tour.chefNotes?.trim() || tour.intakeEntries.length > 0 || tour.sharedManagerNotes || tour.cancellationReason || tour.noShowReason || tour.disruptionReason) && <section className="rounded-xl border bg-card p-5 sm:col-span-2 sm:p-6"><h2 className="text-sm font-semibold text-foreground">{t("tourMoreRequestInfo", "Notes and updates")}</h2><div className="mt-4 space-y-4 divide-y [&>div:not(:first-child)]:pt-4">
        {tour.status === 'confirmed' && Date.parse(tour.scheduledAt) > Date.now() && <div aria-label={t('tourPrepareTitle', 'Prepare for your kitchen tour')} className="space-y-3">
          <h3 className="text-sm font-semibold">{t('tourPrepareTitle', 'Prepare for your kitchen tour')}</h3>
          <ul className="list-disc space-y-2 pl-4 text-muted-foreground">
            <li>{intendedUse ? t('tourInspectForUse', 'Walk through the space with your intended use in mind: can your preparation, cooking, packing, and cleanup fit?') : t('tourInspectSpace', 'Walk through the preparation, cooking, packing, and cleanup areas. Ask whether the space fits your work.')}</li>
            <li>
              {t('tourInspectEquipment', 'Ask which listed equipment is available to you, how it operates, and whether rental charges or training apply.')}
              <p className="mt-1 break-words text-foreground">
                {t('tourListedEquipment', 'Listed equipment')}{preparation.data?.equipment.length ? `: ${preparation.data.equipment.map(e => e.name).slice(0, 4).join(', ')}${preparation.data.equipment.length > 4 ? ', …' : ''}` : ''}{' '}
                <button type="button" disabled={preparation.isPending && !!tour.targetedKitchenId} onClick={() => setShowEquipmentModal(true)} className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap align-baseline sm:min-h-0 text-sm font-semibold text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" aria-label={t('tourShowAllEquipment', 'Show all equipment')}>{t('showAllDescription', 'Show all')} <Icon icon="mdi:chevron-right" width={16} height={16} aria-hidden /></button>
              </p>
            </li>
            <li>
              {t('tourInspectStorage', 'Ask about dry, refrigerated, and freezer storage, available capacity, access, and any separate charges.')}
              <p className="mt-1 break-words text-foreground">
                {t('tourListedStorage', 'Listed storage')}{preparation.data?.storage.length ? `: ${preparation.data.storage.map(s => s.name).slice(0, 4).join(', ')}${preparation.data.storage.length > 4 ? ', …' : ''}` : ''}{' '}
                <button type="button" disabled={preparation.isPending && !!tour.targetedKitchenId} onClick={() => setShowStorageModal(true)} className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap align-baseline sm:min-h-0 text-sm font-semibold text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" aria-label={t('tourShowAllStorage', 'Show all storage')}>{t('showAllDescription', 'Show all')} <Icon icon="mdi:chevron-right" width={16} height={16} aria-hidden /></button>
              </p>
            </li>
            <li>{t('tourBringQuestions', 'Bring your menu or workflow, expected hours, storage needs, and questions. Ask the kitchen before bringing ingredients or equipment; this kitchen tour does not authorize food production.')}</li>
          </ul>
          {(!tour.targetedKitchenId || preparation.isError || (preparation.data && !preparation.data.equipment.length && !preparation.data.storage.length)) && <p className="text-xs text-muted-foreground">{t('tourListingUnknown', 'Listing details are unavailable or incomplete. Treat equipment and storage as questions to confirm during the tour.')}</p>}
          {preparation.isPending && !!tour.targetedKitchenId && <p role="status" className="text-xs text-muted-foreground">{t('tourListingLoading', 'Loading current listing details…')}</p>}
        </div>}
        {tour.chefNotes?.trim() && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-0.5">
              {t("tourListYourNotes", "Your notes")}
            </p>
            <p className="text-foreground whitespace-pre-wrap">{tour.chefNotes.trim()}</p>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("tourRequestDetails", "Request details")}
          </p>
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2 text-sm pt-1">
            <div><dt className="text-xs text-muted-foreground">{t("tourDetailReference", "Tour reference")}</dt><dd>TOUR-{tour.id}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("tourDetailSubmitted", "Request submitted")}</dt><dd>{tour.submittedAt ? chefTourWhen(tour.submittedAt, null, locale) : t("tourDetailDateUnavailable", "Date unavailable")}</dd></div>
            {tour.cancelledAt && !expired && <div><dt className="text-xs text-muted-foreground">{declined ? t("tourDetailDeclined", "Declined") : tour.disruptionReason === "outcome_unknown" ? t("tourDetailEnded", "Ended") : t("tourDetailCancelled", "Cancelled")}</dt><dd>{chefTourWhen(tour.cancelledAt, null, locale)}</dd></div>}
            {tour.completedAt && <div><dt className="text-xs text-muted-foreground">{t("tourDetailCompleted", "Completed")}</dt><dd>{chefTourWhen(tour.completedAt, null, locale)}</dd></div>}
          </dl>
        </div>

        {tour.intakeEntries.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("tourListIntakeTitle", "What you shared")}
            </p>
            <TourIntakeDetails data={Object.fromEntries(tour.intakeEntries)} />
          </div>
        )}

        {tour.cancellationReason && !expired && (
          <div>
            <p className="font-medium text-destructive text-xs mb-0.5">
              {declined ? t("tourReasonDeclined", "Why the kitchen declined") : tour.cancelledBy === 'chef' ? t("tourReasonYou", "Your reason") : tour.cancelledBy === 'manager' ? t("tourReasonKitchen", "Why the kitchen cancelled") : t("tourReasonLc", "Why Local Cooks closed this tour")}
            </p>
            <p className="text-muted-foreground">{tour.cancellationReason}</p>
          </div>
        )}

        {tour.sharedManagerNotes && (
          <div>
            <p className="font-medium text-foreground text-xs mb-0.5">
              {t("tourListKitchenMessage", "Notes from the kitchen")}
            </p>
            <p className="text-muted-foreground">{tour.sharedManagerNotes}</p>
          </div>
        )}
        {expired && <p className="rounded-xl border bg-muted/50 px-3 py-2 text-sm">{t("tourExpiredHelpKitchen", "The time passed before the kitchen confirmed. You can ask for another time.")}</p>}
        {tour.disruptionReason && <p>{tour.disruptionReason === 'outcome_unknown' ? t('tourStatusUnverified', 'Tour closed — outcome not verified') : <>{t("tourDisruptionReason", "Reason the tour couldn’t take place")}: {disruptionLabel(tour.disruptionReason)}</>}</p>}
        {tour.noShowReason && <div><p className="font-medium text-xs">{t("tourDetailNoShowReason", "No-show reason")}</p><p className="text-muted-foreground">{tour.noShowReason === 'visitor_absent' ? t('tourNoShowYou', 'You didn’t come') : disruptionLabel(tour.noShowReason)}</p></div>}
      </div></section>}
      <div className="sm:col-span-2 [&>section]:rounded-xl [&>section]:bg-card [&>section]:p-5 sm:[&>section]:p-6"><TourSupportCard /></div>

      <KitchenInventoryModals
        kitchen={preparation.data?.inventory ?? {}}
        openModal={showEquipmentModal ? "equipment" : showStorageModal ? "storage" : null}
        setOpenModal={modal => { setShowEquipmentModal(modal === "equipment"); setShowStorageModal(modal === "storage"); }}
      />
    </div>
  );
}

function TourSummary({ tour, t }: { tour: ChefTourRow; t: (key: string, defaultValue?: string | Record<string, unknown>) => string }) {
  const { i18n } = useTranslation();
  const locale = i18n?.language || "en-CA";
  return <aside aria-label={t("tourSummary", "Tour summary")} className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
    <section className="space-y-3"><h2 className="text-sm font-semibold">{t("tourVisitDetails", "Kitchen tour details")}</h2>
      <p className="font-medium">{tour.kitchenName || tour.locationName}</p>{tour.kitchenName && tour.kitchenName !== tour.locationName && <p className="text-sm text-muted-foreground">{tour.locationName}</p>}
      <p className="text-sm">{chefTourWhen(tour.scheduledAt, tour.durationMinutes, locale)}</p>
      <p className="text-sm text-muted-foreground">{t("tourListDurationMins", { count: tour.durationMinutes ?? 30, defaultValue: `${tour.durationMinutes ?? 30} min` })}</p>
      {tour.locationAddress && <a className="block text-sm underline underline-offset-2" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tour.locationAddress)}`} target="_blank" rel="noopener noreferrer">{tour.locationAddress}</a>}
    </section>










  </aside>;
}

function TourRescheduleDialog({ tour, t, onClose, onReschedule, onReviewProposal, rescheduling, rescheduleError, onRestoreFocus }: {
  tour: ChefTourRow; t: (key: string, defaultValue?: string | Record<string, unknown>) => string; onClose: () => void;
  onReschedule: (tour: ChefTourRow, scheduledAt: string) => void;
  onReviewProposal: (tour: ChefTourRow, decision: 'accept' | 'decline', scheduledAt?: string) => void;
  rescheduling: boolean; rescheduleError?: string; onRestoreFocus: () => void;
}) {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const locale = i18n?.language || "en-CA";
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
    <DialogContent aria-busy={rescheduling} className="flex max-w-xl flex-col gap-0 overflow-hidden p-0 [overflow-wrap:anywhere]" onEscapeKeyDown={event => { if (rescheduling) event.preventDefault(); }} onPointerDownOutside={event => { if (rescheduling) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogHeader className="relative border-b bg-muted/20 px-5 py-5 pr-14 text-left sm:px-6 sm:pr-14">
        <DialogTitle>{hasProposal ? t('tourOfferedTitle', 'The kitchen offered other times') : pendingRequest ? t('tourEditRequest', 'Edit tour request') : t('tourRequestNewTime', 'Reschedule tour')}</DialogTitle>
        <DialogDescription>{tour.locationName} · TOUR-{tour.id}</DialogDescription>
        <Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label={t('close', 'Close')} disabled={rescheduling} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
      </DialogHeader>
      <div className="max-h-[65dvh] min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="rounded-xl border bg-muted/20 p-4"><p className="mb-1 text-xs font-medium text-muted-foreground">{pendingRequest ? t('tourRequestedTime', 'Requested time') : t('tourDetailTime', 'Tour time')}</p><p className="text-sm font-medium">{chefTourWhen(tour.scheduledAt, tour.durationMinutes, locale)}</p></div>
        {rescheduleError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{rescheduleError}</p>}
        {hasProposal && canReviewProposal && <section className="space-y-4" aria-label={t('tourProposedTimes', 'Choose a new tour time')}>
          <div className="space-y-1"><h2 className="text-sm font-semibold">{t('tourProposedTimes', 'Choose a new tour time')}</h2><p className="text-sm text-muted-foreground">{pendingRequest ? t('tourPendingProposalHelp', 'The kitchen offered these times. Choose one to confirm your tour, or keep your original request. Answer before your requested start time; the request expires then.') : t('tourProposalOriginalHeld', 'The kitchen offered these times. Your current tour stays confirmed until you accept a new one.')}</p></div>
          <fieldset className="space-y-2" disabled={rescheduling}><legend className="sr-only">{t('tourProposedTimes', 'Choose a new tour time')}</legend>{tour.rescheduleProposedSlots.map(time => {
            const past = Date.parse(time) <= Date.now(), picked = proposalSlot === time;
            return <label key={time} className={`flex min-h-12 items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${picked ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'} ${past ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
              <input type="radio" className="sr-only" name={`tour-proposal-${tour.id}`} value={time} checked={picked} onChange={() => setProposalSlot(time)} disabled={past} />
              <span aria-hidden="true" className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${picked ? 'border-primary' : 'border-muted-foreground/40'}`}>{picked && <span className="size-2 rounded-full bg-primary" />}</span>
              <span className="font-medium">{chefTourWhen(time, tour.durationMinutes, locale)}</span>
            </label>;
          })}</fieldset>
          <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={rescheduling} onClick={() => onReviewProposal(tour, 'decline')}>{pendingRequest ? t('tourKeepOriginalRequest', 'Keep original request') : t('tourKeepOriginalTime', 'Keep original time')}</Button><Button className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={rescheduling || !proposalSlot || !tour.rescheduleProposedSlots.includes(proposalSlot) || Date.parse(proposalSlot) <= Date.now()} onClick={() => onReviewProposal(tour, 'accept', proposalSlot)}>{rescheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pendingRequest ? t('tourAcceptAndConfirm', 'Accept and confirm tour') : t('tourAcceptNewTime', 'Accept new time')}</Button></div>
        </section>}
        {canRequestChange && !tour.requestedRescheduleAt && (
          <section className="space-y-5">
            <p className="mt-2 text-sm text-muted-foreground">{pendingRequest ? t('tourEditRequestHelp', 'Choose a different available date and time. Your request will remain pending until it is confirmed.') : t('tourRescheduleDeadline', 'Request a change before the start of your tour day. Your current time stays confirmed until the kitchen accepts.')}</p>
            {(calendarError || slotsError) && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{(calendarError || slotsError)?.message}</p><Button variant="outline" size="sm" disabled={rescheduling} onClick={() => { void queryClient.invalidateQueries({ queryKey: [`/api/viewings/calendar-availability/${tour.targetedKitchenId}`, tour.id] }); void queryClient.invalidateQueries({ queryKey: ['/api/viewings/available-slots', tour.id] }); }}>{t('tourTryAgain', 'Try again')}</Button></div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1"><label className="mb-1 block text-xs font-medium" htmlFor={`tour-date-${tour.id}`}>{t("tourNewDate", "New date")}</label><DateField id={`tour-date-${tour.id}`} value={date} onChange={(value) => { setDate(value); setSlot(""); }} placeholder={t("tourChooseDate", "Choose a date")} disabled={rescheduling || loadingCalendar || !!calendarError || !calendarAvailability} disabledDate={(day) => !tourAvailableDate(day, calendarAvailability)} /></div>
              <div className="space-y-1"><label className="mb-1 block text-xs font-medium" htmlFor={`tour-time-${tour.id}`}>{t("tourAvailableTime", "Available time")}</label><Select value={slot} onValueChange={setSlot} disabled={rescheduling || !date || loadingSlots || !!slotsError || slots.length === 0}><SelectTrigger id={`tour-time-${tour.id}`}><SelectValue placeholder={loadingSlots ? t("tourLoadingTimes", "Loading…") : t("tourChooseTime", "Choose a time")} /></SelectTrigger><SelectContent>{slots.map((item) => <SelectItem key={item.scheduledAt} value={item.scheduledAt}>{chefTourTimes(item.scheduledAt, tour.durationMinutes ?? 30, locale)}</SelectItem>)}</SelectContent></Select></div>

            </div>
            {date && !loadingSlots && !slotsError && slots.length === 0 && <p role="status" className="mt-2 text-sm text-muted-foreground">{t('tourNoAvailableTimes', 'No available times on this date. Choose another date.')}</p>}
            <div className="grid gap-2 border-t pt-4 sm:grid-cols-2"><Button variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={rescheduling} onClick={onClose}>{t("cancel", "Cancel")}</Button>          <Button className="h-auto min-h-11 w-full whitespace-normal py-2" disabled={!slot || rescheduling || loadingSlots || !!slotsError || !!calendarError || !slots.some(item => item.scheduledAt === slot)} onClick={() => onReschedule(tour, slot)}>{rescheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pendingRequest ? t('tourSaveRequest', 'Save request') : t("tourRequestNewTime", "Reschedule tour")}</Button></div>
          </section>
        )}
        {!canRequestChange && !(hasProposal && canReviewProposal) && <div className="space-y-4"><p role="status" className="text-sm text-muted-foreground">{t('tourActionNoLongerAvailable', 'This action is no longer available. Your tour details have been refreshed.')}</p><Button variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2" onClick={onClose} disabled={rescheduling}>{t('close', 'Close')}</Button></div>}
      </div>
    </DialogContent>
  </Dialog>;
}

export default function ChefViewingsList({ onExploreKitchens }: { onExploreKitchens?: () => void }) {
  useTourClock();
  const { user } = useFirebaseAuth();
  const { t, i18n } = useTranslation("chef");
  const locale = i18n?.language || "en-CA";
  const [actionClock, setActionClock] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setActionClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [group, setGroup] = useState<"upcoming" | "past" | null>(null);
  const search = useSearch();
  const [location, navigate] = useLocation();
  const linkParams = new URLSearchParams(search);
  const linkedTourId = Number(linkParams.get('viewing'));
  const linkedAction = linkParams.get('action');
  // Sent here from a new tour request at a kitchen with a tour already (RequestTourPage): say why.
  const alreadyNotice = linkParams.get('notice') === 'already';
  const handledActionLink = useRef<string | null>(null);
  const openTour = (id: number) => navigate(`/dashboard?view=viewings&viewing=${id}`);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const listContainer = useRef<HTMLDivElement | null>(null);
  const [rescheduleTargetId, setRescheduleTargetId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ChefTourRow | null>(null);
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);
  const [rescheduleError, setRescheduleError] = useState<{ id: number; message: string } | null>(null);
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyError, setReplyError] = useState<{ id: number; message: string } | null>(null);
  const [attendanceChangeId, setAttendanceChangeId] = useState<number | null>(null);
  const [feedbackTargetId, setFeedbackTargetId] = useState<number | null>(null);
  const feedbackTrigger = useRef<HTMLButtonElement>(null);
  const replyToTour = async (tour: ChefTourRow, reply: 'still_coming') => {
    if (!tour.reconfirmation?.canReply) return;
    setReplyingId(tour.id); setReplyError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/chef/${tour.id}/reconfirmation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reply, appointmentRevision: tour.reconfirmation.revision, expectedUpdatedAt: tour.updatedAt })
      });
      const body = await response.json().catch(() => ({}));
      await queryClient.invalidateQueries({ queryKey: ['/api/viewings', 'chef'] });
      if (!response.ok) throw new Error(body.error || t('tourReplyFailed', 'Could not save your reply. Review the current tour and retry.'));
      setAttendanceChangeId(null);
    } catch (error) { setReplyError({ id: tour.id, message: error instanceof Error ? error.message : 'Could not save reply' }); }
    finally { setReplyingId(null); }
  };
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
  // A chef who applied here since the tour gets no "Request another time" (owner: no tours once applied).
  const linkedKitchenId = data.find(tour => tour.id === linkedTourId)?.targetedKitchenId ?? undefined;
  const appliedAtLinked = useTourRequestAccess(linkedKitchenId, user?.uid).data?.reason === 'application';

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
    } else if (linkedAction === 'cancel' && ['pending_local_cooks', 'pending', 'confirmed'].includes(tour.status) && Date.parse(tour.scheduledAt) > Date.now() && !tour.checkedInAt) {
      actionTrigger.current = null;
      setCancelTarget(tour);
    }
  }, [user?.uid, isLoading, isFetching, error, location, search, linkedTourId, linkedAction, data]);

  const { data: kitchens } = useQuery<Array<{ id: number; imageUrl?: string | null; galleryImages?: string[] }>>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => { const response = await fetch("/api/public/kitchens"); if (!response.ok) throw new Error(tt("failedToFetchKitchens")); return response.json(); },
    staleTime: 60_000, retry: false, enabled: !linkedTourId,
  });
  const photo = (kitchenId: number | null) => { const kitchen = Array.isArray(kitchens) ? kitchens.find(item => item.id === kitchenId) : undefined; return kitchen?.imageUrl || kitchen?.galleryImages?.[0] || null; };
  const cards = data.map(tour => ({ tour, card: chefTourCard(tour, actionClock) }));
  const upcomingCards = cards.filter(item => !item.card.past).sort((a, b) => Date.parse(a.tour.scheduledAt) - Date.parse(b.tour.scheduledAt));
  const pastCards = cards.filter(item => item.card.past).sort((a, b) => Date.parse(b.tour.scheduledAt) - Date.parse(a.tour.scheduledAt));
  const shownGroup = group ?? (upcomingCards.length || !pastCards.length ? "upcoming" : "past");
  const query = searchQuery.trim().toLocaleLowerCase();
  const shownCards = (shownGroup === "upcoming" ? upcomingCards : pastCards).filter(({ tour, card }) => !query
    || `TOUR-${tour.id} ${tour.locationName} ${tour.kitchenName ?? ""} ${tour.locationAddress ?? ""} ${t(card.status[0], card.status[1])}`.toLocaleLowerCase().includes(query));

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
              {t("tourListExploreCta", "Find kitchens")}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div ref={listContainer} tabIndex={-1} className="min-w-0 space-y-4 outline-none [overflow-wrap:anywhere]" data-testid="chef-viewings-list">
      {!linkedTourId && <div className="space-y-5">
        {/* The page title and subline come from KitchenDiscovery's header (tourListTitle / tourListIntroBody). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label={t("tourListTitle", "Kitchen tours")} className="inline-flex rounded-lg bg-muted p-1">
            {(["upcoming", "past"] as const).map(key => <button key={key} type="button" role="tab" aria-selected={shownGroup === key} onClick={() => setGroup(key)}
              className={`min-h-9 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${shownGroup === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {key === "upcoming" ? t("tourTableUpcoming", "Upcoming") : t("tourTablePast", "Past")} <span className="ml-1 tabular-nums text-muted-foreground">{(key === "upcoming" ? upcomingCards : pastCards).length}</span>
            </button>)}
          </div>
          {data.length > 5 && <Input aria-label={t("tourTableSearch", "Search kitchen tours")} placeholder={t("tourTableSearch", "Search kitchen tours")} value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="sm:max-w-xs" />}
        </div>
        {shownCards.length === 0 ? <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{shownGroup === "upcoming" ? t("tourListNoUpcoming", "No upcoming tours.") : t("tourListNoPast", "No past tours yet.")}</p>
          : <ul className="space-y-3">{shownCards.map(({ tour, card }) => {
            const image = photo(tour.targetedKitchenId);
            const href = `/dashboard?view=viewings&viewing=${tour.id}${card.action === "review" && tour.rescheduleProposedSlots.length ? "&action=review-times" : ""}`;
            const place = [tour.kitchenName || tour.locationName, tour.kitchenName && tour.kitchenName !== tour.locationName ? tour.locationName : null].filter(Boolean).join(" · ");
            return <li key={tour.id}>
              <article data-testid={`chef-tour-card-${tour.id}`} onClick={() => navigate(href)} className="flex cursor-pointer flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40 sm:flex-nowrap sm:items-center sm:p-4">
                {image ? <img src={image} alt="" loading="lazy" className="h-14 w-16 shrink-0 rounded-md object-cover sm:h-[72px] sm:w-24" />
                  : <div aria-hidden="true" className="flex h-14 w-16 shrink-0 items-center justify-center rounded-md bg-muted sm:h-[72px] sm:w-24"><KitchenTour className="h-5 w-5 text-muted-foreground/60" /></div>}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-semibold text-foreground">{chefTourWhen(tour.scheduledAt, tour.durationMinutes ?? 30, locale)}</p>
                  <p className="text-sm text-muted-foreground">{place}</p>
                  <p className="pt-1 text-sm text-muted-foreground">{t(card.line[0], card.line[1])}</p>
                </div>
                <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:shrink-0 sm:flex-col sm:items-end" onClick={event => event.stopPropagation()}>
                  <span className="inline-flex items-center gap-1.5 text-sm"><span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[card.tone]}`} />{t(card.status[0], card.status[1])}</span>
                  {card.action === "apply" ? <TourApplicationButton id={tour.id} version={tour.updatedAt} primary className="min-h-9 rounded-full px-4" />
                    : <Button size="sm" variant={card.action === "review" ? "default" : "outline"} className="rounded-full px-4" onClick={() => navigate(href)}>
                      {card.action === "review" ? t("tourCardReview", "Review") : t("tourCardOpen", "Open")}</Button>}
                </div>
              </article>
            </li>;
          })}</ul>}
      </div>}
      <div className="space-y-3">
        {data.filter(tour => tour.id === linkedTourId).map((tour) => {

          const pastEnd = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000 <= Date.now();
          const expired = !!tour.requestExpiredAt || ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() <= Date.now();
          const card = chefTourCard(tour, actionClock);
          const declined = tour.status === "cancelled" && (tour.cancelledBy === "manager_declined" || tour.adminReviewDecision === "denied");
          const kitchenCancelled = tour.status === "cancelled" && tour.cancelledBy === "manager";
          const unverified = tour.disruptionReason === "outcome_unknown";
          // After a decline, kitchen cancellation or expiry, the next step is another time at the same kitchen. A tour that simply ended (no result) just moves on to applying (owner: tours stay one-time and simple).
          const offerRetry = !!tour.locationId && !!tour.targetedKitchenId && !appliedAtLinked && (expired || declined || kitchenCancelled);
          const otherOpenTour = offerRetry ? data.find(other => other.id !== tour.id && other.targetedKitchenId === tour.targetedKitchenId && !chefTourCard(other, actionClock).past) : undefined;

          const hasProposal = tour.rescheduleProposedSlots.length > 0 && ["pending", "confirmed"].includes(tour.status) && !tour.checkedInAt && !tour.disruptionReason && Date.parse(tour.scheduledAt) > Date.now();
          const canEdit = canChefRequestReschedule(tour) && !tour.disruptionReason;
          const waitingForChange = tour.status === "confirmed" && !pastEnd && !!tour.requestedRescheduleAt && !tour.checkedInAt;
          const showAttendanceReply = !!tour.reconfirmation?.canReply && !waitingForChange && !hasProposal;
          const canCancel = ["pending_local_cooks", "pending", "confirmed"].includes(tour.status) && Date.parse(tour.scheduledAt) > Date.now() && !tour.checkedInAt;
          const hasApplicationNextStep = !!tour.locationId && (tour.status === 'completed' || tour.status === 'confirmed' && pastEnd);
          const canShareFeedback = tourFeedbackOpen({ ...tour, durationMinutes: tour.durationMinutes ?? 30 }) && !tour.chefFeedbackSubmitted;
          const showFeedbackAction = canShareFeedback || hasTourConfirmation(tour) && pastEnd && !!tour.chefFeedbackSubmitted;
          const showOtherActions = offerRetry || hasProposal || !showAttendanceReply && (canEdit || canCancel) || expired || ["cancelled", "no_show"].includes(tour.status) || !!tour.disruptionReason || hasApplicationNextStep || showFeedbackAction;
          return (
            <section key={tour.id} aria-label={t("tourPageDetails", "Tour details")} className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">{tour.kitchenName || tour.locationName}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">{[tour.kitchenName && tour.kitchenName !== tour.locationName ? tour.locationName : null, chefTourWhen(tour.scheduledAt, tour.durationMinutes, locale), `TOUR-${tour.id}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 pt-1 text-sm"><span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[card.tone]}`} />{t(card.status[0], card.status[1])}</span>
                </div>
                {alreadyNotice && <div role="status" className="flex items-start justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-sm" data-testid="tour-already-notice">
                  <p className="min-w-0 pt-0.5">{hasApplicationNextStep
                    ? t("tourNoticeToured", { defaultValue: "You already toured {kitchen}. Request to apply when you’re ready.", kitchen: tour.kitchenName || tour.locationName })
                    : t("tourNoticeAlready", { defaultValue: "You already have a tour here on {when}.", when: chefTourWhen(tour.scheduledAt, tour.durationMinutes, locale) })}</p>
                  <button type="button" aria-label={t("tourNoticeDismiss", "Dismiss")} onClick={() => navigate(`/dashboard?view=viewings&viewing=${tour.id}`, { replace: true })}
                    className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden="true" /></button>
                </div>}
              </div>
              <section aria-label={t("tourNextStep", "What to do next")} className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-5">
                <h2 className={showAttendanceReply ? 'flex items-center gap-2 text-base font-semibold' : 'text-sm font-semibold'}>{showAttendanceReply ? <><CalendarCheck className="h-5 w-5 shrink-0" aria-hidden="true" />{tour.reconfirmation?.reply === 'still_coming' ? t('tourAttendanceConfirmed', 'Thanks for confirming') : t('tourReconfirmTitle', 'Are you still coming to your tour?')}</> : t("tourNextStep", "What to do next")}</h2>
                {!showAttendanceReply && <p className="text-sm">{unverified ? t("tourNextUnverified", "Your tour has ended. Request to apply when you’re ready to cook here.")
                  : declined ? t("tourNextDeclined", "The kitchen declined this request. You can ask for another time or find other kitchens.")
                  : kitchenCancelled ? t("tourNextKitchenCancelled", "The kitchen cancelled this tour. You can ask for another time or find other kitchens.")
                  : tour.status === "cancelled" && !expired ? tour.cancelledBy === "chef" ? t("tourNextYouCancelled", "You cancelled this tour.") : t("tourNextLcClosed", "Local Cooks closed this tour. Contact Support if something looks wrong.")
                  : tour.disruptionReason ? t("tourNextClosed", "Review the tour outcome and shared notes. Contact Support if something is incorrect, or discover kitchens to request another tour.")
                  : hasProposal ? t("tourNextInvitation", "Review the offered times and choose whether to accept the invitation or keep your original time.")
                    : waitingForChange ? t("tourNextChangePending", "You asked for a new time. Your current time stays confirmed until the kitchen answers.")
                      : expired ? t("tourExpiredHelpKitchen", "The time passed before the kitchen confirmed. You can ask for another time.")
                        : ["pending_local_cooks", "pending"].includes(tour.status) ? t("tourListPending", "Your tour request is pending. We’ll notify you when it’s confirmed or declined.")
                          : tour.status === "completed" ? t("tourNextCompleted", "Your tour is complete. Review the shared notes and your application next step.")
                            : tour.status === "confirmed" && !pastEnd ? t("tourListConfirmedNext", "Tour confirmed. Arrive on time and bring questions about equipment, storage, and access.")
                              : tour.status === "confirmed" ? tour.chefFeedbackSubmitted ? t('common:tourFeedbackSubmitted', 'Thank you for sharing your feedback.') : t("tourAwaitingVisitResultHelp", "How did your kitchen tour go? Share your feedback about the visit.")
                                : t("tourNextClosed", "Review the tour outcome and shared notes. Contact Support if something is incorrect, or discover kitchens to request another tour.")}</p>}
                {!expired && ['pending_local_cooks', 'pending'].includes(tour.status) && <p className="text-xs text-muted-foreground">{t('tourPendingResponseExpectation', 'We aim to respond within 24 hours. Your tour is not confirmed until you receive confirmation; a request expires when its requested start time passes.')}</p>}
                {showAttendanceReply && <div className="space-y-4">
                  <p className="text-sm font-medium">{chefTourWhen(tour.scheduledAt, tour.durationMinutes, locale)}</p>
                  {tour.reconfirmation?.reply !== 'still_coming' && <p className="text-sm leading-relaxed text-muted-foreground">{t('tourReconfirmHelp', 'Please confirm below so the kitchen knows to expect you. If you can’t come, choose “Change my plans” to see your options.')}</p>}
                  <div role="status" aria-live="polite" aria-atomic="true" className={tour.reconfirmation?.reply === 'still_coming' ? undefined : 'sr-only'}>
                    {tour.reconfirmation?.reply === 'still_coming' ? <p className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-medium"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />{t('tourStillComingSaved', 'You confirmed that you’re still coming.')}</p> : replyingId === tour.id && <p className="sr-only">{t('tourReplySaving', 'Saving your reply…')}</p>}
                  </div>
                  <div className="grid gap-3 sm:flex sm:flex-wrap [&>button]:h-auto [&>button]:min-h-12 [&>button]:whitespace-normal [&>button]:rounded-full [&>button]:px-5 [&>button]:py-3">
                    {tour.reconfirmation?.reply !== 'still_coming' && <Button className="bg-foreground text-background shadow-none hover:bg-foreground/90 hover:text-background hover:shadow-none disabled:hover:bg-foreground" disabled={replyingId !== null} aria-busy={replyingId === tour.id} onClick={() => void replyToTour(tour, 'still_coming')}>{replyingId === tour.id ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t('tourReplySaving', 'Saving your reply…')}</> : <><Check className="h-4 w-4" aria-hidden="true" />{t('tourStillComing', 'Yes, I’m still coming')}</>}</Button>}
                    <Button variant="outline" disabled={replyingId !== null} aria-haspopup="dialog" onClick={event => { actionTrigger.current = event.currentTarget; setAttendanceChangeId(tour.id); }}>{t('tourCantMakeIt', 'Change my plans')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                  <Dialog open={attendanceChangeId === tour.id} onOpenChange={open => { if (!open && replyingId === null) setAttendanceChangeId(null); }}>
                    <AppDialogContent showCloseButton className="gap-0 overflow-hidden p-0 sm:max-w-md sm:p-0" aria-busy={replyingId !== null}
                      onCloseAutoFocus={event => { event.preventDefault(); if (rescheduleTargetId === null && !cancelTarget) actionTrigger.current?.focus(); }}
                      onEscapeKeyDown={event => { if (replyingId !== null) event.preventDefault(); }}
                      onPointerDownOutside={event => { if (replyingId !== null) event.preventDefault(); }}>
                      <AppDialogHeader className="pr-14 sm:pr-14" title={t('tourAttendanceChangeTitle', 'Change your plans')} description={t('tourCantMakeItOptionsHelp', 'Choose whether to reschedule your tour or cancel it. Your current time stays confirmed until you complete the change.')} />
                      <AppDialogBody className="space-y-3">
                        <div className="grid gap-3">
                          <Button variant="outline" className="h-auto min-h-11 whitespace-normal rounded-xl py-3" disabled={replyingId !== null || !canEdit} onClick={() => { setAttendanceChangeId(null); setRescheduleError(null); setRescheduleTargetId(tour.id); }}>{t('tourReplyReschedule', 'Reschedule')}</Button>
                          <Button variant="outline" className="h-auto min-h-11 whitespace-normal rounded-xl py-3 text-destructive hover:text-destructive" disabled={replyingId !== null || !canCancel} onClick={() => { setAttendanceChangeId(null); setCancelTarget(tour); }}>{t('tourCancel', 'Cancel tour')}</Button>
                        </div>
                        {!canEdit && <p className="text-xs text-muted-foreground">{t('tourRescheduleUnavailable', 'You can change the time until the start of your tour day. After that, message the kitchen.')}</p>}
                        {replyError?.id === tour.id && <p role="alert" className="text-xs text-destructive">{replyError.message}</p>}
                      </AppDialogBody>
                    </AppDialogContent>
                  </Dialog>
                  {replyError?.id === tour.id && attendanceChangeId !== tour.id && <p role="alert" className="text-sm text-destructive">{replyError.message}</p>}
                </div>}
                {waitingForChange && <p className="text-sm">{t("tourChangeRequested", "Reschedule requested for")} {chefTourWhen(tour.requestedRescheduleAt!, tour.durationMinutes, locale)}</p>}
                {showOtherActions && <div className="mt-4 grid gap-2 border-t pt-4 sm:flex sm:flex-wrap sm:items-center [&>div]:min-w-0 [&>div>button]:h-auto [&>div>button]:min-h-11 [&>div>button]:w-full [&>div>button]:whitespace-normal [&>div>button]:py-2 sm:[&>div>button]:min-h-9 sm:[&>div>button]:w-auto [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:py-2 [&>a]:min-h-11 [&>a]:whitespace-normal sm:[&>button]:min-h-9">
                  {offerRetry && (otherOpenTour
                    ? <Button size="sm" onClick={() => openTour(otherOpenTour.id)}>{t("tourOpenYourTour", "Open your tour")}</Button>
                    : <Button asChild size="sm"><Link href={`/request-tour/${tour.locationId}?kitchenId=${tour.targetedKitchenId}`}>{t("tourRequestAnotherTime", "Request another time")}</Link></Button>)}
                  {unverified && tour.locationId && <Button asChild variant="outline" size="sm"><Link href={`/apply-kitchen/${tour.locationId}?tourId=${tour.id}`}>{t("tourRequestToApply", "Request to apply")}</Link></Button>}
                  {showFeedbackAction && <Button ref={feedbackTrigger} size="sm" variant={canShareFeedback && tour.status !== 'completed' ? 'default' : 'outline'} aria-haspopup="dialog" onClick={() => setFeedbackTargetId(tour.id)}>{t(canShareFeedback ? 'common:tourFeedbackOpen' : 'common:tourFeedbackView', canShareFeedback ? 'Share feedback' : 'View your feedback')}</Button>}
                  {(hasProposal || canEdit && !showAttendanceReply) && <Button variant="outline" size="sm" className="h-9" disabled={reschedulingId !== null || cancellingId !== null} onClick={event => { actionTrigger.current = event.currentTarget; setRescheduleError(null); setRescheduleTargetId(tour.id); }}>{hasProposal ? t('tourReviewInvitation', 'Review invitation') : ['pending_local_cooks', 'pending'].includes(tour.status) ? t('tourEditRequest', 'Edit tour request') : t('tourRequestNewTime', 'Reschedule tour')}</Button>}
                  {canCancel && !showAttendanceReply && <Button variant="outline" size="sm" className="h-9 text-destructive hover:text-destructive" disabled={cancellingId !== null || reschedulingId !== null} onClick={event => { actionTrigger.current = event.currentTarget; setCancelTarget(tour); }}>{t("tourCancel", "Cancel tour")}</Button>}
                  {(expired || ["cancelled", "no_show"].includes(tour.status) || !!tour.disruptionReason) && <Button asChild variant={offerRetry ? "ghost" : "outline"} size="sm"><Link href="/dashboard?view=discover-kitchens">{t("tourFindOtherKitchens", "Find other kitchens")}</Link></Button>}
                  {hasApplicationNextStep &&
                    <TourApplicationButton id={tour.id} version={tour.updatedAt} primary={tour.status === 'completed' || !canShareFeedback} />}

                </div>}
              </section>
              <div id={`tour-details-${tour.id}`} className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0 space-y-4">
                  {tour.status === 'confirmed' && !pastEnd && <section aria-label={t('tourConfirmationTitle', 'Kitchen tour confirmation')} className="grid grid-cols-1 items-center gap-3 rounded-xl border bg-card p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4 sm:gap-y-2 sm:p-6">
                    <h2 className="min-w-0 text-sm font-semibold">{t('tourConfirmationTitle', 'Kitchen tour confirmation')}</h2>
                    <p className="row-start-2 min-w-0 text-sm text-muted-foreground">{t('tourConfirmationHelp', 'Your kitchen tour is confirmed. Download your confirmation with the address, time and visit details.')}</p>
                    <div className="row-start-3 min-w-0 sm:col-start-2 sm:row-start-1 sm:row-span-2">
                      <TourDownloadButton tour={tour} t={t as any} />
                    </div>
                  </section>}
                  <TourDetailPanel tour={tour} t={t as any} />{hasTourConfirmation(tour) && pastEnd && <TourFeedbackPanel key={tour.id} id={tour.id} role="chef" version={tour.updatedAt} open={feedbackTargetId === tour.id} onOpenChange={open => setFeedbackTargetId(open ? tour.id : null)} triggerRef={feedbackTrigger} />}
                  {tour.targetedKitchenId && tour.locationId && !offerRetry && (expired || ['completed', 'cancelled', 'no_show'].includes(tour.status)) && <ChefTourRepeatPermissionPanel kitchenId={tour.targetedKitchenId} locationId={tour.locationId} />}
                </div>
                <aside className="min-w-0 space-y-4">
                  <section aria-label={t('tourKitchenContactTitle', 'Coordinate with the kitchen')} className="space-y-4 rounded-xl border bg-card p-5 text-sm sm:p-6">
                    <h2 className="text-sm font-semibold leading-5">{t('tourKitchenContactTitle', 'Coordinate with the kitchen')}</h2>
                    <p className="font-medium">{tour.kitchenName || tour.locationName}</p>
                    {tour.status === 'confirmed' && tour.locationContactPhone && <dl><div><dt className="text-xs text-muted-foreground">{t('tourContactPhone', 'Phone')}</dt><dd className="mt-1"><a className="text-primary underline underline-offset-2" href={`tel:${tour.locationContactPhone}`}>{tour.locationContactPhone}</a></dd></div></dl>}
                    <p className="text-xs leading-relaxed text-muted-foreground">{t('tourKitchenCoordinationHelp', 'Message the kitchen about arrival or changes to your visit.')}</p>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2 [&>div]:min-w-0 [&_button]:h-auto [&_button]:min-h-11 [&_button]:w-full [&_button]:whitespace-normal [&_button]:px-2 [&_button]:py-2 [&_button]:text-xs">
                      <TourChatButton tour={tour} role="chef" openFromLink={location === '/dashboard' && linkParams.get('view') === 'viewings'} buttonLabel={t('tourMessageKitchen', 'Message the kitchen')} />
                      {tourCanReportLate(tour, actionClock) && <TourChatButton tour={tour} role="chef" buttonLabel={t('tourRunningLate', 'Running late?')} initialDraft={t('tourRunningLateDraft', 'I’m running late for my kitchen tour. My estimated arrival time is: ')} />}
                    </div>
                  </section>
                  <TourSummary tour={tour} t={t as any} /><TourHistoryPanel id={tour.id} version={tour.updatedAt || tour.scheduledAt} role="chef" kitchenName={tour.kitchenName || tour.locationName} />
                </aside>
              </div>
            </section>
          );
        })}
      </div>
      {rescheduleTargetId !== null && data.find(tour => tour.id === rescheduleTargetId) && <TourRescheduleDialog tour={data.find(tour => tour.id === rescheduleTargetId)!} t={t as any} onClose={() => setRescheduleTargetId(null)} onRestoreFocus={() => { if (actionTrigger.current?.isConnected) actionTrigger.current.focus(); else listContainer.current?.focus(); }} onReschedule={(item, time) => void requestReschedule(item, time)} onReviewProposal={(item, decision, time) => void reviewProposal(item, decision, time)} rescheduling={reschedulingId !== null} rescheduleError={rescheduleError?.id === rescheduleTargetId ? rescheduleError.message : undefined} />}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open && cancellingId === null) setCancelTarget(null); }}>
        <AlertDialogContent className="[overflow-wrap:anywhere]" onCloseAutoFocus={event => { event.preventDefault(); if (actionTrigger.current?.isConnected) actionTrigger.current.focus(); else listContainer.current?.focus(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tourCancelConfirmTitle", "Cancel this tour?")}</AlertDialogTitle>
            <AlertDialogDescription>{cancelTarget?.locationName} · {cancelTarget && chefTourWhen(cancelTarget.scheduledAt, null, locale)}. {t("tourCancelConfirmBody", "The kitchen will be notified, and you can request another available time.")}</AlertDialogDescription>
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
