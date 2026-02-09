/**
 * Admin Transaction History Section
 * 
 * Enterprise-grade transaction history for admins across all locations and kitchens.
 * Full Stripe details (payment intent IDs, charge IDs, customer IDs, payment methods, etc.)
 * Searchable by booking ID, storage booking ID, equipment ID, payment intent ID, etc.
 * TanStack Table with sorting (default: createdAt DESC), filtering, pagination, CSV export.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
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
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  Download,
  ChevronDown,
  RefreshCw,
  CreditCard,
  Receipt,
  CheckCircle,
  DollarSign,
  ArrowUpDown,
  Calendar,
  Building2,
  Package,
  ChefHat,
  Copy,
  ExternalLink,
  AlertTriangle,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate as sharedFormatDate, formatTime as sharedFormatTime, formatCurrency as sharedFormatCurrency, formatPrice, downloadCSV as sharedDownloadCSV } from "@/lib/formatters";

// Types
interface AdminTransaction {
  id: number;
  bookingId: number;
  bookingType: "kitchen" | "storage" | "equipment" | "bundle";
  chefId: number | null;
  managerId: number | null;
  // Amounts (cents)
  amount: number;
  baseAmount: number;
  serviceFee: number;
  stripeProcessingFee: number;
  managerRevenue: number;
  refundAmount: number;
  netAmount: number;
  currency: string;
  // Stripe IDs
  paymentIntentId: string | null;
  chargeId: string | null;
  refundId: string | null;
  paymentMethodId: string | null;
  stripeCustomerId: string | null;
  // Status
  status: string;
  stripeStatus: string | null;
  bookingStatus: string | null;
  bookingPaymentStatus: string | null;
  // Metadata
  metadata: Record<string, unknown> | null;
  refundReason: string | null;
  failureReason: string | null;
  webhookEventId: string | null;
  // Timestamps
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  lastSyncedAt: string | null;
  // Joined fields
  chefEmail: string | null;
  chefName: string | null;
  managerEmail: string | null;
  locationId: number | null;
  locationName: string | null;
  kitchenId: number | null;
  kitchenName: string | null;
  itemName: string | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  kitchenStartTime: string | null;
  kitchenEndTime: string | null;
}

interface LocationOption {
  id: number;
  name: string;
}

type StatusFilter = "all" | "succeeded" | "refunded" | "pending" | "failed" | "canceled";

// Helpers — use shared formatters from @/lib/formatters
const formatCurrency = sharedFormatCurrency;
const formatDateSt = sharedFormatDate;
const formatTimeSt = sharedFormatTime;

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function getStatusBadge(status: string, refundAmount: number) {
  if (status === "refunded" || (status === "partially_refunded" && refundAmount > 0)) {
    return (
      <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
        {status === "partially_refunded" ? "Partial Refund" : "Refunded"}
      </Badge>
    );
  }
  if (status === "succeeded") {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
        Completed
      </Badge>
    );
  }
  if (status === "authorized") {
    return (
      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
        Authorized
      </Badge>
    );
  }
  if (status === "pending" || status === "processing") {
    return (
      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
        {status === "processing" ? "Processing" : "Pending"}
      </Badge>
    );
  }
  if (status === "canceled") {
    return (
      <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
        No Charge
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        Failed
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

interface TimelineEvent {
  timestamp: string;
  label: string;
  detail?: string;
  color: "green" | "blue" | "purple" | "red" | "yellow" | "gray";
}

function buildTransactionTimeline(tx: AdminTransaction): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const meta = tx.metadata as any;

  // 1. Transaction created (checkout initiated)
  if (tx.createdAt) {
    events.push({ timestamp: tx.createdAt, label: "Transaction Created", detail: `Payment intent created for ${tx.bookingType} booking #${tx.bookingId}`, color: "blue" });
  }

  // 2. Stripe fees synced
  if (meta?.stripeFees?.syncedAt) {
    events.push({ timestamp: meta.stripeFees.syncedAt, label: "Stripe Fees Synced", detail: `Processing fee: ${formatCurrency(meta.stripeFees.processingFee || 0)}, Platform fee: ${formatCurrency(meta.stripeFees.platformFee || 0)}`, color: "gray" });
  }

  // 3. Payment captured / paid
  if (meta?.capturedAt) {
    const capturedAmt = meta.capturedAmount != null ? formatCurrency(meta.capturedAmount) : formatCurrency(tx.amount);
    const partial = meta.partialCapture ? " (partial capture)" : "";
    events.push({ timestamp: meta.capturedAt, label: "Payment Captured", detail: `${capturedAmt} captured${partial}`, color: "green" });
  } else if (tx.paidAt) {
    events.push({ timestamp: tx.paidAt, label: "Payment Succeeded", detail: `${formatCurrency(tx.amount)} charged`, color: "green" });
  }

  // 4. Authorization voided / canceled
  if (tx.status === "canceled" && !tx.paidAt) {
    const ts = tx.updatedAt || tx.createdAt;
    events.push({ timestamp: ts, label: "Authorization Voided", detail: meta?.originalAuthorizedAmount ? `${formatCurrency(meta.originalAuthorizedAmount)} hold released` : "Card hold released — no charge", color: "gray" });
  }

  // 5. Each refund
  if (meta?.refunds && Array.isArray(meta.refunds)) {
    for (const refund of meta.refunds) {
      if (refund.createdAt) {
        events.push({
          timestamp: refund.createdAt,
          label: "Refund Issued",
          detail: `${formatCurrency(refund.customerReceived || 0)} to customer, ${formatCurrency(refund.managerDebited || 0)} from manager${refund.reason ? ` — "${refund.reason}"` : ""}`,
          color: "purple",
        });
      }
    }
  } else if (tx.refundedAt && tx.refundAmount > 0) {
    events.push({ timestamp: tx.refundedAt, label: "Refund Issued", detail: `${formatCurrency(tx.refundAmount)} refunded${tx.refundReason ? ` — "${tx.refundReason}"` : ""}`, color: "purple" });
  }

  // 6. Failure
  if (tx.status === "failed" && tx.failureReason) {
    const ts = tx.updatedAt || tx.createdAt;
    events.push({ timestamp: ts, label: "Payment Failed", detail: tx.failureReason, color: "red" });
  }

  // 7. Last synced
  if (tx.lastSyncedAt && tx.lastSyncedAt !== tx.createdAt) {
    events.push({ timestamp: tx.lastSyncedAt, label: "Last Stripe Sync", color: "gray" });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return events;
}

const timelineColorMap: Record<TimelineEvent["color"], string> = {
  green: "bg-green-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
  yellow: "bg-yellow-500",
  gray: "bg-gray-400",
};

function getBookingTypeIcon(type: string) {
  switch (type) {
    case "kitchen":
      return <ChefHat className="h-4 w-4 text-orange-600" />;
    case "storage":
      return <Package className="h-4 w-4 text-purple-600" />;
    case "equipment":
      return <Building2 className="h-4 w-4 text-blue-600" />;
    default:
      return <Receipt className="h-4 w-4 text-gray-600" />;
  }
}

function getBookingTypeLabel(type: string, metadata: Record<string, unknown> | null): string {
  if (metadata) {
    if (metadata.damage_claim_id) return "Damage Claim";
    if (metadata.overstay_id) return "Overstay Penalty";
    if (metadata.storage_extension_id) return "Storage Extension";
  }
  switch (type) {
    case "kitchen": return "Kitchen Booking";
    case "storage": return "Storage Booking";
    case "equipment": return "Equipment Rental";
    case "bundle": return "Bundle Booking";
    default: return type;
  }
}

function StripeIdCell({ label, value }: { label: string; value: string | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const short = value.length > 20 ? value.slice(0, 8) + "..." + value.slice(-6) : value;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); copyToClipboard(value); }}
            className="flex items-center gap-1 text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
          >
            {short}
            <Copy className="h-3 w-3 opacity-50" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs font-mono break-all">{label}: {value}</p>
          <p className="text-xs text-muted-foreground mt-1">Click to copy</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Detail Sheet
function TransactionDetailSheet({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: AdminTransaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!transaction) return null;
  const tx = transaction;

  const stripeFields = [
    { label: "Payment Intent", value: tx.paymentIntentId, link: tx.paymentIntentId ? `https://dashboard.stripe.com/payments/${tx.paymentIntentId}` : null },
    { label: "Charge ID", value: tx.chargeId },
    { label: "Refund ID", value: tx.refundId },
    { label: "Payment Method", value: tx.paymentMethodId },
    { label: "Customer ID", value: tx.stripeCustomerId, link: tx.stripeCustomerId ? `https://dashboard.stripe.com/customers/${tx.stripeCustomerId}` : null },
    { label: "Webhook Event", value: tx.webhookEventId },
    { label: "Stripe Status", value: tx.stripeStatus },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Transaction #{tx.id}
          </SheetTitle>
          <SheetDescription>
            {getBookingTypeLabel(tx.bookingType, tx.metadata)} — Booking #{tx.bookingId}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status */}
          <div className="flex items-center gap-3">
            {getStatusBadge(tx.status, tx.refundAmount)}
            {tx.bookingStatus && (
              <Badge variant="secondary" className="text-xs">
                Booking: {tx.bookingStatus}
              </Badge>
            )}
          </div>

          {/* Transaction Timeline */}
          {(() => {
            const timeline = buildTransactionTimeline(tx);
            if (timeline.length === 0) return null;
            return (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Transaction Timeline</h4>
                <div className="relative pl-6 space-y-0">
                  {timeline.map((event, i) => (
                    <div key={`${event.label}-${i}`} className="relative pb-4 last:pb-0">
                      {i < timeline.length - 1 && (
                        <div className="absolute left-[-18px] top-3 bottom-0 w-px bg-border" />
                      )}
                      <div className={cn("absolute left-[-21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background", timelineColorMap[event.color])} />
                      <div className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{event.label}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(event.timestamp).toLocaleString("en-US", { timeZone: "America/St_Johns", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                        {event.detail && <p className="text-xs text-muted-foreground mt-0.5">{event.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Financial Details */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Financial Details</h4>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Amount</span><span className="font-medium">{formatCurrency(tx.amount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Base Amount</span><span>{formatCurrency(tx.baseAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Service Fee</span><span>{formatCurrency(tx.serviceFee)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Stripe Fee</span><span>{formatCurrency(tx.stripeProcessingFee)}</span></div>
              <div className="flex justify-between border-t pt-1.5"><span className="text-muted-foreground">Manager Revenue</span><span className="font-medium text-green-700">{formatCurrency(tx.managerRevenue)}</span></div>
              {tx.refundAmount > 0 && (
                <div className="flex justify-between text-purple-700"><span>Refunded</span><span className="font-medium">-{formatCurrency(tx.refundAmount)}</span></div>
              )}
              <div className="flex justify-between border-t pt-1.5"><span className="text-muted-foreground font-medium">Net Amount</span><span className="font-bold">{formatCurrency(tx.netAmount)}</span></div>
            </div>
          </div>

          {/* People */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">People</h4>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Chef</span><span>{tx.chefName || "—"} {tx.chefEmail ? `(${tx.chefEmail})` : ""}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Chef ID</span><span>{tx.chefId || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Manager</span><span>{tx.managerEmail || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Manager ID</span><span>{tx.managerId || "—"}</span></div>
            </div>
          </div>

          {/* Location & Kitchen */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Location & Kitchen</h4>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Location</span><span>{tx.locationName || "—"} {tx.locationId ? `(#${tx.locationId})` : ""}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Kitchen</span><span>{tx.kitchenName || "—"} {tx.kitchenId ? `(#${tx.kitchenId})` : ""}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Item</span><span>{tx.itemName || "—"}</span></div>
              {tx.bookingType === "kitchen" && tx.bookingStart && (
                <div className="flex justify-between"><span className="text-muted-foreground">Booking Date</span><span>{formatDateSt(tx.bookingStart)}</span></div>
              )}
              {tx.bookingType === "kitchen" && tx.kitchenStartTime && tx.kitchenEndTime && (
                <div className="flex justify-between"><span className="text-muted-foreground">Time</span><span>{formatTimeSt(tx.kitchenStartTime)} – {formatTimeSt(tx.kitchenEndTime)}</span></div>
              )}
              {tx.bookingType !== "kitchen" && tx.bookingStart && (
                <div className="flex justify-between"><span className="text-muted-foreground">Start Date</span><span>{formatDateSt(tx.bookingStart)}</span></div>
              )}
              {tx.bookingType !== "kitchen" && tx.bookingEnd && (
                <div className="flex justify-between"><span className="text-muted-foreground">End Date</span><span>{formatDateSt(tx.bookingEnd)}</span></div>
              )}
            </div>
          </div>

          {/* Bundled Storage Items */}
          {tx.metadata && Array.isArray((tx.metadata as any).storage_items) && (tx.metadata as any).storage_items.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Storage Items ({(tx.metadata as any).storage_items.length})</h4>
              <div className="space-y-2">
                {(tx.metadata as any).storage_items.map((item: any, idx: number) => (
                  <div key={item.id || idx} className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{item.name || "—"}</span></div>
                    {item.storageType && <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{item.storageType}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">Storage Booking ID</span><span>#{item.id || item.storageBookingId || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Listing ID</span><span>#{item.storageListingId || "—"}</span></div>
                    {item.totalPrice != null && <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-medium">{formatCurrency(item.totalPrice)}</span></div>}
                    {item.startDate && <div className="flex justify-between"><span className="text-muted-foreground">Start</span><span>{formatDateSt(item.startDate)}</span></div>}
                    {item.endDate && <div className="flex justify-between"><span className="text-muted-foreground">End</span><span>{formatDateSt(item.endDate)}</span></div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bundled Equipment Items */}
          {tx.metadata && Array.isArray((tx.metadata as any).equipment_items) && (tx.metadata as any).equipment_items.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Equipment Items ({(tx.metadata as any).equipment_items.length})</h4>
              <div className="space-y-2">
                {(tx.metadata as any).equipment_items.map((item: any, idx: number) => (
                  <div key={item.id || idx} className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{item.name || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Equipment Booking ID</span><span>#{item.id || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Listing ID</span><span>#{item.equipmentListingId || "—"}</span></div>
                    {item.totalPrice != null && <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-medium">{formatCurrency(item.totalPrice)}</span></div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approved/Rejected IDs from metadata */}
          {tx.metadata && ((tx.metadata as any).approvedStorageIds?.length > 0 || (tx.metadata as any).rejectedStorageIds?.length > 0 || (tx.metadata as any).approvedEquipmentIds?.length > 0 || (tx.metadata as any).rejectedEquipmentIds?.length > 0) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Approval Details</h4>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
                {(tx.metadata as any).approvedStorageIds?.length > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Approved Storage</span><span className="text-green-700">IDs: {(tx.metadata as any).approvedStorageIds.join(", ")}</span></div>
                )}
                {(tx.metadata as any).rejectedStorageIds?.length > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Rejected Storage</span><span className="text-red-700">IDs: {(tx.metadata as any).rejectedStorageIds.join(", ")}</span></div>
                )}
                {(tx.metadata as any).approvedEquipmentIds?.length > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Approved Equipment</span><span className="text-green-700">IDs: {(tx.metadata as any).approvedEquipmentIds.join(", ")}</span></div>
                )}
                {(tx.metadata as any).rejectedEquipmentIds?.length > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Rejected Equipment</span><span className="text-red-700">IDs: {(tx.metadata as any).rejectedEquipmentIds.join(", ")}</span></div>
                )}
                {(tx.metadata as any).approvedSubtotal != null && (
                  <div className="flex justify-between border-t pt-1.5"><span className="text-muted-foreground">Approved Subtotal</span><span className="font-medium">{formatCurrency((tx.metadata as any).approvedSubtotal)}</span></div>
                )}
                {(tx.metadata as any).approvedTax != null && (tx.metadata as any).approvedTax > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatCurrency((tx.metadata as any).approvedTax)}</span></div>
                )}
                {(tx.metadata as any).originalAuthorizedAmount != null && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Original Authorized</span><span>{formatCurrency((tx.metadata as any).originalAuthorizedAmount)}</span></div>
                )}
                {(tx.metadata as any).capturedAmount != null && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Captured Amount</span><span className="font-medium">{formatCurrency((tx.metadata as any).capturedAmount)}</span></div>
                )}
                {(tx.metadata as any).partialCapture && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Partial Capture</span><span><Badge variant="outline" className="text-xs">Yes</Badge></span></div>
                )}
              </div>
            </div>
          )}

          {/* Refund History from metadata */}
          {tx.metadata && Array.isArray((tx.metadata as any).refunds) && (tx.metadata as any).refunds.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Refund History ({(tx.metadata as any).refunds.length})</h4>
              <div className="space-y-2">
                {(tx.metadata as any).refunds.map((refund: any, idx: number) => (
                  <div key={refund.id || idx} className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Refund ID</span><span className="font-mono text-xs">{refund.id || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Customer Received</span><span className="font-medium text-purple-700">{formatCurrency(refund.customerReceived || 0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Manager Debited</span><span>{formatCurrency(refund.managerDebited || 0)}</span></div>
                    {refund.reason && <div className="flex justify-between"><span className="text-muted-foreground">Reason</span><span>{refund.reason}</span></div>}
                    {refund.createdAt && <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{new Date(refund.createdAt).toLocaleString("en-US", { timeZone: "America/St_Johns" })}</span></div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stripe IDs */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Stripe Details</h4>
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
              {stripeFields.map((field) => (
                <div key={field.label} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs whitespace-nowrap">{field.label}</span>
                  <div className="flex items-center gap-1">
                    {field.value ? (
                      <>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(field.value!)}
                          className="font-mono text-xs text-blue-600 hover:underline cursor-pointer truncate max-w-[200px]"
                          title={field.value}
                        >
                          {field.value}
                        </button>
                        <Copy className="h-3 w-3 text-muted-foreground cursor-pointer" onClick={() => copyToClipboard(field.value!)} />
                        {field.link && (
                          <a href={field.link} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-blue-600" />
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timestamps */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Timestamps</h4>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{new Date(tx.createdAt).toLocaleString("en-US", { timeZone: "America/St_Johns" })}</span></div>
              {tx.paidAt && <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>{new Date(tx.paidAt).toLocaleString("en-US", { timeZone: "America/St_Johns" })}</span></div>}
              {tx.refundedAt && <div className="flex justify-between"><span className="text-muted-foreground">Refunded</span><span>{new Date(tx.refundedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" })}</span></div>}
              {tx.lastSyncedAt && <div className="flex justify-between"><span className="text-muted-foreground">Last Synced</span><span>{new Date(tx.lastSyncedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" })}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Updated</span><span>{new Date(tx.updatedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" })}</span></div>
            </div>
          </div>

          {/* Failure / Refund Reason */}
          {(tx.failureReason || tx.refundReason) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Notes</h4>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
                {tx.failureReason && (
                  <div className="flex items-start gap-2 text-red-700">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div><span className="font-medium">Failure:</span> {tx.failureReason}</div>
                  </div>
                )}
                {tx.refundReason && (
                  <div className="flex items-start gap-2 text-purple-700">
                    <RefreshCw className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div><span className="font-medium">Refund Reason:</span> {tx.refundReason}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Metadata */}
          {tx.metadata && Object.keys(tx.metadata).length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">
                Raw Metadata
              </summary>
              <pre className="mt-2 bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto max-h-60">
                {JSON.stringify(tx.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Column definitions
function getAdminTransactionColumns(
  onViewDetails: (tx: AdminTransaction) => void
): ColumnDef<AdminTransaction>[] {
  return [
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 -ml-3"
        >
          Created
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const tx = row.original;
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 text-sm font-medium">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/St_Johns" })}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(tx.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/St_Johns" })}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "id",
      header: "TX #",
      cell: ({ row }) => (
        <span className="text-xs font-mono text-muted-foreground">#{row.original.id}</span>
      ),
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
            <div>
              <span className="text-sm font-medium">{label}</span>
              <div className="text-xs text-muted-foreground">Booking #{tx.bookingId}</div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "chefName",
      header: "Chef",
      cell: ({ row }) => {
        const tx = row.original;
        return (
          <div className="space-y-0.5">
            <div className="text-sm font-medium">{tx.chefName || "—"}</div>
            {tx.chefEmail && <div className="text-xs text-muted-foreground truncate max-w-[150px]">{tx.chefEmail}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: "locationName",
      header: "Location",
      cell: ({ row }) => {
        const tx = row.original;
        return (
          <div className="space-y-0.5">
            <div className="text-sm font-medium">{tx.locationName || "—"}</div>
            {tx.kitchenName && <div className="text-xs text-muted-foreground truncate max-w-[130px]">{tx.kitchenName}</div>}
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
        const isVoided = tx.status === "canceled";
        return (
          <div className="text-right">
            {isVoided ? (
              <>
                <div className="font-medium text-sm text-muted-foreground">No Charge</div>
                {tx.amount > 0 && <div className="text-xs text-gray-400 line-through">{formatCurrency(tx.amount)}</div>}
              </>
            ) : (
              <>
                <div className="font-medium text-sm">{formatCurrency(tx.amount)}</div>
                {tx.refundAmount > 0 && <div className="text-xs text-purple-600">-{formatCurrency(tx.refundAmount)} refunded</div>}
              </>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "stripeProcessingFee",
      header: "Stripe Fee",
      cell: ({ row }) => {
        const fee = row.original.stripeProcessingFee;
        return <div className="text-right text-xs text-muted-foreground">{fee > 0 ? formatCurrency(fee) : "—"}</div>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original.status, row.original.refundAmount),
    },
    {
      accessorKey: "paymentIntentId",
      header: "Payment Intent",
      cell: ({ row }) => <StripeIdCell label="PI" value={row.original.paymentIntentId} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewDetails(row.original)}
          className="h-7 w-7 p-0"
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];
}

// CSV Export
function transactionsToCSV(transactions: AdminTransaction[]): string {
  const headers = [
    "TX ID", "Booking ID", "Booking Type", "Status", "Stripe Status",
    "Chef Name", "Chef Email", "Chef ID", "Manager Email", "Manager ID",
    "Location", "Location ID", "Kitchen", "Kitchen ID",
    "Amount (CAD)", "Base Amount", "Service Fee", "Stripe Fee", "Manager Revenue", "Refund Amount", "Net Amount",
    "Payment Intent ID", "Charge ID", "Refund ID", "Payment Method ID", "Stripe Customer ID", "Webhook Event ID",
    "Booking Status", "Booking Payment Status",
    "Refund Reason", "Failure Reason",
    "Created At", "Paid At", "Refunded At",
  ];
  const rows = transactions.map((tx) => [
    tx.id, tx.bookingId, tx.bookingType, tx.status, tx.stripeStatus || "",
    tx.chefName || "", tx.chefEmail || "", tx.chefId || "", tx.managerEmail || "", tx.managerId || "",
    tx.locationName || "", tx.locationId || "", tx.kitchenName || "", tx.kitchenId || "",
    formatPrice(tx.amount), formatPrice(tx.baseAmount), formatPrice(tx.serviceFee),
    formatPrice(tx.stripeProcessingFee), formatPrice(tx.managerRevenue),
    formatPrice(tx.refundAmount), formatPrice(tx.netAmount),
    tx.paymentIntentId || "", tx.chargeId || "", tx.refundId || "", tx.paymentMethodId || "",
    tx.stripeCustomerId || "", tx.webhookEventId || "",
    tx.bookingStatus || "", tx.bookingPaymentStatus || "",
    tx.refundReason || "", tx.failureReason || "",
    tx.createdAt ? new Date(tx.createdAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    tx.paidAt ? new Date(tx.paidAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
    tx.refundedAt ? new Date(tx.refundedAt).toLocaleString("en-US", { timeZone: "America/St_Johns" }) : "",
  ]);
  const escape = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}


// Main Component
interface AdminTransactionHistoryProps {
  getFirebaseToken: () => Promise<string>;
}

export function AdminTransactionHistory({ getFirebaseToken }: AdminTransactionHistoryProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [bookingTypeFilter, setBookingTypeFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    stripeProcessingFee: false,
    paymentIntentId: false,
  });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<AdminTransaction | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  // Debounce search
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    const timeout = setTimeout(() => setDebouncedSearch(value), 400);
    return () => clearTimeout(timeout);
  }, []);

  // Fetch locations for filter dropdown
  const { data: locations = [] } = useQuery<LocationOption[]>({
    queryKey: ["/api/admin/transactions/locations"],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch("/api/admin/transactions/locations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      return response.json();
    },
  });

  // Fetch transactions
  const { data, isLoading, error, refetch } = useQuery<{ transactions: AdminTransaction[]; total: number }>({
    queryKey: ["/api/admin/transactions", statusFilter, bookingTypeFilter, locationFilter, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("limit", "500");
      if (statusFilter !== "all") {
        if (statusFilter === "refunded") {
          // Include both refunded and partially_refunded
        } else {
          params.append("status", statusFilter);
        }
      }
      if (bookingTypeFilter !== "all") params.append("bookingType", bookingTypeFilter);
      if (locationFilter !== "all") params.append("locationId", locationFilter);
      if (debouncedSearch.trim()) params.append("search", debouncedSearch.trim());

      const token = await getFirebaseToken();
      const response = await fetch(`/api/admin/transactions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return response.json();
    },
    refetchInterval: 60000,
  });

  const transactions = useMemo(() => data?.transactions || [], [data]);

  // Client-side status filtering for "refunded" tab (includes partially_refunded)
  const filteredTransactions = useMemo(() => {
    if (statusFilter === "refunded") {
      return transactions.filter(
        (t) => t.status === "refunded" || t.status === "partially_refunded" || t.refundAmount > 0
      );
    }
    return transactions;
  }, [transactions, statusFilter]);

  // Categorize for tab counts
  const counts = useMemo(() => {
    const all = transactions.length;
    const succeeded = transactions.filter((t) => t.status === "succeeded" && t.refundAmount === 0).length;
    const refunded = transactions.filter((t) => t.status === "refunded" || t.status === "partially_refunded" || t.refundAmount > 0).length;
    const pending = transactions.filter((t) => t.status === "pending" || t.status === "processing" || t.status === "authorized").length;
    const failed = transactions.filter((t) => t.status === "failed").length;
    const canceled = transactions.filter((t) => t.status === "canceled").length;
    return { all, succeeded, refunded, pending, failed, canceled };
  }, [transactions]);

  // Summary totals
  const totals = useMemo(() => {
    const totalCharged = transactions
      .filter((t) => t.status === "succeeded" || t.status === "partially_refunded")
      .reduce((sum, t) => sum + t.amount, 0);
    const totalRefunded = transactions.reduce((sum, t) => sum + t.refundAmount, 0);
    const totalStripeFees = transactions
      .filter((t) => t.status === "succeeded" || t.status === "partially_refunded")
      .reduce((sum, t) => sum + t.stripeProcessingFee, 0);
    const totalManagerRevenue = transactions
      .filter((t) => t.status === "succeeded" || t.status === "partially_refunded")
      .reduce((sum, t) => sum + t.managerRevenue, 0);
    return { totalCharged, totalRefunded, totalStripeFees, totalManagerRevenue };
  }, [transactions]);

  const handleViewDetails = useCallback((tx: AdminTransaction) => {
    setSelectedTransaction(tx);
    setDetailSheetOpen(true);
  }, []);

  const columns = useMemo(() => getAdminTransactionColumns(handleViewDetails), [handleViewDetails]);

  const table = useReactTable({
    data: filteredTransactions,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
    initialState: {
      pagination: { pageSize: 25 },
    },
  });

  const handleExportCSV = useCallback(() => {
    const csv = transactionsToCSV(filteredTransactions);
    sharedDownloadCSV(csv, `admin-transactions-${new Date().toISOString().split("T")[0]}`);
  }, [filteredTransactions]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
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
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
          <CreditCard className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transaction History</h1>
          <p className="text-sm text-muted-foreground">
            All payment transactions across all locations and kitchens
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Charged</p>
                <p className="text-xl font-bold text-green-700">{formatCurrency(totals.totalCharged)}</p>
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
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <CreditCard className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Stripe Fees</p>
                <p className="text-xl font-bold text-orange-700">{formatCurrency(totals.totalStripeFees)}</p>
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
                <p className="text-sm text-muted-foreground">Manager Revenue</p>
                <p className="text-xl font-bold text-blue-700">{formatCurrency(totals.totalManagerRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Transactions
              </CardTitle>
              <CardDescription>
                {table.getFilteredRowModel().rows.length} of {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? "s" : ""} — {data?.total || 0} total in database
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID, PI, email..."
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 w-[220px]"
                />
              </div>

              {/* Location filter */}
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Booking type filter */}
              <Select value={bookingTypeFilter} onValueChange={setBookingTypeFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="kitchen">Kitchen</SelectItem>
                  <SelectItem value="storage">Storage</SelectItem>
                  <SelectItem value="equipment">Equipment</SelectItem>
                  <SelectItem value="bundle">Bundle</SelectItem>
                </SelectContent>
              </Select>

              {/* Column visibility */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Columns <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {table
                    .getAllColumns()
                    .filter((col) => col.getCanHide())
                    .map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.id}
                        className="capitalize"
                        checked={col.getIsVisible()}
                        onCheckedChange={(value) => col.toggleVisibility(!!value)}
                      >
                        {col.id === "stripeProcessingFee" ? "Stripe Fee" :
                         col.id === "paymentIntentId" ? "Payment Intent" :
                         col.id}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Export */}
              <Button variant="outline" size="sm" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-1" />
                CSV
              </Button>

              {/* Refresh */}
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status Tabs */}
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="w-full">
            <TabsList className="w-full flex flex-wrap gap-1 h-auto p-1">
              <TabsTrigger value="all" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                All <Badge variant="secondary" className="ml-1">{counts.all}</Badge>
              </TabsTrigger>
              <TabsTrigger value="succeeded" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                Completed <Badge variant="secondary" className="ml-1">{counts.succeeded}</Badge>
              </TabsTrigger>
              <TabsTrigger value="refunded" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                Refunded <Badge variant="secondary" className="ml-1">{counts.refunded}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                Pending <Badge variant="secondary" className="ml-1">{counts.pending}</Badge>
              </TabsTrigger>
              {counts.failed > 0 && (
                <TabsTrigger value="failed" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                  Failed <Badge variant="secondary" className="ml-1">{counts.failed}</Badge>
                </TabsTrigger>
              )}
              {counts.canceled > 0 && (
                <TabsTrigger value="canceled" className="flex-1 min-w-[60px] text-xs sm:text-sm px-2 py-1.5">
                  No Charge <Badge variant="secondary" className="ml-1">{counts.canceled}</Badge>
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
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
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
                      className={cn(
                        "hover:bg-muted/50 cursor-pointer",
                        row.original.status === "succeeded" && row.original.refundAmount === 0 && "bg-green-50/30",
                        (row.original.status === "refunded" || row.original.refundAmount > 0) && "bg-purple-50/30",
                        (row.original.status === "pending" || row.original.status === "processing") && "bg-yellow-50/30",
                        row.original.status === "failed" && "bg-red-50/30",
                        row.original.status === "canceled" && "bg-gray-50/40"
                      )}
                      onClick={() => handleViewDetails(row.original)}
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
                          {debouncedSearch ? "No transactions match your search." : "No transactions found."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={String(table.getState().pagination.pageSize)}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 rows</SelectItem>
                  <SelectItem value="25">25 rows</SelectItem>
                  <SelectItem value="50">50 rows</SelectItem>
                  <SelectItem value="100">100 rows</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <TransactionDetailSheet
        transaction={selectedTransaction}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
      />
    </div>
  );
}

export default AdminTransactionHistory;
