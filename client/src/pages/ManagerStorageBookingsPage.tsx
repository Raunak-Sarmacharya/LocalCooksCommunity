import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, MapPin, User } from "@/components/ui/manager-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAuthHeaders } from "@/lib/api";
import { filterManagerStorageBookings, type ManagerStorageBooking } from "@/lib/manager-storage-bookings";
import { mt } from "@/i18n/manager";

const statusClass: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  confirmed: "bg-emerald-100 text-emerald-800 border-emerald-300",
  completed: "bg-blue-100 text-blue-800 border-blue-300",
  cancelled: "bg-red-100 text-red-800 border-red-300",
  cancellation_requested: "bg-orange-100 text-orange-800 border-orange-300",
};

export default function ManagerStorageBookingsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const { data: bookings = [], isLoading, error } = useQuery<ManagerStorageBooking[]>({
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

  const locations = useMemo(
    () => Array.from(new Set(bookings.map(({ locationName }) => locationName))).sort(),
    [bookings],
  );
  const filteredBookings = useMemo(
    () => filterManagerStorageBookings(bookings, statusFilter, locationFilter),
    [bookings, statusFilter, locationFilter],
  );
  const columns = useMemo<ColumnDef<ManagerStorageBooking>[]>(() => [
    {
      accessorKey: "createdAt",
      header: () => null,
      cell: () => null,
    },
    {
      id: "search",
      accessorFn: (row) => [row.referenceCode, row.storageName, row.storageType, row.kitchenName, row.locationName, row.chefName].join(" "),
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
  ], []);

  if (error) {
    return <Card className="border-destructive/40"><CardContent className="py-10 text-center text-destructive">{error.message}</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <label className="sr-only" htmlFor="storage-location-filter">{mt("location2")}</label>
        <select
          id="storage-location-filter"
          value={locationFilter}
          onChange={(event) => setLocationFilter(event.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm sm:w-56"
        >
          <option value="all">{mt("cmdAllLocations")}</option>
          {locations.map((location) => <option key={location} value={location}>{location}</option>)}
        </select>
      </div>
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-5">
          {[
            ["all", mt("filterAll")],
            ["upcoming", mt("upcoming")],
            ["past", mt("past")],
            ["pending", mt("pending")],
            ["cancelled", mt("cancelled")],
          ].map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="rounded-lg py-2 text-xs sm:text-sm">
              {label}<Badge variant="count" className="ml-1">{filterManagerStorageBookings(bookings, value, locationFilter).length}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {isLoading ? (
        <div className="flex justify-center py-16"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" /></div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredBookings}
          filterColumn="search"
          filterPlaceholder={mt("searchStorageBookings")}
          defaultSorting={[{ id: "createdAt", desc: true }]}
          initialColumnVisibility={{ createdAt: false, search: false }}
          pageSize={15}
        />
      )}
    </div>
  );
}
