import { EquipmentIcon as Package, StorageIcon as Boxes } from "@/components/ui/inventory-icons";
import { useState, useMemo, useRef, type ReactNode } from "react";
import { mt } from "@/i18n/manager";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Loader2, Calendar, Clock, MapPin, DollarSign, AlertTriangle, RefreshCcw, Info, Pencil } from "@/components/ui/manager-icons";
import { cn } from "@/lib/utils";
import { TruncatedText } from "@/components/common/TruncatedText";
import { kitchenBookingBlocks } from "@/lib/kitchen-booking-blocks";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StorageItemForAction {
  id: number;
  storageBookingId: number;
  name: string;
  storageType: string;
  totalPrice: number; // in cents
  startDate?: string;
  endDate?: string;
  rejected?: boolean; // true if already rejected (read-only in action dialog)
}

export interface EquipmentItemForAction {
  id: number;
  equipmentBookingId: number;
  name: string;
  totalPrice: number; // in cents
  rejected?: boolean; // true if already rejected (read-only in action dialog)
}

export interface BookingForAction {
  id: number;
  kitchenName?: string;
  chefName?: string;
  locationName?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  selectedSlots?: Array<string | { startTime: string; endTime: string }> | null;
  operatingWindowStartTime?: string | null;
  totalPrice?: number; // kitchen-only price in cents
  storageItems?: StorageItemForAction[];
  equipmentItems?: EquipmentItemForAction[];
  // Payment info for refund preview
  transactionAmount?: number; // total charged in cents
  serviceFee?: number; // Local Cooks fee included in the authorization
  stripeProcessingFee?: number; // Stripe fee in cents
  managerRevenue?: number; // manager received in cents
  taxRatePercent?: number; // tax rate (e.g. 13 for 13%)
  paymentStatus?: string; // 'authorized' | 'paid' | etc.
}

type ItemAction = "confirmed" | "cancelled";

function BookingItemDecision({ name, details, price, icon, decision, disabled, onDecision }: {
  name: string;
  details?: ReactNode;
  price?: number;
  icon: ReactNode;
  decision: ItemAction;
  disabled: boolean;
  onDecision: (decision: ItemAction) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between", disabled && "bg-muted/30")}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">{icon}</span>
        <div className="min-w-0 space-y-1">
          <p className="break-words text-sm font-medium">{name}</p>
          {details && <div className="text-xs leading-5 text-muted-foreground">{details}</div>}
          {price != null && price > 0 && <p className="text-sm tabular-nums">{formatPrice(price)}</p>}
        </div>
      </div>
      <div role="group" aria-label={name} className="flex shrink-0 gap-1 rounded-lg border bg-background p-1">
        {(["confirmed", "cancelled"] as const).map(value => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={decision === value}
            disabled={disabled}
            onClick={() => onDecision(value)}
            className={cn("flex-1 px-3 sm:flex-none", decision === value && (value === "confirmed"
              ? "bg-success/10 text-success hover:bg-success/15 hover:text-success"
              : "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"))}
          >
            {value === "confirmed" ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
            {mt(value === "confirmed" ? "approve" : "reviewDecline")}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface StorageDecision {
  storageBookingId: number;
  action: ItemAction;
}

interface EquipmentDecision {
  equipmentBookingId: number;
  action: ItemAction;
}

interface BookingActionDialogProps {
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

export function BookingActionDialog({
  open,
  onOpenChange,
  booking,
  isLoading = false,
  onSubmit,
}: BookingActionDialogProps) {
  
  const dialogKey = booking ? `${booking.id}` : "empty";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isLoading) onOpenChange(nextOpen); }}>
      {open && booking ? (
        <BookingActionDialogContent
          key={dialogKey}
          booking={booking}
          isLoading={isLoading}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      ) : open ? (
        <AppDialogContent className="space-y-4 p-6 sm:max-w-[680px]" aria-label={mt("loadingBookingDetails")}>
          <Skeleton className="h-8 w-2/3" />
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}
        </AppDialogContent>
      ) : null}
    </Dialog>
  );
}

function BookingActionDialogContent({
  booking,
  isLoading,
  onSubmit,
  onCancel,
}: {
  booking: BookingForAction;
  isLoading: boolean;
  onSubmit: BookingActionDialogProps["onSubmit"];
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

  // ── Refund Calculation (tax + service fee returned; Stripe fee sunk) ─────────
  // Formula:
  //   rejectedSubtotal = sum of rejected item prices (pre-tax)
  //   proportionalTax / proportionalServiceFee scaled to rejected share
  //   grossRefund = rejectedSubtotal + tax + serviceFee
  //   netRefund = max(0, grossRefund − proportionalStripeFee)
  //   Full rejection → customer gets charge − stripe fee (platform returns service fee)
  const refundCalc = useMemo(() => {
    const kitchenPriceCents = booking.totalPrice || 0;
    const transactionAmount = booking.transactionAmount || 0;
    const stripeFee = booking.stripeProcessingFee || 0;
    const managerRevenue = booking.managerRevenue || 0;
    const serviceFee = booking.serviceFee || 0;
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

    // Proportional platform service fee (returned to customer on refund)
    const managerGross = managerRevenue + stripeFee;
    const proportionalServiceFee = managerGross > 0
      ? Math.round(serviceFee * ((totalRejectedSubtotal + proportionalTax) / managerGross))
      : 0;

    // Gross refund = rejected subtotal + tax + service fee
    const grossRefund = totalRejectedSubtotal + proportionalTax + proportionalServiceFee;

    // Proportional Stripe fee (sunk)
    const proportionalStripeFee = transactionAmount > 0
      ? Math.round(stripeFee * (grossRefund / transactionAmount))
      : 0;

    const netRefund = Math.max(0, grossRefund - proportionalStripeFee);

    // Cap at manager remaining + remaining service fee (Stripe fee excluded)
    const maxRefundable = Math.max(0, managerRevenue + serviceFee);
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
    const originalServiceFee = booking.serviceFee || 0;
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
    const originalSubtotal = Math.max(
      0,
      kitchenPriceCents
        + (booking.storageItems || []).reduce((sum, item) => sum + (item.rejected ? 0 : item.totalPrice), 0)
        + (booking.equipmentItems || []).reduce((sum, item) => sum + (item.rejected ? 0 : item.totalPrice), 0),
    );
    const approvedServiceFee = originalSubtotal > 0
      ? Math.round(originalServiceFee * approvedSubtotal / originalSubtotal)
      : 0;
    const captureAmount = approvedSubtotal + approvedTax + approvedServiceFee;
    const releaseAmount = Math.max(0, transactionAmount - captureAmount);

    // Estimated Stripe fee on capture amount (2.9% + $0.30)
    const estimatedStripeFee = captureAmount > 0
      ? Math.round(captureAmount * 0.029 + 30)
      : 0;
    const estimatedManagerNet = Math.max(0, approvedSubtotal + approvedTax - estimatedStripeFee);
    const isPartialCapture = captureAmount > 0 && captureAmount < transactionAmount;

    return {
      approvedKitchenCents,
      approvedStorageCents,
      approvedEquipmentCents,
      approvedSubtotal,
      approvedTax,
      approvedServiceFee,
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
  const titleRef = useRef<HTMLSpanElement>(null);

  return (
    <AppDialogContent className="sm:max-w-[880px] sm:w-[calc(100%_-_3rem)] p-0 sm:p-0 gap-0 max-h-[90dvh] overflow-hidden" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}>
      <AppDialogHeader
        className="shrink-0"
        icon={<Calendar className="h-4 w-4" />}
        title={<span ref={titleRef} tabIndex={-1} className="outline-none">{mt("takeActionOnBooking")}</span>}
        description={mt("reviewBookingGuidance")}
      />
      <AppDialogBody className="space-y-5">
        {/* Booking Summary */}
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-start">
          <div className="flex-1 min-w-0">
            <TruncatedText as="p" className="font-semibold text-sm truncate">
              {booking.kitchenName || mt("kitchenBooking")}
            </TruncatedText>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              {booking.chefName && (
                <span className="flex items-center gap-1">
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
                {kitchenBookingBlocks(booking).map(block =>
                  `${formatTime(block.startTime)} – ${formatTime(block.endTime)}`).join(', ')}
              </span>
            </div>
          </div>
          {booking.transactionAmount != null && booking.transactionAmount > 0 && (
            <div className="shrink-0 text-sm sm:text-right">
              <p className="text-xs text-muted-foreground">{mt(isAuthorized ? "reviewAmountHeld" : "totalCharged3")}</p>
              <p className="mt-1 font-semibold tabular-nums">{formatPrice(booking.transactionAmount)}</p>
            </div>
          )}
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
        <section className="space-y-3" aria-label={mt("reviewRequestedItems")}>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{mt("reviewRequestedItems")}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{mt("reviewItemGuidance")}</p>
          </div>
          <BookingItemDecision
            name={mt("kitchenSession")}
            details={kitchenBookingBlocks(booking).map(block =>
              `${formatTime(block.startTime)} – ${formatTime(block.endTime)}`).join(', ')}
            price={booking.totalPrice}
            icon={<Calendar className="h-4 w-4" />}
            decision={kitchenAction}
            disabled={isLoading}
            onDecision={value => { if (value !== kitchenAction) toggleKitchenAction(); }}
          />
          {kitchenIsRejected && hasAddons && <p className="text-sm leading-6 text-muted-foreground">{mt("reviewDeclineIncludesAddons")}</p>}
        </section>

        {/* Storage Items — individually toggleable */}
        {hasStorage && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Boxes className="h-3.5 w-3.5" />{mt("storageRentals")}</p>

              {/* Actionable storage items — toggleable */}
              {actionableStorageItems.map((item) => {
                const decision = storageDecisions.get(item.storageBookingId) || "confirmed";
                const isDisabled = kitchenIsRejected; // Addons can't be approved if kitchen is rejected
                const dateRange =
                  item.startDate && item.endDate
                    ? item.startDate === item.endDate
                      ? formatStorageDate(item.startDate)
                      : `${formatStorageDate(item.startDate)} – ${formatStorageDate(item.endDate)}`
                    : "";

                return (
                  <BookingItemDecision
                    key={item.storageBookingId}
                    name={item.name}
                    details={[item.storageType, dateRange].filter(Boolean).join(' · ')}
                    price={item.totalPrice}
                    icon={<Boxes className="h-4 w-4" />}
                    decision={decision}
                    disabled={isDisabled || isLoading}
                    onDecision={value => { if (value !== decision) toggleStorageDecision(item.storageBookingId); }}
                  />
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
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      <XCircle className="h-2.5 w-2.5 mr-0.5" />{mt("rejected")}</Badge>
                  </div>
                </div>
              ))}

            </div>
          </>
        )}

        {/* Equipment items — individually toggleable (same as storage) */}
        {hasEquipment && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />{mt("equipmentRentals")}</p>

              {/* Actionable equipment items — toggleable */}
              {actionableEquipmentItems.map((item) => {
                const decision = equipmentDecisions.get(item.equipmentBookingId) || "confirmed";
                const isDisabled = kitchenIsRejected; // Addons can't be approved if kitchen is rejected

                return (
                  <BookingItemDecision
                    key={item.equipmentBookingId}
                    name={item.name}
                    price={item.totalPrice}
                    icon={<Package className="h-4 w-4" />}
                    decision={decision}
                    disabled={isDisabled || isLoading}
                    onDecision={value => { if (value !== decision) toggleEquipmentDecision(item.equipmentBookingId); }}
                  />
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
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      <XCircle className="h-2.5 w-2.5 mr-0.5" />{mt("rejected")}</Badge>
                  </div>
                </div>
              ))}

            </div>
          </>
        )}

        </div>
        <section className="space-y-4 rounded-xl border bg-muted/20 p-4" aria-label={mt("reviewPaymentSummary")}>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{mt("reviewPaymentSummary")}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{isAuthorized ? mt("paymentHeldApproveToCharge") : mt("reviewDecideEachItem")}</p>
          </div>
        {/* ── Kitchen Rejected + Has Addons: Entire Booking Cancelled Banner ── */}
        {kitchenIsRejected && hasAddons && (
          <>
            <Separator />
            <div className="p-4 rounded-lg border border-red-200 bg-red-50/50 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <p className="text-sm font-semibold text-red-800">{mt("entireBookingWillBeCancelled")}</p>
              </div>
              <p className="text-sm leading-6 text-destructive">{mt("reviewDeclineIncludesAddons")}{" "}
                {isAuthorized
                  ? mt("paymentHoldFullyReleased")
                  : mt("fullBookingRefundProcessed")}
              </p>
            </div>
          </>
        )}

        {/* ── Auth-Then-Capture: Full Rejection (kitchen-only, no addons) ── */}
        {isAuthorized && allRejected && !hasAddons && (
          <>
            <Separator />
            <div className="p-4 rounded-lg border border-blue-200 bg-background space-y-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-semibold text-blue-800">
                  {mt("noChargeAuthReleased")}
                </p>
              </div>
              <p className="text-xs text-blue-700">
                {mt("chefCardHoldAmount", { amount: booking.transactionAmount ? formatPrice(booking.transactionAmount) : mt("theBookingAmount") })}
                {" "}{mt("rejectingReleaseHoldNote")}
              </p>
            </div>
          </>
        )}

        {/* ── Auth-Then-Capture: Full Approval ────────────────────────────── */}
        {isAuthorized && allApproved && captureCalc && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">{mt("paymentWillBeCaptured")}</p>
              </div>
              <div className="space-y-2 text-sm p-3 rounded-lg bg-background border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{mt("captureBreakdown")}</p>
                <div className="flex justify-between text-muted-foreground">
                  <span>{mt("totalCharged3")}</span>
                  <span className="font-mono font-medium">{formatPrice(captureCalc.captureAmount)}</span>
                </div>
                {captureCalc.approvedServiceFee > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("localCooksServiceFee")}</span>
                    <span className="font-mono text-red-600">-{formatPrice(captureCalc.approvedServiceFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>{mt("estStripeFee")}</span>
                  <span className="font-mono text-red-600">-{formatPrice(captureCalc.estimatedStripeFee)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between font-semibold text-sm">
                  <span>{mt("estYouReceive")}</span>
                  <span className="font-mono text-green-700">{formatPrice(captureCalc.estimatedManagerNet)}</span>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{mt("stripeFeeIsEstimatedActualFeeConfirmedAfterCapture")}</p>
            </div>
          </>
        )}

        {/* ── Auth-Then-Capture: Partial Approval ──────────────────────────── */}
        {isAuthorized && captureCalc && captureCalc.isPartialCapture && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">
                  {mt("partialCaptureApprovedOnly")}
                </p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {mt("chefCardHoldAmount", { amount: formatPrice(captureCalc.transactionAmount) })}{" "}
                {mt("partialCaptureReleasedNote")}
              </p>

              {/* Capture Breakdown */}
              <div className="space-y-2 text-sm p-3 rounded-lg bg-background border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{mt("captureBreakdown")}</p>
                <div className="flex justify-between font-medium text-foreground">
                  <span>{mt("totalCharged3")}</span>
                  <span className="font-mono">{formatPrice(captureCalc.captureAmount)}</span>
                </div>
                {captureCalc.approvedServiceFee > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("localCooksServiceFee")}</span>
                    <span className="font-mono text-red-600">-{formatPrice(captureCalc.approvedServiceFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>{mt("estStripeFee")}</span>
                  <span className="font-mono text-red-600">-{formatPrice(captureCalc.estimatedStripeFee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-sm text-green-700">
                  <span>{mt("estYouReceive")}</span>
                  <span className="font-mono">{formatPrice(captureCalc.estimatedManagerNet)}</span>
                </div>
              </div>

              {/* Release Info */}
              <div className="flex justify-between gap-3 rounded-lg border bg-background p-3 text-sm">
                <span>{mt("releasedBackToChef")}</span>
                <span className="font-mono font-medium">{formatPrice(captureCalc.releaseAmount)}</span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {mt("stripeFeeEstimatedCaptureNote")}
              </p>
            </div>
          </>
        )}

        {/* ── Refund Preview (only for captured/paid payments) ───────────── */}
        {!isAuthorized && refundCalc.hasAnyRejection && (
          <>
            <Separator />
            <div className="space-y-3 p-4 rounded-lg border border-amber-200 bg-background">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">{mt("automaticRefundPreview")}</p>
              </div>

              {/* Transaction Breakdown */}
              {refundCalc.transactionAmount > 0 && (
                <div className="space-y-1 text-sm p-3 rounded-md bg-background border border-amber-100">
                  <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-1">{mt("transactionBreakdown")}</p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("totalCharged3")}</span>
                    <span className="font-mono">{formatPrice(refundCalc.transactionAmount)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("stripeFeeAlreadyDeducted")}</span>
                    <span className="font-mono text-red-600">-{formatPrice(refundCalc.stripeFee)}</span>
                  </div>
                  <div className="flex justify-between font-medium text-foreground">
                    <span>{mt("availableInKitchenAccount")}</span>
                    <span className="font-mono">{formatPrice(refundCalc.managerRevenue)}</span>
                  </div>
                </div>
              )}

              {/* Refund Breakdown */}
              <div className="space-y-1.5 text-xs">
                <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">{mt("refundBreakdown")}</p>
                {refundCalc.rejectedKitchenCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("kitchenSessionRejected")}</span>
                    <span className="font-mono">{formatPrice(refundCalc.rejectedKitchenCents)}</span>
                  </div>
                )}
                {refundCalc.rejectedStorageCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("storageItemsRejectedCount", { count: refundCalc.rejectedStorageCount })}</span>
                    <span className="font-mono">{formatPrice(refundCalc.rejectedStorageCents)}</span>
                  </div>
                )}
                {refundCalc.rejectedEquipmentCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("equipmentItemsRejectedCount", { count: refundCalc.rejectedEquipmentCount })}</span>
                    <span className="font-mono">{formatPrice(refundCalc.rejectedEquipmentCents)}</span>
                  </div>
                )}
                {refundCalc.proportionalTax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{mt("taxPercentLabel", { percent: refundCalc.taxRatePercent })}</span>
                    <span className="font-mono">+{formatPrice(refundCalc.proportionalTax)}</span>
                  </div>
                )}
                {refundCalc.grossRefund > 0 && (
                  <div className="flex justify-between text-muted-foreground font-medium">
                    <span>{mt("grossRefund")}</span>
                    <span className="font-mono">{formatPrice(refundCalc.grossRefund)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>{mt("stripeFeeProportional")}</span>
                  <span className="font-mono text-red-600">-{formatPrice(refundCalc.proportionalStripeFee)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between font-semibold text-sm">
                  <span>{mt("customerReceives2")}</span>
                  <span className="font-mono text-green-700">{formatPrice(effectiveRefundAmount)}</span>
                </div>
                {effectiveRefundAmount < refundCalc.netRefund && (
                  <p className="text-xs text-amber-600 italic">
                    {mt("reviewRefundCapped", { amount: formatPrice(refundCalc.maxRefundable) })}
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
                    disabled={isLoading}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
                  >
                    <Pencil className="h-3 w-3 mr-1" />{mt("modifyRefundAmount")}</Button>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-review-refund" className="text-xs text-amber-700">{mt("customRefundAmount")}</Label>
                    <div className="flex items-center gap-2">
                      <CurrencyInput
                        id="booking-review-refund"
                        disabled={isLoading}
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
                        disabled={isLoading}
                        className="h-8 text-xs px-2"
                      >{mt("reset")}</Button>
                    </div>
                    <p className="text-xs text-amber-600">
                      {mt("reviewRefundMaximum", { amount: formatPrice(refundCalc.maxRefundable) })}
                    </p>
                  </div>
                )}
              </div>

              {/* Info note */}
              <div className="flex items-start gap-1.5 text-xs text-amber-600">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  {mt("stripeFeeTaxProportionalRefund")}{" "}
                  {mt("reviewRefundProcessing")}
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
                  {mt("allItemsApprovedNoRefund")}
                </p>
              </div>
            </div>
          </>
        )}
        </section>
        </div>
      </AppDialogBody>

      {/* Footer */}
      <AppDialogFooter className="shrink-0 !flex-col gap-3">
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          <span>{mt("reviewApprovalCount", { count: approvedCount })}</span>
          <span>{mt("reviewDeclineCount", { count: rejectedCount })}</span>
          {!isAuthorized && refundCalc.hasAnyRejection && (
            <span className="font-medium text-foreground sm:ml-auto">{mt("reviewRefundAmount", { amount: formatPrice(effectiveRefundAmount) })}</span>
          )}
          {isAuthorized && captureCalc && (
            <span className="font-medium text-foreground sm:ml-auto">{mt("reviewChargeAmount", { amount: formatPrice(captureCalc.captureAmount) })}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isLoading}
            className="sm:w-auto"
          >{mt("reviewKeepRequest")}</Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            variant={allRejected ? "destructive" : "default"}
            className="sm:min-w-[200px]"
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
              ? mt("processingEllipsis")
              : kitchenIsRejected
              ? mt("reviewDeclineRequest")
              : allApproved
              ? mt("reviewApproveBooking")
              : mt("reviewApproveSelected")}
          </Button>
        </div>
      </AppDialogFooter>
    </AppDialogContent>
  );
}
