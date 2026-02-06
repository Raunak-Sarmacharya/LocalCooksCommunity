import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StorageItemForApproval {
  id: number;
  storageBookingId: number;
  name: string;
  storageType: string;
  totalPrice: number;
  startDate?: string;
  endDate?: string;
}

export interface EquipmentItemForApproval {
  id: number;
  name: string;
  totalPrice: number;
}

export interface BookingForApproval {
  id: number;
  kitchenName?: string;
  chefName?: string;
  locationName?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice?: number;
  storageItems?: StorageItemForApproval[];
  equipmentItems?: EquipmentItemForApproval[];
}

type StorageAction = "confirmed" | "cancelled";

interface StorageDecision {
  storageBookingId: number;
  action: StorageAction;
}

interface BookingApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingForApproval | null;
  mode: "confirm" | "reject";
  isLoading?: boolean;
  onSubmit: (params: {
    bookingId: number;
    status: "confirmed" | "cancelled";
    storageActions?: StorageDecision[];
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

export function BookingApprovalDialog({
  open,
  onOpenChange,
  booking,
  mode,
  isLoading = false,
  onSubmit,
}: BookingApprovalDialogProps) {
  // Render the inner component with a key that changes when booking/mode changes
  // This forces a remount so initial state is derived from props cleanly
  const dialogKey = booking ? `${booking.id}-${mode}` : "empty";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && booking ? (
        <BookingApprovalDialogContent
          key={dialogKey}
          booking={booking}
          mode={mode}
          isLoading={isLoading}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function BookingApprovalDialogContent({
  booking,
  mode,
  isLoading,
  onSubmit,
  onCancel,
}: {
  booking: BookingForApproval;
  mode: "confirm" | "reject";
  isLoading: boolean;
  onSubmit: BookingApprovalDialogProps["onSubmit"];
  onCancel: () => void;
}) {
  // Initialize per-storage-booking decisions from props (runs once per mount due to key)
  const [storageDecisions, setStorageDecisions] = useState<
    Map<number, StorageAction>
  >(() => {
    const defaults = new Map<number, StorageAction>();
    if (booking.storageItems) {
      for (const item of booking.storageItems) {
        defaults.set(
          item.storageBookingId,
          mode === "confirm" ? "confirmed" : "cancelled"
        );
      }
    }
    return defaults;
  });

  const toggleStorageDecision = (storageBookingId: number) => {
    setStorageDecisions((prev) => {
      const next = new Map(prev);
      const current = next.get(storageBookingId);
      next.set(
        storageBookingId,
        current === "confirmed" ? "cancelled" : "confirmed"
      );
      return next;
    });
  };

  const handleSubmit = () => {
    if (!booking) return;

    const hasStorage =
      booking.storageItems && booking.storageItems.length > 0;

    // Build storageActions only if there are storage items
    const storageActions: StorageDecision[] | undefined = hasStorage
      ? booking.storageItems!.map((item) => ({
          storageBookingId: item.storageBookingId,
          action: storageDecisions.get(item.storageBookingId) || (mode === "confirm" ? "confirmed" : "cancelled"),
        }))
      : undefined;

    onSubmit({
      bookingId: booking.id,
      status: mode === "confirm" ? "confirmed" : "cancelled",
      storageActions,
    });
  };

  const hasStorage = booking.storageItems && booking.storageItems.length > 0;
  const hasEquipment =
    booking.equipmentItems && booking.equipmentItems.length > 0;
  const isConfirmMode = mode === "confirm";

  // Count how many storage items differ from the default action
  const storageOverrideCount = hasStorage
    ? booking.storageItems!.filter((item) => {
        const decision = storageDecisions.get(item.storageBookingId);
        return isConfirmMode
          ? decision === "cancelled"
          : decision === "confirmed";
      }).length
    : 0;

  return (
      <DialogContent className="sm:max-w-[520px] gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div
          className={cn(
            "px-6 pt-6 pb-4",
            isConfirmMode
              ? "bg-gradient-to-br from-green-50 to-emerald-50 border-b border-green-100"
              : "bg-gradient-to-br from-red-50 to-orange-50 border-b border-red-100"
          )}
        >
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="flex items-center gap-2 text-lg">
              {isConfirmMode ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              {isConfirmMode ? "Approve Booking" : "Reject Booking"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {hasStorage
                ? "Review each item and choose what to approve or reject individually."
                : isConfirmMode
                ? "Confirm this kitchen booking?"
                : "Reject this kitchen booking? The chef will be notified."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Booking summary */}
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
                  {formatTime(booking.startTime)} –{" "}
                  {formatTime(booking.endTime)}
                </span>
              </div>
            </div>
            {booking.totalPrice != null && booking.totalPrice > 0 && (
              <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                <DollarSign className="h-3 w-3 mr-0.5" />
                {formatPrice(booking.totalPrice)}
              </Badge>
            )}
          </div>

          {/* Kitchen booking action — always follows the mode */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-background">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  isConfirmMode ? "bg-green-100" : "bg-red-100"
                )}
              >
                <ChefHat
                  className={cn(
                    "h-4 w-4",
                    isConfirmMode ? "text-green-600" : "text-red-600"
                  )}
                />
              </div>
              <div>
                <p className="text-sm font-medium">Kitchen Booking</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(booking.startTime)} –{" "}
                  {formatTime(booking.endTime)}
                </p>
              </div>
            </div>
            <Badge
              className={cn(
                "text-xs",
                isConfirmMode
                  ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-100"
                  : "bg-red-100 text-red-700 border-red-200 hover:bg-red-100"
              )}
            >
              {isConfirmMode ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Approve
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 mr-1" />
                  Reject
                </>
              )}
            </Badge>
          </div>

          {/* Storage items — individually toggleable */}
          {hasStorage && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Boxes className="h-3.5 w-3.5" />
                    Storage Rentals
                  </p>
                  {storageOverrideCount > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-amber-600 border-amber-200"
                    >
                      <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                      {storageOverrideCount} modified
                    </Badge>
                  )}
                </div>

                {booking.storageItems!.map((item) => {
                  const decision =
                    storageDecisions.get(item.storageBookingId) ||
                    (isConfirmMode ? "confirmed" : "cancelled");
                  const isApproved = decision === "confirmed";
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
                      onClick={() =>
                        toggleStorageDecision(item.storageBookingId)
                      }
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200 text-left group",
                        "hover:shadow-sm active:scale-[0.99]",
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
                          <p className="text-sm font-medium truncate">
                            {item.name}
                          </p>
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

                <p className="text-[11px] text-muted-foreground italic pl-1">
                  Click each storage item to toggle between approve and reject
                </p>
              </div>
            </>
          )}

          {/* Equipment items — informational only (follows kitchen booking) */}
          {hasEquipment && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Equipment Rentals
                </p>
                {booking.equipmentItems!.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border",
                      isConfirmMode
                        ? "bg-green-50/30 border-green-100"
                        : "bg-red-50/30 border-red-100"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center",
                          isConfirmMode ? "bg-green-100" : "bg-red-100"
                        )}
                      >
                        <Package
                          className={cn(
                            "h-4 w-4",
                            isConfirmMode
                              ? "text-green-600"
                              : "text-red-600"
                          )}
                        />
                      </div>
                      <p className="text-sm font-medium">{item.name}</p>
                    </div>
                    {item.totalPrice > 0 && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {formatPrice(item.totalPrice)}
                      </span>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground italic pl-1">
                  Equipment follows the kitchen booking decision
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <div className="flex items-center justify-between w-full gap-3">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading}
              className={cn(
                "flex-1 sm:flex-none min-w-[140px]",
                isConfirmMode
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              )}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : isConfirmMode ? (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              {isLoading
                ? "Processing..."
                : isConfirmMode
                ? "Confirm Booking"
                : "Reject Booking"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
  );
}
