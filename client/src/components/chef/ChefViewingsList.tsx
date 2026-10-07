import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { TourIntakeDetails } from "@/components/tour/TourIntakeDetails";
import { KitchenTour } from "@/components/ui/manager-icons";
import { TourChatButton } from '@/components/chat/TourChatButton';
import { TourHistoryPanel } from '@/components/tour/TourHistoryPanel';
import { tourCanReportLate } from '@shared/tour-late';
import { hasTourConfirmation } from '@shared/tour-outcome';
import { TourFeedbackPanel } from '@/components/tour/TourFeedbackPanel';
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoChip } from "@/components/chef/info-chip";
import { Loader2, ArrowUpDown, Download, X } from "lucide-react";
import { Icon } from "@iconify/react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tt } from "@/i18n/common-ns";
import { mt } from "@/i18n/manager";
import { ChefTourRow, isPendingOrUpcomingTour, formatTourWhen, normalizeChefTourRow, viewingStatusBadge } from "@/lib/chef-viewing-display";
import { tourAvailableDate } from "@/lib/tour-available-date";
import { Link, useLocation, useSearch } from "wouter";
import { useTourClock } from "@/hooks/use-tour-clock";
import { formatTourSlotRange } from '@shared/tour-time';
import { TourSupportCard } from '@/components/tour/TourSupportCard';
import { canChefRequestReschedule } from '@shared/tour-reschedule';
import { TourApplicationButton } from '@/components/tour/TourApplicationButton';
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
  const disruptionLabel = (reason: string) => mt(`tourDisruption_${['manager_absent', 'access_unavailable', 'weather', 'other'].includes(reason) ? reason : 'other'}`);
  const expired = !!tour.requestExpiredAt || ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() <= Date.now();
  const awaitingConfirmation = ["pending_local_cooks", "pending"].includes(tour.status);
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
        storage: (storage || []).map((item: StorageListing) => ({ ...item, basePrice: item.basePrice ? item.basePrice / 100 : undefined })),
      };
      return { equipment: [...inventory.equipment.included, ...inventory.equipment.rental].map(item => ({ name: (item.equipmentType || '').replace(/[_-]/g, ' ') })).filter(item => item.name), storage: inventory.storage, inventory };
    },
  });
  const intendedUse = tour.intakeEntries.find(([key]) => key === 'intendedUse')?.[1];
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [showStorageModal, setShowStorageModal] = useState(false);
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-2">
      <section aria-label={t("tourArrivalNotes", "Arrival notes")} className="space-y-3 rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">{t("tourArrivalNotes", "Arrival notes")}</h2>
        <p className="whitespace-pre-wrap text-muted-foreground">{tour.arrivalNotes?.trim() || (awaitingConfirmation ? t("tourArrivalNotesAfterConfirmation", "Arrival instructions are available after your tour is confirmed.") : tour.status !== "confirmed" ? t("tourClosedInstructions", "Instructions are unavailable for this tour. Review the shared notes or contact Support if you need help.") : t("tourArrivalNotesEmpty", "The kitchen manager hasn’t shared arrival instructions yet. Message the manager if you need help finding the entrance or meeting point."))}</p>
      </section>
      <section aria-label={t("tourDepartureNotes", "Departure notes")} className="space-y-3 rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">{t("tourDepartureNotes", "Departure notes")}</h2>
        <p className="whitespace-pre-wrap text-muted-foreground">{tour.departureNotes?.trim() || (awaitingConfirmation ? t("tourDepartureNotesAfterConfirmation", "Departure instructions are available after your tour is confirmed.") : tour.status !== "confirmed" ? t("tourClosedInstructions", "Instructions are unavailable for this tour. Review the shared notes or contact Support if you need help.") : t("tourDepartureNotesEmpty", "The kitchen manager hasn’t shared departure instructions yet. Message the manager if you need help with leaving the kitchen."))}</p>
      </section>
      {(tour.status === 'confirmed' && Date.parse(tour.scheduledAt) > Date.now() || tour.chefNotes?.trim() || tour.intakeEntries.length > 0 || tour.sharedManagerNotes || tour.cancellationReason || tour.noShowReason || tour.disruptionReason) && <section className="rounded-xl border bg-card p-5 sm:col-span-2 sm:p-6"><h2 className="text-sm font-semibold text-foreground">{t("tourMoreRequestInfo", "Notes and updates")}</h2><div className="mt-4 space-y-4 divide-y [&>div:not(:first-child)]:pt-4">
      {tour.status === 'confirmed' && Date.parse(tour.scheduledAt) > Date.now() && <div aria-label={t('tourPrepareTitle', 'Prepare for your kitchen tour')} className="space-y-3">
        <h3 className="text-sm font-semibold">{t('tourPrepareTitle', 'Prepare for your kitchen tour')}</h3>
        <ul className="list-disc space-y-2 pl-4 text-muted-foreground">
          <li>{intendedUse ? t('tourInspectForUse', 'Walk through the space with your intended use in mind: can your preparation, cooking, packing, and cleanup fit?') : t('tourInspectSpace', 'Walk through the preparation, cooking, packing, and cleanup areas. Ask whether the space fits your work.')}</li>
          <li>{t('tourInspectEquipment', 'Ask which listed equipment is available to you, how it operates, and whether rental charges or training apply.')}{preparation.data?.equipment.length ? <span className="mt-1 block text-foreground">{t('tourListedEquipment', 'Listed equipment')}: {preparation.data.equipment.map(e => e.name).slice(0, 4).join(', ')}{preparation.data.equipment.length > 4 ? ', …' : ''} {(preparation.data.equipment.length > 4 || preparation.data.inventory.equipment.rental.length > 0) && <button type="button" onClick={() => setShowEquipmentModal(true)} className="inline-flex min-h-6 items-center gap-1 text-sm font-semibold text-[#F51042] hover:text-[#d10e39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] ml-1">{t('showAllDescription', 'Show all')} <Icon icon="mdi:chevron-right" width={16} height={16} className="ml-0.5" /></button>}</span> : null}</li>
          <li>{t('tourInspectStorage', 'Ask about dry, refrigerated, and freezer storage, available capacity, access, and any separate charges.')}{preparation.data?.storage.length ? <span className="mt-1 block text-foreground">{t('tourListedStorage', 'Listed storage')}: {preparation.data.storage.map(s => s.name).slice(0, 4).join(', ')}{preparation.data.storage.length > 4 ? ', …' : ''} {preparation.data.storage.length > 4 && <button type="button" onClick={() => setShowStorageModal(true)} className="inline-flex min-h-6 items-center gap-1 text-sm font-semibold text-[#F51042] hover:text-[#d10e39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] ml-1">{t('showAllDescription', 'Show all')} <Icon icon="mdi:chevron-right" width={16} height={16} className="ml-0.5" /></button>}</span> : null}</li>
          <li>{t('tourBringQuestions', 'Bring your menu or workflow, expected hours, storage needs, and questions. Ask the manager before bringing ingredients or equipment; this kitchen tour does not authorize food production.')}</li>
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
          <div><dt className="text-xs text-muted-foreground">{t("tourDetailSubmitted", "Request submitted")}</dt><dd>{tour.submittedAt ? formatTourWhen(tour.submittedAt, null, tour.timezone) : t("tourDetailDateUnavailable", "Date unavailable")}</dd></div>
          {tour.chefName && <div><dt className="text-xs text-muted-foreground">{t("tourDetailChef", "Chef")}</dt><dd>{tour.chefName}</dd></div>}
          {tour.chefEmail && <div><dt className="text-xs text-muted-foreground">{t("tourDetailEmail", "Account email")}</dt><dd className="break-all">{tour.chefEmail}</dd></div>}
          {tour.cancelledAt && <div><dt className="text-xs text-muted-foreground">{t("tourDetailCancelled", "Cancelled")}</dt><dd>{formatTourWhen(tour.cancelledAt, null, tour.timezone)}</dd></div>}
          {tour.completedAt && <div><dt className="text-xs text-muted-foreground">{t("tourDetailCompleted", "Completed")}</dt><dd>{formatTourWhen(tour.completedAt, null, tour.timezone)}</dd></div>}
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
      {tour.disruptionReason && <p>{tour.disruptionReason === 'outcome_unknown' ? t('tourStatusUnverified', 'Tour closed — outcome not verified') : <>{t("tourDisruptionReason", "Reason the tour couldn’t take place")}: {disruptionLabel(tour.disruptionReason)}</>}</p>}
      {tour.noShowReason && <div><p className="font-medium text-xs">{t("tourDetailNoShowReason", "No-show reason")}</p><p className="text-muted-foreground">{tour.noShowReason === 'visitor_absent' ? mt('tourVisitorAbsent') : disruptionLabel(tour.noShowReason)}</p></div>}
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
  return <aside aria-label={t("tourSummary", "Tour summary")} className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
    <section className="space-y-3"><h2 className="text-sm font-semibold">{t("tourVisitDetails", "Kitchen tour details")}</h2>
      <p className="font-medium">{tour.locationName}</p>{tour.kitchenName && <p className="text-sm text-muted-foreground">{tour.kitchenName}</p>}
      <p className="text-sm">{formatTourWhen(tour.scheduledAt, tour.durationMinutes, tour.timezone)}</p>
      <p className="text-sm text-muted-foreground">{t("tourListDurationMins", { count: tour.durationMinutes ?? 30, defaultValue: `${tour.durationMinutes ?? 30} min` })}</p>
      {tour.locationAddress && <a className="block text-sm underline underline-offset-2" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tour.locationAddress)}`} target="_blank" rel="noopener noreferrer">{tour.locationAddress}</a>}
      {tour.managerName && <p className="text-sm">{t("tourDetailManager", "Kitchen manager")}: {tour.managerName}</p>}
      {tour.status === "confirmed" && <div className="space-y-2 text-sm">{tour.locationContactPhone && <a className="block underline" href={`tel:${tour.locationContactPhone}`}>{tour.locationContactPhone}</a>}{tour.locationContactEmail && <a className="block break-all underline" href={`mailto:${tour.locationContactEmail}`}>{tour.locationContactEmail}</a>}</div>}
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
        <DialogTitle>{hasProposal ? pendingRequest ? t('tourInvitation', 'Tour invitation') : t('tourRescheduleInvitation', 'Reschedule invitation') : pendingRequest ? t('tourEditRequest', 'Edit tour request') : t('tourRequestNewTime', 'Reschedule tour')}</DialogTitle>
        <DialogDescription>{tour.locationName} · TOUR-{tour.id}</DialogDescription>
        <Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label={t('close', 'Close')} disabled={rescheduling} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
      </DialogHeader>
      <div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="rounded-xl border bg-muted/20 p-4"><p className="mb-1 text-xs font-medium text-muted-foreground">{pendingRequest ? t('tourRequestedTime', 'Requested time') : t('tourDetailTime', 'Tour time')}</p><p className="text-sm font-medium">{formatTourWhen(tour.scheduledAt, tour.durationMinutes, tour.timezone)}</p></div>
        {rescheduleError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{rescheduleError}</p>}
      {hasProposal && canReviewProposal && <section className="space-y-4" aria-label={t('tourProposedTimes', 'Choose a new tour time')}>
        <div className="space-y-1"><h2 className="text-sm font-semibold">{t('tourProposedTimes', 'Choose a new tour time')}</h2><p className="text-sm text-muted-foreground">{pendingRequest ? t('tourPendingProposalHelp', 'Your manager offered these available times. Choose one to confirm your tour, or keep your original request pending. Respond before your original requested start time; the request expires then.') : t('tourProposalOriginalHeld', 'Your manager suggested these alternatives. Your original tour stays confirmed until you accept a new time.')}</p></div>
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
  const [actionClock, setActionClock] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setActionClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [group, setGroup] = useState("all");
  const search = useSearch();
  const [location, navigate] = useLocation();
  const linkParams = new URLSearchParams(search);
  const linkedTourId = Number(linkParams.get('viewing'));
  const linkedAction = linkParams.get('action');
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
  const replyToTour = async (tour: ChefTourRow, reply: 'still_coming' | 'reschedule' | 'cant_make_it') => {
    if (!tour.reconfirmation?.canReply) return;
    setReplyingId(tour.id); setReplyError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/chef/${tour.id}/reconfirmation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reply, appointmentRevision: tour.reconfirmation.revision, expectedUpdatedAt: tour.updatedAt }) });
      const body = await response.json().catch(() => ({}));
      await queryClient.invalidateQueries({ queryKey: ['/api/viewings', 'chef'] });
      if (!response.ok) throw new Error(body.error || t('tourReplyFailed', 'Could not save your reply. Review the current tour and retry.'));
      if (reply === 'reschedule') setRescheduleTargetId(tour.id);
      if (reply === 'cant_make_it') setCancelTarget({ ...tour, updatedAt: body.updatedAt || tour.updatedAt });
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

  const statusChip = (tour: ChefTourRow) => {
    const expired = !!tour.requestExpiredAt || ["pending_local_cooks", "pending"].includes(tour.status) && Date.parse(tour.scheduledAt) <= Date.now();
    const ended = Date.parse(tour.scheduledAt) + (tour.durationMinutes ?? 30) * 60_000 < Date.now();
    const badge = viewingStatusBadge(tour.status, tour.adminReviewDecision, tour.cancelledBy, tour.disruptionReason);
    return <InfoChip variant={expired ? "warning" : ended && tour.status === "confirmed" ? "info" : badge.variant}>{expired ? t("tourExpired", "Request expired") : ended && tour.status === "confirmed" ? t("tourAwaitingVisitResult", "Awaiting kitchen tour result") : t(badge.labelKey, badge.defaultLabel)}</InfoChip>;
  };
  const upcoming = isPendingOrUpcomingTour;
  const upcomingIds = data.filter(tour => upcoming(tour)).map(tour => tour.id).join(",");
  const filteredTours = useMemo(() => data.filter(tour => (group === "all" || (group === "upcoming" ? upcoming(tour) : !upcoming(tour))) && `TOUR-${tour.id} ${tour.locationName} ${tour.kitchenName ?? ""} ${tour.locationAddress ?? ""} ${t(viewingStatusBadge(tour.status).labelKey, viewingStatusBadge(tour.status).defaultLabel)}`.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase())), [data, group, searchQuery, t, upcomingIds]);
  const columns: ColumnDef<ChefTourRow>[] = [
    { accessorKey: "id", header: t("tourDetailReference", "Tour reference"), cell: ({ row }) => <Link className="font-medium hover:underline" href={`/dashboard?view=viewings&viewing=${row.original.id}`}>TOUR-{row.original.id}</Link> },
    { accessorKey: "locationName", header: t("tourTableKitchen", "Kitchen / location"), cell: ({ row }) => <div><p className="font-medium">{row.original.locationName}</p><p className="text-xs text-muted-foreground">{row.original.kitchenName}</p></div> },
    { accessorKey: "scheduledAt", header: ({ column }) => <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>{t("tourTableWhen", "Date and time")}<ArrowUpDown className="ml-2 size-4" /></Button>, cell: ({ row }) => <div className="whitespace-normal">{formatTourWhen(row.original.scheduledAt, row.original.durationMinutes, row.original.timezone)}</div> },
    { accessorKey: "status", header: t("tourTableStatus", "Status"), cell: ({ row }) => <div className="space-y-1">{statusChip(row.original)}{!!row.original.rescheduleProposedSlots.length && upcoming(row.original) && <p className="text-xs text-muted-foreground">{row.original.status === "confirmed" ? t("tourRescheduleInvitation", "Reschedule invitation") : t("tourInvitation", "Tour invitation")}</p>}{row.original.requestedRescheduleAt && <p className="text-xs text-muted-foreground">{t("tourReschedulePending", "Reschedule requested")}</p>}</div> },
    { id: "actions", header: t("tourTableResponse", "Response / action"), meta: { mobileSpan: "full" }, cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => openTour(row.original.id)}>{t("tourShowDetails", "View details")}</Button> },
  ];

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
      {!linkedTourId && <div className="space-y-5">
        <Input aria-label={t("tourTableSearch", "Search kitchen tours")} placeholder={t("tourTableSearch", "Search kitchen tours")} value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="sm:max-w-md" />
        <div className="grid grid-cols-3 gap-3">{["all", "upcoming", "past"].map(key => <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)} className={`rounded-xl border p-4 text-left ${group === key ? "border-primary bg-primary/[0.04]" : "bg-card hover:bg-muted/30"}`}><p className="text-xs text-muted-foreground">{key === "all" ? t("tourTableAll", "All tours") : key === "upcoming" ? t("tourTableUpcoming", "Upcoming") : t("tourTablePast", "Past")}</p><p className="mt-2 text-2xl font-semibold">{data.filter(tour => key === "all" || (key === "upcoming" ? upcoming(tour) : !upcoming(tour))).length}</p></button>)}</div>
        <DataTable columns={columns} data={filteredTours} defaultSorting={[{ id: "scheduledAt", desc: true }]} pageSize={15} onRowClick={tour => openTour(tour.id)} />
      </div>}
      <div className="space-y-3">
        {data.filter(tour => tour.id === linkedTourId).map((tour) => {

          const pastEnd = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000 < Date.now();
          const expired = !!tour.requestExpiredAt || ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() <= Date.now();
          const badge = viewingStatusBadge(tour.status, tour.adminReviewDecision, tour.cancelledBy, tour.disruptionReason);

          const hasProposal = tour.rescheduleProposedSlots.length > 0 && ["pending", "confirmed"].includes(tour.status) && !tour.checkedInAt && !tour.disruptionReason && Date.parse(tour.scheduledAt) > Date.now();
          const canEdit = canChefRequestReschedule(tour) && !tour.disruptionReason;
          const waitingForChange = tour.status === "confirmed" && !pastEnd && !!tour.requestedRescheduleAt && !tour.checkedInAt;
          return (
            <section key={tour.id} aria-label={t("tourPageDetails", "Tour details")} className="space-y-6">
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">TOUR-{tour.id} · {tour.locationName}</h1>
                    {tour.kitchenName && <p className="text-sm text-muted-foreground">{tour.kitchenName}</p>}
                  </div>
                  <InfoChip variant={expired ? "warning" : pastEnd && tour.status === "confirmed" ? "info" : badge.variant}>
                    {expired ? t("tourExpired", "Request expired") : pastEnd && tour.status === "confirmed" ? t("tourAwaitingVisitResult", "Awaiting kitchen tour result") : t(badge.labelKey, badge.defaultLabel)}
                  </InfoChip>
                </div>
              </div>
              <section aria-label={t("tourNextStep", "What to do next")} className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-5">
                <h2 className="text-sm font-semibold">{t("tourNextStep", "What to do next")}</h2>
                <p className="text-sm">{tour.disruptionReason ? t("tourNextClosed", "Review the tour outcome and shared notes. Contact Support if something is incorrect, or discover kitchens to request another tour.")
                  : hasProposal ? t("tourNextInvitation", "Review the offered times and choose whether to accept the invitation or keep your original time.")
                  : waitingForChange ? t("tourNextChangePending", "Your reschedule request is awaiting a response. Your original time remains confirmed until the manager accepts.")
                  : expired ? t("tourExpiredHelp", "The requested time passed before confirmation. If you have not applied, you can request another tour from the kitchen page.")
                  : ["pending_local_cooks", "pending"].includes(tour.status) ? t("tourListPending", "Your tour request is pending. We’ll notify you when it’s confirmed or declined.")
                  : tour.status === "completed" ? t("tourNextCompleted", "Your tour is complete. Review the shared notes and your application next step.")
                  : tour.status === "confirmed" && !pastEnd ? t("tourListConfirmedNext", "Tour confirmed. Arrive on time and bring questions about equipment, storage, and access.")
                  : tour.status === "confirmed" ? tour.chefFeedbackSubmitted ? t('common:tourFeedbackSubmitted', 'Your feedback is saved. Local Cooks will record the final kitchen tour result.') : t("tourAwaitingVisitResultHelp", "The tour time has ended. Share your feedback; Local Cooks will review both responses and record the final outcome.")
                  : t("tourNextClosed", "Review the tour outcome and shared notes. Contact Support if something is incorrect, or discover kitchens to request another tour.")}</p>
                {!expired && ['pending_local_cooks', 'pending'].includes(tour.status) && <p className="text-xs text-muted-foreground">{t('tourPendingResponseExpectation', 'We aim to respond within 24 hours. Your tour is not confirmed until you receive confirmation; a request expires when its requested start time passes.')}</p>}
                {tour.reconfirmation?.canReply && !waitingForChange && !hasProposal && <div className="space-y-3 border-t pt-3">
                  <p className="text-sm">{t('tourReconfirmHelp', 'Still planning to attend? Your tour remains confirmed while you reply. A change of time or cancellation needs a separate confirmation.')}</p>
                  {tour.reconfirmation.reply === 'still_coming' ? <p className="text-xs font-medium">{t('tourStillComingSaved', 'You confirmed that you’re still coming.')}</p> : <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={replyingId !== null} onClick={() => void replyToTour(tour, 'still_coming')}>{t('tourStillComing', 'Still coming')}</Button>
                    <Button size="sm" variant="outline" disabled={replyingId !== null} onClick={() => void replyToTour(tour, 'reschedule')}>{t('tourReplyReschedule', 'Reschedule')}</Button>
                    <Button size="sm" variant="outline" disabled={replyingId !== null} onClick={() => void replyToTour(tour, 'cant_make_it')}>{t('tourCantMakeIt', 'Can’t make it')}</Button>
                  </div>}
                  {replyError?.id === tour.id && <p role="alert" className="text-xs text-destructive">{replyError.message}</p>}
                </div>}
                {waitingForChange && <p className="text-sm">{t("tourChangeRequested", "Reschedule requested for")} {formatTourWhen(tour.requestedRescheduleAt!, tour.durationMinutes, tour.timezone)}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">

                  {(hasProposal || (canEdit && !(tour.reconfirmation?.canReply && !waitingForChange && tour.reconfirmation.reply !== 'still_coming'))) && <Button variant="outline" size="sm" className="h-9" disabled={reschedulingId !== null || cancellingId !== null} onClick={event => { actionTrigger.current = event.currentTarget; setRescheduleError(null); setRescheduleTargetId(tour.id); }}>{hasProposal ? t('tourReviewInvitation', 'Review invitation') : ['pending_local_cooks', 'pending'].includes(tour.status) ? t('tourEditRequest', 'Edit tour request') : t('tourRequestNewTime', 'Reschedule tour')}</Button>}
                  {["pending_local_cooks", "pending", "confirmed"].includes(tour.status) && new Date(tour.scheduledAt).getTime() > Date.now() && !tour.checkedInAt && <Button variant="outline" size="sm" className="h-9 text-destructive hover:text-destructive" disabled={cancellingId !== null || reschedulingId !== null} onClick={event => { actionTrigger.current = event.currentTarget; setCancelTarget(tour); }}>{t("tourCancel", "Cancel tour")}</Button>}
                  <TourChatButton tour={tour} role="chef" openFromLink={location === "/dashboard" && linkParams.get("view") === "viewings"} buttonClassName="h-9" />{tour.status === "confirmed" && !pastEnd && <TourDownloadButton tour={tour} t={t as any} />}
                  {(expired || ["cancelled", "no_show"].includes(tour.status) || !!tour.disruptionReason) && <Button asChild variant="outline" size="sm"><Link href="/dashboard?view=discover-kitchens">{t("tourListExploreCta", "Discover Kitchens")}</Link></Button>}
                  {tour.locationId && (tour.status === 'completed' || tour.status === 'confirmed' && pastEnd) &&
                    <TourApplicationButton id={tour.id} version={tour.updatedAt} />}
                  {tourCanReportLate(tour, actionClock) && <TourChatButton tour={tour} role="chef" buttonLabel={t('tourRunningLate', 'Running late')} buttonClassName="h-9" initialDraft={t('tourRunningLateDraft', 'I’m running late for my kitchen tour. My estimated arrival time is: ')} />}

                </div>
              </section>
              <div id={`tour-details-${tour.id}`} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0 space-y-4"><TourDetailPanel tour={tour} t={t as any} />{hasTourConfirmation(tour) && pastEnd && <TourFeedbackPanel id={tour.id} role="chef" version={tour.updatedAt} />}</div>
                <aside className="min-w-0 space-y-4"><TourSummary tour={tour} t={t as any} /><TourHistoryPanel id={tour.id} version={tour.updatedAt || tour.scheduledAt} role="chef" /></aside>
              </div>
            </section>
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
