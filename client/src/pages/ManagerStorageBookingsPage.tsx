/**
 * Kitchen Storage board (WP-ST11).
 *
 * The kitchen's home for standalone storage rentals: a glance strip, the requests that need an
 * answer, then every unit grouped by listing — free units included — so the kitchen sees at a
 * glance what is in use and what needs them now. Actions come from the DTO's `actions[]`; the detail
 * page (`/manager/storage/:id`) carries the deeper tools.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { formatCurrency } from "@/lib/formatters";
import { StoragePhoto } from "@/components/storage/StoragePhoto";
import { navigateNotificationHref } from "@/lib/navigate-notification-href";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, ChevronRight } from "@/components/ui/manager-icons";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { getAuthHeaders } from "@/lib/api";
import {
  boardSummary, filterUnitRows, formatStorageDate, groupRowsByListing, pendingRequests, unitRows,
  type BoardFilter, type StorageListing, type StorageRental,
} from "@/lib/storage-board";
import { StorageRequestCard } from "@/components/manager/storage/StorageRequestCard";
import { StorageUnitCard } from "@/components/manager/storage/StorageUnitCard";

export default function ManagerStorageBookingsPage() {
  const { t, i18n } = useTranslation("storage");
  const { kitchens } = useManagerDashboard();
  const kitchenIds = useMemo(() => kitchens.map((kitchen) => kitchen.id), [kitchens]);
  const listingId = Number(new URLSearchParams(window.location.search).get("listingId")) || null;
  const [filter, setFilter] = useState<BoardFilter>("all");

  const rentalsQuery = useQuery<StorageRental[]>({
    queryKey: ["/api/manager/storage-rentals"],
    queryFn: async () => {
      const response = await fetch("/api/manager/storage-rentals", { headers: await getAuthHeaders(), credentials: "include" });
      if (!response.ok) throw new Error(t("stBoardError"));
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const listingsQuery = useQuery<StorageListing[]>({
    queryKey: ["/api/manager/storage-listings", kitchenIds],
    enabled: kitchenIds.length > 0,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const perKitchen = await Promise.all(kitchenIds.map(async (kitchenId) => {
        const response = await fetch(`/api/manager/kitchens/${kitchenId}/storage-listings`, { headers, credentials: "include" });
        if (!response.ok) throw new Error(t("stBoardError"));
        const rows = (await response.json()) as Array<Record<string, unknown>>;
        const kitchenName = kitchens.find((kitchen) => kitchen.id === kitchenId)?.name ?? "";
        return rows.map((row) => ({
          id: Number(row.id),
          name: String(row.name ?? ""),
          kitchenId: Number(row.kitchenId ?? kitchenId),
          kitchenName,
          unitCount: Number(row.unitCount ?? 1),
          storageType: String(row.storageType ?? "other"), photos: row.photos as string[] | null,
          outOfServiceUnits: row.outOfServiceUnits as StorageListing["outOfServiceUnits"],
        }));
      }));
      return perKitchen.flat();
    },
  });

  const rentals = (rentalsQuery.data ?? []).filter(rental => !listingId || rental.listing.id === listingId);
  const pastRentals = rentals.filter(rental => rental.state === "ended")
    .sort((a, b) => (b.releasedOn || b.paidThrough).localeCompare(a.releasedOn || a.paidThrough));
  const listings = useMemo(() => (listingsQuery.data ?? []).filter(listing => !listingId || listing.id === listingId), [listingsQuery.data, listingId]);
  const rows = useMemo(() => unitRows(rentals, listings), [rentals, listings]);
  const summary = useMemo(() => boardSummary(rentals, listings), [rentals, listings]);
  const requests = useMemo(() => pendingRequests(rentals), [rentals]);
  const visibleRows = useMemo(() => filterUnitRows(rows, filter), [rows, filter]);
  const groups = useMemo(() => groupRowsByListing(visibleRows), [visibleRows]);
  const refetch = () => { void rentalsQuery.refetch(); void listingsQuery.refetch(); };
  const loading = rentalsQuery.isLoading || listingsQuery.isLoading;
  const error = rentalsQuery.error ?? listingsQuery.error;

  const filters: Array<[BoardFilter, string, number]> = [
    ["all", t("stFilterAll"), rows.length],
    ["needsAction", t("stFilterNeedsAction"), rows.filter(row => row.needsAction).length + requests.length],
    ["free", t("stFilterFree"), rows.filter(row => row.chip === 'free').length],
    ["past", t("stPastRentals"), pastRentals.length],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-10 gap-y-5 border-b pb-5">
        {[
          [t('stStatInUse'), t('stInUseValue', { occupied: summary.occupied, units: summary.units }), true],
          [t('stRequestsHeading'), summary.requests],
          ...(summary.grace > 0 ? [[t('stStatGrace'), summary.grace]] : []),
          ...(summary.holdover > 0 ? [[t('stStatHoldover'), summary.holdover]] : []),
          ...(summary.outOfService > 0 ? [[t('stChipOutOfService'), summary.outOfService]] : []),
        ].map(([label, value, occupancy]) => (
          <div key={String(label)} className="min-w-24">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
            {occupancy && <div className="mt-2 h-1 w-32 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${summary.units ? Math.min(100, summary.occupied / summary.units * 100) : 0}%` }} /></div>}
          </div>
        ))}
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-destructive">{error.message}</p>
            <Button variant="outline" size="sm" onClick={refetch}>{t("stRetry")}</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="space-y-3" role="status" aria-label={t("stLoading")}>
          <Skeleton className="h-11 w-full rounded-xl" />
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : (
        <Tabs value={filter} onValueChange={value => setFilter(value as BoardFilter)} className="space-y-6">
          <TabsList aria-label={t("stUnitsHeading")} className="h-auto w-fit max-w-full flex-wrap justify-start rounded-lg bg-muted/60 p-1">
            {filters.map(([value, label, count]) => (
              <TabsTrigger key={value} value={value} className="h-11 gap-2 px-3 text-sm">
                {label}<span className="text-xs tabular-nums text-muted-foreground">{count}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={filter} className="space-y-6">

          {filter !== "free" && filter !== "past" && (
            <section className="space-y-3" aria-labelledby="storage-requests-heading">
              <h2 id="storage-requests-heading" className="text-base font-semibold">{t("stRequestsHeading")}</h2>
              {requests.length === 0
                ? <p className="text-sm text-muted-foreground">{t("stRequestsEmpty")}</p>
                : requests.map((rental) => <StorageRequestCard key={rental.id} rental={rental} onDone={refetch} />)}
            </section>
          )}

          {filter !== "past" && <section className="space-y-4" aria-labelledby="storage-units-heading">
            <h2 id="storage-units-heading" className="text-base font-semibold">{t("stUnitsHeading")}</h2>
            {groups.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                  <Package className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">{t("stUnitsEmptyTitle")}</p>
                  <p className="text-sm text-muted-foreground">{t("stUnitsEmptyBody")}</p>
                </CardContent>
              </Card>
            ) : groups.map((group) => (
              <div key={group.listingId} className="space-y-3">
                <div className="flex items-center justify-between gap-3 pt-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <StoragePhoto iconSet="manager" storageType={group.rows[0].storageType} photos={group.rows[0].photos} className="h-12 w-12" />
                    <div className="min-w-0"><h3 className="truncate font-semibold">{group.listingName}</h3>
                      <p className="text-xs text-muted-foreground">{t(`stPhoto_${['freezer', 'frozen'].includes(group.rows[0].storageType || '') ? 'frozen' : ['cold', 'dry'].includes(group.rows[0].storageType || '') ? group.rows[0].storageType : 'other'}` as never)} · {t('stListingInUse', { inUse: rows.filter(row => row.listingId === group.listingId && row.rental).length, units: rows.filter(row => row.listingId === group.listingId).length })}</p>
                    </div>
                  </div>
                  <a href="/manager/dashboard?view=storage-listings" className="inline-flex min-h-11 shrink-0 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateNotificationHref(event.currentTarget.getAttribute('href')!); } }}>{t('stEditListing')}</a>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.rows.map((row) => <StorageUnitCard key={row.key} row={row} onDone={refetch} />)}
                </div>
              </div>
            ))}
          </section>}
          {(filter === "all" || filter === "past") && <section className="space-y-3" aria-labelledby="storage-past-heading">
            <h2 id="storage-past-heading" className="text-base font-semibold">{t("stPastRentals")}</h2>
            {pastRentals.length === 0 && <p>{t("stPastRentalsEmpty")}</p>}
            <div className="divide-y rounded-xl border bg-card">{pastRentals.map(rental => <Link key={rental.id} href={`/manager/storage/${rental.id}`} className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
              <span className="font-medium">{rental.ref} · {rental.listing.name} · {t('stUnitLabel', { index: rental.unitLabel })}</span>
              <span className="text-muted-foreground">{formatStorageDate(rental.startOn, i18n.language)} – {formatStorageDate(rental.releasedOn || rental.paidThrough, i18n.language)}</span>
              <span className="truncate text-muted-foreground">{rental.chef?.name || t('stTheChef')}</span>
              <span className="tabular-nums">{t('stRentalEarnings', { amount: formatCurrency(rental.terms.reduce((sum, term) => sum + (term.payoutCents ?? 0), 0), 'CAD', i18n.language) })}</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>)}</div>
          </section>}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
