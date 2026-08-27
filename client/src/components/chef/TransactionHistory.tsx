/**
 * Transaction History Component
 * 
 * Industry-standard transaction history view for chefs.
 * Shows all payments: kitchen bookings, storage extensions, damage claims, overstay penalties.
 * Inspired by Uber/Airbnb payment history patterns.
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import { Input } from "@/components/ui/input";
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
  RefreshCw,
  Building2,
  Package,
  DollarSign,
  ArrowUpDown,
  Calendar,
  Receipt,
  ChefHat,
  Search,
  X,
  Hash,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ChefPageHeader, StatTile } from "@/components/chef/ui";

// Types
interface Transaction {
  id: number;
  bookingId: number;
  bookingType: 'kitchen' | 'storage' | 'equipment' | 'bundle';
  referenceCode: string | null;
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

function getStatusBadge(status: string, refundAmount: number, t: any) {
  if (status === 'refunded' || (status === 'partially_refunded' && refundAmount > 0)) {
    return (
      <Badge variant="info">
        {status === 'partially_refunded' ? t("billingPartialRefund", "Partial Refund") : t("billingRefunded", "Refunded")}
      </Badge>
    );
  }
  if (status === 'succeeded') {
    return (
      <Badge variant="success">
        {t("billingCompleted", "Completed")}
      </Badge>
    );
  }
  if (status === 'pending' || status === 'processing') {
    return (
      <Badge variant="warning">
        {status === 'processing' ? t("billingProcessing", "Processing") : t("billingPending", "Pending")}
      </Badge>
    );
  }
  if (status === 'canceled') {
    return (
      <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
        {t("billingNoCharge", "No Charge")}
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="text-destructive border-destructive/30">
        {t("billingFailed", "Failed")}
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

function getBookingTypeIcon(type: string) {
  switch (type) {
    case "kitchen":
      return <ChefHat className="h-4 w-4 text-muted-foreground" />;
    case "storage":
      return <Package className="h-4 w-4 text-muted-foreground" />;
    case "equipment":
      return <Building2 className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Receipt className="h-4 w-4 text-muted-foreground" />;
  }
}

function getBookingTypeLabel(type: string, metadata: Record<string, unknown> | null, t: any): string {
  // Check metadata for specific transaction types
  if (metadata) {
    if (metadata.damage_claim_id) return t("billingDamageClaim", "Damage Claim");
    if (metadata.overstay_id) return t("billingOverstayPenaltyType", "Overstay Penalty");
    if (metadata.storage_extension_id) return t("billingStorageExtension", "Storage Extension");
  }
  
  switch (type) {
    case 'kitchen':
      return t("billingKitchenBooking", "Kitchen Booking");
    case 'storage':
      return t("billingStorageBooking", "Storage Booking");
    case 'equipment':
      return t("billingEquipmentRental", "Equipment Rental");
    case 'bundle':
      return t("billingBundleBooking", "Bundle Booking");
    default:
      return type;
  }
}

// Column definitions
function getTransactionColumns(t: any, language: string): ColumnDef<Transaction>[] {
  return [
    {
      id: "reference",
      header: t("billingRefColumn", { defaultValue: "Ref" }),
      cell: ({ row }) => {
        const ref = row.original.referenceCode || row.original.bookingId;
        return (
          <div className="font-mono text-xs text-muted-foreground whitespace-nowrap">
            {ref ? `#${ref}` : "—"}
          </div>
        );
      },
    },
    {
      accessorKey: "paidAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 -ml-3"
        >
          {t("billingDateColumn", { defaultValue: "Date" })}
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
              {new Date(date).toLocaleDateString(language, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/St_Johns' })}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(date).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/St_Johns' })}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "bookingType",
      header: t("billingTypeColumn", { defaultValue: "Type" }),
      cell: ({ row }) => {
        const tx = row.original;
        const label = getBookingTypeLabel(tx.bookingType, tx.metadata, t);
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
      header: t("billingDetailsColumn", { defaultValue: "Details" }),
      cell: ({ row }) => {
        const tx = row.original;
        return (
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {tx.itemName || t("billingNotAvailable", { defaultValue: "N/A" })}
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
          {t("billingAmountColumn", { defaultValue: "Amount" })}
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
              <div className="font-medium text-sm text-muted-foreground">{t("billingNoCharge", { defaultValue: "No Charge" })}</div>
              {tx.amount > 0 && (
                <div className="text-xs text-muted-foreground/50 line-through">
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
              <div className="text-xs text-muted-foreground">
                {t("billingRefundedAmount", { amount: formatCurrency(tx.refundAmount), defaultValue: "-{amount} refunded" })}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: t("billingStatusColumn", { defaultValue: "Status" }),
      cell: ({ row }) => {
        const tx = row.original;
        return getStatusBadge(tx.status, tx.refundAmount, t);
      },
    },
  ];
}

// Main Component
export function TransactionHistory() {
  const { t, i18n } = useTranslation("chef");
  const [viewType, setViewType] = useState<TransactionViewType>("all");
  const [bookingTypeFilter, setBookingTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
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

  // Get current view data with search filter
  const currentViewData = useMemo(() => {
    let data = transactions;
    if (viewType === "succeeded") data = succeededTx;
    else if (viewType === "refunded") data = refundedTx;
    else if (viewType === "pending") data = pendingTx;
    else if (viewType === "canceled") data = canceledTx;
    
    // Search filter (includes reference code for lookup)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      data = data.filter((t) => {
        const searchableText = [
          t.bookingId.toString(),
          t.paymentIntentId || '',
          t.chargeId || '',
          t.refundId || '',
          t.itemName || '',
          t.locationName || '',
          t.referenceCode || '',
        ].join(' ').toLowerCase();
        return searchableText.includes(query);
      });
    }
    
    // Booking type filter
    if (bookingTypeFilter !== 'all') {
      data = data.filter(t => t.bookingType === bookingTypeFilter);
    }
    
    return data;
  }, [viewType, succeededTx, refundedTx, pendingTx, canceledTx, transactions, searchQuery, bookingTypeFilter]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalPaid = transactions
      .filter(t => t.status === 'succeeded' || t.status === 'partially_refunded')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalRefunded = transactions.reduce((sum, t) => sum + t.refundAmount, 0);
    return { totalPaid, totalRefunded, netTotal: totalPaid - totalRefunded };
  }, [transactions]);

  // Column definitions
  const columns = useMemo(() => getTransactionColumns(t, i18n.language), [t, i18n.language]);

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
          <p className="text-destructive">{t("billingErrorLoadingTransactions", { message: (error as Error).message, defaultValue: "Error loading transactions: {message}" })}</p>
          <Button onClick={() => refetch()} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("billingRetry", "Retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <ChefPageHeader
        title={t("billingTransactionHistoryTitle", "Transaction history")}
        description={t("billingTransactionHistoryDesc", "Kitchen, storage, and other payments.")}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile
          label={t("billingTotalPaid", "Total paid")}
          value={formatCurrency(totals.totalPaid)}
          tone="success"
        />
        <StatTile
          label={t("billingRefunded", "Refunded")}
          value={formatCurrency(totals.totalRefunded)}
          tone="neutral"
        />
        <StatTile
          label={t("billingNet", "Net")}
          value={formatCurrency(totals.netTotal)}
          tone="progress"
        />
      </div>

      {/* Main Card with Table */}
      <Card className="shadow-none">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                {t("billingTransactionsTitle", "Transactions")}
              </CardTitle>
              <CardDescription>
                {t("billingTransactionCountSummary", { filtered: table.getFilteredRowModel().rows.length, count: transactions.length, defaultValue: "{filtered} of {count, plural, one {# transaction} other {# transactions}}" })}
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              {/* Search Input */}
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={t("billingSearchPlaceholder", "Search by ref code, ID...")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 w-full sm:w-[180px] lg:w-[220px]"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setSearchQuery('')}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Select value={bookingTypeFilter} onValueChange={setBookingTypeFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder={t("billingAllTypes", "All Types")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("billingAllTypes", "All Types")}</SelectItem>
                  <SelectItem value="kitchen">{t("billingKitchenBookingsOption", "Kitchen Bookings")}</SelectItem>
                  <SelectItem value="storage">{t("billingStorageOption", "Storage")}</SelectItem>
                  <SelectItem value="equipment">{t("billingEquipmentOption", "Equipment")}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => refetch()} disabled={isLoading} className="w-full sm:w-auto">
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                {t("billingRefresh", "Refresh")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* View Type Tabs */}
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as TransactionViewType)} className="w-full">
            <TabsList className="w-full gap-1">
              <TabsTrigger value="all" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                {t("billingTabAll", "All")}
                <Badge variant="count" className="ml-1">{transactions.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="succeeded" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                <span className="hidden sm:inline">{t("billingCompleted", "Completed")}</span>
                <span className="sm:hidden">{t("billingTabDone", "Done")}</span>
                <Badge variant="count" className="ml-1">{succeededTx.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="refunded" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                <span className="hidden sm:inline">{t("billingRefunded", "Refunded")}</span>
                <span className="sm:hidden">{t("billingTabRefund", "Refund")}</span>
                <Badge variant="count" className="ml-1">{refundedTx.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                {t("billingPending", "Pending")}
                <Badge variant="count" className="ml-1">{pendingTx.length}</Badge>
              </TabsTrigger>
              {canceledTx.length > 0 && (
                <TabsTrigger value="canceled" className="flex-1 min-w-[70px] text-xs sm:text-sm px-2 py-1.5">
                  <span className="hidden sm:inline">{t("billingNoCharge", "No Charge")}</span>
                  <span className="sm:hidden">{t("billingTabVoid", "Void")}</span>
                  <Badge variant="count" className="ml-1">{canceledTx.length}</Badge>
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>

          {/* Table */}
          <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap text-xs sm:text-sm">
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
                        row.original.status === "succeeded" && row.original.refundAmount === 0 && "bg-muted/30",
                        (row.original.status === "refunded" || row.original.refundAmount > 0) && "bg-muted/20",
                        (row.original.status === "pending" || row.original.status === "processing") && "bg-muted/30",
                        row.original.status === "canceled" && "bg-muted/40"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-3 text-xs sm:text-sm whitespace-nowrap">
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
                        <p className="text-sm font-medium">{t("billingNoTransactionsTitle", "No Transactions")}</p>
                        <p className="text-sm text-muted-foreground">
                          {viewType === "all" 
                            ? t("billingNoTransactionsAllDesc", "You haven't made any payments yet.")
                            : t("billingNoTransactionsFilteredDesc", { viewType, defaultValue: "No {viewType} transactions to display." })}
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
