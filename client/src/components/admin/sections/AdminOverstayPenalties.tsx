/**
 * Admin Overstay Penalties History
 *
 * Full history of ALL overstay penalties across all managers/locations.
 * TanStack Table with sorting (default: detectedAt DESC), filtering, pagination.
 * Detail sheet with full audit trail timeline, Stripe details, and booking context.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowUpDown,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  Eye,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { formatDate as sharedFormatDate, formatCurrency as sharedFormatCurrency, formatPrice, downloadCSV as sharedDownloadCSV } from "@/lib/formatters";

// ============================================================================
// Types
// ============================================================================

interface OverstayPenalty {
  id: number;
  storageBookingId: number;
  status: string;
  daysOverdue: number;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  dailyRateCents: number;
  penaltyRate: string;
  penaltyWaived: boolean;
  waiveReason: string | null;
  managerNotes: string | null;
  detectedAt: string;
  bookingEndDate: string;
  gracePeriodEndsAt: string;
  penaltyApprovedAt: string | null;
  penaltyApprovedBy: number | null;
  chargeAttemptedAt: string | null;
  chargeSucceededAt: string | null;
  chargeFailedAt: string | null;
  chargeFailureReason: string | null;
  resolvedAt: string | null;
  resolutionType: string | null;
  resolutionNotes: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  chefWarningSentAt: string | null;
  chefPenaltyNoticeSentAt: string | null;
  managerNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  bookingStartDate: string | null;
  bookingTotalPrice: string | null;
  chefId: number | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  storageName: string;
  storageType: string | null;
  kitchenId: number | null;
  kitchenName: string;
  locationId: number | null;
  locationName: string;
  chefEmail: string | null;
  chefName: string | null;
  managerEmail: string | null;
  managerName: string | null;
  managerId: number | null;
  kitchenTaxRatePercent?: number;
}

interface HistoryEvent {
  id: number;
  overstayRecordId: number;
  previousStatus: string | null;
  newStatus: string;
  eventType: string;
  eventSource: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  createdBy: number | null;
  createdByEmail: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

const formatCurrency = sharedFormatCurrency;
const formatDateSt = sharedFormatDate;

/** Safely parse a PostgreSQL numeric (arrives as string) to a number, defaulting to 0 */
function safeParseNumeric(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

function formatDateTimeSt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      timeZone: "America/St_Johns",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  detected: { label: "Detected", variant: "outline" },
  grace_period: { label: "Grace Period", variant: "secondary" },
  pending_review: { label: "Pending Review", variant: "warning" },
  penalty_approved: { label: "Approved", variant: "success" },
  penalty_waived: { label: "Waived", variant: "secondary" },
  charge_pending: { label: "Charge Pending", variant: "warning" },
  charge_succeeded: { label: "Paid", variant: "success" },
  charge_failed: { label: "Charge Failed", variant: "destructive" },
  resolved: { label: "Resolved", variant: "success" },
  escalated: { label: "Escalated", variant: "destructive" },
};

function getStatusBadge(status: string) {
  const config = STATUS_CONFIG[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

const TIMELINE_COLORS: Record<string, string> = {
  detected: "bg-yellow-500",
  grace_period: "bg-blue-400",
  pending_review: "bg-orange-500",
  penalty_approved: "bg-green-500",
  penalty_waived: "bg-gray-400",
  charge_pending: "bg-blue-500",
  charge_succeeded: "bg-green-600",
  charge_failed: "bg-red-500",
  resolved: "bg-green-400",
  escalated: "bg-red-600",
};

async function adminFetch(url: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Not authenticated");
  const token = await currentUser.getIdToken();
  const res = await fetch(url, {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============================================================================
// Columns
// ============================================================================

function getColumns(onViewDetails: (p: OverstayPenalty) => void): ColumnDef<OverstayPenalty>[] {
  return [
    {
      accessorKey: "id",
      header: "ID",
      size: 60,
      cell: ({ row }) => <span className="font-mono text-xs">#{row.original.id}</span>,
    },
    {
      accessorKey: "detectedAt",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Detected <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="text-xs">{formatDateTimeSt(row.original.detectedAt)}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original.status),
      filterFn: "equals",
    },
    {
      accessorKey: "chefName",
      header: "Chef",
      cell: ({ row }) => (
        <div className="max-w-[140px]">
          <div className="text-sm font-medium truncate">{row.original.chefName || "—"}</div>
          <div className="text-xs text-muted-foreground truncate">{row.original.chefEmail || ""}</div>
        </div>
      ),
    },
    {
      accessorKey: "storageName",
      header: "Storage",
      cell: ({ row }) => (
        <div className="max-w-[140px]">
          <div className="text-sm truncate">{row.original.storageName}</div>
          <div className="text-xs text-muted-foreground truncate">{row.original.kitchenName}</div>
        </div>
      ),
    },
    {
      accessorKey: "locationName",
      header: "Location",
      cell: ({ row }) => <span className="text-sm truncate max-w-[120px] block">{row.original.locationName}</span>,
    },
    {
      accessorKey: "daysOverdue",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Days <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.daysOverdue}</span>,
      size: 70,
    },
    {
      id: "amount",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Amount <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      accessorFn: (row) => {
        const base = row.finalPenaltyCents || row.calculatedPenaltyCents || 0;
        const taxRate = parseFloat(String(row.kitchenTaxRatePercent || 0));
        return taxRate > 0 ? Math.round(base * (1 + taxRate / 100)) : base;
      },
      cell: ({ row }) => {
        const base = row.original.finalPenaltyCents || row.original.calculatedPenaltyCents || 0;
        const taxRate = parseFloat(String(row.original.kitchenTaxRatePercent || 0));
        const total = taxRate > 0 ? Math.round(base * (1 + taxRate / 100)) : base;
        return (
          <div>
            <span className="font-mono text-sm">{formatCurrency(total)}</span>
            {taxRate > 0 && (
              <div className="text-xs text-muted-foreground">
                {formatCurrency(base)} + {taxRate}% tax
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      size: 50,
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => onViewDetails(row.original)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];
}

// ============================================================================
// CSV Export
// ============================================================================

function toCSV(penalties: OverstayPenalty[]): string {
  const headers = [
    "ID", "Status", "Chef Name", "Chef Email", "Storage", "Kitchen", "Location",
    "Days Overdue", "Calculated ($)", "Final ($)", "Waived", "Waive Reason",
    "Stripe PI", "Stripe Charge", "Detected At", "Approved At", "Charged At",
    "Resolved At", "Resolution Type", "Manager Notes",
  ];
  const rows = penalties.map((p) => [
    p.id, p.status, p.chefName || "", p.chefEmail || "", p.storageName, p.kitchenName, p.locationName,
    p.daysOverdue,
    formatPrice(p.calculatedPenaltyCents),
    formatPrice(p.finalPenaltyCents),
    p.penaltyWaived ? "Yes" : "No",
    p.waiveReason || "",
    p.stripePaymentIntentId || "",
    p.stripeChargeId || "",
    p.detectedAt ? new Date(p.detectedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    p.penaltyApprovedAt ? new Date(p.penaltyApprovedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    p.chargeSucceededAt ? new Date(p.chargeSucceededAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    p.resolvedAt ? new Date(p.resolvedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    p.resolutionType || "",
    p.managerNotes || "",
  ]);
  const escape = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}


// ============================================================================
// Component
// ============================================================================

interface Props {
  getFirebaseToken: () => Promise<string>;
}

export default function AdminOverstayPenalties({ getFirebaseToken: _getFirebaseToken }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "detectedAt", desc: true }]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPenalty, setSelectedPenalty] = useState<OverstayPenalty | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch all overstay penalties
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["/api/admin/overstay-penalties"],
    queryFn: () => adminFetch("/api/admin/overstay-penalties?limit=500"),
    staleTime: 0,
  });

  const penalties: OverstayPenalty[] = useMemo(() => data?.overstayPenalties || [], [data]);
  const total: number = data?.total || 0;

  // Fetch audit trail when a penalty is selected
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["/api/admin/overstay-penalties", selectedPenalty?.id, "history"],
    queryFn: () => adminFetch(`/api/admin/overstay-penalties/${selectedPenalty!.id}/history`),
    enabled: !!selectedPenalty,
    staleTime: 0,
  });

  const history: HistoryEvent[] = historyData?.history || [];

  // Filter
  const filteredPenalties = useMemo(() => {
    let result = penalties;
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (globalFilter) {
      const q = globalFilter.toLowerCase();
      result = result.filter(
        (p) =>
          String(p.id).includes(q) ||
          (p.chefName || "").toLowerCase().includes(q) ||
          (p.chefEmail || "").toLowerCase().includes(q) ||
          (p.storageName || "").toLowerCase().includes(q) ||
          (p.kitchenName || "").toLowerCase().includes(q) ||
          (p.locationName || "").toLowerCase().includes(q) ||
          (p.stripePaymentIntentId || "").toLowerCase().includes(q) ||
          (p.managerName || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [penalties, statusFilter, globalFilter]);

  const handleViewDetails = useCallback((p: OverstayPenalty) => {
    setSelectedPenalty(p);
    setSheetOpen(true);
  }, []);

  const columns = useMemo(() => getColumns(handleViewDetails), [handleViewDetails]);

  const table = useReactTable({
    data: filteredPenalties,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: { sorting },
    initialState: { pagination: { pageSize: 25 } },
  });

  const handleExportCSV = useCallback(() => {
    const csv = toCSV(filteredPenalties);
    sharedDownloadCSV(csv, `admin-overstay-penalties-${new Date().toISOString().split("T")[0]}`);
  }, [filteredPenalties]);

  // Stats
  const stats = useMemo(() => {
    const totalPenalties = penalties.length;
    const escalated = penalties.filter((p) => p.status === "escalated").length;
    const paid = penalties.filter((p) => p.status === "charge_succeeded").length;
    const waived = penalties.filter((p) => p.status === "penalty_waived").length;
    const pending = penalties.filter((p) => ["pending_review", "penalty_approved", "charge_pending"].includes(p.status)).length;
    const totalCollected = penalties
      .filter((p) => p.status === "charge_succeeded")
      .reduce((sum, p) => {
        const base = p.finalPenaltyCents || p.calculatedPenaltyCents || 0;
        const taxRate = parseFloat(String(p.kitchenTaxRatePercent || 0));
        return sum + (taxRate > 0 ? Math.round(base * (1 + taxRate / 100)) : base);
      }, 0);
    return { totalPenalties, escalated, paid, waived, pending, totalCollected };
  }, [penalties]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.totalPenalties}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-orange-600">{stats.pending}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Escalated</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{stats.escalated}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Collected</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalCollected)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Waived</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-gray-500">{stats.waived}</div></CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search chef, storage, location, PI..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExportCSV}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredPenalties.length} of {total} records
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id} style={{ width: h.getSize() }}>
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                      No overstay penalties found
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleViewDetails(row.original)}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-xs text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedPenalty && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Overstay Penalty #{selectedPenalty.id}
                </SheetTitle>
              </SheetHeader>

              <div className="space-y-6 mt-4">
                {/* Status + Key Info */}
                <div className="flex items-center gap-2 flex-wrap">
                  {getStatusBadge(selectedPenalty.status)}
                  {selectedPenalty.penaltyWaived && <Badge variant="secondary">Waived</Badge>}
                  {selectedPenalty.resolutionType && <Badge variant="outline">{selectedPenalty.resolutionType}</Badge>}
                </div>

                {/* Booking Details */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Booking Details</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Storage Booking ID</span><span>#{selectedPenalty.storageBookingId}</span>
                    <span className="text-muted-foreground">Storage</span><span>{selectedPenalty.storageName} ({selectedPenalty.storageType || "—"})</span>
                    <span className="text-muted-foreground">Kitchen</span><span>{selectedPenalty.kitchenName}</span>
                    <span className="text-muted-foreground">Location</span><span>{selectedPenalty.locationName}</span>
                    {selectedPenalty.bookingStartDate && (
                      <><span className="text-muted-foreground">Booking Start</span><span>{formatDateSt(selectedPenalty.bookingStartDate)}</span></>
                    )}
                    <span className="text-muted-foreground">Booking End</span><span>{formatDateSt(selectedPenalty.bookingEndDate)}</span>
                    {selectedPenalty.bookingTotalPrice && (
                      <><span className="text-muted-foreground">Booking Price</span><span>{formatCurrency(safeParseNumeric(selectedPenalty.bookingTotalPrice))}</span></>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Parties */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Parties</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Chef</span><span>{selectedPenalty.chefName || "—"}</span>
                    <span className="text-muted-foreground">Chef Email</span>
                    <span className="text-xs font-mono truncate">{selectedPenalty.chefEmail || "—"}</span>
                    <span className="text-muted-foreground">Chef ID</span><span>#{selectedPenalty.chefId || "—"}</span>
                    <span className="text-muted-foreground">Manager</span><span>{selectedPenalty.managerName || "—"}</span>
                    <span className="text-muted-foreground">Manager Email</span>
                    <span className="text-xs font-mono truncate">{selectedPenalty.managerEmail || "—"}</span>
                  </div>
                </div>

                <Separator />

                {/* Financial Details */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><DollarSign className="h-4 w-4" /> Financial Details</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Days Overdue</span><span className="font-mono">{selectedPenalty.daysOverdue}</span>
                    <span className="text-muted-foreground">Daily Rate</span><span className="font-mono">{formatCurrency(selectedPenalty.dailyRateCents)}</span>
                    <span className="text-muted-foreground">Penalty Rate</span><span className="font-mono">{(safeParseNumeric(selectedPenalty.penaltyRate) * 100).toFixed(0)}%</span>
                    <span className="text-muted-foreground">Calculated Penalty</span><span className="font-mono">{formatCurrency(selectedPenalty.calculatedPenaltyCents)}</span>
                    <span className="text-muted-foreground">Final Penalty</span>
                    <span className="font-mono font-semibold">{selectedPenalty.finalPenaltyCents != null ? formatCurrency(selectedPenalty.finalPenaltyCents) : "—"}</span>
                    {(() => {
                      const taxRate = parseFloat(String(selectedPenalty.kitchenTaxRatePercent || 0));
                      if (taxRate <= 0) return null;
                      const base = selectedPenalty.finalPenaltyCents || selectedPenalty.calculatedPenaltyCents || 0;
                      const tax = Math.round((base * taxRate) / 100);
                      return (
                        <>
                          <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                          <span className="font-mono text-amber-600">{formatCurrency(tax)}</span>
                          <span className="text-muted-foreground">Total Charged</span>
                          <span className="font-mono font-semibold text-primary">{formatCurrency(base + tax)}</span>
                        </>
                      );
                    })()}
                    {selectedPenalty.penaltyWaived && (
                      <><span className="text-muted-foreground">Waive Reason</span><span>{selectedPenalty.waiveReason || "—"}</span></>
                    )}
                    {selectedPenalty.managerNotes && (
                      <><span className="text-muted-foreground">Manager Notes</span><span>{selectedPenalty.managerNotes}</span></>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Stripe Details */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><CreditCard className="h-4 w-4" /> Stripe Details</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Payment Intent</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="font-mono text-xs truncate cursor-help">{selectedPenalty.stripePaymentIntentId || "—"}</span>
                        </TooltipTrigger>
                        <TooltipContent><p>{selectedPenalty.stripePaymentIntentId || "None"}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground">Charge ID</span>
                    <span className="font-mono text-xs truncate">{selectedPenalty.stripeChargeId || "—"}</span>
                    <span className="text-muted-foreground">Customer ID</span>
                    <span className="font-mono text-xs truncate">{selectedPenalty.stripeCustomerId || "—"}</span>
                    {selectedPenalty.chargeFailureReason && (
                      <><span className="text-muted-foreground text-red-600">Failure Reason</span>
                      <span className="text-red-600 text-xs">{selectedPenalty.chargeFailureReason}</span></>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Timestamps */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><Clock className="h-4 w-4" /> Timestamps</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Detected</span><span>{formatDateTimeSt(selectedPenalty.detectedAt)}</span>
                    <span className="text-muted-foreground">Grace Period Ends</span><span>{formatDateTimeSt(selectedPenalty.gracePeriodEndsAt)}</span>
                    {selectedPenalty.penaltyApprovedAt && (
                      <><span className="text-muted-foreground">Approved</span><span>{formatDateTimeSt(selectedPenalty.penaltyApprovedAt)}</span></>
                    )}
                    {selectedPenalty.chargeAttemptedAt && (
                      <><span className="text-muted-foreground">Charge Attempted</span><span>{formatDateTimeSt(selectedPenalty.chargeAttemptedAt)}</span></>
                    )}
                    {selectedPenalty.chargeSucceededAt && (
                      <><span className="text-muted-foreground">Charge Succeeded</span><span>{formatDateTimeSt(selectedPenalty.chargeSucceededAt)}</span></>
                    )}
                    {selectedPenalty.chargeFailedAt && (
                      <><span className="text-muted-foreground">Charge Failed</span><span>{formatDateTimeSt(selectedPenalty.chargeFailedAt)}</span></>
                    )}
                    {selectedPenalty.resolvedAt && (
                      <><span className="text-muted-foreground">Resolved</span><span>{formatDateTimeSt(selectedPenalty.resolvedAt)}</span></>
                    )}
                    {selectedPenalty.chefWarningSentAt && (
                      <><span className="text-muted-foreground">Chef Warning Sent</span><span>{formatDateTimeSt(selectedPenalty.chefWarningSentAt)}</span></>
                    )}
                    {selectedPenalty.managerNotifiedAt && (
                      <><span className="text-muted-foreground">Manager Notified</span><span>{formatDateTimeSt(selectedPenalty.managerNotifiedAt)}</span></>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Audit Trail Timeline */}
                <div>
                  <h4 className="text-sm font-semibold mb-3">Audit Trail</h4>
                  {historyLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
                    </div>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No audit history available</p>
                  ) : (
                    <div className="relative pl-6 space-y-4">
                      <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border" />
                      {history.map((event) => (
                        <div key={event.id} className="relative">
                          <div className={`absolute -left-6 top-1 h-[18px] w-[18px] rounded-full border-2 border-background ${TIMELINE_COLORS[event.newStatus] || "bg-gray-400"}`} />
                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{event.eventSource}</Badge>
                                <span className="text-xs text-muted-foreground">{event.eventType}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{formatDateTimeSt(event.createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-1 text-xs mb-1">
                              {event.previousStatus && (
                                <>
                                  <Badge variant="outline" className="text-[10px] px-1">{STATUS_CONFIG[event.previousStatus]?.label || event.previousStatus}</Badge>
                                  <span>→</span>
                                </>
                              )}
                              <Badge variant="secondary" className="text-[10px] px-1">{STATUS_CONFIG[event.newStatus]?.label || event.newStatus}</Badge>
                            </div>
                            {event.description && <p className="text-xs text-muted-foreground">{event.description}</p>}
                            {event.createdByEmail && <p className="text-[10px] text-muted-foreground mt-1">By: {event.createdByEmail}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Resolution */}
                {selectedPenalty.resolutionNotes && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Resolution Notes</h4>
                      <p className="text-sm text-muted-foreground">{selectedPenalty.resolutionNotes}</p>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
