/**
 * Chef Seller Revenue Dashboard
 *
 * Enterprise-grade revenue dashboard for food order earnings from the PHP platform.
 * Matches TransactionHistory patterns: TanStack Table, Sheet detail view, CSV export.
 */

import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type ChefTFunction = TFunction<"chef", undefined>;
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
import locoLogo from "@/assets/LoCoLogo.svg";
import { SiUber } from "react-icons/si";
import { formatNumber } from "@/lib/formatters";
import {
  useShopStatus,
  useLinkShop,
  useEarningsSummary,
  useSellerOrders,
  useStripeDashboardLink,
  useSellerRetention,
  openChefShopHome,
} from "./hooks/useSellerRevenue";
import type { SellerOrder } from "./hooks/useSellerRevenue";
import { ChefRevenueMatrix } from "./ChefRevenueMatrix";
import { PickupOrderIcon } from "@/components/ui/PickupOrderIcon";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { ChefPageHeader, QuietNotice, StatTile } from "@/components/chef/ui";
import { TruncatedText } from "@/components/common/TruncatedText";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getDateFiltersForPeriod(period: string): { startDate?: string; endDate?: string } {
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

function fmtDate(phpDateStr: string, language: string = "en-US"): string {
  const d = parsePhpDateToDate(phpDateStr);
  if (!d) return "N/A";
  return d.toLocaleDateString(language, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/St_Johns",
  });
}

function fmtDateTime(phpDateStr: string, language: string = "en-US"): string {
  const d = parsePhpDateToDate(phpDateStr);
  if (!d) return "N/A";
  return d.toLocaleDateString(language, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/St_Johns",
  });
}

function fmtTime(phpDateStr: string, language: string = "en-US"): string {
  const d = parsePhpDateToDate(phpDateStr);
  if (!d) return "";
  return d.toLocaleTimeString(language, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/St_Johns",
  });
}

function getPayoutBadge(status: "due" | "paid", t: (key: string, defaultValue: string) => string) {
  if (status === "paid") {
    return <Badge variant="success">{t("revenuePaidBadge", "Paid")}</Badge>;
  }
  return <Badge variant="warning">{t("revenueDueBadge", "Due")}</Badge>;
}

function getDeliveryLabel(method: string, provider: string, t: (key: string, defaultValue: string) => string): string {
  if (method === "pickup") return t("revenueDeliveryPickup", "Pickup");
  if (provider === "uber_direct") return t("revenueDeliveryUberDirect", "Uber Direct");
  return t("revenueDeliveryInHouse", "In-House Delivery");
}

function getDeliveryIcon(method: string, provider: string, t: (key: string, defaultValue: string) => string) {
  if (method === "pickup") return <PickupOrderIcon className="h-4 w-4 text-black" />;
  if (provider === "uber_direct") return <SiUber className="h-5 w-5" />;
  return <img src={locoLogo} alt={t("revenueLocalCooksAlt", "Local Cooks")} className="h-5 w-5 object-contain" />;
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
            <TruncatedText className="truncate">{item.name}</TruncatedText>
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

function exportOrdersCSV(orders: SellerOrder[], t: (key: string, defaultValue: string) => string, language: string = "en-US") {
  const headers = [
    t("revenueCsvHeaderOrderId", "Order ID"), t("revenueCsvHeaderType", "Type"), t("revenueCsvHeaderDate", "Date"), t("revenueCsvHeaderCustomer", "Customer"), t("revenueCsvHeaderItems", "Items"),
    t("revenueCsvHeaderShopCharge", "Shop Charge"), t("revenueCsvHeaderTaxCollected", "Tax Collected"), t("revenueCsvHeaderDiscount", "Discount"), t("revenueCsvHeaderStripeFee", "Stripe Fee"), t("revenueCsvHeaderTipChef", "Tip (Chef)"),
    t("revenueCsvHeaderYourEarnings", "Your Earnings"), t("revenueCsvHeaderPayoutStatus", "Payout Status"), t("revenueCsvHeaderDeliveryMethod", "Delivery Method"),
  ];
  const rows = orders.map((o) => [
    o.id,
    o.type === "pre_order" ? t("revenueOrderTypePreOrder", "Pre-Order") : t("revenueOrderTypeOrder", "Order"),
    fmtDateTime(o.order_time, language),
    o.customer_name,
    `"${parseOrderItems(o.items_description).map(item => `${item.qty}x ${item.name} @ $${item.price.toFixed(2)}`).join('\n')}"`,
    fmtDollars(o.shopcharge),
    fmtDollars(o.discount_amt),
    fmtDollars(o.stripe_fee),
    fmtDollars(o.commission),
    fmtDollars(o.tip_chef),
    fmtDollars(o.chef_earnings),
    o.payout_status,
    getDeliveryLabel(o.order_method, o.delivery_provider, t),
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
  const { t } = useTranslation("chef");
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
    <Card className="border-dashed border-2 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">{t("revenueLinkAccountTitle", "Link Your Seller Account")}</CardTitle>
        </div>
        <CardDescription>
          {t("revenueLinkAccountDescription", "Connect your LocalCooks seller account to view your food order revenue here.")}
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
          {t("revenueAutoLinkByEmail", "Auto-Link by Email")}
        </Button>

        {linkShopMutation.isError && (
          <div className="space-y-2">
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {linkShopMutation.error.message}
            </p>
            {!showManualInput && (
              <Button variant="outline" size="sm" onClick={() => setShowManualInput(true)}>
                {t("revenueEnterSellerEmailManually", "Enter seller email manually")}
              </Button>
            )}
          </div>
        )}

        {showManualInput && (
          <div className="flex gap-2">
            <Input
              placeholder={t("revenueSellerEmailPlaceholder", "Enter your seller account email")}
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              className="max-w-sm"
            />
            <Button
              onClick={() => { if (manualEmail.trim()) linkShopMutation.mutate({ email: manualEmail.trim() }); }}
              disabled={linkShopMutation.isPending || !manualEmail.trim()}
            >
              {linkShopMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("revenueLink", "Link")}
            </Button>
          </div>
        )}

        {linkShopMutation.isSuccess && (
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4 text-success" />
            {t("revenueSuccessfullyLinked", { shopName: linkShopMutation.data.shop.sname, defaultValue: "Successfully linked to {shopName}!" })}
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
  const { t } = useTranslation("chef");
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
          {t("revenueFailedToLoadEarnings", "Failed to load earnings data. Please try again.")}
        </CardContent>
      </Card>
    );
  }

  const { earnings, by_delivery_method } = data;
  const summaryCards = [
    {
      label: t("revenueTotalEarnings", "Total Earnings"),
      value: fmtDollars(earnings.total_earnings),
      hint: t("revenueOrdersIncludesTips", { count: earnings.total_orders + earnings.total_pre_orders, defaultValue: "{count, plural, one {# order (includes tips)} other {# orders (includes tips)}}" }),
      tone: "neutral" as const,
      tooltip: t("revenueTotalEarningsTooltip", "Your total revenue generated across all payment statuses (Due + Paid). This amount already includes all tips, and is exactly equal to the sum of your Pickup, In-House Delivery, and Uber Direct earnings."),
    },
    {
      label: t("revenueDueEarnings", "Due Earnings"),
      value: fmtDollars(earnings.total_due),
      hint: t("revenueOrdersCount", { count: data.by_payment_status.due.count, defaultValue: "{count, plural, one {# order} other {# orders}}" }),
      tone: "warning" as const,
      tooltip: t("revenueDueEarningsTooltip", "Funds currently being processed by Stripe or held in your pending balance. These will be automatically paid out to your connected bank account according to your Stripe payout schedule (usually 2-7 rolling days)."),
    },
    {
      label: t("revenuePaidEarnings", "Paid Earnings"),
      value: fmtDollars(earnings.total_paid),
      hint: t("revenueOrdersCount", { count: data.by_payment_status.paid.count, defaultValue: "{count, plural, one {# order} other {# orders}}" }),
      tone: "success" as const,
      tooltip: t("revenuePaidEarningsTooltip", "Funds that have been successfully deposited into your connected bank account by Stripe. It may take 1-2 business days for your bank to reflect the transfer."),
    },
    {
      label: t("revenueTipsIncludedInTotal", "Tips (included in total)"),
      value: fmtDollars(earnings.total_tips),
      hint: t("revenueTipRate", { rate: ((earnings.total_tips / (earnings.total_earnings || 1)) * 100).toFixed(1), defaultValue: "{rate}% tip rate" }),
      tone: "neutral" as const,
      tooltip: t("revenueTipsTooltip", "Total tips provided by your customers. Note: These tips are already included in your Total Earnings figure."),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <StatTile
            key={card.label}
            label={card.label}
            value={card.value}
            hint={card.hint}
            tone={card.tone}
            tooltip={card.tooltip}
          />
        ))}
      </div>

      <div className="pt-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">{t("revenueByDeliveryMethod", "Earnings by Delivery Method")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([
          { 
            key: "pickup" as const, 
            label: t("revenueDeliveryPickup", "Pickup"), 
            icon: <PickupOrderIcon className="h-5 w-5 text-muted-foreground" />,
            data: by_delivery_method.pickup,
            tooltip: t("revenuePickupTooltip", "Revenue from orders picked up directly by the customer from your location. This is one of the three components that sum up to your Total Earnings.")
          },
          { 
            key: "inhouse" as const, 
            label: t("revenueDeliveryInHouse", "In-House Delivery"), 
            icon: <img src={locoLogo} alt={t("revenueLocalCooksAlt", "Local Cooks")} className="h-5 w-5 object-contain opacity-70" />,
            data: by_delivery_method.inhouse,
            tooltip: t("revenueInHouseTooltip", "Revenue from orders delivered by Local Cooks delivery partners. This is one of the three components that sum up to your Total Earnings.")
          },
          { 
            key: "uber_direct" as const, 
            label: t("revenueDeliveryUberDirect", "Uber Direct"), 
            icon: <SiUber className="h-5 w-5 text-muted-foreground" />,
            data: by_delivery_method.uber_direct,
            tooltip: t("revenueUberDirectTooltip", "Revenue from orders delivered via the Uber Direct integration. This is one of the three components that sum up to your Total Earnings.")
          },
        ]).map((item) => (
          <Card key={item.key} className="shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 h-5">
                {item.label}
                {item.tooltip && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center justify-center p-0 m-0 border-none bg-transparent outline-none ring-0">
                        <Info className="h-4 w-4 text-muted-foreground/70 hover:text-muted-foreground cursor-help" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="w-[280px] p-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {item.tooltip}
                      </p>
                    </PopoverContent>
                  </Popover>
                )}
              </CardTitle>
              <div className="flex h-9 w-9 items-center justify-center rounded-md border shrink-0">
                {item.icon}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmtDollars(item.data.earnings)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("revenueOrdersCount", { count: item.data.count, defaultValue: "{count, plural, one {# order} other {# orders}}" })}
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
  const { t, i18n } = useTranslation("chef");
  const { toast } = useToast();

  if (!order) return null;

  const revenueItems = [
    { label: t("revDetailShopCharge", "Shop Charge (Food Total)"), value: order.shopcharge, icon: <Receipt className="h-4 w-4" /> },
    { label: t("revDetailTaxCollected", "Tax Collected"), value: order.commission, icon: <Receipt className="h-4 w-4" /> },
    { label: t("revTipChef", "Tip (Chef)"), value: order.tip_chef, icon: <TrendingUp className="h-4 w-4" />, highlight: true },
  ].filter(item => item.value > 0 || item.label === t("revDetailShopCharge", "Shop Charge (Food Total)") || item.label === t("revDetailTaxCollected", "Tax Collected"));

  const deductions = [
    { label: t("revDetailDiscountApplied", "Discount Applied"), value: order.discount_amt },
    { label: t("revDetailStripeFee", "Stripe Processing Fee"), value: order.stripe_fee },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {order.type === "pre_order" ? t("revPreOrder", "Pre-Order") : t("revOrder", "Order")} #{order.id}
          </SheetTitle>
          <SheetDescription>
            {t("revOrderDetailsSubtitle", "Full financial breakdown for this order")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Order Info */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{t("revDetailCustomer", "Customer")}</span>
              </div>
              <span className="font-medium text-sm">{order.customer_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{t("revDetailOrderDate", "Order Date")}</span>
              </div>
              <span className="font-medium text-sm">{fmtDateTime(order.order_time, i18n.language)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {getDeliveryIcon(order.order_method, order.delivery_provider, t)}
                <span className="text-muted-foreground">{t("revDetailDelivery", "Delivery")}</span>
              </div>
              <span className="font-medium text-sm">
                {getDeliveryLabel(order.order_method, order.delivery_provider, t)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{t("revDetailPayoutStatus", "Payout Status")}</span>
              </div>
              {getPayoutBadge(order.payout_status, t)}
            </div>
            <div className="pt-1">
              <p className="text-xs text-muted-foreground mb-2">{t("revDetailItemsOrdered", "Items Ordered")}</p>
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
              {t("revDetailRevenueBreakdown", "Revenue Breakdown")}
            </h4>
            <div className="space-y-2">
              {revenueItems.map((item) => (
                <div
                  key={item.label}
                  className={cn(
                    "flex items-center justify-between py-1.5 px-2 rounded-md text-sm",
                    item.highlight && item.value > 0 && "bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {item.icon}
                    {item.label}
                  </div>
                  <span className="font-medium">
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
              {t("revDetailDeductions", "Deductions")}
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
          <div className="flex items-center justify-between py-3 px-3 border rounded-lg bg-muted/30">
            <div>
              <p className="text-sm font-semibold">{t("revDetailYourEarnings", "Your Earnings")}</p>
              <p className="text-xs text-muted-foreground">{t("revDetailAfterFees", "After all fees and deductions")}</p>
            </div>
            <p className="text-2xl font-bold">{fmtDollars(order.chef_earnings)}</p>
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
                    title: t("trCertFailTitle"),
                    description: error instanceof Error ? error.message : t("revInvoiceCouldNotDownload"),
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
              {isDownloading ? t("revDownloading", "Downloading...") : t("revDetailDownloadInvoice", "Download Invoice PDF")}
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

function getOrderColumns(onSelectOrder: (order: SellerOrder) => void, t: ChefTFunction, language: string = "en-US"): ColumnDef<SellerOrder>[] {
  return [
    {
      id: "reference",
      header: t("revColRef", "Ref"),
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
          {t("revColDate", "Date")}
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const o = row.original;
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 text-sm font-medium">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {fmtDate(o.order_time, language)}
            </div>
            <div className="text-xs text-muted-foreground">{fmtTime(o.order_time, language)}</div>
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
      header: t("revColOrder", "Order"),
      cell: ({ row }) => {
        const o = row.original;
        return (
          <div className="flex items-center gap-2">
            {getDeliveryIcon(o.order_method, o.delivery_provider, t)}
            <div>
              <span className="text-sm font-medium">
                {o.type === "pre_order" ? t("revColPre", "Pre") : ""} #{o.id}
              </span>
              <p className="text-xs text-muted-foreground">
                {getDeliveryLabel(o.order_method, o.delivery_provider, t)}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "customer_name",
      header: t("revColCustomer", "Customer"),
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
      header: () => <div className="text-right w-full pr-2">{t("revColTax", "Tax")}</div>,
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
          {t("revColEarnings")}
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const o = row.original;
        return (
          <div className="text-right">
            <div className="text-sm font-semibold">{fmtDollars(o.chef_earnings)}</div>
            {o.tip_chef > 0 && (
              <div className="text-xs text-muted-foreground">+{fmtDollars(o.tip_chef)} {t("revColTip", "tip")}</div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "payout_status",
      header: t("revColStatus", "Status"),
      cell: ({ row }) => getPayoutBadge(row.original.payout_status, t),
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
          {t("revActionDetails")}
        </Button>
      ),
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELLER ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

function SellerAnalytics({ period, sellerId }: { period: string; sellerId?: string | number }) {
  const { t } = useTranslation("chef");
  const dateFilters = useMemo(() => getDateFiltersForPeriod(period), [period]);
  
  const { data, isLoading: ordersLoading } = useSellerOrders({
    status: "all",
    page: 1,
    limit: 1000,
    startDate: dateFilters.startDate,
  });

  const { data: retentionData, isLoading: retentionLoading } = useSellerRetention({
    startDate: dateFilters.startDate,
    endDate: dateFilters.endDate,
  });

  const isLoading = ordersLoading || retentionLoading;

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
        const timeWindow = hour < 12 ? t('revMorningWindow') : hour < 17 ? t('revAfternoonWindow') : t('revEveningWindow');
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
    
    const customerList = Object.values(customerStats);
    const topCustomers = customerList.sort((a, b) => b.count - a.count || b.revenue - a.revenue);
    
    const returningPct = retentionData?.retentionRate ?? 0;
    
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
  }, [orders, retentionData]);

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="pt-6"><Skeleton className="h-48 w-full" /></CardContent>
      </Card>
    );
  }

  if (!analytics) return null;

  return (
    <Card className="mb-6 overflow-hidden shadow-none">
      <CardHeader className="pb-4 border-b">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
          {t("revInsightsTitle")}
        </CardTitle>
        <CardDescription>{t("revInsightsDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x">
          
          {/* Business Analytics Column */}
          <div className="p-6 lg:col-span-2 space-y-6">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              {t("revSalesEngagement")}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4"><DollarSign className="h-3.5 w-3.5"/>{t("revAvgOrder")}</p>
                <p className="text-xl font-bold">{fmtDollars(analytics.aov)}</p>
              </div>
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4">
                  <Users className="h-3.5 w-3.5"/>
                  <span>{t("revRetentionRate")}</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center justify-center p-0 m-0 h-4 w-4 border-none bg-transparent outline-none ring-0">
                        <Info className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-muted-foreground cursor-help" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="w-[280px] p-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("revRetentionTooltip")}
                      </p>
                      <a 
                        href="https://www.bdc.ca/en/articles-tools/entrepreneur-toolkit/templates-business-guides/glossary/customer-retention-rate" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-xs text-foreground underline underline-offset-2 mt-2 inline-block font-medium"
                      >
                        {t("revRetentionLearnMore")}
                      </a>
                    </PopoverContent>
                  </Popover>
                </p>
                <p className="text-xl font-bold">{analytics.returningPct.toFixed(1)}%</p>
              </div>
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4"><ShoppingBag className="h-3.5 w-3.5"/>{t("revItemsPerOrder")}</p>
                <p className="text-xl font-bold">{analytics.itemsPerOrder.toFixed(1)}</p>
              </div>
              <div className="space-y-1 bg-muted/20 p-3 rounded-lg border border-muted/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 h-4"><Calendar className="h-3.5 w-3.5"/>{t("revPreOrders")}</p>
                <p className="text-xl font-bold">{((analytics.preOrderCount / analytics.totalOrders) * 100).toFixed(0)}%</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
              {analytics.topItems.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2"><Star className="h-4 w-4 text-muted-foreground"/>{t("revTopSellingItems")}</h4>
                  <div className="space-y-2">
                    {analytics.topItems.slice(0, 4).map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-sm p-2 bg-muted/30 rounded-md hover:bg-muted/50 transition-colors">
                        <TruncatedText className="font-medium truncate pr-2">{item.name}</TruncatedText>
                        <div className="text-right flex-shrink-0">
                          <span className="font-bold">{item.qty}x</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground"/>{t("revPeakHours")}</h4>
                <div className="space-y-2">
                  {analytics.peakHours.map((ph, i) => (
                    <div key={i} className="flex justify-between items-center text-sm p-2 bg-muted/30 rounded-md hover:bg-muted/50 transition-colors">
                      <span>{ph.window}</span>
                      <span className="font-medium">{t("revPeakOrders", { count: ph.count })}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top Customers Column */}
          <div className="p-6 lg:col-span-1 border-t lg:border-t-0">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-6">
              <Users className="h-4 w-4 text-muted-foreground" />
              {t("revTopCustomers")}
            </h3>
            
            {analytics.topCustomers.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">
                {t("revNoCustomerData")}
              </div>
            ) : (
              <div className="space-y-3">
                {analytics.topCustomers.map((customer, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-background rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-bold text-xs shrink-0">
                        {customer.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <TruncatedText as="p" className="text-sm font-semibold leading-none truncate">{customer.name}</TruncatedText>
                        <p className="text-xs text-muted-foreground mt-1">{t("revOrdersCountShort", { count: customer.count })}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">{fmtDollars(customer.revenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <div className="mt-6 pt-6 border-t">
              <h4 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-1.5"><Truck className="h-3.5 w-3.5"/>{t("revFulfillmentSplit")}</h4>
              <div className="flex items-center gap-0.5">
                <div 
                  className="h-2 bg-foreground/70 rounded-l-full" 
                  style={{ width: `${Math.max((analytics.pickupCount / analytics.totalOrders) * 100, 2)}%` }}
                />
                <div 
                  className="h-2 bg-muted-foreground/40 rounded-r-full" 
                  style={{ width: `${Math.max((analytics.deliveryCount / analytics.totalOrders) * 100, 2)}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs font-medium text-muted-foreground">
                <span>{t("revPickupPct", { pct: ((analytics.pickupCount / analytics.totalOrders) * 100).toFixed(0) })}</span>
                <span>{t("revDeliveryPct", { pct: ((analytics.deliveryCount / analytics.totalOrders) * 100).toFixed(0) })}</span>
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
  const { t, i18n } = useTranslation("chef");
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
          {t("revExportReport")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("revExportDialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("revQuickPresets")}</span>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => handlePreset(7)}>{t("revLast7Days")}</Button>
              <Button variant="outline" size="sm" onClick={() => handlePreset(30)}>{t("revLast30Days")}</Button>
              <Button variant="outline" size="sm" onClick={handleMonthlyPreset}>{t("revLastMonth")}</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t("revStartDate")}</label>
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
              <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
              Download Statement (PDF)
            </Button>
            <Button onClick={() => downloadSecureReport('csv')} variant="outline" disabled={isDownloading || !startDate || !endDate} className="w-full justify-start">
              <FileSpreadsheet className="mr-2 h-4 w-4 text-muted-foreground" />
              Download Data (CSV)
            </Button>
            <Button onClick={() => { setOpen(false); exportOrdersCSV(orders, t, i18n.language); }} variant="outline" disabled={orders.length === 0} className="w-full justify-start mt-2 border-dashed">
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
  const { t, i18n } = useTranslation("chef");
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
      }, t, i18n.language),
    [t, i18n.language]
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
      <Card className="shadow-none">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                {t("revOrderHistory")}
              </CardTitle>
              <CardDescription>
                {t("revOrdersCount", { shown: filteredOrders.length, total: orders.length })}
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-auto">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={t("revSearchOrders")}
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
                {t("revRefresh")}
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
                {t("revFilterAll")}
                <Badge variant="count" className="ml-1.5">{orders.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="due" className="flex-1 text-xs sm:text-sm">
                {t("revFilterDue")}
                <Badge variant="count" className="ml-1.5">{dueOrders.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="paid" className="flex-1 text-xs sm:text-sm">
                {t("revFilterPaid")}
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
              <p className="text-sm text-destructive">{t("revLoadFailed")}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" /> {t("revRetry")}
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
                          className="hover:bg-muted/50 cursor-pointer"
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
                            <p className="text-sm font-medium">{t("revNoOrders")}</p>
                            <p className="text-sm text-muted-foreground">
                              {searchQuery
                                ? t("revNoOrdersMatch")
                                : payoutFilter !== "all"
                                  ? t("revNoStatusOrders", { status: payoutFilter === "due" ? t("revFilterDue") : t("revFilterPaid") })
                                  : t("revNoOrdersFound")}
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
  const { t } = useTranslation("chef");
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
      {t("revViewStripeDashboard")}
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHP SELLER DASHBOARD BUTTON
// ═══════════════════════════════════════════════════════════════════════════════

function PhpSellerDashboardButton({ className }: { className?: string }) {
  const { t } = useTranslation("chef");
  return (
    <Button variant="outline" onClick={openChefShopHome} className={cn("gap-2", className)}>
      <Store className="h-4 w-4" />
      {t("revSellerAccount")}
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ChefSellerRevenue() {
  const { t } = useTranslation("chef");
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
          <ChefPageHeader
            title={t("revPageTitle")}
            description={t("revPageDesc")}
            actions={
              <>
                <Tabs value={period} onValueChange={setPeriod} className="w-full sm:w-auto">
                  <TabsList className="h-8 w-full sm:w-auto">
                    <TabsTrigger value="all" className="text-xs px-3 h-7 flex-1 sm:flex-none">{t("revTabAllTime")}</TabsTrigger>
                    <TabsTrigger value="month" className="text-xs px-3 h-7 flex-1 sm:flex-none">{t("revTab30Days")}</TabsTrigger>
                    <TabsTrigger value="week" className="text-xs px-3 h-7 flex-1 sm:flex-none">{t("revTab7Days")}</TabsTrigger>
                    <TabsTrigger value="today" className="text-xs px-3 h-7 flex-1 sm:flex-none">{t("revTabToday")}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <PhpSellerDashboardButton className="w-full sm:w-auto" />
                <StripeDashboardButton className="w-full sm:w-auto" />
              </>
            }
          />

          {!shopStatus?.phpShopStripeAccountId && (
            <QuietNotice title={t("revStripeNotConnected")}>
              {t("revStripeNotConnectedBody")}
            </QuietNotice>
          )}

          <QuietNotice>
            {t("revRevenueNotice")}{shopStatus?.phpShopStripeAccountId ? <span dangerouslySetInnerHTML={{ __html: t("revRevenueNoticeStripe") }} /> : <span dangerouslySetInnerHTML={{ __html: t("revRevenueNoticeConnect") }} />}
          </QuietNotice>

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
