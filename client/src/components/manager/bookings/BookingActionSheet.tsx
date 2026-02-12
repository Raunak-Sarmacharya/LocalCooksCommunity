import { useState, useMemo } from "react";
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
  RefreshCcw,
  Info,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StorageItemForAction {
  id: number;
  storageBookingId: number;
  name: string;
  storageType: string;
  totalPrice: number; // in cents
  startDate?: string;
  endDate?: string;
  rejected?: boolean; // true if already rejected (read-only in action sheet)
}

export interface EquipmentItemForAction {
  id: number;
  equipmentBookingId: number;
  name: string;
  totalPrice: number; // in cents
  rejected?: boolean; // true if already rejected (read-only in action sheet)
}

export interface BookingForAction {
  id: number;
  kitchenName?: string;
  chefName?: string;
  locationName?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice?: number; // kitchen-only price in cents
  storageItems?: StorageItemForAction[];
  equipmentItems?: EquipmentItemForAction[];
  // Payment info for refund preview
  transactionAmount?: number; // total charged in cents
  stripeProcessingFee?: number; // Stripe fee in cents
  managerRevenue?: number; // manager received in cents
  taxRatePercent?: number; // tax rate (e.g. 13 for 13%)
  paymentStatus?: string; // 'authorized' | 'paid' | etc.
}

type ItemAction = "confirmed" | "cancelled";

interface StorageDecision {
  storageBookingId: number;
  action: ItemAction;
}

interface EquipmentDecision {
  equipmentBookingId: number;
  action: ItemAction;
}

interface BookingActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingForAction | null;
  isLoading?: boolean;
  onSubmit: (params: {
    bookingId: number;
    status: "confirmed" | "cancelled";
    storageActions?: StorageDecision[];
    equipmentActions?: EquipmentDecision[];
  }) => void;
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

// ─── Component ───────────────────────────────────────────────────────────────

export function BookingActionSheet({
  open,
  onOpenChange,
  booking,
  isLoading = false,
  onSubmit,
}: BookingActionSheetProps) {
  const sheetKey = booking ? `${booking.id}` : "empty";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && booking ? (
        <BookingActionSheetContent
          key={sheetKey}
          booking={booking}
          isLoading={isLoading}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      ) : open ? (
        <SheetContent className="sm:max-w-[480px] flex flex-col items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Loading booking details…</p>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function BookingActionSheetContent({
  booking,
  isLoading,
  onSubmit,
  onCancel,
}: {
  booking: BookingForAction;
  isLoading: boolean;
  onSubmit: BookingActionSheetProps["onSubmit"];
  onCancel: () => void;
}) {
  // Kitchen decision — toggleable
  const [kitchenAction, setKitchenAction] = useState<ItemAction>("confirmed");

  // Per-storage-booking decisions — default to approved, skip already-rejected items
  const [storageDecisions, setStorageDecisions] = useState<Map<number, ItemAction>>(() => {
    const defaults = new Map<number, ItemAction>();
    if (booking.storageItems) {
      for (const item of booking.storageItems) {
        if (!item.rejected) {
          defaults.set(item.storageBookingId, "confirmed");
        }
      }
    }
    return defaults;
  });

  // Per-equipment-booking decisions — default to approved, skip already-rejected items
  const [equipmentDecisions, setEquipmentDecisions] = useState<Map<number, ItemAction>>(() => {
    const defaults = new Map<number, ItemAction>();
    if (booking.equipmentItems) {
      for (const item of booking.equipmentItems) {
        if (!item.rejected) {
          defaults.set(item.equipmentBookingId, "confirmed");
        }
      }
    }
    return defaults;
  });

  // Editable refund amount override
  const [isEditingRefund, setIsEditingRefund] = useState(false);
  const [customRefundInput, setCustomRefundInput] = useState("");

  const toggleKitchenAction = () => {
    setKitchenAction((prev) => {
      const next = prev === "confirmed" ? "cancelled" : "confirmed";
      // When kitchen is rejected, the entire PaymentIntent is cancelled/released.
      // All addons must be rejected too — they share the same payment.
      // When kitchen is re-approved, restore addons to confirmed.
      if (booking.storageItems) {
        setStorageDecisions((sd) => {
          const updated = new Map(sd);
          for (const item of booking.storageItems!) {
            if (!item.rejected) {
              updated.set(item.storageBookingId, next);
            }
          }
          return updated;
        });
      }
      if (booking.equipmentItems) {
        setEquipmentDecisions((ed) => {
          const updated = new Map(ed);
          for (const item of booking.equipmentItems!) {
            if (!item.rejected) {
              updated.set(item.equipmentBookingId, next);
            }
          }
          return updated;
        });
      }
      return next;
    });
  };

  const toggleStorageDecision = (storageBookingId: number) => {
    setStorageDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(storageBookingId);
      next.set(storageBookingId, current === "confirmed" ? "cancelled" : "confirmed");
      return next;
    });
  };

  const toggleEquipmentDecision = (equipmentBookingId: number) => {
    setEquipmentDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(equipmentBookingId);
      next.set(equipmentBookingId, current === "confirmed" ? "cancelled" : "confirmed");
      return next;
    });
  };

  // Separate actionable items from already-rejected ones
  const actionableStorageItems = booking.storageItems?.filter(i => !i.rejected) || [];
  const rejectedStorageItems = booking.storageItems?.filter(i => i.rejected) || [];
  const actionableEquipmentItems = booking.equipmentItems?.filter(i => !i.rejected) || [];
  const rejectedEquipmentItems = booking.equipmentItems?.filter(i => i.rejected) || [];
  const hasStorage = booking.storageItems && booking.storageItems.length > 0;
  const hasEquipment = booking.equipmentItems && booking.equipmentItems.length > 0;
  const hasAddons = (actionableStorageItems.length + actionableEquipmentItems.length) > 0;
  const isAuthorized = booking.paymentStatus === "authorized";
  const kitchenIsRejected = kitchenAction === "cancelled";

  // ── Refund Calculation (Tax-inclusive, full Stripe fee deducted) ─────────────
  // Formula:
  //   rejectedSubtotal = sum of rejected item prices (pre-tax)
  //   proportionalTax = rejectedSubtotal × taxRate / 100
  //   grossRefund = rejectedSubtotal + proportionalTax
  //   netRefund = max(0, grossRefund − fullStripeFee)
  //   Full rejection → netRefund = transactionAmount − stripeFee = managerRevenue → balance = 0
  const refundCalc = useMemo(() => {
    const kitchenPriceCents = booking.totalPrice || 0;
    const transactionAmount = booking.transactionAmount || 0;
    const stripeFee = booking.stripeProcessingFee || 0;
    const managerRevenue = booking.managerRevenue || 0;
    const taxRatePercent = booking.taxRatePercent || 0;

    // Sum rejected subtotals (pre-tax)
    let rejectedKitchenCents = 0;
    if (kitchenAction === "cancelled") {
      rejectedKitchenCents = kitchenPriceCents;
    }

    let rejectedStorageCents = 0;
    const rejectedStorageCount = { total: 0 };
    if (booking.storageItems) {
      for (const item of booking.storageItems) {
        if (item.rejected) continue; // Skip already-rejected items
        const decision = storageDecisions.get(item.storageBookingId) || "confirmed";
        if (decision === "cancelled") {
          rejectedStorageCents += item.totalPrice;
          rejectedStorageCount.total++;
        }
      }
    }

    let rejectedEquipmentCents = 0;
    const rejectedEquipmentCount = { total: 0 };
    if (booking.equipmentItems) {
      for (const item of booking.equipmentItems) {
        if (item.rejected) continue; // Skip already-rejected items
        const decision = equipmentDecisions.get(item.equipmentBookingId) || "confirmed";
        if (decision === "cancelled") {
          rejectedEquipmentCents += item.totalPrice;
          rejectedEquipmentCount.total++;
        }
      }
    }

    const totalRejectedSubtotal = rejectedKitchenCents + rejectedStorageCents + rejectedEquipmentCents;

    // Proportional tax on rejected items
    const proportionalTax = Math.round((totalRejectedSubtotal * taxRatePercent) / 100);

    // Gross refund = rejected subtotal + proportional tax
    const grossRefund = totalRejectedSubtotal + proportionalTax;

    // Proportional Stripe fee = stripeFee × (grossRefund / transactionAmount)
    const proportionalStripeFee = transactionAmount > 0
      ? Math.round(stripeFee * (grossRefund / transactionAmount))
      : 0;

    // Net refund = gross minus proportional Stripe fee (chef absorbs the fee)
    const netRefund = Math.max(0, grossRefund - proportionalStripeFee);

    // Cap at manager's available balance
    const maxRefundable = Math.max(0, managerRevenue);
    const autoRefundAmount = Math.min(netRefund, maxRefundable);

    const hasAnyRejection = totalRejectedSubtotal > 0;
    // Only count actionable items (exclude already-rejected) for full-rejection detection
    const actionableItemCount = 1 + actionableStorageItems.length + actionableEquipmentItems.length;
    const totalRejectedCount = (kitchenAction === "cancelled" ? 1 : 0) + rejectedStorageCount.total + rejectedEquipmentCount.total;
    const isFullRejection = totalRejectedCount === actionableItemCount;

    return {
      transactionAmount,
      stripeFee,
      managerRevenue,
      taxRatePercent,
      rejectedKitchenCents,
      rejectedStorageCents,
      rejectedEquipmentCents,
      totalRejectedSubtotal,
      proportionalTax,
      grossRefund,
      proportionalStripeFee,
      netRefund,
      autoRefundAmount,
      maxRefundable,
      hasAnyRejection,
      isFullRejection,
      rejectedStorageCount: rejectedStorageCount.total,
      rejectedEquipmentCount: rejectedEquipmentCount.total,
    };
  }, [kitchenAction, storageDecisions, equipmentDecisions, booking, actionableStorageItems.length, actionableEquipmentItems.length]);

  // ── Capture Calculation (for authorized bookings only) ───────────────────
  // Calculates what will be captured vs released when manager partially approves
  const captureCalc = useMemo(() => {
    if (!isAuthorized) return null;

    const kitchenPriceCents = booking.totalPrice || 0;
    const transactionAmount = booking.transactionAmount || 0;
    const taxRatePercent = booking.taxRatePercent || 0;

    // Kitchen is approved when kitchenAction === 'confirmed'
    const approvedKitchenCents = kitchenAction === "confirmed" ? kitchenPriceCents : 0;

    // Approved storage (skip already-rejected)
    let approvedStorageCents = 0;
    if (booking.storageItems) {
      for (const item of booking.storageItems) {
        if (item.rejected) continue;
        const decision = storageDecisions.get(item.storageBookingId) || "confirmed";
        if (decision === "confirmed") approvedStorageCents += item.totalPrice;
      }
    }

    // Approved equipment (skip already-rejected)
    let approvedEquipmentCents = 0;
    if (booking.equipmentItems) {
      for (const item of booking.equipmentItems) {
        if (item.rejected) continue;
        const decision = equipmentDecisions.get(item.equipmentBookingId) || "confirmed";
        if (decision === "confirmed") approvedEquipmentCents += item.totalPrice;
      }
    }

    const approvedSubtotal = approvedKitchenCents + approvedStorageCents + approvedEquipmentCents;
    const approvedTax = Math.round((approvedSubtotal * taxRatePercent) / 100);
    const captureAmount = approvedSubtotal + approvedTax;
    const releaseAmount = Math.max(0, transactionAmount - captureAmount);

    // Estimated Stripe fee on capture amount (2.9% + $0.30)
    const estimatedStripeFee = captureAmount > 0
      ? Math.round(captureAmount * 0.029 + 30)
      : 0;
    const estimatedManagerNet = Math.max(0, captureAmount - estimatedStripeFee);
    const isPartialCapture = captureAmount > 0 && captureAmount < transactionAmount;

    return {
      approvedKitchenCents,
      approvedStorageCents,
      approvedEquipmentCents,
      approvedSubtotal,
      approvedTax,
      captureAmount,
      releaseAmount,
      estimatedStripeFee,
      estimatedManagerNet,
      isPartialCapture,
      taxRatePercent,
      transactionAmount,
    };
  }, [isAuthorized, kitchenAction, storageDecisions, equipmentDecisions, booking]);

  // Custom refund amount (user-editable, capped at max)
  const effectiveRefundAmount = useMemo(() => {
    if (isEditingRefund && customRefundInput !== "") {
      const customCents = Math.round(parseFloat(customRefundInput) * 100);
      if (!isNaN(customCents) && customCents >= 0) {
        return Math.min(customCents, refundCalc.maxRefundable);
      }
    }
    return refundCalc.autoRefundAmount;
  }, [isEditingRefund, customRefundInput, refundCalc]);

  // Reset custom refund when auto amount changes
  const handleEditRefund = () => {
    setIsEditingRefund(true);
    setCustomRefundInput((refundCalc.autoRefundAmount / 100).toFixed(2));
  };

  const handleResetRefund = () => {
    setIsEditingRefund(false);
    setCustomRefundInput("");
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!booking) return;

    // When kitchen is rejected, the entire booking is cancelled.
    // The backend cancels the PaymentIntent and cascades to all sub-bookings.
    // No need to send individual addon actions — they're all cancelled implicitly.
    if (kitchenAction === "cancelled") {
      onSubmit({
        bookingId: booking.id,
        status: "cancelled",
      });
      return;
    }

    // Kitchen approved — send individual addon actions for modular approval
    const storageActions: StorageDecision[] | undefined = actionableStorageItems.length > 0
      ? actionableStorageItems.map((item) => ({
          storageBookingId: item.storageBookingId,
          action: storageDecisions.get(item.storageBookingId) || "confirmed",
        }))
      : undefined;

    const eqActions: EquipmentDecision[] | undefined = actionableEquipmentItems.length > 0
      ? actionableEquipmentItems.map((item) => ({
          equipmentBookingId: item.equipmentBookingId,
          action: equipmentDecisions.get(item.equipmentBookingId) || "confirmed",
        }))
      : undefined;

    onSubmit({
      bookingId: booking.id,
      status: "confirmed",
      storageActions,
      equipmentActions: eqActions,
    });
  };

  // Count approved vs rejected (across actionable item types only, exclude already-rejected)
  const approvedCount = (kitchenAction === "confirmed" ? 1 : 0) +
    actionableStorageItems.filter((i) => storageDecisions.get(i.storageBookingId) === "confirmed").length +
    actionableEquipmentItems.filter((i) => equipmentDecisions.get(i.equipmentBookingId) === "confirmed").length;
  const rejectedCount = (kitchenAction === "cancelled" ? 1 : 0) +
    actionableStorageItems.filter((i) => storageDecisions.get(i.storageBookingId) === "cancelled").length +
    actionableEquipmentItems.filter((i) => equipmentDecisions.get(i.equipmentBookingId) === "cancelled").length;

  const allApproved = rejectedCount === 0;
  const allRejected = approvedCount === 0;

  return (
    <SheetContent className="sm:max-w-[480px] flex flex-col p-0 gap-0 h-full max-h-screen overflow-hidden">
      {/* Header */}
      <SheetHeader className="px-6 pt-6 pb-4 border-b bg-muted/30 shrink-0">
        <SheetTitle className="flex items-center gap-2 text-lg">
          <RefreshCcw className="h-5 w-5 text-primary" />
          Take Action on Booking
        </SheetTitle>
        <SheetDescription className="text-sm">
          {isAuthorized
            ? "Payment is held but not yet charged. Approve to charge, reject to release the hold."
            : "Review and decide on each item individually. Rejected items will be automatically refunded."}
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

        <Separator />

        {/* Kitchen Booking — toggleable */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <ChefHat className="h-3.5 w-3.5" />
            Kitchen Session
          </p>
          <button
            type="button"
            onClick={toggleKitchenAction}
            className={cn(
              "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left",
              "hover:shadow-sm active:scale-[0.99]",
              kitchenAction === "confirmed"
                ? "bg-green-50/50 border-green-200 hover:border-green-300"
                : "bg-red-50/50 border-red-200 hover:border-red-300"
            )}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                  kitchenAction === "confirmed" ? "bg-green-100" : "bg-red-100"
                )}
              >
                <ChefHat
                  className={cn(
                    "h-4 w-4",
                    kitchenAction === "confirmed" ? "text-green-600" : "text-red-600"
                  )}
                />
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
                <span className="text-xs font-mono text-muted-foreground">
                  {formatPrice(booking.totalPrice)}
                </span>
              )}
              <Badge
                className={cn(
                  "text-[10px] transition-colors cursor-pointer",
                  kitchenAction === "confirmed"
                    ? "border-success/30 text-success bg-success/10 hover:bg-success/15"
                    : "border-destructive/30 text-destructive bg-destructive/10 hover:bg-destructive/15"
                )}
              >
                {kitchenAction === "confirmed" ? (
                  <>
                    <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                    Approve
                  </>
                ) : (
                  <>
                    <XCircle className="h-2.5 w-2.5 mr-0.5" />
                    Reject
                  </>
                )}
              </Badge>
            </div>
          </button>
        </div>

        {/* Storage Items — individually toggleable */}
        {hasStorage && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Boxes className="h-3.5 w-3.5" />
                Storage Rentals
              </p>

              {/* Actionable storage items — toggleable */}
              {actionableStorageItems.map((item) => {
                const decision = storageDecisions.get(item.storageBookingId) || "confirmed";
                const isApproved = decision === "confirmed";
                const isDisabled = kitchenIsRejected; // Addons can't be approved if kitchen is rejected
                const dateRange =
                  item.startDate && item.endDate
                    ? item.startDate === item.endDate
                      ? formatStorageDate(item.startDate)
                      : `${formatStorageDate(item.startDate)} – ${formatStorageDate(item.endDate)}`
                    : "";

                return (
                  <button
                    key={item.storageBookingId}
                    type="button"
                    onClick={() => !isDisabled && toggleStorageDecision(item.storageBookingId)}
                    disabled={isDisabled}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left group",
                      isDisabled
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:shadow-sm active:scale-[0.99]",
                      isApproved
                        ? "bg-green-50/50 border-green-200 hover:border-green-300"
                        : "bg-red-50/50 border-red-200 hover:border-red-300"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                          isApproved ? "bg-green-100" : "bg-red-100"
                        )}
                      >
                        <Boxes
                          className={cn(
                            "h-4 w-4",
                            isApproved ? "text-green-600" : "text-red-600"
                          )}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.storageType}</span>
                          {dateRange && (
                            <>
                              <span>·</span>
                              <span>{dateRange}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.totalPrice > 0 && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {formatPrice(item.totalPrice)}
                        </span>
                      )}
                      <Badge
                        className={cn(
                          "text-[10px] transition-colors cursor-pointer",
                          isApproved
                            ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
                            : "bg-red-100 text-red-700 border-red-200 hover:bg-red-200"
                        )}
                      >
                        {isApproved ? (
                          <>
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                            Approve
                          </>
                        ) : (
                          <>
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />
                            Reject
                          </>
                        )}
                      </Badge>
                    </div>
                  </button>
                );
              })}

              {/* Already-rejected storage items — read-only */}
              {rejectedStorageItems.map((item) => (
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
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      <XCircle className="h-2.5 w-2.5 mr-0.5" />
                      Rejected
                    </Badge>
                  </div>
                </div>
              ))}

              {actionableStorageItems.length > 0 && !kitchenIsRejected && (
                <p className="text-[11px] text-muted-foreground italic pl-1">
                  Click each item to toggle between approve and reject
                </p>
              )}
            </div>
          </>
        )}

        {/* Equipment items — individually toggleable (same as storage) */}
        {hasEquipment && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Equipment Rentals
              </p>

              {/* Actionable equipment items — toggleable */}
              {actionableEquipmentItems.map((item) => {
                const decision = equipmentDecisions.get(item.equipmentBookingId) || "confirmed";
                const isApproved = decision === "confirmed";
                const isDisabled = kitchenIsRejected; // Addons can't be approved if kitchen is rejected

                return (
                  <button
                    key={item.equipmentBookingId}
                    type="button"
                    onClick={() => !isDisabled && toggleEquipmentDecision(item.equipmentBookingId)}
                    disabled={isDisabled}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left group",
                      isDisabled
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:shadow-sm active:scale-[0.99]",
                      isApproved
                        ? "bg-green-50/50 border-green-200 hover:border-green-300"
                        : "bg-red-50/50 border-red-200 hover:border-red-300"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                          isApproved ? "bg-green-100" : "bg-red-100"
                        )}
                      >
                        <Package
                          className={cn(
                            "h-4 w-4",
                            isApproved ? "text-green-600" : "text-red-600"
                          )}
                        />
                      </div>
                      <p className="text-sm font-medium truncate">{item.name}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.totalPrice > 0 && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {formatPrice(item.totalPrice)}
                        </span>
                      )}
                      <Badge
                        className={cn(
                          "text-[10px] transition-colors cursor-pointer",
                          isApproved
                            ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200"
                            : "bg-red-100 text-red-700 border-red-200 hover:bg-red-200"
                        )}
                      >
                        {isApproved ? (
                          <>
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                            Approve
                          </>
                        ) : (
                          <>
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />
                            Reject
                          </>
                        )}
                      </Badge>
                    </div>
                  </button>
                );
              })}

              {/* Already-rejected equipment items — read-only */}
              {rejectedEquipmentItems.map((item) => (
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
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      <XCircle className="h-2.5 w-2.5 mr-0.5" />
                      Rejected
                    </Badge>
                  </div>
                </div>
              ))}

              {actionableEquipmentItems.length > 0 && !kitchenIsRejected && (
                <p className="text-[11px] text-muted-foreground italic pl-1">
                  Click each item to toggle between approve and reject
                </p>
              )}
            </div>
          </>
        )}

        {/* ── Kitchen Rejected + Has Addons: Entire Booking Cancelled Banner ── */}
        {kitchenIsRejected && hasAddons && (
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
                Rejecting the kitchen session cancels the <strong>entire booking</strong> including all storage and equipment add-ons.
                {isAuthorized
                  ? " The payment hold will be fully released — the chef will not be charged anything."
                  : " A refund will be processed for the full booking amount."}
              </p>
            </div>
          </>
        )}

        {/* ── Auth-Then-Capture: Full Rejection (kitchen-only, no addons) ── */}
        {isAuthorized && allRejected && !hasAddons && (
          <>
            <Separator />
            <div className="p-4 rounded-lg border border-blue-200 bg-blue-50/50 space-y-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-semibold text-blue-800">
                  No Charge — Authorization Will Be Released
                </p>
              </div>
              <p className="text-xs text-blue-700">
                The chef&apos;s card has a temporary hold of {booking.transactionAmount ? formatPrice(booking.transactionAmount) : "the booking amount"}.
                Rejecting will release the entire hold — the chef will <strong>not be charged anything</strong> and no Stripe fees apply.
              </p>
            </div>
          </>
        )}

        {/* ── Auth-Then-Capture: Full Approval ────────────────────────────── */}
        {isAuthorized && allApproved && captureCalc && (
          <>
            <Separator />
            <div className="space-y-3 p-4 rounded-lg border border-blue-200 bg-blue-50/50">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-semibold text-blue-800">
                  Payment Will Be Captured
                </p>
              </div>
              <div className="space-y-1 text-xs p-2.5 rounded-md bg-white/60 border border-blue-100">
                <p className="text-[10px] font-medium text-blue-700 uppercase tracking-wide mb-1">Capture Breakdown</p>
                <div className="flex justify-between text-muted-foreground">
                  <span>Chef will be charged</span>
                  <span className="font-mono font-medium">{formatPrice(captureCalc.captureAmount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Est. Stripe fee</span>
                  <span className="font-mono text-red-600">-{formatPrice(captureCalc.estimatedStripeFee)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between font-semibold text-sm">
                  <span>Est. you receive</span>
                  <span className="font-mono text-green-700">{formatPrice(captureCalc.estimatedManagerNet)}</span>
                </div>
              </div>
              <p className="text-[10px] text-blue-600 italic">
                Stripe fee is estimated. Actual fee confirmed after capture.
              </p>
            </div>
          </>
        )}

        {/* ── Auth-Then-Capture: Partial Approval ──────────────────────────── */}
        {isAuthorized && captureCalc && captureCalc.isPartialCapture && (
          <>
            <Separator />
            <div className="space-y-3 p-4 rounded-lg border border-amber-200 bg-amber-50/50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">
                  Partial Capture — Only Approved Items Charged
                </p>
              </div>
              <p className="text-xs text-amber-700">
                The chef&apos;s card has a hold of {formatPrice(captureCalc.transactionAmount)}.
                Only the approved portion will be charged — the rest is <strong>automatically released</strong> (no refund needed).
              </p>

              {/* Capture Breakdown */}
              <div className="space-y-1 text-xs p-2.5 rounded-md bg-white/60 border border-amber-100">
                <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide mb-1">Capture Breakdown</p>
                {captureCalc.approvedKitchenCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Kitchen session</span>
                    <span className="font-mono">{formatPrice(captureCalc.approvedKitchenCents)}</span>
                  </div>
                )}
                {captureCalc.approvedStorageCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Approved storage</span>
                    <span className="font-mono">{formatPrice(captureCalc.approvedStorageCents)}</span>
                  </div>
                )}
                {captureCalc.approvedEquipmentCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Approved equipment</span>
                    <span className="font-mono">{formatPrice(captureCalc.approvedEquipmentCents)}</span>
                  </div>
                )}
                {captureCalc.approvedTax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax ({captureCalc.taxRatePercent}%)</span>
                    <span className="font-mono">+{formatPrice(captureCalc.approvedTax)}</span>
                  </div>
                )}
                <Separator className="my-1" />
                <div className="flex justify-between font-medium text-foreground">
                  <span>Will be charged</span>
                  <span className="font-mono">{formatPrice(captureCalc.captureAmount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Est. Stripe fee</span>
                  <span className="font-mono text-red-600">-{formatPrice(captureCalc.estimatedStripeFee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-sm text-green-700">
                  <span>Est. you receive</span>
                  <span className="font-mono">{formatPrice(captureCalc.estimatedManagerNet)}</span>
                </div>
              </div>

              {/* Release Info */}
              <div className="flex justify-between text-xs p-2 rounded-md bg-blue-50/80 border border-blue-100">
                <span className="text-blue-700">Released back to chef</span>
                <span className="font-mono font-medium text-blue-700">{formatPrice(captureCalc.releaseAmount)}</span>
              </div>
              <p className="text-[10px] text-amber-600 italic">
                Stripe fee is estimated (2.9% + $0.30). Actual fee confirmed after capture.
              </p>
            </div>
          </>
        )}

        {/* ── Refund Preview (only for captured/paid payments) ───────────── */}
        {!isAuthorized && refundCalc.hasAnyRejection && (
          <>
            <Separator />
            <div className="space-y-3 p-4 rounded-lg border border-amber-200 bg-amber-50/50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">
                  Automatic Refund Preview
                </p>
              </div>

              {/* Transaction Breakdown */}
              {refundCalc.transactionAmount > 0 && (
                <div className="space-y-1 text-xs p-2.5 rounded-md bg-white/60 border border-amber-100">
                  <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide mb-1">Transaction Breakdown</p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Total charged</span>
                    <span className="font-mono">{formatPrice(refundCalc.transactionAmount)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Stripe fee (already deducted)</span>
                    <span className="font-mono text-red-600">-{formatPrice(refundCalc.stripeFee)}</span>
                  </div>
                  <div className="flex justify-between font-medium text-foreground">
                    <span>Available in kitchen account</span>
                    <span className="font-mono">{formatPrice(refundCalc.managerRevenue)}</span>
                  </div>
                </div>
              )}

              {/* Refund Breakdown */}
              <div className="space-y-1.5 text-xs">
                <p className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">Refund Breakdown</p>
                {refundCalc.rejectedKitchenCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Kitchen session (rejected)</span>
                    <span className="font-mono">{formatPrice(refundCalc.rejectedKitchenCents)}</span>
                  </div>
                )}
                {refundCalc.rejectedStorageCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Storage ({refundCalc.rejectedStorageCount} item{refundCalc.rejectedStorageCount !== 1 ? "s" : ""} rejected)</span>
                    <span className="font-mono">{formatPrice(refundCalc.rejectedStorageCents)}</span>
                  </div>
                )}
                {refundCalc.rejectedEquipmentCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Equipment ({refundCalc.rejectedEquipmentCount} item{refundCalc.rejectedEquipmentCount !== 1 ? "s" : ""} rejected)</span>
                    <span className="font-mono">{formatPrice(refundCalc.rejectedEquipmentCents)}</span>
                  </div>
                )}
                {refundCalc.proportionalTax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax ({refundCalc.taxRatePercent}%)</span>
                    <span className="font-mono">+{formatPrice(refundCalc.proportionalTax)}</span>
                  </div>
                )}
                {refundCalc.grossRefund > 0 && (
                  <div className="flex justify-between text-muted-foreground font-medium">
                    <span>Gross refund</span>
                    <span className="font-mono">{formatPrice(refundCalc.grossRefund)}</span>
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
                {effectiveRefundAmount < refundCalc.netRefund && (
                  <p className="text-[10px] text-amber-600 italic">
                    Capped at available balance ({formatPrice(refundCalc.maxRefundable)})
                  </p>
                )}
              </div>

              {/* Editable refund amount */}
              <div className="space-y-2">
                {!isEditingRefund ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleEditRefund}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
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
                        variant="ghost"
                        size="sm"
                        onClick={handleResetRefund}
                        className="h-8 text-xs px-2"
                      >
                        Reset
                      </Button>
                    </div>
                    <p className="text-[10px] text-amber-600">
                      Max: {formatPrice(refundCalc.maxRefundable)} (manager&apos;s available balance)
                    </p>
                  </div>
                )}
              </div>

              {/* Info note */}
              <div className="flex items-start gap-1.5 text-[10px] text-amber-600">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Stripe fee and tax are proportionally included in the refund calculation.
                  Refund is processed automatically from the kitchen account upon confirmation.
                </span>
              </div>
            </div>
          </>
        )}

        {/* All approved confirmation (only for non-authorized bookings — authorized has its own section above) */}
        {!isAuthorized && allApproved && (
          <>
            <Separator />
            <div className="p-3 rounded-lg border border-green-200 bg-green-50/50">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <p className="text-sm font-medium text-green-800">
                  All items approved — no refund needed
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <SheetFooter className="px-6 py-4 border-t bg-muted/30 shrink-0 !flex-col !space-x-0 gap-3">
        {/* Summary badges */}
        <div className="flex items-center gap-2 w-full">
          {approvedCount > 0 && (
            <Badge variant="success" className="text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {approvedCount} approved
            </Badge>
          )}
          {rejectedCount > 0 && (
            <Badge variant="outline" className="text-xs text-destructive border-destructive/30">
              <XCircle className="h-3 w-3 mr-1" />
              {rejectedCount} rejected
            </Badge>
          )}
          {!isAuthorized && refundCalc.hasAnyRejection && (
            <Badge variant="warning" className="text-xs ml-auto">
              <DollarSign className="h-3 w-3 mr-0.5" />
              {formatPrice(effectiveRefundAmount)} refund
            </Badge>
          )}
          {isAuthorized && refundCalc.hasAnyRejection && (
            <Badge variant="info" className="text-xs ml-auto">
              No charge
            </Badge>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between w-full gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            variant={allRejected ? "destructive" : allApproved ? "success" : "default"}
            className="flex-1 min-w-[160px]"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : allRejected ? (
              <XCircle className="h-4 w-4 mr-2" />
            ) : allApproved ? (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            ) : (
              <RefreshCcw className="h-4 w-4 mr-2" />
            )}
            {isLoading
              ? "Processing..."
              : kitchenIsRejected
              ? (hasAddons ? "Reject Entire Booking" : "Reject Booking")
              : allApproved
              ? "Approve All"
              : "Confirm Decisions"}
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  );
}
