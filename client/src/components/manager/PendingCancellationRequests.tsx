import { useState, useMemo } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ChefHat,
  MapPin,
  Boxes,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StorageItemWithCancel {
  id: number;
  storageBookingId?: number;
  name: string;
  storageType: string;
  totalPrice: number;
  startDate?: string;
  endDate?: string;
  cancellationRequested?: boolean;
  status?: string;
}

export interface BookingForCancellation {
  id: number;
  status: string;
  chefName?: string;
  kitchenName?: string;
  locationName?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  storageItems?: StorageItemWithCancel[];
}

interface CancellationRequest {
  kind: "kitchen" | "storage";
  bookingId: number;
  storageBookingId?: number;
  chefName: string;
  kitchenName: string;
  locationName: string;
  label: string;
  date: string;
}

interface PendingCancellationRequestsProps {
  bookings: BookingForCancellation[];
  onAcceptKitchenCancellation: (bookingId: number) => void;
  onDeclineKitchenCancellation: (bookingId: number) => void;
  onAcceptStorageCancellation: (storageBookingId: number) => void;
  onDeclineStorageCancellation: (storageBookingId: number) => void;
  isProcessing?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatTime = (time: string) => {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function PendingCancellationRequests({
  bookings,
  onAcceptKitchenCancellation,
  onDeclineKitchenCancellation,
  onAcceptStorageCancellation,
  onDeclineStorageCancellation,
  isProcessing = false,
}: PendingCancellationRequestsProps) {
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: "accept" | "decline";
    request: CancellationRequest | null;
  }>({ open: false, action: "accept", request: null });

  // Derive cancellation requests from bookings data
  const requests = useMemo<CancellationRequest[]>(() => {
    const result: CancellationRequest[] = [];

    for (const booking of bookings) {
      // Kitchen booking cancellation requests
      if (booking.status === "cancellation_requested") {
        const dateStr = booking.bookingDate?.split("T")[0];
        result.push({
          kind: "kitchen",
          bookingId: booking.id,
          chefName: booking.chefName || `Chef #${booking.id}`,
          kitchenName: booking.kitchenName || "Kitchen",
          locationName: booking.locationName || "",
          label: `Kitchen Booking #${booking.id}`,
          date: dateStr
            ? `${format(new Date(dateStr), "MMM d, yyyy")} · ${formatTime(booking.startTime)} – ${formatTime(booking.endTime)}`
            : "",
        });
      }

      // Storage item cancellation requests (within any booking)
      if (booking.storageItems) {
        for (const item of booking.storageItems) {
          if (item.cancellationRequested) {
            const sbId = item.storageBookingId || item.id;
            const dateRange =
              item.startDate && item.endDate
                ? `${format(new Date(item.startDate), "MMM d")} – ${format(new Date(item.endDate), "MMM d, yyyy")}`
                : "";
            result.push({
              kind: "storage",
              bookingId: booking.id,
              storageBookingId: sbId,
              chefName: booking.chefName || `Chef #${booking.id}`,
              kitchenName: booking.kitchenName || "Kitchen",
              locationName: booking.locationName || "",
              label: `${item.name} (${item.storageType})`,
              date: dateRange,
            });
          }
        }
      }
    }

    return result;
  }, [bookings]);

  if (requests.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Cancellation Requests</CardTitle>
              <CardDescription className="text-xs">
                Chef-initiated cancellation requests awaiting your review
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No pending cancellation requests</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleAction = (
    action: "accept" | "decline",
    request: CancellationRequest,
  ) => {
    setConfirmDialog({ open: true, action, request });
  };

  const handleConfirm = () => {
    const { action, request } = confirmDialog;
    if (!request) return;

    if (request.kind === "kitchen") {
      if (action === "accept") onAcceptKitchenCancellation(request.bookingId);
      else onDeclineKitchenCancellation(request.bookingId);
    } else if (request.storageBookingId) {
      if (action === "accept")
        onAcceptStorageCancellation(request.storageBookingId);
      else onDeclineStorageCancellation(request.storageBookingId);
    }

    setConfirmDialog({ open: false, action: "accept", request: null });
  };

  return (
    <>
      <Card className="border-amber-200 bg-amber-50/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Cancellation Requests
                </CardTitle>
                <CardDescription className="text-xs">
                  Chef-initiated cancellation requests awaiting your review
                </CardDescription>
              </div>
            </div>
            <Badge
              variant="secondary"
              className="bg-amber-100 text-amber-700 border-amber-300"
            >
              {requests.length} pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {requests.map((req, idx) => (
            <div
              key={`${req.kind}-${req.storageBookingId || req.bookingId}-${idx}`}
              className="flex items-center justify-between gap-4 rounded-lg border bg-white p-3.5 shadow-sm"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div
                  className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${req.kind === "kitchen" ? "bg-blue-50" : "bg-purple-50"}`}
                >
                  {req.kind === "kitchen" ? (
                    <ChefHat className="h-4 w-4 text-blue-600" />
                  ) : (
                    <Boxes className="h-4 w-4 text-purple-600" />
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium truncate">{req.label}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ChefHat className="h-3 w-3" />
                      {req.chefName}
                    </span>
                    {req.locationName && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {req.locationName}
                      </span>
                    )}
                    {req.date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {req.date}
                      </span>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-amber-50 text-amber-700 border-amber-200"
                  >
                    <Clock className="h-2.5 w-2.5 mr-0.5" />
                    {req.kind === "kitchen"
                      ? "Booking Cancellation"
                      : "Storage Cancellation"}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-destructive border-destructive/30 hover:bg-destructive/5"
                  onClick={() => handleAction("decline", req)}
                  disabled={isProcessing}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Decline
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => handleAction("accept", req)}
                  disabled={isProcessing}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                  Accept
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open)
            setConfirmDialog({ open: false, action: "accept", request: null });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {confirmDialog.action === "accept" ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Accept Cancellation Request
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-600" />
                  Decline Cancellation Request
                </>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-2 space-y-3">
              {confirmDialog.request && (
                <div className="bg-muted rounded-lg p-3 space-y-1.5 text-sm">
                  <div className="font-medium">
                    {confirmDialog.request.label}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {confirmDialog.request.chefName} ·{" "}
                    {confirmDialog.request.date}
                  </div>
                </div>
              )}
              {confirmDialog.action === "accept" ? (
                <p className="text-sm">
                  The{" "}
                  {confirmDialog.request?.kind === "kitchen"
                    ? "booking"
                    : "storage booking"}{" "}
                  will be cancelled. You can then use{" "}
                  <span className="font-medium">
                    &quot;Issue Refund&quot;
                  </span>{" "}
                  from the booking actions menu to process the refund.
                </p>
              ) : (
                <p className="text-sm">
                  The cancellation request will be declined and the{" "}
                  {confirmDialog.request?.kind === "kitchen"
                    ? "booking"
                    : "storage booking"}{" "}
                  will remain confirmed. The chef will be notified.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>
              Go Back
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={isProcessing}
              className={
                confirmDialog.action === "accept"
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-red-600 hover:bg-red-700"
              }
            >
              {isProcessing
                ? "Processing..."
                : confirmDialog.action === "accept"
                  ? "Accept & Cancel"
                  : "Decline Request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
