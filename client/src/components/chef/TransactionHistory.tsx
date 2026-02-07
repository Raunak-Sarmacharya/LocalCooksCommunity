/**
 * Transaction History Component
 * 
 * Industry-standard transaction history view for chefs.
 * Shows all payments: kitchen bookings, storage extensions, damage claims, overstay penalties.
 * Inspired by Uber/Airbnb payment history patterns.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
// date-fns format removed — using toLocaleDateString with timeZone for timezone-aware display
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle,
  CreditCard,
  RefreshCw,
  Building2,
  Package,
  DollarSign,
  ArrowUpDown,
  Calendar,
  Receipt,
  ChefHat,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// Types
interface Transaction {
  id: number;
  bookingId: number;
  bookingType: 'kitchen' | 'storage' | 'equipment' | 'bundle';
  amount: number;
  baseAmount: number;
  serviceFee: number;
  netAmount: number;
  refundAmount: number;
  currency: string;
  status: string;
  stripeStatus: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  refundId: string | null;
  refundReason: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  itemName: string | null;
  locationName: string | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  metadata: Record<string, unknown> | null;
}

type TransactionViewType = "all" | "succeeded" | "refunded" | "pending" | "canceled";

// Helper functions
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100);
}

function getStatusBadge(status: string, refundAmount: number) {
  if (status === 'refunded' || (status === 'partially_refunded' && refundAmount > 0)) {
    return (
      <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
        {status === 'partially_refunded' ? 'Partial Refund' : 'Refunded'}
      </Badge>
    );
  }
  if (status === 'succeeded') {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
        Completed
      </Badge>
    );
  }
  if (status === 'pending' || status === 'processing') {
    return (
      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
        {status === 'processing' ? 'Processing' : 'Pending'}
      </Badge>
    );
  }
  if (status === 'canceled') {
    return (
      <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
        No Charge
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        Failed
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

function getBookingTypeIcon(type: string) {
  switch (type) {
    case 'kitchen':
      return <ChefHat className="h-4 w-4 text-orange-600" />;
    case 'storage':
      return <Package className="h-4 w-4 text-purple-600" />;
    case 'equipment':
      return <Building2 className="h-4 w-4 text-blue-600" />;
    default:
      return <Receipt className="h-4 w-4 text-gray-600" />;
  }
}

function getBookingTypeLabel(type: string, metadata: Record<string, unknown> | null): string {
  // Check metadata for specific transaction types
  if (metadata) {
    if (metadata.damage_claim_id) return 'Damage Claim';
    if (metadata.overstay_id) return 'Overstay Penalty';
    if (metadata.storage_extension_id) return 'Storage Extension';
  }
  
  switch (type) {
    case 'kitchen':
      return 'Kitchen Booking';
    case 'storage':
      return 'Storage Booking';
    case 'equipment':
      return 'Equipment Rental';
    case 'bundle':
      return 'Bundle Booking';
    default:
      return type;
  }
}

// Column definitions
function getTransactionColumns(): ColumnDef<Transaction>[] {
  return [
    {
      accessorKey: "paidAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 -ml-3"
        >
          Date
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const tx = row.original;
        const date = tx.paidAt || tx.createdAt;
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm font-medium">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/St_Johns' })}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/St_Johns' })}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "bookingType",
      header: "Type",
      cell: ({ row }) => {
        const tx = row.original;
        const label = getBookingTypeLabel(tx.bookingType, tx.metadata);
        return (
          <div className="flex items-center gap-2">
            {getBookingTypeIcon(tx.bookingType)}
            <span className="text-sm font-medium">{label}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "itemName",
      header: "Details",
      cell: ({ row }) => {
        const tx = row.original;
        return (
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {tx.itemName || 'N/A'}
            </div>
            {tx.locationName && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {tx.locationName}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "amount",
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
        const tx = row.original;
        const hasRefund = tx.refundAmount > 0;
        const isVoidedAuth = tx.status === 'canceled';
        
        if (isVoidedAuth) {
          return (
            <div className="text-right">
              <div className="font-medium text-sm text-muted-foreground">No Charge</div>
              {tx.amount > 0 && (
                <div className="text-xs text-gray-400 line-through">
                  {formatCurrency(tx.amount)}
                </div>
              )}
            </div>
          );
        }
        
        return (
          <div className="text-right">
            <div className="font-medium text-sm flex items-center justify-end gap-1">
              <DollarSign className="h-3 w-3 text-muted-foreground" />
              {formatCurrency(tx.amount)}
            </div>
            {hasRefund && (
              <div className="text-xs text-purple-600">
                -{formatCurrency(tx.refundAmount)} refunded
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const tx = row.original;
        return getStatusBadge(tx.status, tx.refundAmount);
      },
    },
  ];
}

// Main Component
export function TransactionHistory() {
  const [viewType, setViewType] = useState<TransactionViewType>("all");
  const [bookingTypeFilter, setBookingTypeFilter] = useState<string>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "paidAt", desc: true }]);

  // Fetch transactions
  const { data, isLoading, error, refetch } = useQuery<{ transactions: Transaction[]; total: number }>({
    queryKey: ['/api/chef/transactions', bookingTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (bookingTypeFilter !== 'all') {
        params.append('bookingType', bookingTypeFilter);
      }
      params.append('limit', '100');
      
      const response = await apiRequest('GET', `/api/chef/transactions?${params.toString()}`);
      return response.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const transactions = data?.transactions || [];

  // Categorize transactions
  const { succeededTx, refundedTx, pendingTx, canceledTx } = useMemo(() => {
    const succeeded = transactions.filter(t => t.status === 'succeeded' && t.refundAmount === 0);
    const refunded = transactions.filter(t => 
      t.status === 'refunded' || t.status === 'partially_refunded' || t.refundAmount > 0
    );
    const pending = transactions.filter(t => 
      t.status === 'pending' || t.status === 'processing'
    );
    const canceled = transactions.filter(t => t.status === 'canceled');
    return { succeededTx: succeeded, refundedTx: refunded, pendingTx: pending, canceledTx: canceled };
  }, [transactions]);

  // Get current view data
  const currentViewData = useMemo(() => {
    if (viewType === "succeeded") return succeededTx;
    if (viewType === "refunded") return refundedTx;
    if (viewType === "pending") return pendingTx;
    if (viewType === "canceled") return canceledTx;
    return transactions;
  }, [viewType, succeededTx, refundedTx, pendingTx, canceledTx, transactions]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalPaid = transactions
      .filter(t => t.status === 'succeeded' || t.status === 'partially_refunded')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalRefunded = transactions.reduce((sum, t) => sum + t.refundAmount, 0);
    return { totalPaid, totalRefunded, netTotal: totalPaid - totalRefunded };
  }, [transactions]);

  // Column definitions
  const columns = useMemo(() => getTransactionColumns(), []);

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
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Error loading transactions: {(error as Error).message}</p>
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
          <CreditCard className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transaction History</h1>
          <p className="text-sm text-muted-foreground">
            View all your payments and refunds
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="text-xl font-bold text-green-700">{formatCurrency(totals.totalPaid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <RefreshCw className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Refunded</p>
                <p className="text-xl font-bold text-purple-700">{formatCurrency(totals.totalRefunded)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Total</p>
                <p className="text-xl font-bold text-blue-700">{formatCurrency(totals.netTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Card with Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Transactions
              </CardTitle>
              <CardDescription>
                {table.getFilteredRowModel().rows.length} of {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={bookingTypeFilter} onValueChange={setBookingTypeFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="kitchen">Kitchen Bookings</SelectItem>
                  <SelectItem value="storage">Storage</SelectItem>
                  <SelectItem value="equipment">Equipment</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* View Type Tabs */}
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as TransactionViewType)} className="w-full">
            <TabsList className="w-full flex flex-wrap gap-1 h-auto p-1">
              <TabsTrigger value="all" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                All
                <Badge variant="secondary" className="ml-1">{transactions.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="succeeded" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                <span className="hidden sm:inline">Completed</span>
                <span className="sm:hidden">Done</span>
                <Badge variant="secondary" className="ml-1">{succeededTx.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="refunded" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                <span className="hidden sm:inline">Refunded</span>
                <span className="sm:hidden">Refund</span>
                <Badge variant="secondary" className="ml-1">{refundedTx.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                Pending
                <Badge variant="secondary" className="ml-1">{pendingTx.length}</Badge>
              </TabsTrigger>
              {canceledTx.length > 0 && (
                <TabsTrigger value="canceled" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                  <span className="hidden sm:inline">No Charge</span>
                  <span className="sm:hidden">Void</span>
                  <Badge variant="secondary" className="ml-1">{canceledTx.length}</Badge>
                </TabsTrigger>
              )}
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
                        row.original.status === "succeeded" && row.original.refundAmount === 0 && "bg-green-50/30",
                        (row.original.status === "refunded" || row.original.refundAmount > 0) && "bg-purple-50/30",
                        (row.original.status === "pending" || row.original.status === "processing") && "bg-yellow-50/30",
                        row.original.status === "canceled" && "bg-gray-50/40"
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
                        <Receipt className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium">No Transactions</p>
                        <p className="text-sm text-muted-foreground">
                          {viewType === "all" 
                            ? "You haven't made any payments yet."
                            : `No ${viewType} transactions to display.`}
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

export default TransactionHistory;
