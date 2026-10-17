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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Package } from "@/components/ui/manager-icons";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { getAuthHeaders } from "@/lib/api";
import {
  boardSummary, filterUnitRows, groupRowsByListing, pendingRequests, unitRows,
  type BoardFilter, type StorageListing, type StorageRental,
} from "@/lib/storage-board";
import { StorageRequestCard } from "@/components/manager/storage/StorageRequestCard";
import { StorageUnitCard } from "@/components/manager/storage/StorageUnitCard";

export default function ManagerStorageBookingsPage() {
  const { t } = useTranslation("storage");
  const { kitchens } = useManagerDashboard();
  const kitchenIds = useMemo(() => kitchens.map((kitchen) => kitchen.id), [kitchens]);
  const [filter, setFilter] = useState<BoardFilter>("all");

  const rentalsQuery = useQuery<StorageRental[]>({
    queryKey: ["/api/manager/storage-rentals"],
    queryFn: async () => {
      const response = await fetch("/api/manager/storage-rentals", { headers: await getAuthHeaders(), credentials: "include" });
      if (!response.ok) throw new Error(t("stBoardError"));
      return response.json();
    },
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
          outOfServiceUnits: row.outOfServiceUnits as StorageListing["outOfServiceUnits"],
          visible: Boolean(row.isActive) && ["approved", "active"].includes(String(row.status)),
        }));
      }));
      return perKitchen.flat();
    },
  });

  const rentals = rentalsQuery.data ?? [];
  const occupiedListingIds = useMemo(() => new Set(rentals.map((rental) => rental.listing.id)), [rentals]);
  const listings = useMemo(
    () => (listingsQuery.data ?? []).filter((listing) => listing.visible !== false || occupiedListingIds.has(listing.id)),
    [listingsQuery.data, occupiedListingIds],
  );
  const rows = useMemo(() => unitRows(rentals, listings), [rentals, listings]);
  const summary = useMemo(() => boardSummary(rentals, listings), [rentals, listings]);
  const requests = useMemo(() => pendingRequests(rentals), [rentals]);
  const visibleRows = useMemo(() => filterUnitRows(rows, filter), [rows, filter]);
  const groups = useMemo(() => groupRowsByListing(visibleRows), [visibleRows]);
  const refetch = () => { void rentalsQuery.refetch(); void listingsQuery.refetch(); };
  const loading = rentalsQuery.isLoading || listingsQuery.isLoading;
  const error = rentalsQuery.error ?? listingsQuery.error;

  const filters: Array<[BoardFilter, string]> = [
    ["all", t("stFilterAll")],
    ["needsAction", t("stFilterNeedsAction")],
    ["free", t("stFilterFree")],
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t("stSummaryOccupied", { occupied: summary.occupied, units: summary.units }), "text-foreground"],
          [t("stSummaryRequests", { count: summary.requests }), "text-foreground"],
          [t("stSummaryGrace", { count: summary.grace }), "text-foreground"],
          [t("stSummaryHoldover", { count: summary.holdover }), "text-foreground"],
          ...(summary.outOfService ? [[t("stSummaryOutOfService", { count: summary.outOfService }), "text-foreground"]] : []),
        ].map(([label, className]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className={`text-lg font-semibold tabular-nums ${className}`}>{label}</p>
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
        <>
          <div role="group" aria-label={t("stUnitsHeading")} className="flex flex-wrap gap-2">
            {filters.map(([value, label]) => (
              <Button
                key={value}
                aria-pressed={filter === value}
                variant={filter === value ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          {filter !== "free" && (
            <section className="space-y-3" aria-labelledby="storage-requests-heading">
              <h2 id="storage-requests-heading" className="text-base font-semibold">{t("stRequestsHeading")}</h2>
              {requests.length === 0
                ? <p className="text-sm text-muted-foreground">{t("stRequestsEmpty")}</p>
                : requests.map((rental) => <StorageRequestCard key={rental.id} rental={rental} onDone={refetch} />)}
            </section>
          )}

          <section className="space-y-4" aria-labelledby="storage-units-heading">
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
                <h3 className="text-sm font-medium text-muted-foreground">
                  {t("stListingUnits", { name: group.listingName, count: group.rows.length })}
                  {group.kitchenName ? ` · ${group.kitchenName}` : ""}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.rows.map((row) => <StorageUnitCard key={row.key} row={row} onDone={refetch} />)}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
