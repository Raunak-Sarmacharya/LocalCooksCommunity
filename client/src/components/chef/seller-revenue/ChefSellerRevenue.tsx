/**
 * Chef Seller Revenue Dashboard
 *
 * Enterprise-grade revenue dashboard for food order earnings from the PHP platform.
 * Matches TransactionHistory patterns: TanStack Table, Sheet detail view, CSV export.
 */

import { useState, useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  DollarSign,
  TrendingUp,
  Receipt,
  ExternalLink,
  Link2,
  Store,
  Truck,
  ShoppingBag,
  Clock,
  CheckCircle2,
  AlertCircle,
  Info,
  ArrowUpDown,
  Calendar,
  User,
  Hash,
  Search,
  X,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatters";
import {
  useShopStatus,
  useLinkShop,
  useEarningsSummary,
  useSellerOrders,
  useStripeDashboardLink,
} from "./hooks/useSellerRevenue";
import type { SellerOrder } from "./hooks/useSellerRevenue";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function fmtDollars(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
  }).format(value);
}

function parsePhpDateToDate(phpDateStr: string): Date | null {
  if (!phpDateStr) return null;
  try {
    // Format: DD-MM-YYYY HH:MM:SSAM/PM  (e.g., "24-02-2026 03:25:34AM")
    const match = phpDateStr.match(
      /^(\d{1,2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(AM|PM)$/i
    );
    if (match) {
      const [, day, month, year, hour, min, sec, meridiem] = match;
      const m = parseInt(month, 10) - 1; // 0-indexed
      let h = parseInt(hour, 10);
      if (meridiem.toUpperCase() === "PM" && h !== 12) h += 12;
      if (meridiem.toUpperCase() === "AM" && h === 12) h = 0;
      return new Date(parseInt(year), m, parseInt(day), h, parseInt(min), parseInt(sec));
    }
    // Fallback: 3-letter month  DD-MMM-YYYY HH:MM:SSAM/PM
    const match2 = phpDateStr.match(
      /^(\d{1,2})-(\w{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(AM|PM)$/i
    );
    if (match2) {
      const [, day, month, year, hour, min, sec, meridiem] = match2;
      const monthMap: Record<string, number> = {
        JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
        JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
      };
      const m = monthMap[month.toUpperCase()] ?? 0;
      let h = parseInt(hour, 10);
      if (meridiem.toUpperCase() === "PM" && h !== 12) h += 12;
      if (meridiem.toUpperCase() === "AM" && h === 12) h = 0;
      return new Date(parseInt(year), m, parseInt(day), h, parseInt(min), parseInt(sec));
    }
    // Last resort: native Date parse (handles ISO, MySQL datetime, etc.)
    const fallback = new Date(phpDateStr);
    return isNaN(fallback.getTime()) ? null : fallback;
  } catch {
    return null;
  }
}

function fmtDate(phpDateStr: string): string {
  const d = parsePhpDateToDate(phpDateStr);
  if (!d) return "N/A";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/St_Johns",
  });
}

function fmtDateTime(phpDateStr: string): string {
  const d = parsePhpDateToDate(phpDateStr);
  if (!d) return "N/A";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/St_Johns",
  });
}

function fmtTime(phpDateStr: string): string {
  const d = parsePhpDateToDate(phpDateStr);
  if (!d) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/St_Johns",
  });
}

function getPayoutBadge(status: "due" | "paid") {
  if (status === "paid") {
    return <Badge variant="success">Paid</Badge>;
  }
  return <Badge variant="warning">Due</Badge>;
}

function getDeliveryLabel(method: string, provider: string): string {
  if (method === "pickup") return "Pickup";
  if (provider === "uber_direct") return "Uber Direct";
  return "In-House Delivery";
}

function getDeliveryIcon(method: string, provider: string) {
  if (method === "pickup") return <ShoppingBag className="h-3.5 w-3.5 text-blue-600" />;
  if (provider === "uber_direct") return <Truck className="h-3.5 w-3.5 text-orange-600" />;
  return <Truck className="h-3.5 w-3.5 text-green-600" />;
}

interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

function parseOrderItems(itemsStr: string | null | undefined): OrderItem[] {
  if (!itemsStr) return [];
  // Split by <br> or newline
  const items = itemsStr
    .split(/<br\s*\/?>|\n/i)
    .map((item) => item.trim())
    .filter(Boolean);
  
  return items.map((item) => {
    // Clean: remove leading "o", remove parentheses content for display
    // "Chicken combo (x1) ($20.00)" -> "Chicken combo"
    const cleaned = item
      .replace(/^o/, "")
      .replace(/\s*\(x\d+\)/, "") // Remove (x1), (x3) etc
      .replace(/\s*\$\([\d.]+\)/, "") // Remove ($20.00), ($12.00) etc
      .trim();
    return { name: cleaned, qty: 1, price: 0 };
  });
}

function OrderItemsList({ itemsStr }: { itemsStr: string | null | undefined }) {
  const items = parseOrderItems(itemsStr);
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 flex-shrink-0" />
            <span className="truncate">{item.name}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
            {item.qty > 1 && <span className="font-medium">×{item.qty}</span>}
            {item.price > 0 && <span>{fmtDollars(item.price)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

function exportOrdersCSV(orders: SellerOrder[]) {
  const headers = [
    "Order ID", "Type", "Date", "Customer", "Items",
    "Shop Charge", "Total Price", "Delivery Charge", "Service Fee",
    "Discount", "Stripe Fee", "Commission", "Tip (Chef)", "Tip (Driver)",
    "Your Earnings", "Payout Status", "Delivery Method",
  ];
  const rows = orders.map((o) => [
    o.id,
    o.type === "pre_order" ? "Pre-Order" : "Order",
    fmtDateTime(o.order_time),
    o.customer_name,
    `"${(o.items_description || "").replace(/"/g, '""')}"`,
    fmtDollars(o.shopcharge),
    fmtDollars(o.total_price),
    fmtDollars(o.delivery_charge),
    fmtDollars(o.service_fee),
    fmtDollars(o.discount_amt),
    fmtDollars(o.stripe_fee),
    fmtDollars(o.commission),
    fmtDollars(o.tip_chef),
    fmtDollars(o.tip_dboy),
    fmtDollars(o.chef_earnings),
    o.payout_status,
    getDeliveryLabel(o.order_method, o.delivery_provider),
  ]);
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `seller-revenue-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LINK SELLER ACCOUNT BANNER
// ═══════════════════════════════════════════════════════════════════════════════

function LinkSellerAccountBanner() {
  const { data: shopStatus, isLoading: statusLoading } = useShopStatus();
  const linkShopMutation = useLinkShop();
  const [manualEmail, setManualEmail] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  if (statusLoading) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/25">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (shopStatus?.linked) return null;

  return (
    <Card className="border-dashed border-2 border-orange-200 bg-orange-50/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-orange-600" />
          <CardTitle className="text-lg">Link Your Seller Account</CardTitle>
        </div>
        <CardDescription>
          Connect your LocalCooks seller account to view your food order revenue here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={() => linkShopMutation.mutate({})}
          disabled={linkShopMutation.isPending}
          className="w-full sm:w-auto"
        >
          {linkShopMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Store className="h-4 w-4 mr-2" />
          )}
          Auto-Link by Email
        </Button>

        {linkShopMutation.isError && (
          <div className="space-y-2">
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {linkShopMutation.error.message}
            </p>
            {!showManualInput && (
              <Button variant="outline" size="sm" onClick={() => setShowManualInput(true)}>
                Enter seller email manually
              </Button>
            )}
          </div>
        )}

        {showManualInput && (
          <div className="flex gap-2">
            <Input
              placeholder="Enter your seller account email"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              className="max-w-sm"
            />
            <Button
              onClick={() => { if (manualEmail.trim()) linkShopMutation.mutate({ email: manualEmail.trim() }); }}
              disabled={linkShopMutation.isPending || !manualEmail.trim()}
            >
              {linkShopMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
            </Button>
          </div>
        )}

        {linkShopMutation.isSuccess && (
          <p className="text-sm text-green-600 flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" />
            Successfully linked to {linkShopMutation.data.shop.sname}!
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EARNINGS SUMMARY CARDS
// ═══════════════════════════════════════════════════════════════════════════════

function EarningsSummaryCards({ period }: { period: string }) {
  const { data, isLoading, isError } = useEarningsSummary({ period });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-3" />
                <Skeleton className="h-8 w-28 mb-2" />
                <Skeleton className="h-3 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="py-6 text-center text-sm text-destructive">
          Failed to load earnings data. Please try again.
        </CardContent>
      </Card>
    );
  }

  const { earnings, by_delivery_method } = data;
  const summaryCards = [
    {
      label: "Due Earnings",
      value: earnings.total_due,
      count: data.by_payment_status.due.count,
      icon: <Clock className="h-5 w-5 text-orange-600" />,
      color: "text-orange-700",
      bg: "bg-orange-100",
    },
    {
      label: "Paid Earnings",
      value: earnings.total_paid,
      count: data.by_payment_status.paid.count,
      icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
      color: "text-green-700",
      bg: "bg-green-100",
    },
    {
      label: "Total Earnings",
      value: earnings.total_earnings,
      count: earnings.total_orders + earnings.total_pre_orders,
      icon: <DollarSign className="h-5 w-5 text-blue-600" />,
      color: "text-blue-700",
      bg: "bg-blue-100",
    },
    {
      label: "Tips Received",
      value: earnings.total_tips,
      subtitle: `Avg: ${fmtDollars(earnings.avg_order_value)}/order`,
      icon: <TrendingUp className="h-5 w-5 text-purple-600" />,
      color: "text-purple-700",
      bg: "bg-purple-100",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", card.bg)}>
                  {card.icon}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className={cn("text-xl font-bold", card.color)}>{fmtDollars(card.value)}</p>
                  <p className="text-xs text-muted-foreground">
                    {card.subtitle || `${formatNumber(card.count ?? 0)} orders`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {([
          { key: "pickup" as const, label: "Pickup", icon: <ShoppingBag className="h-4 w-4 text-blue-500" />, data: by_delivery_method.pickup },
          { key: "inhouse" as const, label: "In-House Delivery", icon: <Truck className="h-4 w-4 text-green-500" />, data: by_delivery_method.inhouse },
          { key: "uber_direct" as const, label: "Uber Direct", icon: <Truck className="h-4 w-4 text-orange-500" />, data: by_delivery_method.uber_direct },
        ]).map((item) => (
          <Card key={item.key} className="bg-muted/30">
            <CardContent className="pt-4 pb-3 text-center">
              <div className="mx-auto mb-1 w-fit">{item.icon}</div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="font-semibold text-sm">{fmtDollars(item.data.earnings)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(item.data.count)} orders</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER DETAIL SHEET
// ═══════════════════════════════════════════════════════════════════════════════

function OrderDetailSheet({
  order,
  open,
  onOpenChange,
}: {
  order: SellerOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!order) return null;

  const revenueItems = [
    { label: "Shop Charge (Food Total)", value: order.shopcharge, icon: <Receipt className="h-4 w-4" /> },
    { label: "Tip (Chef)", value: order.tip_chef, icon: <TrendingUp className="h-4 w-4" />, highlight: true },
  ];

  const deductions = [
    { label: "Discount Applied", value: order.discount_amt },
    { label: "Stripe Processing Fee", value: order.stripe_fee },
    { label: "Platform Commission", value: order.commission },
    { label: "Delivery Charge", value: order.delivery_charge },
    { label: "Service Fee", value: order.service_fee },
    { label: "Tip (Driver)", value: order.tip_dboy },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {order.type === "pre_order" ? "Pre-Order" : "Order"} #{order.id}
          </SheetTitle>
          <SheetDescription>
            Full financial breakdown for this order
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Order Info */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Customer</span>
              </div>
              <span className="font-medium text-sm">{order.customer_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Order Date</span>
              </div>
              <span className="font-medium text-sm">{fmtDateTime(order.order_time)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {getDeliveryIcon(order.order_method, order.delivery_provider)}
                <span className="text-muted-foreground">Delivery</span>
              </div>
              <span className="font-medium text-sm">
                {getDeliveryLabel(order.order_method, order.delivery_provider)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Payout Status</span>
              </div>
              {getPayoutBadge(order.payout_status)}
            </div>
            <div className="pt-1">
              <p className="text-xs text-muted-foreground mb-2">Items Ordered</p>
              <div className="bg-muted/50 rounded-md px-3 py-2">
                <OrderItemsList itemsStr={order.items_description} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Revenue Breakdown */}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Revenue Breakdown
            </h4>
            <div className="space-y-2">
              {revenueItems.map((item) => (
                <div
                  key={item.label}
                  className={cn(
                    "flex items-center justify-between py-1.5 px-2 rounded-md text-sm",
                    item.highlight && item.value > 0 && "bg-purple-50/70"
                  )}
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {item.icon}
                    {item.label}
                  </div>
                  <span className={cn("font-medium", item.highlight && item.value > 0 && "text-purple-700")}>
                    {fmtDollars(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between py-2 px-2 bg-muted/50 rounded-md text-sm font-semibold">
            <span>Customer Total Paid</span>
            <span>{fmtDollars(order.total_price)}</span>
          </div>

          <Separator />

          {/* Deductions */}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Minus className="h-4 w-4" />
              Deductions
            </h4>
            <div className="space-y-2">
              {deductions.map((item) => (
                <div key={item.label} className="flex items-center justify-between py-1.5 px-2 text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium text-destructive/80">
                    {item.value > 0 ? `−${fmtDollars(item.value)}` : fmtDollars(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Net Earnings */}
          <div className="flex items-center justify-between py-3 px-3 bg-green-50 border border-green-200 rounded-lg">
            <div>
              <p className="text-sm font-semibold text-green-800">Your Earnings</p>
              <p className="text-xs text-green-600">After all fees and deductions</p>
            </div>
            <p className="text-2xl font-bold text-green-700">{fmtDollars(order.chef_earnings)}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER TABLE COLUMNS
// ═══════════════════════════════════════════════════════════════════════════════

function getOrderColumns(onSelectOrder: (order: SellerOrder) => void): ColumnDef<SellerOrder>[] {
  return [
    {
      id: "reference",
      header: "Ref",
      cell: ({ row }) => {
        const ref = row.original.id; // Usually orders only have an ID or order_id
        return (
          <div className="font-mono text-xs text-muted-foreground whitespace-nowrap">
            {ref ? `#${ref}` : "—"}
          </div>
        );
      },
    },
    {
      accessorKey: "order_time",
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
        const o = row.original;
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 text-sm font-medium">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {fmtDate(o.order_time)}
            </div>
            <div className="text-xs text-muted-foreground">{fmtTime(o.order_time)}</div>
          </div>
        );
      },
      sortingFn: (a, b) => {
        const da = parsePhpDateToDate(a.original.order_time)?.getTime() ?? 0;
        const db = parsePhpDateToDate(b.original.order_time)?.getTime() ?? 0;
        return da - db;
      },
    },
    {
      accessorKey: "id",
      header: "Order",
      cell: ({ row }) => {
        const o = row.original;
        return (
          <div className="flex items-center gap-2">
            {getDeliveryIcon(o.order_method, o.delivery_provider)}
            <div>
              <span className="text-sm font-medium">
                {o.type === "pre_order" ? "Pre" : ""} #{o.id}
              </span>
              <p className="text-xs text-muted-foreground">
                {getDeliveryLabel(o.order_method, o.delivery_provider)}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "customer_name",
      header: "Customer",
      cell: ({ row }) => {
        const o = row.original;
        return (
          <div className="space-y-0.5">
            <div className="text-sm font-medium">{o.customer_name}</div>
            <div className="truncate max-w-[180px]">
              <OrderItemsList itemsStr={o.items_description} />
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "total_price",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 justify-end w-full"
        >
          Total
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="text-right text-sm font-medium">
          {fmtDollars(row.original.total_price)}
        </div>
      ),
    },
    {
      accessorKey: "chef_earnings",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 justify-end w-full"
        >
          Your Earnings
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const o = row.original;
        return (
          <div className="text-right">
            <div className="text-sm font-semibold text-green-700">{fmtDollars(o.chef_earnings)}</div>
            {o.tip_chef > 0 && (
              <div className="text-xs text-purple-600">+{fmtDollars(o.tip_chef)} tip</div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "payout_status",
      header: "Status",
      cell: ({ row }) => getPayoutBadge(row.original.payout_status),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onSelectOrder(row.original)}
        >
          Details
        </Button>
      ),
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER HISTORY TABLE
// ═══════════════════════════════════════════════════════════════════════════════

function SellerOrderHistory() {
  const [payoutFilter, setPayoutFilter] = useState<"all" | "due" | "paid">("all");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "order_time", desc: true }]);
  const [selectedOrder, setSelectedOrder] = useState<SellerOrder | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useSellerOrders({
    status: payoutFilter,
    page,
    limit: 50,
  });

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase().trim();
    return orders.filter((o) =>
      [o.id.toString(), o.customer_name, o.items_description, o.order_method]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [orders, searchQuery]);

  const { dueOrders, paidOrders } = useMemo(() => ({
    dueOrders: orders.filter((o) => o.payout_status === "due"),
    paidOrders: orders.filter((o) => o.payout_status === "paid"),
  }), [orders]);

  const columns = useMemo(
    () =>
      getOrderColumns((order) => {
        setSelectedOrder(order);
        setSheetOpen(true);
      }),
    []
  );

  const table = useReactTable({
    data: filteredOrders,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting },
  });

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Order History
              </CardTitle>
              <CardDescription>
                {filteredOrders.length} of {orders.length} order{orders.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search orders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 w-[180px] lg:w-[220px]"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => exportOrdersCSV(orders)} disabled={orders.length === 0}>
                <Download className="h-4 w-4 mr-1.5" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4 mr-1.5", isLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Tabs
            value={payoutFilter}
            onValueChange={(v) => { setPayoutFilter(v as "all" | "due" | "paid"); setPage(1); }}
            className="w-full"
          >
            <TabsList className="w-full gap-1">
              <TabsTrigger value="all" className="flex-1 text-xs sm:text-sm">
                All
                <Badge variant="count" className="ml-1.5">{orders.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="due" className="flex-1 text-xs sm:text-sm">
                Due
                <Badge variant="count" className="ml-1.5">{dueOrders.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="paid" className="flex-1 text-xs sm:text-sm">
                Paid
                <Badge variant="count" className="ml-1.5">{paidOrders.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-32 flex-1" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-12" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="py-12 text-center">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive" />
              <p className="text-sm text-destructive">Failed to load orders.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" /> Retry
              </Button>
            </div>
          ) : (
            <>
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
                    {table.getRowModel().rows.length ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={cn(
                            "hover:bg-muted/50 cursor-pointer",
                            row.original.payout_status === "paid" && "bg-green-50/30",
                            row.original.payout_status === "due" && "bg-orange-50/20"
                          )}
                          onClick={() => {
                            setSelectedOrder(row.original);
                            setSheetOpen(true);
                          }}
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
                            <p className="text-sm font-medium">No Orders</p>
                            <p className="text-sm text-muted-foreground">
                              {searchQuery
                                ? "No orders match your search."
                                : payoutFilter !== "all"
                                  ? `No ${payoutFilter} orders to display.`
                                  : "No orders found."}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {data && data.pagination.total_pages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {data.pagination.page} of {data.pagination.total_pages} &middot; {formatNumber(data.pagination.total)} orders
                  </p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= data.pagination.total_pages} onClick={() => setPage((p) => p + 1)}>
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <OrderDetailSheet order={selectedOrder} open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE DASHBOARD BUTTON
// ═══════════════════════════════════════════════════════════════════════════════

function StripeDashboardButton() {
  const { data: shopStatus } = useShopStatus();
  const dashboardLinkMutation = useStripeDashboardLink();

  if (!shopStatus?.phpShopStripeAccountId) return null;

  const handleOpenDashboard = async () => {
    try {
      const result = await dashboardLinkMutation.mutateAsync();
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <Button variant="outline" onClick={handleOpenDashboard} disabled={dashboardLinkMutation.isPending} className="gap-2">
      {dashboardLinkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
      View Stripe Dashboard
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ChefSellerRevenue() {
  const { data: shopStatus, isLoading: statusLoading } = useShopStatus();
  const [period, setPeriod] = useState("all");

  if (statusLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LinkSellerAccountBanner />

      {shopStatus?.linked && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Seller Revenue</h1>
                <p className="text-sm text-muted-foreground">
                  Your food order earnings from LocalCooks
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={period} onValueChange={setPeriod}>
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs px-3 h-7">All Time</TabsTrigger>
                  <TabsTrigger value="month" className="text-xs px-3 h-7">30 Days</TabsTrigger>
                  <TabsTrigger value="week" className="text-xs px-3 h-7">7 Days</TabsTrigger>
                  <TabsTrigger value="today" className="text-xs px-3 h-7">Today</TabsTrigger>
                </TabsList>
              </Tabs>
              <StripeDashboardButton />
            </div>
          </div>

          {!shopStatus?.phpShopStripeAccountId && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50/70 border border-amber-200/50 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>
                Your seller account doesn&apos;t have Stripe connected yet. Set up Stripe on your
                LocalCooks seller account to receive payouts and access your Stripe dashboard here.
                Your order revenue data is still available below.
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50/70 border border-blue-200/50 text-sm text-blue-700">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>
              This shows revenue from your LocalCooks food orders.{shopStatus?.phpShopStripeAccountId ? <> For detailed payout history and bank transfers,
              click <strong>View Stripe Dashboard</strong> above.</> : <> Connect Stripe on your seller account to access payout details.</>}
            </p>
          </div>

          <EarningsSummaryCards period={period} />
          <SellerOrderHistory />
        </>
      )}

      {!statusLoading && !shopStatus?.linked && (
        <Card className="bg-muted/20">
          <CardContent className="py-12 text-center">
            <Store className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              Link your seller account above to view your food order revenue.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
