/**
 * Admin Damage Claims History
 *
 * Full history of ALL damage claims across all managers/locations.
 * TanStack Table with sorting (default: createdAt DESC), filtering, pagination.
 * Detail sheet with full audit trail timeline, evidence, Stripe details, and booking context.
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
  FileWarning,
  ImageIcon,
  RefreshCw,
  Search,
  User,
} from "lucide-react";
import { formatDate as sharedFormatDate, formatCurrency as sharedFormatCurrency, formatPrice, downloadCSV as sharedDownloadCSV } from "@/lib/formatters";

// ============================================================================
// Types
// ============================================================================

interface DamageClaim {
  id: number;
  bookingType: string;
  kitchenBookingId: number | null;
  storageBookingId: number | null;
  chefId: number;
  managerId: number;
  locationId: number;
  status: string;
  claimTitle: string;
  claimDescription: string;
  damageDate: string;
  claimedAmountCents: number;
  approvedAmountCents: number | null;
  finalAmountCents: number | null;
  chefResponse: string | null;
  chefRespondedAt: string | null;
  chefResponseDeadline: string;
  adminReviewerId: number | null;
  adminReviewedAt: string | null;
  adminNotes: string | null;
  adminDecisionReason: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  chargeAttemptedAt: string | null;
  chargeSucceededAt: string | null;
  chargeFailedAt: string | null;
  chargeFailureReason: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  resolvedAt: string | null;
  resolvedBy: number | null;
  resolutionType: string | null;
  resolutionNotes: string | null;
  damagedItems: unknown[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  locationName: string;
  chefEmail: string | null;
  chefName: string | null;
  managerEmail: string | null;
  managerName: string | null;
  adminReviewerEmail: string | null;
}

interface ClaimHistoryEvent {
  id: number;
  damageClaimId: number;
  previousStatus: string | null;
  newStatus: string;
  action: string;
  actionBy: string;
  actionByUserId: number | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actionByEmail: string | null;
}

interface EvidenceItem {
  id: number;
  damageClaimId: number;
  evidenceType: string;
  fileUrl: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  description: string | null;
  uploadedBy: number;
  uploadedAt: string;
  amountCents: number | null;
  vendorName: string | null;
  uploadedByEmail: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

const formatCurrency = sharedFormatCurrency;
const formatDateSt = sharedFormatDate;

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
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "warning" },
  chef_accepted: { label: "Chef Accepted", variant: "secondary" },
  chef_disputed: { label: "Chef Disputed", variant: "destructive" },
  under_review: { label: "Under Review", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  partially_approved: { label: "Partially Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  charge_pending: { label: "Charge Pending", variant: "warning" },
  charge_succeeded: { label: "Paid", variant: "success" },
  charge_failed: { label: "Charge Failed", variant: "destructive" },
  resolved: { label: "Resolved", variant: "success" },
  expired: { label: "Expired", variant: "outline" },
  escalated: { label: "Escalated", variant: "destructive" },
};

function getStatusBadge(status: string) {
  const config = STATUS_CONFIG[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

const TIMELINE_COLORS: Record<string, string> = {
  draft: "bg-gray-400",
  submitted: "bg-blue-500",
  chef_accepted: "bg-green-500",
  chef_disputed: "bg-red-500",
  under_review: "bg-orange-500",
  approved: "bg-green-600",
  partially_approved: "bg-yellow-500",
  rejected: "bg-red-600",
  charge_pending: "bg-blue-400",
  charge_succeeded: "bg-green-600",
  charge_failed: "bg-red-500",
  resolved: "bg-green-400",
  expired: "bg-gray-500",
  escalated: "bg-red-700",
};

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  photo_before: "Photo (Before)",
  photo_after: "Photo (After)",
  receipt: "Receipt",
  invoice: "Invoice",
  video: "Video",
  document: "Document",
  third_party_report: "Third-Party Report",
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

function getColumns(onViewDetails: (c: DamageClaim) => void): ColumnDef<DamageClaim>[] {
  return [
    {
      accessorKey: "id",
      header: "ID",
      size: 60,
      cell: ({ row }) => <span className="font-mono text-xs">#{row.original.id}</span>,
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Created <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="text-xs">{formatDateTimeSt(row.original.createdAt)}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original.status),
      filterFn: "equals",
    },
    {
      accessorKey: "claimTitle",
      header: "Claim",
      cell: ({ row }) => (
        <div className="max-w-[160px]">
          <div className="text-sm font-medium truncate">{row.original.claimTitle}</div>
          <div className="text-xs text-muted-foreground">{row.original.bookingType === "kitchen" ? "Kitchen" : "Storage"}</div>
        </div>
      ),
    },
    {
      accessorKey: "chefName",
      header: "Chef",
      cell: ({ row }) => (
        <div className="max-w-[130px]">
          <div className="text-sm font-medium truncate">{row.original.chefName || "—"}</div>
          <div className="text-xs text-muted-foreground truncate">{row.original.chefEmail || ""}</div>
        </div>
      ),
    },
    {
      accessorKey: "managerName",
      header: "Manager",
      cell: ({ row }) => (
        <div className="max-w-[130px]">
          <div className="text-sm truncate">{row.original.managerName || "—"}</div>
        </div>
      ),
    },
    {
      accessorKey: "locationName",
      header: "Location",
      cell: ({ row }) => <span className="text-sm truncate max-w-[120px] block">{row.original.locationName}</span>,
    },
    {
      id: "amount",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          Amount <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      accessorFn: (row) => row.finalAmountCents || row.approvedAmountCents || row.claimedAmountCents || 0,
      cell: ({ row }) => {
        const c = row.original;
        const cents = c.finalAmountCents || c.approvedAmountCents || c.claimedAmountCents || 0;
        return <span className="font-mono text-sm">{formatCurrency(cents)}</span>;
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

function toCSV(claims: DamageClaim[]): string {
  const headers = [
    "ID", "Status", "Booking Type", "Claim Title", "Chef Name", "Chef Email",
    "Manager Name", "Manager Email", "Location",
    "Claimed ($)", "Approved ($)", "Final ($)",
    "Damage Date", "Chef Response", "Admin Decision",
    "Stripe PI", "Stripe Charge",
    "Created At", "Submitted At", "Resolved At", "Resolution Type",
  ];
  const rows = claims.map((c) => [
    c.id, c.status, c.bookingType, c.claimTitle,
    c.chefName || "", c.chefEmail || "",
    c.managerName || "", c.managerEmail || "", c.locationName,
    formatPrice(c.claimedAmountCents),
    formatPrice(c.approvedAmountCents),
    formatPrice(c.finalAmountCents),
    c.damageDate ? new Date(c.damageDate).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    c.chefResponse || "",
    c.adminDecisionReason || "",
    c.stripePaymentIntentId || "",
    c.stripeChargeId || "",
    c.createdAt ? new Date(c.createdAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    c.submittedAt ? new Date(c.submittedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    c.resolvedAt ? new Date(c.resolvedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    c.resolutionType || "",
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

export default function AdminDamageClaimsHistory({ getFirebaseToken: _getFirebaseToken }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [bookingTypeFilter, setBookingTypeFilter] = useState<string>("all");
  const [selectedClaim, setSelectedClaim] = useState<DamageClaim | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch all damage claims
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["/api/admin/damage-claims-history"],
    queryFn: () => adminFetch("/api/admin/damage-claims-history?limit=500"),
    staleTime: 0,
  });

  const claims: DamageClaim[] = useMemo(() => data?.damageClaims || [], [data]);
  const total: number = data?.total || 0;

  // Fetch audit trail when a claim is selected
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["/api/admin/damage-claims-history", selectedClaim?.id, "history"],
    queryFn: () => adminFetch(`/api/admin/damage-claims-history/${selectedClaim!.id}/history`),
    enabled: !!selectedClaim,
    staleTime: 0,
  });

  // Fetch evidence when a claim is selected
  const { data: evidenceData, isLoading: evidenceLoading } = useQuery({
    queryKey: ["/api/admin/damage-claims-history", selectedClaim?.id, "evidence"],
    queryFn: () => adminFetch(`/api/admin/damage-claims-history/${selectedClaim!.id}/evidence`),
    enabled: !!selectedClaim,
    staleTime: 0,
  });

  const history: ClaimHistoryEvent[] = historyData?.history || [];
  const evidence: EvidenceItem[] = evidenceData?.evidence || [];

  // Filter
  const filteredClaims = useMemo(() => {
    let result = claims;
    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (bookingTypeFilter !== "all") {
      result = result.filter((c) => c.bookingType === bookingTypeFilter);
    }
    if (globalFilter) {
      const q = globalFilter.toLowerCase();
      result = result.filter(
        (c) =>
          String(c.id).includes(q) ||
          (c.claimTitle || "").toLowerCase().includes(q) ||
          (c.chefName || "").toLowerCase().includes(q) ||
          (c.chefEmail || "").toLowerCase().includes(q) ||
          (c.managerName || "").toLowerCase().includes(q) ||
          (c.locationName || "").toLowerCase().includes(q) ||
          (c.stripePaymentIntentId || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [claims, statusFilter, bookingTypeFilter, globalFilter]);

  const handleViewDetails = useCallback((c: DamageClaim) => {
    setSelectedClaim(c);
    setSheetOpen(true);
  }, []);

  const columns = useMemo(() => getColumns(handleViewDetails), [handleViewDetails]);

  const table = useReactTable({
    data: filteredClaims,
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
    const csv = toCSV(filteredClaims);
    sharedDownloadCSV(csv, `admin-damage-claims-${new Date().toISOString().split("T")[0]}`);
  }, [filteredClaims]);

  // Stats
  const stats = useMemo(() => {
    const totalClaims = claims.length;
    const escalated = claims.filter((c) => c.status === "escalated").length;
    const paid = claims.filter((c) => c.status === "charge_succeeded").length;
    const pending = claims.filter((c) => ["submitted", "chef_accepted", "chef_disputed", "under_review", "approved", "partially_approved", "charge_pending"].includes(c.status)).length;
    const rejected = claims.filter((c) => c.status === "rejected").length;
    const totalCollected = claims
      .filter((c) => c.status === "charge_succeeded")
      .reduce((sum, c) => sum + (c.finalAmountCents || c.approvedAmountCents || c.claimedAmountCents || 0), 0);
    return { totalClaims, escalated, paid, pending, rejected, totalCollected };
  }, [claims]);

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
          <CardContent><div className="text-2xl font-bold">{stats.totalClaims}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">In Progress</CardTitle></CardHeader>
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
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Rejected</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-gray-500">{stats.rejected}</div></CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search claim, chef, manager, location, PI..."
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
        <Select value={bookingTypeFilter} onValueChange={setBookingTypeFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="kitchen">Kitchen</SelectItem>
            <SelectItem value="storage">Storage</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExportCSV}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredClaims.length} of {total} records
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
                      No damage claims found
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
          {selectedClaim && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <FileWarning className="h-5 w-5" />
                  Damage Claim #{selectedClaim.id}
                </SheetTitle>
              </SheetHeader>

              <div className="space-y-6 mt-4">
                {/* Status + Key Info */}
                <div className="flex items-center gap-2 flex-wrap">
                  {getStatusBadge(selectedClaim.status)}
                  <Badge variant="outline">{selectedClaim.bookingType === "kitchen" ? "Kitchen" : "Storage"}</Badge>
                  {selectedClaim.resolutionType && <Badge variant="secondary">{selectedClaim.resolutionType}</Badge>}
                </div>

                {/* Claim Details */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Claim Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-y-1.5">
                      <span className="text-muted-foreground">Title</span><span className="font-medium">{selectedClaim.claimTitle}</span>
                      <span className="text-muted-foreground">Damage Date</span><span>{formatDateSt(selectedClaim.damageDate)}</span>
                      <span className="text-muted-foreground">Booking ID</span>
                      <span>#{selectedClaim.bookingType === "kitchen" ? selectedClaim.kitchenBookingId : selectedClaim.storageBookingId}</span>
                      <span className="text-muted-foreground">Location</span><span>{selectedClaim.locationName}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Description</span>
                      <p className="text-sm mt-1 bg-muted/50 rounded p-2">{selectedClaim.claimDescription}</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Parties */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><User className="h-4 w-4" /> Parties</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Chef</span><span>{selectedClaim.chefName || "—"}</span>
                    <span className="text-muted-foreground">Chef Email</span>
                    <span className="text-xs font-mono truncate">{selectedClaim.chefEmail || "—"}</span>
                    <span className="text-muted-foreground">Chef ID</span><span>#{selectedClaim.chefId}</span>
                    <span className="text-muted-foreground">Manager</span><span>{selectedClaim.managerName || "—"}</span>
                    <span className="text-muted-foreground">Manager Email</span>
                    <span className="text-xs font-mono truncate">{selectedClaim.managerEmail || "—"}</span>
                    {selectedClaim.adminReviewerEmail && (
                      <><span className="text-muted-foreground">Admin Reviewer</span><span className="text-xs font-mono">{selectedClaim.adminReviewerEmail}</span></>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Financial Details */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><DollarSign className="h-4 w-4" /> Financial Details</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Claimed Amount</span><span className="font-mono">{formatCurrency(selectedClaim.claimedAmountCents)}</span>
                    {selectedClaim.approvedAmountCents != null && (
                      <><span className="text-muted-foreground">Approved Amount</span><span className="font-mono">{formatCurrency(selectedClaim.approvedAmountCents)}</span></>
                    )}
                    {selectedClaim.finalAmountCents != null && (
                      <><span className="text-muted-foreground">Final Amount</span><span className="font-mono font-semibold">{formatCurrency(selectedClaim.finalAmountCents)}</span></>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Chef Response */}
                {selectedClaim.chefResponse && (
                  <>
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Chef Response</h4>
                      <p className="text-sm bg-muted/50 rounded p-2">{selectedClaim.chefResponse}</p>
                      {selectedClaim.chefRespondedAt && (
                        <p className="text-xs text-muted-foreground mt-1">Responded: {formatDateTimeSt(selectedClaim.chefRespondedAt)}</p>
                      )}
                    </div>
                    <Separator />
                  </>
                )}

                {/* Admin Decision */}
                {selectedClaim.adminDecisionReason && (
                  <>
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Admin Decision</h4>
                      <p className="text-sm bg-muted/50 rounded p-2">{selectedClaim.adminDecisionReason}</p>
                      {selectedClaim.adminNotes && (
                        <p className="text-sm text-muted-foreground mt-1">Notes: {selectedClaim.adminNotes}</p>
                      )}
                      {selectedClaim.adminReviewedAt && (
                        <p className="text-xs text-muted-foreground mt-1">Reviewed: {formatDateTimeSt(selectedClaim.adminReviewedAt)}</p>
                      )}
                    </div>
                    <Separator />
                  </>
                )}

                {/* Damaged Items */}
                {selectedClaim.damagedItems && Array.isArray(selectedClaim.damagedItems) && selectedClaim.damagedItems.length > 0 && (
                  <>
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Damaged Items</h4>
                      <div className="space-y-2">
                        {(selectedClaim.damagedItems as Array<{ equipmentType?: string; brand?: string; description?: string }>).map((item, i) => (
                          <div key={i} className="bg-muted/50 rounded p-2 text-sm">
                            <div className="font-medium">{item.equipmentType || "Equipment"} {item.brand ? `(${item.brand})` : ""}</div>
                            {item.description && <p className="text-xs text-muted-foreground mt-1">{item.description}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator />
                  </>
                )}

                {/* Evidence */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><ImageIcon className="h-4 w-4" /> Evidence ({evidence.length})</h4>
                  {evidenceLoading ? (
                    <Skeleton className="h-16" />
                  ) : evidence.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No evidence uploaded</p>
                  ) : (
                    <div className="space-y-2">
                      {evidence.map((ev) => (
                        <div key={ev.id} className="bg-muted/50 rounded p-2 text-sm flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">{EVIDENCE_TYPE_LABELS[ev.evidenceType] || ev.evidenceType}</Badge>
                              <span className="text-xs font-medium">{ev.fileName || "File"}</span>
                            </div>
                            {ev.description && <p className="text-xs text-muted-foreground mt-1">{ev.description}</p>}
                            {ev.vendorName && <p className="text-xs text-muted-foreground">Vendor: {ev.vendorName}</p>}
                            {ev.amountCents != null && <p className="text-xs font-mono">Amount: {formatCurrency(ev.amountCents)}</p>}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              By: {ev.uploadedByEmail || `User #${ev.uploadedBy}`} — {formatDateTimeSt(ev.uploadedAt)}
                            </p>
                          </div>
                          {ev.fileUrl && (
                            <a href={ev.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline shrink-0 ml-2">
                              View
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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
                          <span className="font-mono text-xs truncate cursor-help">{selectedClaim.stripePaymentIntentId || "—"}</span>
                        </TooltipTrigger>
                        <TooltipContent><p>{selectedClaim.stripePaymentIntentId || "None"}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground">Charge ID</span>
                    <span className="font-mono text-xs truncate">{selectedClaim.stripeChargeId || "—"}</span>
                    <span className="text-muted-foreground">Customer ID</span>
                    <span className="font-mono text-xs truncate">{selectedClaim.stripeCustomerId || "—"}</span>
                    {selectedClaim.chargeFailureReason && (
                      <><span className="text-muted-foreground text-red-600">Failure Reason</span>
                      <span className="text-red-600 text-xs">{selectedClaim.chargeFailureReason}</span></>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Timestamps */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><Clock className="h-4 w-4" /> Timestamps</h4>
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Created</span><span>{formatDateTimeSt(selectedClaim.createdAt)}</span>
                    {selectedClaim.submittedAt && (
                      <><span className="text-muted-foreground">Submitted</span><span>{formatDateTimeSt(selectedClaim.submittedAt)}</span></>
                    )}
                    <span className="text-muted-foreground">Response Deadline</span><span>{formatDateTimeSt(selectedClaim.chefResponseDeadline)}</span>
                    {selectedClaim.chefRespondedAt && (
                      <><span className="text-muted-foreground">Chef Responded</span><span>{formatDateTimeSt(selectedClaim.chefRespondedAt)}</span></>
                    )}
                    {selectedClaim.adminReviewedAt && (
                      <><span className="text-muted-foreground">Admin Reviewed</span><span>{formatDateTimeSt(selectedClaim.adminReviewedAt)}</span></>
                    )}
                    {selectedClaim.chargeAttemptedAt && (
                      <><span className="text-muted-foreground">Charge Attempted</span><span>{formatDateTimeSt(selectedClaim.chargeAttemptedAt)}</span></>
                    )}
                    {selectedClaim.chargeSucceededAt && (
                      <><span className="text-muted-foreground">Charge Succeeded</span><span>{formatDateTimeSt(selectedClaim.chargeSucceededAt)}</span></>
                    )}
                    {selectedClaim.chargeFailedAt && (
                      <><span className="text-muted-foreground">Charge Failed</span><span>{formatDateTimeSt(selectedClaim.chargeFailedAt)}</span></>
                    )}
                    {selectedClaim.resolvedAt && (
                      <><span className="text-muted-foreground">Resolved</span><span>{formatDateTimeSt(selectedClaim.resolvedAt)}</span></>
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
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{event.actionBy}</Badge>
                                <span className="text-xs text-muted-foreground">{event.action}</span>
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
                            {event.notes && <p className="text-xs text-muted-foreground">{event.notes}</p>}
                            {event.actionByEmail && <p className="text-[10px] text-muted-foreground mt-1">By: {event.actionByEmail}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Resolution Notes */}
                {selectedClaim.resolutionNotes && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Resolution Notes</h4>
                      <p className="text-sm text-muted-foreground">{selectedClaim.resolutionNotes}</p>
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
