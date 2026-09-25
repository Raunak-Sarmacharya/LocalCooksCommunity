import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { Loader2, Eye, ChevronDown, MapPin, Download, CalendarDays, Clock3 } from "lucide-react";
import { Icon } from "@iconify/react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { tt } from "@/i18n/common-ns";
import { ChefTourRow, chefTourRowHasDetails, formatTourWhen, normalizeChefTourRow, viewingStatusBadge } from "@/lib/chef-viewing-display";

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
  onCancel,
  cancelling,
  onReschedule,
  rescheduling,
}: {
  tour: ChefTourRow;
  t: (key: string, defaultValue?: string | Record<string, unknown>) => string;
  onCancel: (tour: ChefTourRow) => void;
  cancelling: boolean;
  onReschedule: (tour: ChefTourRow, scheduledAt: string) => void;
  rescheduling: boolean;
}) {
  const pastEnd = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000 < Date.now();
  const expired = ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() < Date.now();
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const { data: slots = [], isFetching: loadingSlots } = useQuery<{ scheduledAt: string; startTime: string }[]>({
    queryKey: ["/api/viewings/available-slots", tour.id, date],
    queryFn: async () => {
      const response = await fetch(`/api/viewings/available-slots/${tour.targetedKitchenId}?date=${date}`);
      if (!response.ok) throw new Error("Could not load available times");
      const data = await response.json();
      return Array.isArray(data) ? data : data.slots || [];
    },
    enabled: !!date && !!tour.targetedKitchenId && tour.status === "confirmed" && !pastEnd,
  });
  return (
    <div className="space-y-5 text-sm">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3">
          <h4 className="font-semibold text-foreground">{t("tourVisitDetails", "Visit details")}</h4>
          <div className="space-y-2 text-muted-foreground">
            <p><span className="text-foreground">{t("tourDetailTime", "Tour time")}: </span>{formatTourWhen(tour.scheduledAt, tour.durationMinutes, tour.timezone)}</p>
            {tour.locationAddress && <p><span className="text-foreground">{t("tourAddress", "Address")}: </span>{tour.locationAddress}</p>}
            {tour.managerName && <p><span className="text-foreground">{t("tourDetailManager", "Kitchen manager")}: </span>{tour.managerName}</p>}
            {tour.status === "confirmed" && <div className="flex flex-wrap gap-x-4 gap-y-1">{tour.locationContactPhone && <a className="text-foreground underline underline-offset-2" href={`tel:${tour.locationContactPhone}`}>{tour.locationContactPhone}</a>}{tour.locationContactEmail && <a className="break-all text-foreground underline underline-offset-2" href={`mailto:${tour.locationContactEmail}`}>{tour.locationContactEmail}</a>}</div>}
          </div>
          {tour.status === "confirmed" && <p className="text-xs text-muted-foreground">{t("tourNeedHelp", "Need help from Local Cooks?")} <a className="underline underline-offset-2" href="tel:+17096318480">709-631-8480</a> · <a className="underline underline-offset-2" href="mailto:support@localcook.shop">support@localcook.shop</a></p>}
        </section>
        <section className="space-y-3">
          <h4 className="font-semibold text-foreground">{t("tourRequestDetails", "Request details")}</h4>
          <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
            <p><span className="block text-xs">{t("tourDetailReference", "Tour reference")}</span><span className="font-medium text-foreground">TOUR-{tour.id}</span></p>
            <p><span className="block text-xs">{t("tourDetailSubmitted", "Request submitted")}</span><span className="font-medium text-foreground">{tour.submittedAt ? formatTourWhen(tour.submittedAt, null, tour.timezone) : t("tourDetailDateUnavailable", "Date unavailable")}</span></p>
            {tour.chefName && <p><span className="block text-xs">{t("tourDetailChef", "Chef")}</span><span className="font-medium text-foreground">{tour.chefName}</span></p>}
            {tour.chefEmail && <p><span className="block text-xs">{t("tourDetailEmail", "Account email")}</span><span className="break-all font-medium text-foreground">{tour.chefEmail}</span></p>}
            {tour.adminReviewedAt && <p><span className="block text-xs">{t("tourDetailReviewed", "Local Cooks reviewed")}</span><span className="font-medium text-foreground">{formatTourWhen(tour.adminReviewedAt, null, tour.timezone)}</span></p>}
            {tour.cancelledAt && <p><span className="block text-xs">{t("tourDetailCancelled", "Cancelled")}</span><span className="font-medium text-foreground">{formatTourWhen(tour.cancelledAt, null, tour.timezone)}</span></p>}
            {tour.completedAt && <p><span className="block text-xs">{t("tourDetailCompleted", "Completed")}</span><span className="font-medium text-foreground">{formatTourWhen(tour.completedAt, null, tour.timezone)}</span></p>}
          </div>
        </section>
      </div>
      {tour.requestedRescheduleAt && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("tourChangeRequested", "Change requested for")} {formatTourWhen(tour.requestedRescheduleAt, tour.durationMinutes, tour.timezone)}. {t("tourOriginalTimeHeld", "Your original time remains confirmed until the manager accepts.")}</p>}
      {tour.status === "confirmed" && !pastEnd && !tour.requestedRescheduleAt && new Date(tour.scheduledAt).getTime() > Date.now() && (
        <details className="rounded-lg border bg-background p-3">
          <summary className="cursor-pointer font-medium text-foreground">{t("tourRequestNewTime", "Request new time")}</summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56"><label className="mb-1 block text-xs font-medium" htmlFor={`tour-date-${tour.id}`}>{t("tourNewDate", "New date")}</label><DateField id={`tour-date-${tour.id}`} value={date} onChange={(value) => { setDate(value); setSlot(""); }} placeholder={t("tourChooseDate", "Choose a date")} /></div>
          <div className="w-full sm:w-56"><label className="mb-1 block text-xs font-medium" htmlFor={`tour-time-${tour.id}`}>{t("tourAvailableTime", "Available time")}</label><Select value={slot} onValueChange={setSlot} disabled={!date || loadingSlots || slots.length === 0}><SelectTrigger id={`tour-time-${tour.id}`}><SelectValue placeholder={loadingSlots ? t("tourLoadingTimes", "Loading…") : t("tourChooseTime", "Choose a time")} /></SelectTrigger><SelectContent>{slots.map((item) => <SelectItem key={item.scheduledAt} value={item.scheduledAt}>{item.startTime}</SelectItem>)}</SelectContent></Select></div>
          <Button variant="outline" size="sm" disabled={!slot || rescheduling} onClick={() => onReschedule(tour, slot)}>{t("tourRequestNewTime", "Request new time")}</Button>
          </div>
        </details>
      )}
      {["pending_local_cooks", "pending", "confirmed"].includes(tour.status) && new Date(tour.scheduledAt).getTime() > Date.now() && (
        <Button variant="outline" size="sm" disabled={cancelling} onClick={() => onCancel(tour)}>{t("tourCancel", "Cancel tour")}</Button>
      )}

      {(tour.chefNotes?.trim() || tour.intakeEntries.length > 0 || tour.managerNotes || tour.cancellationReason || tour.adminReviewReason || tour.noShowReason) && <details className="rounded-lg border bg-background p-3"><summary className="cursor-pointer font-medium text-foreground">{t("tourMoreRequestInfo", "Notes and updates")}</summary><div className="mt-3 space-y-3">
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
          {tour.intakeEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 text-xs sm:text-sm">
              <span className="text-muted-foreground capitalize">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <span className="font-medium text-foreground text-right">
                {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
              </span>
            </div>
          ))}
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

      {tour.managerNotes && (
        <div>
          <p className="font-medium text-foreground text-xs mb-0.5">
            {t("tourListManagerMessage", {
              name: tour.managerName || "Manager",
              defaultValue: `Message from ${tour.managerName || "Manager"}`,
            })}
          </p>
          <p className="text-muted-foreground">{tour.managerNotes}</p>
        </div>
      )}
      {expired && <p className="rounded-xl border bg-muted/50 px-3 py-2 text-sm">{t("tourExpiredHelp", "The requested time passed before confirmation. If you have not applied, you can request another tour from the kitchen page.")}</p>}
      {tour.adminReviewReason && <div><p className="font-medium text-xs">{t("tourDetailReviewReason", "Review note")}</p><p className="text-muted-foreground whitespace-pre-wrap">{tour.adminReviewReason}</p></div>}
      {tour.noShowReason && <div><p className="font-medium text-xs">{t("tourDetailNoShowReason", "No-show reason")}</p><p className="text-muted-foreground">{tour.noShowReason.replace(/_/g, " ")}</p></div>}
      </div></details>}
      {(tour.status === "pending_local_cooks" || tour.status === "pending") && !expired && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("tourListPendingNext", "Your request is moving through Local Cooks and kitchen manager approval. You’ll get an email after the final decision.")}</p>}
      {tour.status === "confirmed" && !pastEnd && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-950">{t("tourListConfirmedNext", "Tour confirmed. Arrive on time and bring questions about equipment, storage, and access.")}</p>}
    </div>
  );
}

export default function ChefViewingsList({ onExploreKitchens }: { onExploreKitchens?: () => void }) {
  const { user } = useFirebaseAuth();
  const { t } = useTranslation("chef");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ChefTourRow | null>(null);
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const requestReschedule = async (tour: ChefTourRow, scheduledAt: string) => {
    setReschedulingId(tour.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/chef/${tour.id}/reschedule`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ scheduledAt }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not request a new time");
      await queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Could not request a new time"); }
    finally { setReschedulingId(null); }
  };
  const cancelTour = async (tour: ChefTourRow) => {
    setCancellingId(tour.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/${tour.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ status: "cancelled", cancellationReason: "Cancelled by chef" }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not cancel tour");
      await queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] });
    } catch (error) { window.alert(error instanceof Error ? error.message : "Could not cancel tour"); }
    finally { setCancellingId(null); setCancelTarget(null); }
  };

  const { data: rawViewings = [], isLoading, error, refetch } = useQuery({
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
  });

  const data = useMemo(
    () =>
      (rawViewings as unknown[])
        .map(normalizeChefTourRow)
        .filter((row): row is ChefTourRow => row != null)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || b.id - a.id),
    [rawViewings]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 p-8" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span>Loading your kitchen tours…</span>
      </div>
    );
  }

  if (error) {
    return <Card className="shadow-none"><CardContent className="space-y-3 p-8 text-center"><p>We couldn’t load your kitchen tours right now.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></CardContent></Card>;
  }

  if (data.length === 0) {
    return (
      <Card className="border-dashed shadow-none" data-testid="chef-viewings-list-empty">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <Eye className="mb-4 h-6 w-6 text-muted-foreground" />
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
    <div className="space-y-4" data-testid="chef-viewings-list">
      <div className="space-y-3">
        {data.map((tour) => {
          const open = expandedId === tour.id;
          const hasDetails = chefTourRowHasDetails(tour);
          const pastEnd = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000 < Date.now();
          const expired = ["pending_local_cooks", "pending"].includes(tour.status) && new Date(tour.scheduledAt).getTime() < Date.now();
          const badge = viewingStatusBadge(tour.status);
          return (
            <article key={tour.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">TOUR-{tour.id}</p>
                    <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{tour.locationName}</h3>
                    {tour.kitchenName && <p className="text-sm text-muted-foreground">{tour.kitchenName}</p>}
                  </div>
                  <InfoChip variant={expired ? "warning" : pastEnd && tour.status === "confirmed" ? "warning" : badge.variant}>
                    {expired ? t("tourExpired", "Request expired") : pastEnd && tour.status === "confirmed" ? t("tourAwaitingOutcome", "Awaiting outcome") : t(badge.labelKey, badge.defaultLabel)}
                  </InfoChip>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-foreground sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                  <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{formatTourWhen(tour.scheduledAt, null, tour.timezone)}</span></p>
                  <p className="flex items-start gap-2"><Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{tour.durationMinutes ? t("tourListDurationMins", { count: tour.durationMinutes, defaultValue: `${tour.durationMinutes} min` }) : t("tourListDurationDefault", "About 30 min")}</span></p>
                  {tour.locationAddress && <p className="flex min-w-0 items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="line-clamp-2">{tour.locationAddress}</span></p>}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
                  {tour.status === "confirmed" && !pastEnd && <TourDownloadButton tour={tour} t={t as any} />}
                  {tour.status === "confirmed" && tour.locationAddress && <Button asChild variant="outline" size="sm" className="h-9 gap-2"><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(tour.locationAddress)}`} target="_blank" rel="noopener noreferrer"><MapPin className="size-4" />{t("tourGetDirections", "Get directions")}</a></Button>}
                  {hasDetails && <Button variant="ghost" size="sm" className="ml-auto h-9 gap-1 text-muted-foreground" aria-expanded={open} aria-controls={`tour-details-${tour.id}`} onClick={() => setExpandedId(open ? null : tour.id)}>{open ? t("tourHideDetails", "Hide details") : t("tourShowDetails", "View details")}{open ? <ChevronDown className="size-4 rotate-180" /> : <ChevronDown className="size-4" />}</Button>}
                </div>
              </div>
              {open && <div id={`tour-details-${tour.id}`} className="border-t bg-muted/20 p-4 sm:p-5"><TourDetailPanel tour={tour} t={t as any} onCancel={setCancelTarget} cancelling={cancellingId === tour.id} onReschedule={(item, time) => void requestReschedule(item, time)} rescheduling={reschedulingId === tour.id} /></div>}
            </article>
          );
        })}
      </div>
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open && cancellingId === null) setCancelTarget(null); }}>
        <AlertDialogContent>
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
