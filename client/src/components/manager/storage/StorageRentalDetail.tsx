/**
 * One storage rental, from the kitchen's side (WP-ST11).
 *
 * Evidence photos, the money per term with its payout status, and the actions the DTO
 * allows — each stating its consequence, with the amount and date, before it is sent.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StorageMessageButton } from "@/components/storage/StorageMessageButton";
import { Badge } from "@/components/ui/badge";
import { StorageRequestCard } from "./StorageRequestCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SmartImage } from "@/components/ui/smart-image";
import { Check, Info, ChevronLeft, Image as ImageIcon } from "@/components/ui/manager-icons";
import { StorageStatusChip } from "@/components/manager/storage/StorageStatusChip";
import { StorageMoreActions } from "@/components/manager/storage/StorageMoreActions";
import { DamageClaimSheet } from "@/components/booking/DamageClaimSheet";
import { StorageDamageClaims } from "@/components/booking/DamageClaimCards";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { formatBookingDate, formatCurrency } from "@/lib/formatters";
import { getAuthHeaders } from "@/lib/api";
import { claimRequest, claimWhen, type FilingContext } from "@/lib/damage-claims";
import { chipForRental, formatStorageDate, occupiesUnit, termPayout, type StorageRental } from "@/lib/storage-board";
import { addDays, NO_MOVE_IN_RELEASE_DAYS, type RentalState } from "@shared/storage-rental";

const STATE_KEY: Partial<Record<RentalState, string>> = {
  requested: "stStateRequested",
  declined: "stStateDeclined",
  expired: "stStateExpired",
  withdrawn: "stStateWithdrawn",
  ended: "stStateEnded",
};

export function StorageRentalDetail({ rentalId }: { rentalId: number }) {
  const { t, i18n } = useTranslation("storage");
  const { t: claimT } = useTranslation("booking");
  const [claimOpen, setClaimOpen] = useState(false);
  const query = useQuery<StorageRental>({
    queryKey: ["/api/manager/storage-rentals", rentalId],
    enabled: Number.isFinite(rentalId) && rentalId > 0,
    queryFn: async () => {
      const response = await fetch(`/api/manager/storage-rentals/${rentalId}`, { headers: await getAuthHeaders(), credentials: "include" });
      if (!response.ok) throw new Error(t("stDetailError"));
      return response.json();
    },
  });
  const filing = useQuery({
    queryKey: ["damage-claim-filing", "storage", rentalId],
    enabled: Number.isFinite(rentalId) && rentalId > 0 && !!query.data,
    retry: false,
    queryFn: () => claimRequest<FilingContext>(`/manager/storage-rentals/${rentalId}/claims/filing-context`),
  });

  const rental = query.data;
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 h-11">
      <Link href="/manager/dashboard?view=storage-bookings"><ChevronLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("stBackToBoard")}</Link>
    </Button>
  );

  if (query.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label={t("stLoading")}>
        {back}
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (query.error || !rental) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="font-medium">{t("stRentalNotFoundTitle")}</p>
            <p className="text-sm text-muted-foreground">{query.error?.message ?? t("stRentalNotFoundBody")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const evidence = [
    { key: "stEvidenceMoveIn", urls: rental.evidence.checkinPhotoUrls ?? [] },
    { key: "stEvidenceHandover", urls: rental.evidence.handoverPhotoUrls ?? [] },
    { key: "stEvidenceMoveOut", urls: rental.evidence.checkoutPhotoUrls ?? [] },
  ];
  const hasEvidence = evidence.some((group) => group.urls.length > 0);

  // Cancelled before the start: no move-in or move-out happened, so the timeline ends at the cancellation.
  const steps = rental.cancellation ? [
    { key: "stTimelineRequested", at: rental.timeline?.requestedAt },
    { key: "stTimelineApproved", at: rental.timeline?.approvedAt },
    { key: "stStateCancelled", at: rental.cancellation.cancelledAt },
  ] : [
    { key: "stTimelineRequested", at: rental.timeline?.requestedAt },
    { key: "stTimelineApproved", at: rental.timeline?.approvedAt },
    { key: "stTimelineMovedIn", at: rental.timeline?.movedInAt },
    { key: "stTimelineMovingOut", at: rental.timeline?.movingOutAt },
    { key: "stTimelineEnded", at: rental.timeline?.endedAt },
  ];
  const currentStep = rental.state === "ended" ? steps.length - 1 : rental.state === "move_out_requested" ? 3
    : ["active", "removal_review"].includes(rental.state) ? 2 : rental.state === "reserved" ? 1 : 0;
  const date = (value: string) => formatStorageDate(value, i18n.language, rental.timezone);
  const chef = rental.chef?.name || t('stTheChef');
  const chip = chipForRental(rental);
  const situation = rental.cancellation ? 'cancelled' : rental.state === 'reserved' ? chip === 'moveInOverdue' ? 'overdue' : 'reserved'
    : rental.state === 'active' ? rental.phase === 'holdover' ? 'holdover' : rental.phase === 'grace' ? 'grace' : 'active'
    : rental.state;
  const prominentActions: Record<string, string[]> = {
    overdue: ['handover', 'release'], reserved: [], active: ['offer-extension'], grace: ['offer-extension'],
    holdover: ['holdover-charge'], move_out_requested: ['clear-move-out', 'items-still-here', 'release'],
    removal_review: ['removal/record'], ended: ['mark-ready', 'items-still-here'],
  };
  const canMessage = ['requested', 'reserved', 'active', 'move_out_requested', 'removal_review', 'ended'].includes(rental.state);
  const warning = ['overdue', 'grace', 'holdover', 'move_out_requested', 'removal_review'].includes(situation);
  return (
    <div className="space-y-6">
      {back}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{t('stUnitLabel', { index: rental.unitLabel })} · {rental.listing.name}</h1>
          {occupiesUnit(rental)
            ? <StorageStatusChip chip={chipForRental(rental)} />
            : <Badge variant="outline">{t((rental.cancellation ? "stStateCancelled" : STATE_KEY[rental.state] ?? "stStateLabel") as never)}</Badge>}
        </div>
        <div className="flex items-center gap-2 text-sm"><Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{chef.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</AvatarFallback></Avatar><span className="font-medium">{chef}</span><span className="text-muted-foreground">· {rental.kitchen.name}</span></div>
        <p className="text-sm">{date(rental.startOn)} – {date(rental.paidThrough)}</p>
        <p className="text-xs text-muted-foreground">{rental.ref ?? `#${rental.id}`}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {filing.data?.allowed && (
            <div className="space-y-1" data-testid="storage-claim-report">
              <Button className="min-h-11" variant="outline" onClick={() => setClaimOpen(true)}>{claimT("dcV2Report")}</Button>
              <p className="text-sm text-muted-foreground">{claimT("dcV2FileBy", { when: claimWhen(filing.data.deadline, filing.data.timezone, i18n.language) })}</p>
            </div>
          )}
        </div>
      </header>

      <Alert className={warning ? 'border-amber-200 bg-amber-50/50' : 'border-border bg-muted/20'} data-testid="storage-situation">
        <Info className={warning ? 'h-4 w-4 text-amber-700' : 'h-4 w-4 text-muted-foreground'} />
        <AlertDescription className="space-y-3">
          <p className="text-sm font-medium">{t(`stSituation_${situation}` as never, { chef, date: date(rental.startOn), end: date(rental.paidThrough), moveOut: date(rental.moveOutBy || rental.paidThrough), grace: date(rental.graceEndsOn), days: rental.holdoverDays, amount: formatCurrency(rental.accruedCents, 'CAD', i18n.language) })}</p>
          {prominentActions[situation] && <p className="text-sm text-muted-foreground">{t(`stNextStep_${situation}` as never, { chef })}</p>}
          {rental.cancellation && <p className="text-sm tabular-nums" data-testid="storage-cancelled-money">{t("stCancelledMoney", { refund: formatCurrency(rental.cancellation.refundCents, 'CAD', i18n.language),
            payout: formatCurrency(rental.cancellation.kitchenPayoutCents ?? 0, 'CAD', i18n.language) })}</p>}
          {rental.cancellation?.reason && <p className="text-sm text-muted-foreground">{t("stCancelReason", { reason: rental.cancellation.reason })}</p>}
          {situation === 'overdue' && !rental.actions.includes('release') && <p className="text-sm text-muted-foreground">{t('stReleaseAvailableOn', { date: date(addDays(rental.startOn, NO_MOVE_IN_RELEASE_DAYS)) })}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {canMessage && <StorageMessageButton rentalId={rental.id} chef={chef} />}
            {rental.state !== 'requested' && <StorageMoreActions rental={rental} prominentActions={prominentActions[situation] || []} onDone={() => void query.refetch()} />}
          </div>
        </AlertDescription>
      </Alert>

      <section aria-label={t("stTimeline")} className="rounded-xl border bg-card p-4">
        <ol className={`grid gap-4 ${steps.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-5'}`}>
          {steps.map((step, index) => <li key={step.key} aria-current={index === currentStep ? "step" : undefined}
            className="relative flex gap-3 text-muted-foreground sm:flex-col">
            <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-card ${index === currentStep ? 'border-primary text-primary ring-2 ring-primary/25 ring-offset-2' : index < currentStep ? 'border-muted bg-muted' : 'border-border text-muted-foreground/50'}`}>
              {index < currentStep ? <Check className="h-4 w-4" /> : <span className="text-xs tabular-nums">{index + 1}</span>}
            </span>
            {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-3.5 top-7 h-full w-px bg-border sm:left-7 sm:top-3.5 sm:h-px sm:w-full" />}
            <div className="relative z-10">
            <p className={`text-sm font-medium ${index === currentStep ? 'text-foreground' : ''}`}>{t(step.key as never)}</p>
            {step.at && <p className="mt-1 text-xs">{date(step.at)}</p>}
            </div>
          </li>)}
        </ol>
        {!hasEvidence && <p className="mt-5 flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground"><ImageIcon className="h-4 w-4" />{t('stEvidenceNone')}</p>}
      </section>

      {/* A request is answered here too (the dashboard links straight to this page), with the board's same card. */}
      {rental.state === "requested" && <StorageRequestCard rental={rental} onDone={() => void query.refetch()} />}

      {hasEvidence && <Card>
        <CardHeader><CardTitle className="text-base">{t("stEvidenceHeading")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {evidence.map((group) => group.urls.length > 0 && (
            <div key={group.key} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{t(group.key as never)}</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {group.urls.map((url, index) => (
                  <a key={`${group.key}-${index}`} href={getR2ProxyUrl(url)} target="_blank" rel="noopener noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-lg border bg-muted/30">
                    <SmartImage src={getR2ProxyUrl(url)} alt={`${t(group.key as never)} ${index + 1}`} hideOnError
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>}

      {(rental.instructions?.moveIn || rental.instructions?.moveOut || rental.chefNotes?.moveIn || rental.chefNotes?.moveOut) && <Card>
        <CardHeader><CardTitle className="text-base">{t('stInstructionsHeading')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          {([
            ['stMoveInInstructions', rental.instructions?.moveIn], ['stMoveOutInstructions', rental.instructions?.moveOut],
            ['stChefMoveInNotes', rental.chefNotes?.moveIn], ['stChefMoveOutNotes', rental.chefNotes?.moveOut],
          ] as const).map(([key, value]) => value && <div key={key}><h3 className="mb-1 font-medium">{t(key)}</h3><p className="whitespace-pre-wrap text-muted-foreground">{value}</p></div>)}
        </CardContent>
      </Card>}

      <Card>
        <CardHeader><CardTitle className="text-base">{t("stMoneyHeading")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {rental.terms.map((term, index) => {
            const payout = termPayout(term);
            const payoutText = rental.cancellation && payout.amountCents <= 0 ? t("stPayoutNoneOwed") : payout.status === "scheduled"
              ? t("stPayoutScheduled", { amount: formatCurrency(payout.amountCents), date: date(payout.at!) })
              : payout.status === "paid"
                ? t("stPayoutPaid", { amount: formatCurrency(payout.amountCents), date: date(payout.at!) })
                : payout.status === "hold" ? t("stPayoutOnHold") : rental.state === "requested" && rental.estimatedPayoutCents != null
                  ? t("stPayoutEstimate", { amount: formatCurrency(rental.estimatedPayoutCents) }) : t("stPayoutNone");
            return (
              <div key={term.id}>
                {index > 0 && <Separator className="mb-4" />}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{t("stTermHeading", { seq: term.seq, start: formatBookingDate(term.startsOn), end: formatBookingDate(term.endsOn) })}</h3>
                  <span className="text-sm text-muted-foreground">{t("stTermDays", { days: term.days })}</span>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t(term.status === "authorized" ? "stTermOnHold" : term.status === "paid" ? "stTermCharged" : term.status === "cancelled" ? "stTermReleased" : "stTermUnpaid")}</dt>
                    <dd className="font-medium tabular-nums">{formatCurrency(term.totalCents)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t("stTermPayout")}</dt>
                    <dd className="text-right">{payoutText}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <StorageDamageClaims storageRentalId={rental.id} manager heading={t("stClaimsHeading")} />

      {claimOpen && (
        <DamageClaimSheet
          storageRentalId={rental.id}
          chefName={rental.chef?.name || t("stTheChef")}
          hideTrigger
          open={claimOpen}
          onOpenChange={setClaimOpen}
          onFiled={() => { setClaimOpen(false); void query.refetch(); void filing.refetch(); }}
        />
      )}
    </div>
  );
}
