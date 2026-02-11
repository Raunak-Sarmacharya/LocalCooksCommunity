import { useState, useMemo, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Package,
  Boxes,
  Calendar,
  Clock,
  MapPin,
  ChefHat,
  DollarSign,
  AlertTriangle,
  Info,
  Pencil,
  Settings2,
  Ban,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StorageItemForManagement {
  id: number;
  storageBookingId: number;
  name: string;
  storageType: string;
  totalPrice: number; // cents
  startDate?: string;
  endDate?: string;
  status?: string; // confirmed, cancellation_requested, cancelled
  cancellationRequested?: boolean;
  cancellationReason?: string;
}

export interface EquipmentItemForManagement {
  id: number;
  equipmentBookingId: number;
  name: string;
  totalPrice: number; // cents
  status?: string;
}

export interface BookingForManagement {
  id: number;
  kitchenName?: string;
  chefName?: string;
  locationName?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice?: number; // kitchen-only in cents
  status: string;
  paymentStatus?: string;

  // Payment/transaction info
  transactionId?: number;
  transactionAmount?: number;
  stripeProcessingFee?: number;
  managerRevenue?: number;
  taxRatePercent?: number;
  refundableAmount?: number;
  refundAmount?: number;

  // Cancellation request info
  cancellationRequested?: boolean;
  cancellationReason?: string;

  // Add-ons
  storageItems?: StorageItemForManagement[];
  equipmentItems?: EquipmentItemForManagement[];
}

type ItemDecision = "keep" | "cancel";

export interface ManagementSubmitParams {
  bookingId: number;
  action:
    | "cancel-booking"          // Cancel entire booking (kitchen cancel)
    | "cancel-booking-refund"   // Cancel entire booking + auto-refund
    | "partial-cancel"          // Cancel only addons, keep kitchen
    | "partial-cancel-refund"   // Cancel addons + manual refund
    | "refund-only"             // Refund without cancelling
    | "accept-cancellation"     // Accept chef's kitchen cancellation request
    | "decline-cancellation"    // Decline chef's kitchen cancellation request
    | "accept-storage-cancel"   // Accept storage cancellation
    | "decline-storage-cancel"; // Decline storage cancellation
  storageActions?: Array<{ storageBookingId: number; action: string }>;
  equipmentActions?: Array<{ equipmentBookingId: number; action: string }>;
  refundAmountCents?: number;
  storageCancellationId?: number; // For accept/decline storage cancel
}

interface BookingManagementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingForManagement | null;
  isProcessing?: boolean;
  onSubmit: (params: ManagementSubmitParams) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatTime = (time: string) => {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const formatStorageDate = (dateStr?: string) => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

// ─── Component Wrapper ───────────────────────────────────────────────────────

export function BookingManagementSheet({
  open,
  onOpenChange,
  booking,
  isProcessing = false,
  onSubmit,
}: BookingManagementSheetProps) {
  const sheetKey = booking ? `mgmt-${booking.id}` : "empty";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && booking ? (
        <BookingManagementContent
          key={sheetKey}
          booking={booking}
          isProcessing={isProcessing}
          onSubmit={onSubmit}
          onClose={() => onOpenChange(false)}
        />
      ) : open ? (
        <SheetContent className="sm:max-w-[520px] flex flex-col items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Loading booking details…</p>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

function BookingManagementContent({
  booking,
  isProcessing,
  onSubmit,
  onClose,
}: {
  booking: BookingForManagement;
  isProcessing: boolean;
  onSubmit: BookingManagementSheetProps["onSubmit"];
  onClose: () => void;
}) {
  // ── State ────────────────────────────────────────────────────────────────
  const [kitchenDecision, setKitchenDecision] = useState<ItemDecision>("keep");

  const [storageDecisions, setStorageDecisions] = useState<Map<number, ItemDecision>>(() => {
    const defaults = new Map<number, ItemDecision>();
    if (booking.storageItems) {
      for (const item of booking.storageItems) {
        if (item.status !== "cancelled") {
          defaults.set(item.storageBookingId, "keep");
        }
      }
    }
    return defaults;
  });

  const [equipmentDecisions, setEquipmentDecisions] = useState<Map<number, ItemDecision>>(() => {
    const defaults = new Map<number, ItemDecision>();
    if (booking.equipmentItems) {
      for (const item of booking.equipmentItems) {
        if (item.status !== "cancelled") {
          defaults.set(item.equipmentBookingId, "keep");
        }
      }
    }
    return defaults;
  });

  const [refundMode, setRefundMode] = useState(false);
  const [isEditingRefund, setIsEditingRefund] = useState(false);
  const [customRefundInput, setCustomRefundInput] = useState("");

  // ── Derived data ─────────────────────────────────────────────────────────
  const activeStorageItems = useMemo(() => booking.storageItems?.filter(i => i.status !== "cancelled") || [], [booking.storageItems]);
  const cancelledStorageItems = useMemo(() => booking.storageItems?.filter(i => i.status === "cancelled") || [], [booking.storageItems]);

  const activeEquipmentItems = useMemo(() => booking.equipmentItems?.filter(i => i.status !== "cancelled") || [], [booking.equipmentItems]);
  const cancelledEquipmentItems = useMemo(() => booking.equipmentItems?.filter(i => i.status === "cancelled") || [], [booking.equipmentItems]);

  const hasStorage = (booking.storageItems?.length || 0) > 0;
  const hasEquipment = (booking.equipmentItems?.length || 0) > 0;
  const hasAddons = activeStorageItems.length > 0 || activeEquipmentItems.length > 0;

  const isKitchenCancellationRequested = booking.cancellationRequested || booking.status === "cancellation_requested";
  const kitchenIsCancelling = kitchenDecision === "cancel";

  // ── Toggle handlers ──────────────────────────────────────────────────────
  const toggleKitchenDecision = useCallback(() => {
    setKitchenDecision(prev => {
      const next = prev === "keep" ? "cancel" : "keep";
      // Kitchen cancel → all addons must cancel too
      if (booking.storageItems) {
        setStorageDecisions(sd => {
          const updated = new Map(sd);
          for (const item of booking.storageItems!) {
            if (item.status !== "cancelled") {
              updated.set(item.storageBookingId, next);
            }
          }
          return updated;
        });
      }
      if (booking.equipmentItems) {
        setEquipmentDecisions(ed => {
          const updated = new Map(ed);
          for (const item of booking.equipmentItems!) {
            if (item.status !== "cancelled") {
              updated.set(item.equipmentBookingId, next);
            }
          }
          return updated;
        });
      }
      return next;
    });
  }, [booking.storageItems, booking.equipmentItems]);

  const toggleStorageDecision = useCallback((storageBookingId: number) => {
    if (kitchenIsCancelling) return; // Can't toggle addons when kitchen is cancelled
    setStorageDecisions(prev => {
      const next = new Map(prev);
      const current = next.get(storageBookingId);
      next.set(storageBookingId, current === "keep" ? "cancel" : "keep");
      return next;
    });
  }, [kitchenIsCancelling]);

  const toggleEquipmentDecision = useCallback((equipmentBookingId: number) => {
    if (kitchenIsCancelling) return;
    setEquipmentDecisions(prev => {
      const next = new Map(prev);
      const current = next.get(equipmentBookingId);
      next.set(equipmentBookingId, current === "keep" ? "cancel" : "keep");
      return next;
    });
  }, [kitchenIsCancelling]);

  // ── Refund Calculation ───────────────────────────────────────────────────
  const refundCalc = useMemo(() => {
    const kitchenPriceCents = booking.totalPrice || 0;
    const transactionAmount = booking.transactionAmount || 0;
    const stripeFee = booking.stripeProcessingFee || 0;
    const managerRevenue = booking.managerRevenue || 0;
    const taxRatePercent = booking.taxRatePercent || 0;
    const alreadyRefunded = booking.refundAmount || 0;

    // Sum cancelled items
    let cancelledKitchenCents = 0;
    if (kitchenDecision === "cancel") cancelledKitchenCents = kitchenPriceCents;

    let cancelledStorageCents = 0;
    let cancelledStorageCount = 0;
    for (const item of activeStorageItems) {
      const decision = storageDecisions.get(item.storageBookingId) || "keep";
      if (decision === "cancel") {
        cancelledStorageCents += item.totalPrice;
        cancelledStorageCount++;
      }
    }

    let cancelledEquipmentCents = 0;
    let cancelledEquipmentCount = 0;
    for (const item of activeEquipmentItems) {
      const decision = equipmentDecisions.get(item.equipmentBookingId) || "keep";
      if (decision === "cancel") {
        cancelledEquipmentCents += item.totalPrice;
        cancelledEquipmentCount++;
      }
    }

    const totalCancelledSubtotal = cancelledKitchenCents + cancelledStorageCents + cancelledEquipmentCents;
    const proportionalTax = Math.round((totalCancelledSubtotal * taxRatePercent) / 100);
    const grossRefund = totalCancelledSubtotal + proportionalTax;

    // Proportional Stripe fee
    const proportionalStripeFee = transactionAmount > 0
      ? Math.round(stripeFee * (grossRefund / transactionAmount))
      : 0;

    // Net refund = gross minus proportional Stripe fee (customer absorbs fee)
    const netRefund = Math.max(0, grossRefund - proportionalStripeFee);

    // Cap at available balance
    const availableBalance = Math.max(0, (booking.refundableAmount || managerRevenue) - alreadyRefunded);
    const autoRefundAmount = Math.min(netRefund, availableBalance);

    const hasCancellations = totalCancelledSubtotal > 0;
    const isFullCancellation = kitchenDecision === "cancel";

    return {
      transactionAmount,
      stripeFee,
      managerRevenue,
      alreadyRefunded,
      availableBalance,
      taxRatePercent,
      cancelledKitchenCents,
      cancelledStorageCents,
      cancelledEquipmentCents,
      cancelledStorageCount,
      cancelledEquipmentCount,
      totalCancelledSubtotal,
      proportionalTax,
      grossRefund,
      proportionalStripeFee,
      netRefund,
      autoRefundAmount,
      hasCancellations,
      isFullCancellation,
    };
  }, [kitchenDecision, storageDecisions, equipmentDecisions, booking, activeStorageItems, activeEquipmentItems]);

  // Effective refund amount (user-editable)
  const effectiveRefundAmount = useMemo(() => {
    if (isEditingRefund && customRefundInput !== "") {
      const customCents = Math.round(parseFloat(customRefundInput) * 100);
      if (!isNaN(customCents) && customCents >= 0) {
        return Math.min(customCents, refundCalc.availableBalance);
      }
    }
    if (refundMode) {
      // In refund-only mode, default to max available
      return refundCalc.availableBalance;
    }
    return refundCalc.autoRefundAmount;
  }, [isEditingRefund, customRefundInput, refundCalc, refundMode]);

  // ── Submit Handler ───────────────────────────────────────────────────────
  const handleSubmit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!booking || isProcessing) return;

    // Refund-only mode
    if (refundMode && !refundCalc.hasCancellations) {
      if (booking.transactionId && effectiveRefundAmount > 0) {
        onSubmit({
          bookingId: booking.id,
          action: "refund-only",
          refundAmountCents: effectiveRefundAmount,
        });
      }
      return;
    }

    // Build addon action arrays
    const storageActions = activeStorageItems.length > 0
      ? activeStorageItems.map(item => ({
          storageBookingId: item.storageBookingId,
          action: storageDecisions.get(item.storageBookingId) === "cancel" ? "cancelled" : "confirmed",
        }))
      : undefined;

    const equipmentActions = activeEquipmentItems.length > 0
      ? activeEquipmentItems.map(item => ({
          equipmentBookingId: item.equipmentBookingId,
          action: equipmentDecisions.get(item.equipmentBookingId) === "cancel" ? "cancelled" : "confirmed",
        }))
      : undefined;

    if (kitchenDecision === "cancel") {
      // Full booking cancel
      const wantsRefund = effectiveRefundAmount > 0;
      onSubmit({
        bookingId: booking.id,
        action: wantsRefund ? "cancel-booking-refund" : "cancel-booking",
        storageActions,
        equipmentActions,
        refundAmountCents: wantsRefund ? effectiveRefundAmount : undefined,
      });
    } else if (refundCalc.hasCancellations) {
      // Partial cancel (only addons)
      const wantsRefund = effectiveRefundAmount > 0;
      onSubmit({
        bookingId: booking.id,
        action: wantsRefund ? "partial-cancel-refund" : "partial-cancel",
        storageActions,
        equipmentActions,
        refundAmountCents: wantsRefund ? effectiveRefundAmount : undefined,
      });
    }
  }, [booking, isProcessing, refundMode, refundCalc, effectiveRefundAmount, kitchenDecision, storageDecisions, equipmentDecisions, activeStorageItems, activeEquipmentItems, onSubmit]);

  // Cancellation request handlers
  const handleCancellationAction = useCallback((action: "accept" | "decline", e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isProcessing) return;
    onSubmit({
      bookingId: booking.id,
      action: action === "accept" ? "accept-cancellation" : "decline-cancellation",
    });
  }, [booking.id, isProcessing, onSubmit]);

  const handleStorageCancellationAction = useCallback((storageBookingId: number, action: "accept" | "decline", e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isProcessing) return;
    onSubmit({
      bookingId: booking.id,
      action: action === "accept" ? "accept-storage-cancel" : "decline-storage-cancel",
      storageCancellationId: storageBookingId,
    });
  }, [booking.id, isProcessing, onSubmit]);

  // Count summary
  const cancelCount = (kitchenDecision === "cancel" ? 1 : 0) +
    activeStorageItems.filter(i => storageDecisions.get(i.storageBookingId) === "cancel").length +
    activeEquipmentItems.filter(i => equipmentDecisions.get(i.equipmentBookingId) === "cancel").length;
  const keepCount = (kitchenDecision === "keep" ? 1 : 0) +
    activeStorageItems.filter(i => storageDecisions.get(i.storageBookingId) !== "cancel").length +
    activeEquipmentItems.filter(i => equipmentDecisions.get(i.equipmentBookingId) !== "cancel").length;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SheetContent className="sm:max-w-[520px] flex flex-col p-0 gap-0 h-full max-h-screen overflow-hidden">
      {/* Header */}
      <SheetHeader className="px-6 pt-6 pb-4 border-b bg-muted/30 shrink-0">
        <SheetTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="h-5 w-5 text-primary" />
          Manage Booking
        </SheetTitle>
        <SheetDescription className="text-sm">
          Cancel items, process refunds, or respond to cancellation requests.
          The customer absorbs the Stripe processing fee per platform terms.
        </SheetDescription>
      </SheetHeader>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        {/* Booking Summary */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">
              {booking.kitchenName || "Kitchen Booking"}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              {booking.chefName && (
                <span className="flex items-center gap-1">
                  <ChefHat className="h-3 w-3" />
                  {booking.chefName}
                </span>
              )}
              {booking.locationName && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {booking.locationName}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(booking.bookingDate)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatTime(booking.startTime)} – {formatTime(booking.endTime)}
              </span>
            </div>
          </div>
          {booking.transactionAmount != null && booking.transactionAmount > 0 && (
            <Badge variant="secondary" className="shrink-0 font-mono text-xs">
              <DollarSign className="h-3 w-3 mr-0.5" />
              {formatPrice(booking.transactionAmount)}
            </Badge>
          )}
        </div>

        {/* Chef Cancellation Request Banner */}
        {isKitchenCancellationRequested && (
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-semibold text-amber-800">
                Chef Cancellation Request
              </p>
            </div>
            {booking.cancellationReason && (
              <p className="text-xs text-amber-700">
                <strong>Reason:</strong> {booking.cancellationReason}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="default"
                className="bg-green-600 hover:bg-green-700"
                disabled={isProcessing}
                onClick={(e) => handleCancellationAction("accept", e)}
              >
                {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                Accept &amp; Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                disabled={isProcessing}
                onClick={(e) => handleCancellationAction("decline", e)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Decline
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* ── Kitchen Session ── */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <ChefHat className="h-3.5 w-3.5" />
            Kitchen Session
          </p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleKitchenDecision(); }}
            disabled={isProcessing || isKitchenCancellationRequested}
            className={cn(
              "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left",
              "hover:shadow-sm active:scale-[0.99]",
              isKitchenCancellationRequested && "opacity-60 cursor-not-allowed",
              kitchenDecision === "keep"
                ? "bg-green-50/50 border-green-200 hover:border-green-300"
                : "bg-red-50/50 border-red-200 hover:border-red-300",
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                kitchenDecision === "keep" ? "bg-green-100" : "bg-red-100",
              )}>
                <ChefHat className={cn("h-4 w-4", kitchenDecision === "keep" ? "text-green-600" : "text-red-600")} />
              </div>
              <div>
                <p className="text-sm font-medium">Kitchen Booking</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(booking.startTime)} – {formatTime(booking.endTime)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {booking.totalPrice != null && booking.totalPrice > 0 && (
                <span className="text-xs font-mono text-muted-foreground">{formatPrice(booking.totalPrice)}</span>
              )}
              <Badge className={cn(
                "text-[10px] transition-colors",
                kitchenDecision === "keep"
                  ? "bg-green-100 text-green-700 border-green-200"
                  : "bg-red-100 text-red-700 border-red-200",
              )}>
                {kitchenDecision === "keep" ? (
                  <><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Active</>
                ) : (
                  <><Ban className="h-2.5 w-2.5 mr-0.5" />Cancel</>
                )}
              </Badge>
            </div>
          </button>
        </div>

        {/* ── Storage Items ── */}
        {hasStorage && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Boxes className="h-3.5 w-3.5" />
                Storage Rentals
              </p>

              {/* Active storage items — toggleable */}
              {activeStorageItems.map((item) => {
                const decision = storageDecisions.get(item.storageBookingId) || "keep";
                const isKeeping = decision === "keep";
                const isDisabled = kitchenIsCancelling || isProcessing;
                const hasCancelRequest = item.cancellationRequested;
                const dateRange = item.startDate && item.endDate
                  ? item.startDate === item.endDate
                    ? formatStorageDate(item.startDate)
                    : `${formatStorageDate(item.startDate)} – ${formatStorageDate(item.endDate)}`
                  : "";

                return (
                  <div key={item.storageBookingId} className="space-y-1.5">
                    {/* Storage cancellation request banner */}
                    {hasCancelRequest && (
                      <div className="flex items-center justify-between p-2 rounded-md border border-amber-200 bg-amber-50/50 text-xs">
                        <span className="text-amber-700 flex items-center gap-1">
                          <ShieldAlert className="h-3 w-3" />
                          Chef requested cancellation
                          {item.cancellationReason && `: "${item.cancellationReason}"`}
                        </span>
                        <div className="flex gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="h-6 px-2 text-[10px] bg-green-600 hover:bg-green-700"
                            disabled={isProcessing}
                            onClick={(e) => handleStorageCancellationAction(item.storageBookingId, "accept", e)}
                          >
                            Accept
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] border-red-200 text-red-700"
                            disabled={isProcessing}
                            onClick={(e) => handleStorageCancellationAction(item.storageBookingId, "decline", e)}
                          >
                            Decline
                          </Button>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleStorageDecision(item.storageBookingId); }}
                      disabled={isDisabled}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left",
                        isDisabled ? "opacity-60 cursor-not-allowed" : "hover:shadow-sm active:scale-[0.99]",
                        isKeeping
                          ? "bg-green-50/50 border-green-200 hover:border-green-300"
                          : "bg-red-50/50 border-red-200 hover:border-red-300",
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                          isKeeping ? "bg-green-100" : "bg-red-100",
                        )}>
                          <Boxes className={cn("h-4 w-4", isKeeping ? "text-green-600" : "text-red-600")} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{item.storageType}</span>
                            {dateRange && <><span>·</span><span>{dateRange}</span></>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.totalPrice > 0 && (
                          <span className="text-xs font-mono text-muted-foreground">{formatPrice(item.totalPrice)}</span>
                        )}
                        <Badge className={cn(
                          "text-[10px] transition-colors",
                          isKeeping
                            ? "bg-green-100 text-green-700 border-green-200"
                            : "bg-red-100 text-red-700 border-red-200",
                        )}>
                          {isKeeping ? (
                            <><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Active</>
                          ) : (
                            <><Ban className="h-2.5 w-2.5 mr-0.5" />Cancel</>
                          )}
                        </Badge>
                      </div>
                    </button>
                  </div>
                );
              })}

              {/* Already cancelled storage items — read-only */}
              {cancelledStorageItems.map((item) => (
                <div
                  key={item.storageBookingId}
                  className="w-full flex items-center justify-between p-3 rounded-lg border bg-gray-50/50 border-gray-200 opacity-60"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gray-100">
                      <Boxes className="h-4 w-4 text-gray-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate line-through text-gray-500">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.storageType}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono text-gray-400 line-through">{formatPrice(item.totalPrice)}</span>
                    <Badge className="text-[10px] bg-gray-100 text-gray-500 border-gray-200">
                      <XCircle className="h-2.5 w-2.5 mr-0.5" />
                      Cancelled
                    </Badge>
                  </div>
                </div>
              ))}

              {activeStorageItems.length > 0 && !kitchenIsCancelling && (
                <p className="text-[11px] text-muted-foreground italic pl-1">
                  Click each item to toggle between active and cancel
                </p>
              )}
            </div>
          </>
        )}

        {/* ── Equipment Items ── */}
        {hasEquipment && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Equipment Rentals
              </p>

              {activeEquipmentItems.map((item) => {
                const decision = equipmentDecisions.get(item.equipmentBookingId) || "keep";
                const isKeeping = decision === "keep";
                const isDisabled = kitchenIsCancelling || isProcessing;

                return (
                  <button
                    key={item.equipmentBookingId}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleEquipmentDecision(item.equipmentBookingId); }}
                    disabled={isDisabled}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left",
                      isDisabled ? "opacity-60 cursor-not-allowed" : "hover:shadow-sm active:scale-[0.99]",
                      isKeeping
                        ? "bg-green-50/50 border-green-200 hover:border-green-300"
                        : "bg-red-50/50 border-red-200 hover:border-red-300",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                        isKeeping ? "bg-green-100" : "bg-red-100",
                      )}>
                        <Package className={cn("h-4 w-4", isKeeping ? "text-green-600" : "text-red-600")} />
                      </div>
                      <p className="text-sm font-medium truncate">{item.name}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.totalPrice > 0 && (
                        <span className="text-xs font-mono text-muted-foreground">{formatPrice(item.totalPrice)}</span>
                      )}
                      <Badge className={cn(
                        "text-[10px] transition-colors",
                        isKeeping
                          ? "bg-green-100 text-green-700 border-green-200"
                          : "bg-red-100 text-red-700 border-red-200",
                      )}>
                        {isKeeping ? (
                          <><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Active</>
                        ) : (
                          <><Ban className="h-2.5 w-2.5 mr-0.5" />Cancel</>
                        )}
                      </Badge>
                    </div>
                  </button>
                );
              })}

              {/* Already cancelled equipment — read-only */}
              {cancelledEquipmentItems.map((item) => (
                <div
                  key={item.equipmentBookingId}
                  className="w-full flex items-center justify-between p-3 rounded-lg border bg-gray-50/50 border-gray-200 opacity-60"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gray-100">
                      <Package className="h-4 w-4 text-gray-400" />
                    </div>
                    <p className="text-sm font-medium truncate line-through text-gray-500">{item.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono text-gray-400 line-through">{formatPrice(item.totalPrice)}</span>
                    <Badge className="text-[10px] bg-gray-100 text-gray-500 border-gray-200">
                      <XCircle className="h-2.5 w-2.5 mr-0.5" />
                      Cancelled
                    </Badge>
                  </div>
                </div>
              ))}

              {activeEquipmentItems.length > 0 && !kitchenIsCancelling && (
                <p className="text-[11px] text-muted-foreground italic pl-1">
                  Click each item to toggle between active and cancel
                </p>
              )}
            </div>
          </>
        )}

        {/* ── Kitchen Cancelled + Has Addons Warning ── */}
        {kitchenIsCancelling && hasAddons && (
          <>
            <Separator />
            <div className="p-4 rounded-lg border border-red-200 bg-red-50/50 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <p className="text-sm font-semibold text-red-800">
                  Entire Booking Will Be Cancelled
                </p>
              </div>
              <p className="text-xs text-red-700">
                Cancelling the kitchen session cancels the <strong>entire booking</strong> including all storage and equipment add-ons.
                A refund will be processed from your available balance.
              </p>
            </div>
          </>
        )}

        {/* ── Refund Breakdown (when cancellations exist) ── */}
        {refundCalc.hasCancellations && (
          <>
            <Separator />
            <div className="space-y-3 p-4 rounded-lg border border-amber-200 bg-amber-50/50">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">
                  Refund Preview
                </p>
              </div>

              {/* Transaction Breakdown */}
              {refundCalc.transactionAmount > 0 && (
                <div className="space-y-1 text-xs p-2.5 rounded-md bg-white/60 border border-amber-100">
                  <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide mb-1">Transaction Summary</p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Total charged</span>
                    <span className="font-mono">{formatPrice(refundCalc.transactionAmount)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Stripe fee (customer absorbs)</span>
                    <span className="font-mono text-red-600">-{formatPrice(refundCalc.stripeFee)}</span>
                  </div>
                  <div className="flex justify-between font-medium text-foreground">
                    <span>Your available balance</span>
                    <span className="font-mono">{formatPrice(refundCalc.availableBalance)}</span>
                  </div>
                  {refundCalc.alreadyRefunded > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Already refunded</span>
                      <span className="font-mono text-orange-600">-{formatPrice(refundCalc.alreadyRefunded)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Cancelled Items Breakdown */}
              <div className="space-y-1.5 text-xs">
                <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">Cancellation Breakdown</p>
                {refundCalc.cancelledKitchenCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Kitchen session</span>
                    <span className="font-mono">{formatPrice(refundCalc.cancelledKitchenCents)}</span>
                  </div>
                )}
                {refundCalc.cancelledStorageCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Storage ({refundCalc.cancelledStorageCount} item{refundCalc.cancelledStorageCount !== 1 ? "s" : ""})</span>
                    <span className="font-mono">{formatPrice(refundCalc.cancelledStorageCents)}</span>
                  </div>
                )}
                {refundCalc.cancelledEquipmentCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Equipment ({refundCalc.cancelledEquipmentCount} item{refundCalc.cancelledEquipmentCount !== 1 ? "s" : ""})</span>
                    <span className="font-mono">{formatPrice(refundCalc.cancelledEquipmentCents)}</span>
                  </div>
                )}
                {refundCalc.proportionalTax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax ({refundCalc.taxRatePercent}%)</span>
                    <span className="font-mono">+{formatPrice(refundCalc.proportionalTax)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Stripe fee (proportional)</span>
                  <span className="font-mono text-red-600">-{formatPrice(refundCalc.proportionalStripeFee)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between font-semibold text-sm">
                  <span>Customer receives</span>
                  <span className="font-mono text-green-700">{formatPrice(effectiveRefundAmount)}</span>
                </div>
              </div>

              {/* Editable refund amount */}
              <div className="space-y-2">
                {!isEditingRefund ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setIsEditingRefund(true); setCustomRefundInput((refundCalc.autoRefundAmount / 100).toFixed(2)); }}
                    className="h-7 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-100 px-2"
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Modify refund amount
                  </Button>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-amber-700">Custom refund amount</Label>
                    <div className="flex items-center gap-2">
                      <CurrencyInput
                        size="sm"
                        value={customRefundInput}
                        onValueChange={setCustomRefundInput}
                        placeholder="0.00"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setIsEditingRefund(false); setCustomRefundInput(""); }}
                        className="h-8 text-xs px-2"
                      >
                        Reset
                      </Button>
                    </div>
                    <p className="text-[10px] text-amber-600">
                      Max: {formatPrice(refundCalc.availableBalance)} (your available balance)
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-start gap-1.5 text-[10px] text-amber-600">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Stripe fee and tax are proportionally included. Refund is processed from your connected account.
                  The customer always absorbs the Stripe processing fee per platform terms.
                </span>
              </div>
            </div>
          </>
        )}

        {/* ── Refund Only Section (no cancellations) ── */}
        {!refundCalc.hasCancellations && (
          <>
            <Separator />
            <div className="space-y-3 p-4 rounded-lg border border-blue-200 bg-blue-50/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-blue-600" />
                  <p className="text-sm font-semibold text-blue-800">
                    Issue Refund
                  </p>
                </div>
                <Button
                  type="button"
                  variant={refundMode ? "default" : "outline"}
                  size="sm"
                  className={cn("h-7 text-xs", refundMode && "bg-blue-600 hover:bg-blue-700")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRefundMode(!refundMode);
                    if (!refundMode) {
                      setIsEditingRefund(true);
                      setCustomRefundInput((refundCalc.availableBalance / 100).toFixed(2));
                    } else {
                      setIsEditingRefund(false);
                      setCustomRefundInput("");
                    }
                  }}
                >
                  {refundMode ? "Cancel Refund" : "Issue Refund"}
                </Button>
              </div>

              {refundMode && (
                <div className="space-y-3">
                  <div className="space-y-1 text-xs p-2.5 rounded-md bg-white/60 border border-blue-100">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Available to refund</span>
                      <span className="font-mono font-medium">{formatPrice(refundCalc.availableBalance)}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-blue-700">Refund amount</Label>
                    <CurrencyInput
                      value={customRefundInput}
                      onValueChange={setCustomRefundInput}
                      placeholder="0.00"
                    />
                    <p className="text-[10px] text-blue-600">
                      Max: {formatPrice(refundCalc.availableBalance)} · Debited from your Stripe balance
                    </p>
                  </div>

                  {effectiveRefundAmount > 0 && (
                    <div className="flex justify-between text-xs p-2 rounded-md bg-white/60 border border-blue-100 font-medium">
                      <span className="text-blue-700">Customer receives</span>
                      <span className="font-mono text-green-700">{formatPrice(effectiveRefundAmount)}</span>
                    </div>
                  )}
                </div>
              )}

              {!refundMode && (
                <p className="text-xs text-blue-600">
                  Issue a refund without cancelling any items. Useful for partial refunds, goodwill credits, or pricing adjustments.
                </p>
              )}
            </div>
          </>
        )}

        {/* No changes info */}
        {!refundCalc.hasCancellations && !refundMode && (
          <>
            <Separator />
            <div className="p-3 rounded-lg border border-green-200 bg-green-50/50">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  All items active — no changes selected
                </p>
              </div>
              <p className="text-xs text-green-600 mt-1">
                Toggle items above to cancel, or use the refund section to issue a refund.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <SheetFooter className="px-6 py-4 border-t bg-muted/30 shrink-0 !flex-col !space-x-0 gap-3">
        {/* Summary badges */}
        <div className="flex items-center gap-2 w-full flex-wrap">
          {keepCount > 0 && (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {keepCount} active
            </Badge>
          )}
          {cancelCount > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
              <Ban className="h-3 w-3 mr-1" />
              {cancelCount} cancelling
            </Badge>
          )}
          {(refundCalc.hasCancellations || refundMode) && effectiveRefundAmount > 0 && (
            <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 ml-auto">
              <DollarSign className="h-3 w-3 mr-0.5" />
              {formatPrice(effectiveRefundAmount)} refund
            </Badge>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between w-full gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            disabled={isProcessing}
            className="flex-1"
          >
            {refundCalc.hasCancellations || refundMode ? "Discard Changes" : "Close"}
          </Button>

          {/* Refund Only */}
          {refundMode && !refundCalc.hasCancellations && (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isProcessing || effectiveRefundAmount <= 0 || !booking.transactionId}
              className="flex-1 min-w-[160px] bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              {isProcessing ? "Processing…" : `Refund ${formatPrice(effectiveRefundAmount)}`}
            </Button>
          )}

          {/* Cancel (with or without refund) */}
          {refundCalc.hasCancellations && (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isProcessing}
              className={cn(
                "flex-1 min-w-[160px]",
                effectiveRefundAmount > 0
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white",
              )}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Ban className="h-4 w-4 mr-2" />
              )}
              {isProcessing
                ? "Processing…"
                : kitchenIsCancelling
                ? (effectiveRefundAmount > 0 ? `Cancel & Refund ${formatPrice(effectiveRefundAmount)}` : "Cancel Booking")
                : (effectiveRefundAmount > 0 ? `Cancel Items & Refund ${formatPrice(effectiveRefundAmount)}` : "Cancel Items")}
            </Button>
          )}
        </div>
      </SheetFooter>
    </SheetContent>
  );
}
