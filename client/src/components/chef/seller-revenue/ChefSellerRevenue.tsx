/**
 * Chef Seller Revenue Dashboard
 *
 * Enterprise-grade revenue dashboard for food order earnings from the PHP platform.
 * Matches TransactionHistory patterns: TanStack Table, Sheet detail view, CSV export.
 */

import { useState, useMemo, useEffect } from "react";
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
import { Progress } from "@/components/ui/progress";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  FileText,
  FileSpreadsheet,
  ChevronDown,
  Users,
  Star,
  MapPin,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import Logo from "@/components/ui/logo";
import locoLogo from "@/assets/LoCoLogo.svg";
import { SiUber } from "react-icons/si";
import { formatNumber } from "@/lib/formatters";
import {
  useShopStatus,
  useLinkShop,
  useEarningsSummary,
  useSellerOrders,
  useStripeDashboardLink,
} from "./hooks/useSellerRevenue";
import type { SellerOrder } from "./hooks/useSellerRevenue";
import { ChefRevenueMatrix } from "./ChefRevenueMatrix";
import { PickupOrderIcon } from "@/components/ui/PickupOrderIcon";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useFirebaseAuth } from "@/hooks/use-auth";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getDateFiltersForPeriod(period: string) {
  if (period === 'all') return {};
  const now = new Date();
  
  const formatDate = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  if (period === 'today') {
    return { startDate: formatDate(now) };
  }
  if (period === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return { startDate: formatDate(d) };
  }
  if (period === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return { startDate: formatDate(d) };
  }
  return {};
}

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
  if (method === "pickup") return <PickupOrderIcon className="h-4 w-4 text-black" />;
  if (provider === "uber_direct") return <SiUber className="h-5 w-5" />;
  return <img src={locoLogo} alt="Local Cooks" className="h-5 w-5 object-contain" />;
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
    // Extract quantity
    const qtyMatch = item.match(/\(x(\d+)\)/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

    // Extract price: Match ($20.00) or $(20.00) or $20.00
    const priceMatch = item.match(/\(\$([\d.]+)\)/) || item.match(/\$\([\d.]+\)/) || item.match(/\$([\d.]+)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

    // Clean name for display
    const cleaned = item
      .replace(/^o\s*/i, "")
      .replace(/\s*\(x\d+\)/i, "")
      .replace(/\s*\(\$[\d.]+\)/, "")
      .replace(/\s*\$\([\d.]+\)/, "")
      .replace(/\s*\$[\d.]+/, "")
      .trim();
      
    return { name: cleaned, qty, price };
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
            {item.qty > 0 && <span className="font-medium">×{item.qty}</span>}
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
    "Shop Charge", "Tax Collected", "Discount", "Stripe Fee", "Tip (Chef)",
    "Your Earnings", "Payout Status", "Delivery Method",
  ];
  const rows = orders.map((o) => [
    o.id,
    o.type === "pre_order" ? "Pre-Order" : "Order",
    fmtDateTime(o.order_time),
    o.customer_name,
    `"${parseOrderItems(o.items_description).map(item => `${item.qty}x ${item.name} @ $${item.price.toFixed(2)}`).join('\n')}"`,
    fmtDollars(o.shopcharge),
    fmtDollars(o.discount_amt),
    fmtDollars(o.stripe_fee),
    fmtDollars(o.commission),
    fmtDollars(o.tip_chef),
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
  const dateFilters = useMemo(() => getDateFiltersForPeriod(period), [period]);
  const { data, isLoading, isError } = useEarningsSummary({ period, startDate: dateFilters.startDate });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
      label: "Total Earnings",
      value: earnings.total_earnings,
      subtitle: `${formatNumber(earnings.total_orders + earnings.total_pre_orders)} orders (Includes Tips)`,
      count: earnings.total_orders + earnings.total_pre_orders,
      icon: <DollarSign className="h-5 w-5 text-blue-600" />,
      color: "text-blue-700",
      bg: "bg-blue-100",
      tooltip: "Your total revenue generated across all payment statuses (Due + Paid). This amount already includes all tips, and is exactly equal to the sum of your Pickup, In-House Delivery, and Uber Direct earnings.",
    },
    {
      label: "Due Earnings",
      value: earnings.total_due,
      count: data.by_payment_status.due.count,
      icon: <Clock className="h-5 w-5 text-orange-600" />,
      color: "text-orange-700",
      bg: "bg-orange-100",
      tooltip: "Funds currently being processed by Stripe or held in your pending balance. These will be automatically paid out to your connected bank account according to your Stripe payout schedule (usually 2-7 rolling days).",
    },
    {
      label: "Paid Earnings",
      value: earnings.total_paid,
      count: data.by_payment_status.paid.count,
      icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
      color: "text-green-700",
      bg: "bg-green-100",
      tooltip: "Funds that have been successfully deposited into your connected bank account by Stripe. It may take 1-2 business days for your bank to reflect the transfer.",
    },
    {
      label: "Tips (Included in Total)",
      value: earnings.total_tips,
      subtitle: `${((earnings.total_tips / (earnings.total_earnings || 1)) * 100).toFixed(1)}% tip rate`,
      icon: <TrendingUp className="h-5 w-5 text-purple-600" />,
      color: "text-purple-700",
      bg: "bg-purple-100",
      tooltip: "Total tips provided by your customers. Note: These tips are already included in your Total Earnings figure.",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 h-5">
                {card.label}
                {card.tooltip && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center justify-center p-0 m-0 border-none bg-transparent outline-none ring-0">
                        <Info className="h-4 w-4 text-muted-foreground/70 hover:text-muted-foreground cursor-help" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="w-[280px] p-3 shadow-md">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {card.tooltip}
                      </p>
                    </PopoverContent>
                  </Popover>
                )}
              </CardTitle>
              <div className={cn("w-9 h-9 rounded-md flex items-center justify-center shrink-0", card.bg)}>
                {card.icon}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmtDollars(card.value)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {card.subtitle || `${formatNumber(card.count ?? 0)} orders`}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="pt-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">Earnings by Delivery Method</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([
          { 
            key: "pickup" as const, 
            label: "Pickup", 
            icon: <PickupOrderIcon className="h-6 w-6 text-emerald-600" />,
            bgIcon: <PickupOrderIcon className="h-20 w-20 text-emerald-600" />,
            color: "text-emerald-700",
            bg: "bg-emerald-100",
            data: by_delivery_method.pickup,
            tooltip: "Revenue from orders picked up directly by the customer from your location. This is one of the three components that sum up to your Total Earnings."
          },
          { 
            key: "inhouse" as const, 
            label: "In-House Delivery", 
            icon: <img src={locoLogo} alt="Local Cooks" className="h-6 w-6 object-contain" />,
            bgIcon: <img src={locoLogo} alt="Local Cooks" className="h-20 w-20 object-contain grayscale" />,
            color: "text-blue-700",
            bg: "bg-blue-100",
            data: by_delivery_method.inhouse,
            tooltip: "Revenue from orders delivered by Local Cooks delivery partners. This is one of the three components that sum up to your Total Earnings."
          },
          { 
            key: "uber_direct" as const, 
            label: "Uber Direct", 
            icon: <SiUber className="h-6 w-6 text-slate-800 dark:text-slate-200" />,
            bgIcon: <SiUber className="h-20 w-20 text-slate-800 dark:text-slate-200" />,
            color: "text-slate-800 dark:text-slate-100",
            bg: "bg-slate-100 dark:bg-slate-800",
            data: by_delivery_method.uber_direct,
            tooltip: "Revenue from orders delivered via the Uber Direct integration. This is one of the three components that sum up to your Total Earnings."
          },
        ]).map((item) => (
          <Card key={item.key} className="relative overflow-hidden group border-muted shadow-sm">
            {/* Subtle background icon for that premium feel */}
            <div className="absolute right-2 bottom-2 opacity-5 group-hover:opacity-10 group-hover:scale-110 origin-bottom-right transition-all duration-500 pointer-events-none flex items-center justify-center">
              {item.bgIcon}
            </div>
            
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 h-5">
                {item.label}
                {item.tooltip && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center justify-center p-0 m-0 border-none bg-transparent outline-none ring-0">
                        <Info className="h-4 w-4 text-muted-foreground/70 hover:text-muted-foreground cursor-help" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="w-[280px] p-3 shadow-md">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {item.tooltip}
                      </p>
                    </PopoverContent>
                  </Popover>
                )}
              </CardTitle>
              <div className={cn("w-10 h-10 rounded-md flex items-center justify-center shrink-0 shadow-sm", item.bg)}>
                {item.icon}
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-2xl font-bold">{fmtDollars(item.data.earnings)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatNumber(item.data.count)} orders
              </p>
            </CardContent>
          </Card>
        ))}
        </div>
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
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  if (!order) return null;

  const revenueItems = [
    { label: "Shop Charge (Food Total)", value: order.shopcharge, icon: <Receipt className="h-4 w-4" /> },
    { label: "Tax Collected", value: order.commission, icon: <Receipt className="h-4 w-4" /> },
    { label: "Tip (Chef)", value: order.tip_chef, icon: <TrendingUp className="h-4 w-4" />, highlight: true },
  ].filter(item => item.value > 0 || item.label === "Shop Charge (Food Total)" || item.label === "Tax Collected");

  const deductions = [
    { label: "Discount Applied", value: order.discount_amt },
    { label: "Stripe Processing Fee", value: order.stripe_fee },
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

          <div className="pt-2">
            <Button 
              className="w-full" 
              variant="outline" 
              disabled={isDownloading}
              onClick={async () => {
                try {
                  setIsDownloading(true);
                  const d = parsePhpDateToDate(order.order_time);
                  if (!d) throw new Error("Invalid order date");
                  
                  const currentFirebaseUser = auth.currentUser;
                  if (!currentFirebaseUser) throw new Error("Not authenticated");
                  const token = await currentFirebaseUser.getIdToken();
                  
                  const dateParam = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
                  
                  const res = await fetch(`/api/chef/seller/orders/${order.id}/invoice?date=${dateParam}`, {
                    headers: {
                      Authorization: `Bearer ${token}`
                    }
                  });
                  
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.message || "Failed to download invoice");
                  }
                  
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `invoice-${order.id}.pdf`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                } catch (error) {
                  toast({
                    title: "Download Failed",
                    description: error instanceof Error ? error.message : "Could not download invoice",
                    variant: "destructive"
                  });
                } finally {
                  setIsDownloading(false);
                }
              }}
            >
              {isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isDownloading ? "Downloading..." : "Download Invoice PDF"}
            </Button>
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
      accessorKey: "commission",
      header: () => <div className="text-right w-full pr-2">Tax</div>,
      cell: ({ row }) => (
        <div className="text-right pr-2">
          {fmtDollars(row.original.commission)}
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
// SELLER ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

function SellerAnalytics({ period, sellerId }: { period: string; sellerId?: string | number }) {
  const dateFilters = useMemo(() => getDateFiltersForPeriod(period), [period]);
  
  const { data, isLoading } = useSellerOrders({
    status: "all",
    page: 1,
    limit: 1000,
    startDate: dateFilters.startDate,
  });

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);

  const analytics = useMemo(() => {
    if (orders.length === 0) return null;

    let totalRevenue = 0;
    let totalTax = 0;
    let totalItems = 0;
    let preOrderCount = 0;
    let pickupCount = 0;
    let deliveryCount = 0;

    const customerStats: Record<string, { count: number, revenue: number, name: string }> = {};
    const itemCounts: Record<string, { qty: number, revenue: number }> = {};
    const hourCounts: Record<string, number> = {};

    orders.forEach(o => {
      totalRevenue += Number(o.shopcharge) || 0;
      totalTax += Number(o.commission) || 0;
      
      if (o.type === "pre_order") preOrderCount++;
      if (o.order_method === "pickup") pickupCount++;
      else deliveryCount++;
      
      const cname = (o.customer_name || 'Guest').trim();
      const cnameLower = cname.toLowerCase();
      
      if (!customerStats[cnameLower]) {
        customerStats[cnameLower] = { count: 0, revenue: 0, name: cname };
      }
      customerStats[cnameLower].count += 1;
      customerStats[cnameLower].revenue += (Number(o.shopcharge) || 0);

      const d = parsePhpDateToDate(o.order_time);
      if (d) {
        const hour = d.getHours();
        const timeWindow = hour < 12 ? 'Morning (6am-12pm)' : hour < 17 ? 'Afternoon (12pm-5pm)' : 'Evening (5pm+)';
        hourCounts[timeWindow] = (hourCounts[timeWindow] || 0) + 1;
      }

      // Items
      const items = o.items_description
        .split(/<br\s*\/?>|\n/i)
        .map((item) => item.trim())
        .filter(Boolean);
      
      items.forEach(itemStr => {
        const qtyMatch = itemStr.match(/\(x(\d+)\)/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        totalItems += qty;
        
        const priceMatch = itemStr.match(/\(\$([\d.]+)\)/) || itemStr.match(/\$\([\d.]+\)/) || itemStr.match(/\$([\d.]+)/);
        const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
        
        const name = itemStr.replace(/\(x\d+\)/i, '').replace(/\(\$[\d.]+\)/, '').replace(/\$[\d.]+/, '').trim();
        
        if (name) {
          if (!itemCounts[name]) itemCounts[name] = { qty: 0, revenue: 0 };
          itemCounts[name].qty += qty;
          itemCounts[name].revenue += (qty * price);
        }
      });
    });

    const aov = totalRevenue / orders.length;
    const itemsPerOrder = totalItems / orders.length;
    
    let returningCount = 0;
    const topCustomers = Object.values(customerStats).sort((a, b) => b.count - a.count || b.revenue - a.revenue).map(c => {
      if (c.count > 1) returningCount++;
      return c;
    });
    
    const returningPct = Object.keys(customerStats).length > 0 ? (returningCount / Object.keys(customerStats).length) * 100 : 0;
    
    const topItems = Object.entries(itemCounts)
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 5)
      .map(([name, stats]) => ({ name, ...stats }));

    const peakHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([window, count]) => ({ window, count }));

    return { 
      aov, 
      returningPct, 
      topItems, 
      peakHours, 
      totalTax,
      itemsPerOrder,
      topCustomers: topCustomers.slice(0, 5),
      preOrderCount,
      pickupCount,
      deliveryCount,
      totalOrders: orders.length
    };
  }, [orders]);

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="pt-6"><Skeleton className="h-48 w-full" /></CardContent>
      </Card>
    );
  }

  if (!analytics) return null;

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader className="pb-4 bg-muted/10 border-b">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blue-600" />
          Business Insights
        </CardTitle>
        <CardDescription>Comprehensive analytics for your performance and customers</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x">
          
          {/* Business Analytics Column */}
          <div className="p-6 lg:col-span-2 space-y-6">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Store className="h-4 w-4 text-indigo-600" />
              Sales & Engagement
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4"><DollarSign className="h-3.5 w-3.5"/>Average Order</p>
                <p className="text-xl font-bold">{fmtDollars(analytics.aov)}</p>
              </div>
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4">
                  <Users className="h-3.5 w-3.5"/>
                  <span>Retention Rate</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center justify-center p-0 m-0 h-4 w-4 border-none bg-transparent outline-none ring-0">
                        <Info className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-muted-foreground cursor-help" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="w-[280px] p-3 shadow-md">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        The percentage of your customers who have placed more than one order.
                      </p>
                    </PopoverContent>
                  </Popover>
                </p>
                <p className="text-xl font-bold">{analytics.returningPct.toFixed(1)}%</p>
              </div>
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4"><ShoppingBag className="h-3.5 w-3.5"/>Items/Order</p>
                <p className="text-xl font-bold">{analytics.itemsPerOrder.toFixed(1)}</p>
              </div>
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4"><Calendar className="h-3.5 w-3.5"/>Pre-Orders</p>
                <p className="text-xl font-bold">{((analytics.preOrderCount / analytics.totalOrders) * 100).toFixed(0)}%</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
              {analytics.topItems.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2"><Star className="h-4 w-4 text-amber-500"/>Top Selling Items</h4>
                  <div className="space-y-2">
                    {analytics.topItems.slice(0, 4).map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-sm p-2 bg-muted/30 rounded-md hover:bg-muted/50 transition-colors">
                        <span className="font-medium truncate pr-2" title={item.name}>{item.name}</span>
                        <div className="text-right flex-shrink-0">
                          <span className="font-bold">{item.qty}x</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4 text-blue-500"/>Peak Hours</h4>
                <div className="space-y-2">
                  {analytics.peakHours.map((ph, i) => (
                    <div key={i} className="flex justify-between items-center text-sm p-2 bg-muted/30 rounded-md hover:bg-muted/50 transition-colors">
                      <span>{ph.window}</span>
                      <span className="font-medium">{ph.count} orders</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top Customers Column */}
          <div className="p-6 lg:col-span-1 bg-muted/5">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-6">
              <Users className="h-4 w-4 text-emerald-600" />
              Top Customers
            </h3>
            
            {analytics.topCustomers.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">
                No customer data available
              </div>
            ) : (
              <div className="space-y-3">
                {analytics.topCustomers.map((customer, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-background rounded-lg border shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                        {customer.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-none truncate">{customer.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{customer.count} order{customer.count > 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-green-700">{fmtDollars(customer.revenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-1.5"><Truck className="h-3.5 w-3.5"/>Fulfillment Split</h4>
              <div className="flex items-center gap-0.5">
                <div 
                  className="h-2 bg-emerald-500 rounded-l-full" 
                  style={{ width: `${Math.max((analytics.pickupCount / analytics.totalOrders) * 100, 2)}%` }}
                />
                <div 
                  className="h-2 bg-blue-500 rounded-r-full" 
                  style={{ width: `${Math.max((analytics.deliveryCount / analytics.totalOrders) * 100, 2)}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs font-medium">
                <span className="text-emerald-700">{((analytics.pickupCount / analytics.totalOrders) * 100).toFixed(0)}% Pickup</span>
                <span className="text-blue-700">{((analytics.deliveryCount / analytics.totalOrders) * 100).toFixed(0)}% Delivery</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER HISTORY TABLE
// ═══════════════════════════════════════════════════════════════════════════════

function ExportReportModal({ orders }: { orders: SellerOrder[] }) {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [open, setOpen] = useState(false);

  const handlePreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
  };

  const handleMonthlyPreset = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0); 
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  };

  const downloadSecureReport = async (format: 'csv' | 'pdf') => {
    try {
      setIsDownloading(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      
      const response = await fetch(`/api/chef/seller/reports/export?period=custom&format=${format}&startDate=${startDate}&endDate=${endDate}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error("Failed to download report");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LocalCooks_Custom_Report_${startDate}_to_${endDate}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Report Downloaded",
        description: `Your custom ${format.toUpperCase()} report has been downloaded.`,
      });
      setOpen(false);
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full sm:w-auto">
          <Download className="h-4 w-4 mr-1.5" />
          Export Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Seller Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Quick Presets</span>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => handlePreset(7)}>Last 7 Days</Button>
              <Button variant="outline" size="sm" onClick={() => handlePreset(30)}>Last 30 Days</Button>
              <Button variant="outline" size="sm" onClick={handleMonthlyPreset}>Last Month</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Start Date</label>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">End Date</label>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
            <Button onClick={() => downloadSecureReport('pdf')} disabled={isDownloading || !startDate || !endDate} className="w-full justify-start">
              <FileText className="mr-2 h-4 w-4 text-red-500" />
              Download Statement (PDF)
            </Button>
            <Button onClick={() => downloadSecureReport('csv')} variant="outline" disabled={isDownloading || !startDate || !endDate} className="w-full justify-start">
              <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
              Download Data (CSV)
            </Button>
            <Button onClick={() => { setOpen(false); exportOrdersCSV(orders); }} variant="outline" disabled={orders.length === 0} className="w-full justify-start mt-2 border-dashed">
              <Download className="mr-2 h-4 w-4" />
              Export Current Table View (CSV)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SellerOrderHistory({ period }: { period: string }) {
  const [payoutFilter, setPayoutFilter] = useState<"all" | "due" | "paid">("all");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "order_time", desc: true }]);
  const [selectedOrder, setSelectedOrder] = useState<SellerOrder | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { toast } = useToast();

  const dateFilters = useMemo(() => getDateFiltersForPeriod(period), [period]);

  const { data, isLoading, isError, refetch } = useSellerOrders({
    status: payoutFilter,
    page,
    limit: 50,
    startDate: dateFilters.startDate,
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
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-auto">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search orders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 w-full sm:w-[180px] lg:w-[220px]"
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
              <ExportReportModal orders={orders} />
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="w-full sm:w-auto">
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

function StripeDashboardButton({ className }: { className?: string }) {
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
    <Button variant="outline" onClick={handleOpenDashboard} disabled={dashboardLinkMutation.isPending} className={cn("gap-2", className)}>
      {dashboardLinkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
      View Stripe Dashboard
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHP SELLER DASHBOARD BUTTON
// ═══════════════════════════════════════════════════════════════════════════════

function PhpSellerDashboardButton({ className }: { className?: string }) {
  const handleOpenDashboard = () => {
    const isProd = window.location.hostname === "chef.localcooks.ca";
    const url = isProd
      ? "https://shop.localcook.shop/app/shop/home.php"
      : "https://stagingwebapp.localcook.shop/app/shop/home.php";
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Button onClick={handleOpenDashboard} className={cn("gap-2 bg-blue-600 hover:bg-blue-700 text-white", className)}>
      <Store className="h-4 w-4" />
      Seller Account
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ChefSellerRevenue() {
  const { user } = useFirebaseAuth();
  const { data: shopStatus, isLoading: statusLoading } = useShopStatus();
  const [period, setPeriod] = useState("all");
  const dateFilters = useMemo(() => getDateFiltersForPeriod(period), [period]);
  
  // We need all-time matrix data for the chart, even if current period is filtered
  const { data: allTimeSummary } = useEarningsSummary({ period: 'all', enabled: !!shopStatus?.linked });
  const { data: summaryData, isLoading, isError } = useEarningsSummary({ 
    period, 
    startDate: dateFilters.startDate,
    enabled: !!shopStatus?.linked 
  });

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
                <h1 className="text-2xl font-bold text-foreground">My Earnings</h1>
                <p className="text-sm text-muted-foreground">
                  Your food order earnings from LocalCooks
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <Tabs value={period} onValueChange={setPeriod} className="w-full sm:w-auto">
                <TabsList className="h-8 w-full sm:w-auto">
                  <TabsTrigger value="all" className="text-xs px-3 h-7 flex-1 sm:flex-none">All Time</TabsTrigger>
                  <TabsTrigger value="month" className="text-xs px-3 h-7 flex-1 sm:flex-none">30 Days</TabsTrigger>
                  <TabsTrigger value="week" className="text-xs px-3 h-7 flex-1 sm:flex-none">7 Days</TabsTrigger>
                  <TabsTrigger value="today" className="text-xs px-3 h-7 flex-1 sm:flex-none">Today</TabsTrigger>
                </TabsList>
              </Tabs>
              <PhpSellerDashboardButton className="w-full sm:w-auto" />
              <StripeDashboardButton className="w-full sm:w-auto" />
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
          <ChefRevenueMatrix data={allTimeSummary?.matrix} period={period} />
          <SellerAnalytics period={period} sellerId={user?.uid} />
          <SellerOrderHistory period={period} />
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
