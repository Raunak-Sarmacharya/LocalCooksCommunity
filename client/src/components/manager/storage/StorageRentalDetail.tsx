/**
 * One storage rental, from the kitchen's side (WP-ST11).
 *
 * Evidence photos, the money per paid term with its payout status, and the "More" actions the DTO
 * allows — each stating its consequence, with the amount and date, before it is sent.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SmartImage } from "@/components/ui/smart-image";
import { ChevronLeft, Image as ImageIcon } from "@/components/ui/manager-icons";
import { StorageStatusChip } from "@/components/manager/storage/StorageStatusChip";
import { StorageMoreActions } from "@/components/manager/storage/StorageMoreActions";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { formatBookingDate, formatCurrency } from "@/lib/formatters";
import { getAuthHeaders } from "@/lib/api";
import { chipForRental, formatKitchenDateTime, occupiesUnit, termPayout, type StorageRental } from "@/lib/storage-board";
import type { RentalState } from "@shared/storage-rental";

const STATE_KEY: Partial<Record<RentalState, string>> = {
  requested: "stStateRequested",
  declined: "stStateDeclined",
  expired: "stStateExpired",
  withdrawn: "stStateWithdrawn",
  ended: "stStateEnded",
};

export function StorageRentalDetail({ rentalId }: { rentalId: number }) {
  const { t, i18n } = useTranslation("storage");
  const query = useQuery<StorageRental>({
    queryKey: ["/api/manager/storage-rentals", rentalId],
    enabled: Number.isFinite(rentalId) && rentalId > 0,
    queryFn: async () => {
      const response = await fetch(`/api/manager/storage-rentals/${rentalId}`, { headers: await getAuthHeaders(), credentials: "include" });
      if (!response.ok) throw new Error(t("stDetailError"));
      return response.json();
    },
  });

  const rental = query.data;
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
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

  return (
    <div className="space-y-6">
      {back}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{t("stDetailTitle", { ref: rental.ref ?? `#${rental.id}` })}</h1>
          {occupiesUnit(rental)
            ? <StorageStatusChip chip={chipForRental(rental)} />
            : <Badge variant="outline">{t(STATE_KEY[rental.state] ?? "stStateLabel")}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {rental.kitchen.name} · {rental.listing.name} · {t("stUnitLabel", { index: rental.unitLabel })}
          {rental.chef?.name ? ` · ${rental.chef.name}` : ""}
        </p>
        <p className="text-sm">{formatBookingDate(rental.startOn)} – {formatBookingDate(rental.paidThrough)}</p>
        <div className="pt-1"><StorageMoreActions rental={rental} onDone={() => void query.refetch()} /></div>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("stEvidenceHeading")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!hasEvidence ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="h-4 w-4" aria-hidden="true" />{t("stEvidenceNone")}
            </p>
          ) : evidence.map((group) => group.urls.length > 0 && (
            <div key={group.key} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{t(group.key)}</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {group.urls.map((url, index) => (
                  <a key={`${group.key}-${index}`} href={getR2ProxyUrl(url)} target="_blank" rel="noopener noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-lg border bg-muted/30">
                    <SmartImage src={getR2ProxyUrl(url)} alt={`${t(group.key)} ${index + 1}`} hideOnError
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("stMoneyHeading")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {rental.terms.map((term, index) => {
            const payout = termPayout(term);
            const payoutText = payout.status === "scheduled"
              ? t("stPayoutScheduled", { amount: formatCurrency(payout.amountCents), date: formatKitchenDateTime(payout.at!, rental.timezone, i18n.language) })
              : payout.status === "paid"
                ? t("stPayoutPaid", { amount: formatCurrency(payout.amountCents), date: formatKitchenDateTime(payout.at!, rental.timezone, i18n.language) })
                : payout.status === "hold" ? t("stPayoutOnHold") : t("stPayoutNone");
            return (
              <div key={term.id}>
                {index > 0 && <Separator className="mb-4" />}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{t("stTermHeading", { seq: term.seq, start: formatBookingDate(term.startsOn), end: formatBookingDate(term.endsOn) })}</h3>
                  <span className="text-sm text-muted-foreground">{t("stTermDays", { days: term.days })}</span>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t("stTermCharged")}</dt>
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
    </div>
  );
}
