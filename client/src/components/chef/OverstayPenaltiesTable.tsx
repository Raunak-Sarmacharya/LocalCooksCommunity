import { logger } from "@/lib/logger";
/**
 * Overstay Penalties Table Component
 * 
 * Chef interface for viewing overstay penalties using TanStack Table.
 * Matches the UI style of PendingDamageClaims for consistency.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  CreditCard,
  RefreshCw,
  Building2,
  Package,
  DollarSign,
  ArrowUpDown,
  Calendar,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Types
interface OverstayPenalty {
  overstayId: number;
  storageBookingId: number;
  status: string;
  daysOverdue: number;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  detectedAt: string;
  penaltyApprovedAt: string;
  chargeSucceededAt?: string | null;
  storageName: string;
  storageType: string;
  kitchenName: string;
  bookingEndDate: string;
  penaltyAmountCents: number;
  penaltyTaxCents?: number;
  penaltyTotalCents?: number;
  kitchenTaxRatePercent?: number;
  isResolved?: boolean;
  isPaid?: boolean;
}

type PenaltyViewType = "all" | "pending" | "resolved";

// Helper functions
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100);
}

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    logger.error('Error getting Firebase token:', error);
  }
  return {
    'Content-Type': 'application/json',
  };
}

function getStatusBadge(penalty: OverstayPenalty) {
  if (penalty.chargeSucceededAt || penalty.isPaid) {
    return <Badge variant="success">Paid</Badge>;
  }
  if (penalty.isResolved) {
    return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border">Resolved</Badge>;
  }
  if (penalty.status === 'escalated') {
    return <Badge variant="destructive">Action Required</Badge>;
  }
  if (penalty.status === 'charge_failed') {
    return <Badge variant="destructive">Payment Failed</Badge>;
  }
  if (penalty.status === 'charge_pending') {
    return <Badge variant="warning">Processing</Badge>;
  }
  return <Badge variant="destructive">Payment Required</Badge>;
}

// Column definitions
function getOverstayPenaltyColumns(
  onPay: (penalty: OverstayPenalty) => void,
  payingId: number | null
): ColumnDef<OverstayPenalty>[] {
  return [
    {
      accessorKey: "detectedAt",
      header: () => null,
      cell: () => null,
      enableHiding: true,
    },
    {
      accessorKey: "storageName",
      header: "Storage",
      cell: ({ row }) => {
        const penalty = row.original;
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-purple-600" />
              <span className="font-medium text-sm">{penalty.storageName}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" />
              <span>{penalty.kitchenName}</span>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "storageType",
      header: "Type",
      cell: ({ row }) => {
        const type = row.getValue("storageType") as string;
        return (
          <Badge variant="outline" className="capitalize">
            {type}
          </Badge>
        );
      },
    },
    {
      accessorKey: "daysOverdue",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 -ml-3"
        >
          Days Overdue
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const days = row.getValue("daysOverdue") as number;
        return (
          <Badge variant={days > 7 ? "destructive" : "secondary"} className="text-xs">
            {days} day{days !== 1 ? 's' : ''}
          </Badge>
        );
      },
    },
    {
      accessorKey: "bookingEndDate",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 -ml-3"
        >
          Booking Ended
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            {format(new Date(row.getValue("bookingEndDate")), 'MMM d, yyyy')}
          </div>
        );
      },
    },
    {
      accessorKey: "penaltyAmountCents",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 justify-end w-full"
        >
          Amount
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const penalty = row.original;
        const base = penalty.penaltyAmountCents;
        const total = penalty.penaltyTotalCents ?? base;
        const taxRate = penalty.kitchenTaxRatePercent ?? 0;
        return (
          <div className="text-right">
            <div className="font-medium text-sm flex items-center justify-end gap-1">
              <DollarSign className="h-3 w-3 text-muted-foreground" />
              {formatCurrency(total)}
            </div>
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
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const penalty = row.original;
        const canPay = !penalty.isResolved && !penalty.isPaid && !penalty.chargeSucceededAt;

        if (!canPay) {
          return null;
        }

        const isThisPaying = payingId === penalty.overstayId;

        return (
          <Button
            size="sm"
            onClick={() => onPay(penalty)}
            disabled={payingId !== null}
            className="bg-orange-600 hover:bg-orange-700"
          >
            <CreditCard className="h-4 w-4 mr-1" />
            {isThisPaying ? 'Processing...' : 'Pay Now'}
          </Button>
        );
      },
    },
  ];
}

// Main Component
export function OverstayPenaltiesTable() {
  const [viewType, setViewType] = useState<PenaltyViewType>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "detectedAt", desc: true }]);

  // Fetch penalties
  const { data: penalties = [], isLoading, error, refetch } = useQuery<OverstayPenalty[]>({
    queryKey: ['/api/chef/overstay-penalties'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/overstay-penalties', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch penalties');
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Pay penalty mutation
  const payMutation = useMutation({
    mutationFn: async (overstayId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/chef/overstay-penalties/${overstayId}/pay`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create payment session');
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        // Safety: ensure Radix UI hasn't left pointer-events:none on body
        document.body.style.pointerEvents = '';
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to initiate payment');
    },
  });

  // Categorize penalties
  const { pendingPenalties, resolvedPenalties } = useMemo(() => {
    const pending = penalties.filter(p => !p.isResolved && !p.isPaid && !p.chargeSucceededAt);
    const resolved = penalties.filter(p => p.isResolved || p.isPaid || p.chargeSucceededAt);
    return { pendingPenalties: pending, resolvedPenalties: resolved };
  }, [penalties]);

  // Get current view data
  const currentViewData = useMemo(() => {
    if (viewType === "pending") return pendingPenalties;
    if (viewType === "resolved") return resolvedPenalties;
    return penalties;
  }, [viewType, pendingPenalties, resolvedPenalties, penalties]);

  // Track which specific penalty is being paid
  const payingId = payMutation.isPending ? (payMutation.variables ?? null) : null;

  // Column definitions
  const columns = useMemo(
    () => getOverstayPenaltyColumns(
      (penalty) => payMutation.mutate(penalty.overstayId),
      payingId
    ),
    [payingId]
  );

  // TanStack Table instance
  const table = useReactTable({
    data: currentViewData,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnVisibility: { detectedAt: false },
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Error loading overstay penalties: {(error as Error).message}</p>
          <Button onClick={() => refetch()} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Urgent Penalties Alert */}
      {pendingPenalties.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
          <div>
            <h4 className="font-medium text-orange-800">Payment Required</h4>
            <p className="text-sm text-orange-700">
              You have {pendingPenalties.length} overstay penalty{pendingPenalties.length !== 1 ? 'ies' : 'y'} requiring payment.
              Please pay to maintain good standing.
            </p>
          </div>
        </div>
      )}

      {/* Main Card with Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Overstay Penalties
              </CardTitle>
              <CardDescription>
                {table.getFilteredRowModel().rows.length} of {penalties.length} penalty{penalties.length !== 1 ? 'ies' : 'y'}
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* View Type Tabs */}
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as PenaltyViewType)} className="w-full">
            <TabsList className="w-full gap-1">
              <TabsTrigger value="all" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                All
                <Badge variant="count" className="ml-1">{penalties.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                Pending
                <Badge variant="count" className="ml-1">{pendingPenalties.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="resolved" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                Resolved
                <Badge variant="count" className="ml-1">{resolvedPenalties.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className={cn(
                        "hover:bg-muted/50",
                        !row.original.isResolved && !row.original.isPaid && !row.original.chargeSucceededAt && "bg-orange-50/50",
                        (row.original.isPaid || row.original.chargeSucceededAt) && "bg-green-50/30"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-3">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CheckCircle className="h-8 w-8 text-green-500" />
                        <p className="text-sm font-medium">No Overstay Penalties</p>
                        <p className="text-sm text-muted-foreground">
                          {viewType === "all" 
                            ? "You don't have any overstay penalties."
                            : `No ${viewType} penalties to display.`}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default OverstayPenaltiesTable;
