import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, MapPin, Search, User, X } from "@/components/ui/manager-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthHeaders } from "@/lib/api";
import { filterManagerStorageBookings, inheritStorageChef, type ManagerStorageBooking } from "@/lib/manager-storage-bookings";
import { mt } from "@/i18n/manager";
import { StorageExtensionApprovals } from "@/components/manager/StorageExtensionApprovals";
import { VisitAssistancePanel } from '@/components/booking/VisitAssistancePanel';

const statusClass: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  confirmed: "bg-emerald-100 text-emerald-800 border-emerald-300",
  completed: "bg-blue-100 text-blue-800 border-blue-300",
  cancelled: "bg-red-100 text-red-800 border-red-300",
  cancellation_requested: "bg-orange-100 text-orange-800 border-orange-300",
};

interface ManagerStorageBookingsPageProps {
  onOpenOverstays: () => void;
  onOpenInspections: () => void;
}

export default function ManagerStorageBookingsPage({ onOpenOverstays, onOpenInspections }: ManagerStorageBookingsPageProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [assistanceId, setAssistanceId] = useState<number | null>(null);
  const [focusedBookingId, setFocusedBookingId] = useState(() => Number(new URLSearchParams(window.location.search).get("storageBooking")) || null);
  useEffect(() => {
    const sync = () => setFocusedBookingId(Number(new URLSearchParams(window.location.search).get("storageBooking")) || null);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const { bookings: parentBookings, isLoadingBookings: loadingParents } = useManagerDashboard();
  const { data: storageRows = [], isLoading, error, refetch } = useQuery<ManagerStorageBooking[]>({
    queryKey: ["/api/manager/storage-bookings"],
    queryFn: async () => {
      const response = await fetch("/api/manager/storage-bookings", {
        headers: await getAuthHeaders(),
        credentials: "include",
      });
      if (!response.ok) throw new Error(mt("failedToFetchStorageBookings"));
      return response.json();
    },
  });
  const bookings = useMemo(() => inheritStorageChef(storageRows, parentBookings), [storageRows, parentBookings]);
  const { data: availableActions } = useQuery({
    queryKey: ["/api/manager/storage-operations-availability"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const paths = [
        "/api/manager/overstays?includeAll=true",
        "/api/manager/storage-checkouts/pending",
        "/api/manager/storage-checkouts/history?limit=1",
        "/api/manager/storage-checkins/history?limit=1",
      ];
      const responses = await Promise.all(paths.map((path) => fetch(path, { headers, credentials: "include" })));
      if (responses.some((response) => !response.ok)) throw new Error("Unable to load storage actions");
      const [penalties, pending, checkoutHistory, checkinHistory] = await Promise.all(responses.map((response) => response.json()));
      return {
        overstays: (penalties.overstays?.length ?? 0) + (penalties.pastOverstays?.length ?? 0) > 0,
        inspections: (pending.pendingCheckouts?.length ?? 0) + (checkoutHistory.checkoutHistory?.length ?? 0) + (checkinHistory.checkinHistory?.length ?? 0) > 0,
      };
    },
    staleTime: 30_000,
  });

  const filteredBookings = useMemo(() => {
    const inStatus = filterManagerStorageBookings(bookings, statusFilter, "all").filter((booking) => !focusedBookingId || booking.id === focusedBookingId);
    const query = searchQuery.trim().toLowerCase();
    if (!query) return inStatus;
    return inStatus.filter((booking) => [
      booking.referenceCode, booking.id, booking.storageName, booking.storageType,
      booking.kitchenName, booking.locationName, booking.chefName,
    ].join(" ").toLowerCase().includes(query));
  }, [bookings, statusFilter, searchQuery, focusedBookingId]);
  const columns = useMemo<ColumnDef<ManagerStorageBooking>[]>(() => [
    {
      accessorKey: "createdAt",
      header: () => null,
      cell: () => null,
    },
    {
      accessorKey: "referenceCode",
      header: mt("ref"),
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">#{row.original.referenceCode || row.original.id}</span>,
    },
    {
      accessorKey: "storageName",
      header: ({ column }) => (
        <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          {mt("navStorage")}<ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.storageName}</div>
          <div className="text-xs text-muted-foreground">{row.original.storageType}</div>
        </div>
      ),
    },
    {
      accessorKey: "locationName",
      header: mt("location2"),
      cell: ({ row }) => (
        <div>
          <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{row.original.locationName}</div>
          <div className="ml-5 text-xs text-muted-foreground">{row.original.kitchenName}</div>
        </div>
      ),
    },
    {
      accessorKey: "chefName",
      header: mt("chefHeader"),
      cell: ({ row }) => <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-muted-foreground" />{row.original.chefName}</span>,
    },
    {
      accessorKey: "startDate",
      header: mt("rentalPeriod"),
      cell: ({ row }) => {
        const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
        return <span>{formatDate(row.original.startDate)} – {formatDate(row.original.endDate)}</span>;
      },
    },
    {
      accessorKey: "status",
      header: mt("status"),
      cell: ({ row }) => <Badge variant="outline" className={statusClass[row.original.status]}>{mt(`storageStatus_${row.original.status}`)}</Badge>,
    },
    {
      accessorKey: "totalPrice",
      header: mt("total"),
      cell: ({ row }) => new Intl.NumberFormat(undefined, { style: "currency", currency: row.original.currency }).format(Number(row.original.totalPrice) / 100),
    },
    { id: 'assistance', header: 'Visit help', cell: ({ row }) => row.original.updatedAt && ['confirmed', 'cancellation_requested', 'completed'].includes(row.original.status)
      ? <Button variant="outline" size="sm" onClick={() => setAssistanceId(row.original.id)}>Assistance / removal</Button> : null },
  ], []);

  return (
    <div className="space-y-6">
      {assistanceId && bookings.find(booking => booking.id === assistanceId)?.updatedAt && <VisitAssistancePanel
        key={assistanceId} storage bookingId={assistanceId} updatedAt={bookings.find(booking => booking.id === assistanceId)!.updatedAt!}
        history={bookings.find(booking => booking.id === assistanceId)?.assistanceHistory}
        onSaved={async () => { await refetch(); }} />}
      {(availableActions?.overstays || availableActions?.inspections) && (
        <div className="flex flex-wrap gap-2">
          {availableActions.overstays && <Button variant="outline" size="sm" onClick={onOpenOverstays}>{mt("navOverstayPenalties")}</Button>}
          {availableActions.inspections && <Button variant="outline" size="sm" onClick={onOpenInspections}>{mt("navStorageInspections")}</Button>}
        </div>
      )}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        {focusedBookingId && <Button variant="outline" size="sm" onClick={() => {
          setFocusedBookingId(null);
          const url = new URL(window.location.href); url.searchParams.delete("storageBooking"); window.history.replaceState({}, "", url);
        }}>{mt("viewAll")}<X className="ml-2 size-3" /></Button>}
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={mt("searchStorageBookings")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9 pr-8"
          />
          {searchQuery && <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-1/2 h-7 w-7 -translate-y-1/2"
            onClick={() => setSearchQuery("")}
            aria-label={mt("clearSearch")}
          ><X className="h-3 w-3" /></Button>}
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["all", mt("filterAll")],
          ["upcoming", mt("upcoming")],
          ["past", mt("past")],
          ["pending", mt("pending")],
          ["cancelled", mt("cancelled")],
        ].map(([value, label]) => {
          const isActive = statusFilter === value;
          return <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            aria-pressed={isActive}
            className={isActive
              ? "rounded-xl border border-primary bg-primary/[0.04] p-4 text-left transition-colors"
              : "rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"}
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{filterManagerStorageBookings(bookings, value, "all").length}</p>
          </button>;
        })}
      </div>
      {error ? (
        <Card className="border-destructive/40"><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-destructive">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>{mt("retry")}</Button>
        </CardContent></Card>
      ) : isLoading || loadingParents ? (
        <div className="space-y-3" role="status" aria-label="Loading storage bookings">
          <Skeleton className="h-11 w-full rounded-xl" />
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : bookings.length === 0 ? (
        <Card><CardContent className="py-10 text-center">
          <p className="font-medium">{mt("storageBookingsEmptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{mt("storageBookingsEmptyBody")}</p>
        </CardContent></Card>
      ) : (
        <DataTable
          columns={columns}
          data={filteredBookings}
          defaultSorting={[{ id: "createdAt", desc: true }]}
          initialColumnVisibility={{ createdAt: false }}
          pageSize={15}
        />
      )}
      <StorageExtensionApprovals />
    </div>
  );
}
