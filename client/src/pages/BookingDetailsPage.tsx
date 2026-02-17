import { logger } from "@/lib/logger";
import { useState, useEffect, useMemo } from "react";
import { useLocation, useRoute } from "wouter";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import ManagerBookingLayout from "@/layouts/ManagerBookingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  MapPin,
  User,
  ChefHat,
  Package,
  Wrench,
  FileText,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CreditCard,
  Phone,
  Mail,
  Receipt,
  Hash,
  Info,
} from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookingActionSheet,
  type BookingForAction,
} from "@/components/manager/bookings/BookingActionSheet";
import {
  BookingManagementSheet,
  type BookingForManagement,
  type ManagementSubmitParams,
} from "@/components/manager/bookings/BookingManagementSheet";

interface BookingDetails {
  id: number;
  referenceCode?: string | null;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  selectedSlots?: Array<{ startTime: string; endTime: string }>;
  status: string;
  paymentStatus?: string;
  specialNotes?: string;
  totalPrice?: number;
  hourlyRate?: number;
  durationHours?: number;
  serviceFee?: number;
  currency?: string;
  createdAt: string;
  updatedAt?: string;
  paymentIntentId?: string;
  kitchen?: {
    id: number;
    name: string;
    description?: string;
    photos?: string[];
    locationId: number;
    taxRatePercent?: number;
  };
  location?: {
    id: number;
    name: string;
    address?: string;
    timezone?: string;
  };
  chef?: {
    id: number;
    username: string;
    fullName?: string;
    phone?: string;
  };
  storageBookings?: Array<{
    id: number;
    storageListingId: number;
    startDate: string;
    endDate: string;
    totalPrice: number;
    status: string;
    paymentStatus?: string;
    storageListing?: {
      name: string;
      storageType: string;
      photos?: string[];
    };
  }>;
  equipmentBookings?: Array<{
    id: number;
    equipmentListingId: number;
    totalPrice: number;
    status: string;
    paymentStatus?: string;
    equipmentListing?: {
      equipmentType: string;
      brand?: string;
      photos?: string[];
    };
  }>;
  paymentTransaction?: {
    amount: number;
    serviceFee: number;
    managerRevenue: number;
    status: string;
    stripeProcessingFee?: number;
    paidAt?: string;
    refundAmount?: number;
    netAmount?: number;
    refundedAt?: string;
    refundReason?: string;
  };
}

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
    }
  } catch (error) {
    logger.error("Error getting Firebase token:", error);
  }
  return {
    "Content-Type": "application/json",
  };
}

export default function BookingDetailsPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/booking/:id");
  const [, managerParams] = useRoute("/manager/booking/:id");
  const bookingId = params?.id || managerParams?.id;
  const isManagerView = !!managerParams?.id;

  useFirebaseAuth();
  const { toast } = useToast();

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [managementSheetOpen, setManagementSheetOpen] = useState(false);
  const [isManagementProcessing, setIsManagementProcessing] = useState(false);
  const queryClient = useQueryClient();

  const handleViewChange = (view: string) => {
    navigate(`/dashboard?view=${view}`);
  };

  useEffect(() => {
    if (!bookingId) {
      setError("No booking ID provided");
      setIsLoading(false);
      return;
    }

    const fetchBookingDetails = async () => {
      try {
        const headers = await getAuthHeaders();
        const endpoint = isManagerView
          ? `/api/manager/bookings/${bookingId}/details`
          : `/api/chef/bookings/${bookingId}/details`;

        const response = await fetch(endpoint, {
          credentials: "include",
          headers,
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Booking not found");
          }
          if (response.status === 403) {
            throw new Error("You don't have permission to view this booking");
          }
          throw new Error("Failed to fetch booking details");
        }

        const data = await response.json();
        setBooking(data);
      } catch (err) {
        logger.error("Error fetching booking details:", err);
        setError(err instanceof Error ? err.message : "Failed to load booking details");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBookingDetails();
  }, [bookingId, isManagerView]);

  const handleDownloadInvoice = async () => {
    if (!booking?.id) return;

    setIsDownloading(true);
    try {
      const headers = await getAuthHeaders();
      // Use different endpoints for chef vs manager
      const endpoint = isManagerView
        ? `/api/manager/revenue/invoices/${booking.id}`
        : `/api/bookings/${booking.id}/invoice`;
      
      const response = await fetch(endpoint, {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to generate invoice");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;

      const bookingDate = booking.bookingDate
        ? new Date(booking.bookingDate).toISOString().split("T")[0]
        : "unknown";
      a.download = `LocalCooks-Invoice-${booking.id}-${bookingDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Invoice Downloaded",
        description: "Your invoice has been downloaded successfully!",
      });
    } catch (err) {
      logger.error("Error downloading invoice:", err);
      toast({
        title: "Download Failed",
        description: err instanceof Error ? err.message : "Failed to download invoice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return "";
    const [hours, minutes] = timeStr.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatCurrency = (cents: number | undefined | null) => {
    if (cents === undefined || cents === null) return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatBookingTimeSlots = (): string => {
    if (!booking) return "";
    const rawSlots = booking.selectedSlots;

    if (!rawSlots || rawSlots.length === 0) {
      return `${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`;
    }

    const sorted = [...rawSlots].sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );

    let isContiguous = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].endTime !== sorted[i].startTime) {
        isContiguous = false;
        break;
      }
    }

    if (isContiguous) {
      return `${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`;
    }

    return sorted
      .map((s) => `${formatTime(s.startTime)}-${formatTime(s.endTime)}`)
      .join(", ");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <Badge variant="success" className="font-medium">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Confirmed
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="warning" className="font-medium">
            <AlertCircle className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "cancelled": {
        // Industry standard: distinguish by cause
        const isExpired = booking?.paymentStatus === 'failed';
        const isRefunded = booking?.paymentStatus === 'refunded';
        const cancelledLabel = isExpired ? 'Expired' : isRefunded ? 'Refunded' : 'Cancelled';
        const cancelledIcon = isExpired ? <AlertCircle className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />;
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            {cancelledIcon}
            {cancelledLabel}
          </Badge>
        );
      }
      default:
        return <Badge variant="outline" className="font-medium">{status}</Badge>;
    }
  };

  const getPaymentStatusBadge = (status: string | undefined) => {
    switch (status) {
      case "authorized":
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            <CreditCard className="h-3 w-3 mr-1" />
            Held
          </Badge>
        );
      case "paid":
        return (
          <Badge variant="success" className="font-medium">
            <CreditCard className="h-3 w-3 mr-1" />
            Paid
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="warning" className="font-medium">
            <AlertCircle className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "refunded":
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            <Receipt className="h-3 w-3 mr-1" />
            Refunded
          </Badge>
        );
      case "partially_refunded":
        return (
          <Badge variant="warning" className="font-medium">
            <Receipt className="h-3 w-3 mr-1" />
            Partial Refund
          </Badge>
        );
      case "failed":
        // Distinguish voided authorization (cancelled booking with 'failed' payment) from actual failures
        if (booking?.status === 'cancelled') {
          return (
            <Badge variant="outline" className="text-muted-foreground border-border font-medium">
              <CreditCard className="h-3 w-3 mr-1" />
              Auth Voided
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="text-destructive border-destructive/30 font-medium">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case "canceled":
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            <XCircle className="h-3 w-3 mr-1" />
            Canceled
          </Badge>
        );
      default:
        return null;
    }
  };

  const calculateDuration = () => {
    if (!booking) return 0;
    if (booking.durationHours) return booking.durationHours;
    if (booking.selectedSlots && booking.selectedSlots.length > 0) {
      return booking.selectedSlots.length;
    }
    const [startH] = booking.startTime.split(":").map(Number);
    const [endH] = booking.endTime.split(":").map(Number);
    return endH - startH;
  };

  // ── Payment state helpers ─────────────────────────────────────────────────
  // VOID = auth was cancelled before capture (paymentStatus='failed') — never charged
  // REFUND = payment was captured then refunded (paymentStatus='refunded') — money returned
  const isRefunded = booking?.paymentStatus === 'refunded';
  const isPartiallyRefunded = booking?.paymentStatus === 'partially_refunded';
  const hasRefund = isRefunded || isPartiallyRefunded;
  const refundAmount = booking?.paymentTransaction?.refundAmount || 0;

  // Helper: item was voided (never charged — exclude from totals)
  const isItemVoided = (item: { paymentStatus?: string; status: string }) =>
    item.paymentStatus === 'failed';

  // Helper: item was refunded (was charged, then money returned — include in totals, show as refunded)
  const isItemRefunded = (item: { paymentStatus?: string; status: string }) =>
    item.paymentStatus === 'refunded' && item.status === 'cancelled';


  const totals = useMemo(() => {
    if (!booking) return { kitchen: 0, storage: 0, equipment: 0, subtotal: 0, tax: 0, total: 0 };

    const kitchenTotal = booking.totalPrice || 0;
    // VOID AWARENESS: Only exclude items with paymentStatus='failed' (never charged).
    // REFUND AWARENESS: Items with paymentStatus='refunded' WERE charged — include them
    // in the "Amount Charged" calculation. Refund is shown separately below.
    const storageTotal = booking.storageBookings?.reduce((sum, s) => {
      if (s.paymentStatus === 'failed') return sum; // Voided — never charged
      return sum + (s.totalPrice || 0);
    }, 0) || 0;
    const equipmentTotal = booking.equipmentBookings?.reduce((sum, e) => {
      if (e.paymentStatus === 'failed') return sum; // Voided — never charged
      return sum + (e.totalPrice || 0);
    }, 0) || 0;

    // Subtotal is kitchen + non-voided storage + non-voided equipment (what was actually charged)
    const subtotal = kitchenTotal + storageTotal + equipmentTotal;

    return {
      kitchen: kitchenTotal,
      storage: storageTotal,
      equipment: equipmentTotal,
      subtotal: subtotal,
      serviceFee: booking.serviceFee || 0,
      total: subtotal,
    };
  }, [booking]);

  // Show ALL storage/equipment bookings including rejected ones for full audit trail
  const allStorageBookings = booking?.storageBookings || [];
  const allEquipmentBookings = booking?.equipmentBookings || [];

  // Original totals including ALL items (for showing what was originally booked)
  const allStorageTotal = allStorageBookings.reduce((sum, s) => sum + (s.totalPrice || 0), 0);
  const allEquipmentTotal = allEquipmentBookings.reduce((sum, e) => sum + (e.totalPrice || 0), 0);
  // Voided totals (never charged) for sidebar strikethrough — only voided items, not refunded
  const rejectedStorageTotal = allStorageBookings.filter(isItemVoided).reduce((sum, s) => sum + (s.totalPrice || 0), 0);
  const rejectedEquipmentTotal = allEquipmentBookings.filter(isItemVoided).reduce((sum, e) => sum + (e.totalPrice || 0), 0);

  const openActionSheet = () => {
    setActionSheetOpen(true);
  };

  const openManagementSheet = () => {
    setManagementSheetOpen(true);
  };

  const bookingForAction: BookingForAction | null = booking ? {
    id: booking.id,
    kitchenName: booking.kitchen?.name,
    chefName: booking.chef?.fullName || booking.chef?.username,
    locationName: booking.location?.name,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: booking.totalPrice,
    transactionAmount: booking.paymentTransaction?.amount,
    stripeProcessingFee: booking.paymentTransaction?.stripeProcessingFee,
    managerRevenue: booking.paymentTransaction?.managerRevenue,
    taxRatePercent: booking.kitchen?.taxRatePercent ? Number(booking.kitchen.taxRatePercent) : undefined,
    // Include ALL items with rejected flag so action sheet shows full audit trail
    // Rejected items appear as read-only, actionable items are toggleable
    storageItems: booking.storageBookings
      ?.map((s) => ({
        id: s.id,
        storageBookingId: s.id,
        name: s.storageListing?.name || `Storage #${s.storageListingId}`,
        storageType: s.storageListing?.storageType || 'Storage',
        totalPrice: s.totalPrice,
        startDate: s.startDate,
        endDate: s.endDate,
        rejected: s.paymentStatus === 'failed' || s.status === 'cancelled',
      })),
    equipmentItems: booking.equipmentBookings
      ?.map((e) => ({
        id: e.id,
        equipmentBookingId: e.id,
        name: e.equipmentListing?.equipmentType || `Equipment #${e.equipmentListingId}`,
        totalPrice: e.totalPrice,
        rejected: e.paymentStatus === 'failed' || e.status === 'cancelled',
      })),
    paymentStatus: booking.paymentStatus,
  } : null;

  const handleApprovalSubmit = async (params: {
    bookingId: number;
    status: 'confirmed' | 'cancelled';
    storageActions?: Array<{ storageBookingId: number; action: string }>;
    equipmentActions?: Array<{ equipmentBookingId: number; action: string }>;
  }) => {
    if (!booking?.id) return;

    setIsUpdatingStatus(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${booking.id}/status`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({
          status: params.status,
          storageActions: params.storageActions,
          equipmentActions: params.equipmentActions,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update booking`);
      }

      const responseData = await response.json().catch(() => ({}));

      // Determine updated paymentStatus based on server response
      // - Voided auth (rejected authorized booking): paymentStatus → 'failed'
      // - Approved authorized booking: paymentStatus → 'paid'
      // - Rejected paid booking with refund: paymentStatus → 'refunded' or 'partially_refunded'
      // - Cancelled confirmed booking: paymentStatus unchanged ('paid')
      const hadRefund = !!responseData.refund;
      let updatedPaymentStatus = booking.paymentStatus;
      if (responseData.authorizationVoided) {
        updatedPaymentStatus = 'failed';
      } else if (params.status === 'confirmed' && booking.paymentStatus === 'authorized') {
        updatedPaymentStatus = 'paid';
      } else if (hadRefund && params.status === 'cancelled') {
        updatedPaymentStatus = 'refunded';
      }

      // For refund scenarios (post-capture rejection), reload to get accurate data from server
      // because the refund engine updates payment_transactions, paymentStatus, and item statuses
      // and local patching would be incomplete (refund amounts, item paymentStatus='refunded', etc.)
      if (hadRefund) {
        queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
        toast({
          title: "Booking Rejected & Refunded",
          description: `Refund of $${(responseData.refund.amount / 100).toFixed(2)} processed.`,
        });
        window.location.reload();
        return;
      }

      // For non-refund scenarios (void or simple approve), update local state directly
      // Cancelled items have paymentStatus='failed' (voided — never charged)
      const updatedStorageBookings = booking.storageBookings?.map((sb) => {
        const action = params.storageActions?.find((a) => a.storageBookingId === sb.id);
        if (action) {
          return { ...sb, status: action.action, paymentStatus: action.action === 'cancelled' ? 'failed' : 'paid' };
        }
        return { ...sb, status: params.status };
      });
      const updatedEquipmentBookings = booking.equipmentBookings?.map((eb) => {
        const action = params.equipmentActions?.find((a) => a.equipmentBookingId === eb.id);
        if (action) {
          return { ...eb, status: action.action, paymentStatus: action.action === 'cancelled' ? 'failed' : 'paid' };
        }
        return { ...eb, status: params.status };
      });
      setBooking({
        ...booking,
        status: params.status,
        paymentStatus: updatedPaymentStatus,
        storageBookings: updatedStorageBookings,
        equipmentBookings: updatedEquipmentBookings,
      });

      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });

      // Show contextual toast based on server response
      if (responseData.authorizationVoided) {
        toast({
          title: "Booking Rejected",
          description: "Payment hold released — no charge was made to the chef.",
        });
      } else if (responseData.requiresManualRefund) {
        toast({
          title: "Booking Cancelled",
          description: "Use 'Issue Refund' from the revenue dashboard to process the refund.",
        });
      } else {
        toast({
          title: "Success",
          description: params.status === 'confirmed' ? "Booking confirmed!" : "Booking rejected.",
        });
      }
    } catch (err) {
      logger.error('Error updating booking:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to update booking',
        variant: "destructive",
      });
    } finally {
      setIsUpdatingStatus(false);
      setActionSheetOpen(false);
    }
  };

  // ── Management Sheet data (for confirmed/paid bookings) ──────────────
  const bookingForManagement: BookingForManagement | null = booking ? {
    id: booking.id,
    kitchenName: booking.kitchen?.name,
    chefName: booking.chef?.fullName || booking.chef?.username,
    locationName: booking.location?.name,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: booking.totalPrice,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    transactionAmount: booking.paymentTransaction?.amount,
    stripeProcessingFee: booking.paymentTransaction?.stripeProcessingFee,
    managerRevenue: booking.paymentTransaction?.managerRevenue,
    taxRatePercent: booking.kitchen?.taxRatePercent ? Number(booking.kitchen.taxRatePercent) : undefined,
    // refundableAmount uses managerRevenue — the ManagementSheet subtracts alreadyRefunded (refundAmount) itself
    refundableAmount: booking.paymentTransaction?.managerRevenue,
    refundAmount: booking.paymentTransaction?.refundAmount || 0,
    cancellationRequested: booking.status === 'cancellation_requested',
    storageItems: booking.storageBookings?.map((s) => ({
      id: s.id,
      storageBookingId: s.id,
      name: s.storageListing?.name || `Storage #${s.storageListingId}`,
      storageType: s.storageListing?.storageType || 'Storage',
      totalPrice: s.totalPrice,
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
      cancellationRequested: false, // detail endpoint doesn't expose this directly
    })),
    equipmentItems: booking.equipmentBookings?.map((e) => ({
      id: e.id,
      equipmentBookingId: e.id,
      name: e.equipmentListing?.equipmentType || `Equipment #${e.equipmentListingId}`,
      totalPrice: e.totalPrice,
      status: e.status,
    })),
  } : null;

  const handleManagementSubmit = async (params: ManagementSubmitParams) => {
    if (!booking?.id) return;
    setIsManagementProcessing(true);
    try {
      const headers = await getAuthHeaders();

      switch (params.action) {
        case "cancel-booking":
        case "cancel-booking-refund": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/status`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({
              status: 'cancelled',
              refundOnCancel: params.action === "cancel-booking-refund",
              storageActions: params.storageActions,
              equipmentActions: params.equipmentActions,
            }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to cancel'); }
          const data = await res.json().catch(() => ({}));
          toast({ title: "Booking Cancelled", description: data?.refund ? `Refund of $${(data.refund.amount / 100).toFixed(2)} processed.` : "Booking cancelled." });
          // Reload to get fresh payment status, refund amounts, and item statuses from server
          window.location.reload();
          break;
        }
        case "partial-cancel":
        case "partial-cancel-refund": {
          const statusRes = await fetch(`/api/manager/bookings/${params.bookingId}/status`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ status: 'confirmed', storageActions: params.storageActions, equipmentActions: params.equipmentActions }),
          });
          if (!statusRes.ok) { const d = await statusRes.json().catch(() => ({})); throw new Error(d.error || 'Failed to update'); }
          toast({ title: "Items Cancelled", description: "Selected items have been cancelled." });
          // Refresh booking data
          window.location.reload();
          break;
        }
        case "refund-only": {
          toast({ title: "Info", description: "Use the Bookings panel to issue refunds (requires transaction ID)." });
          break;
        }
        case "accept-cancellation": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'accept' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
          setBooking({ ...booking, status: 'cancelled' });
          toast({ title: "Cancellation Accepted" });
          break;
        }
        case "decline-cancellation": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'decline' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
          setBooking({ ...booking, status: 'confirmed' });
          toast({ title: "Cancellation Declined" });
          break;
        }
        case "accept-storage-cancel": {
          if (!params.storageCancellationId) throw new Error("No storage booking ID");
          const res = await fetch(`/api/manager/storage-bookings/${params.storageCancellationId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'accept' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
          toast({ title: "Storage Cancellation Accepted" });
          window.location.reload();
          break;
        }
        case "decline-storage-cancel": {
          if (!params.storageCancellationId) throw new Error("No storage booking ID");
          const res = await fetch(`/api/manager/storage-bookings/${params.storageCancellationId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'decline' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
          toast({ title: "Storage Cancellation Declined" });
          break;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      setManagementSheetOpen(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setIsManagementProcessing(false);
    }
  };

  const handleBack = () => {
    if (isManagerView) {
      navigate("/manager/dashboard");
    } else {
      navigate("/dashboard");
    }
  };

  // Loading content
  const loadingContent = (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Loading booking details…</p>
      </div>
    </div>
  );

  // Error content
  const errorContent = (
    <div className="py-12">
      <div className="max-w-md mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold mb-2">Booking Not Found</h1>
        <p className="text-sm text-muted-foreground mb-6">{error || "Unable to load booking details"}</p>
        <Button onClick={handleBack} variant="outline" size="sm">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Go Back
        </Button>
      </div>
    </div>
  );

  // Main booking content
  const bookingContent = booking && (
    <TooltipProvider>
    <div className="max-w-4xl mx-auto">
      {/* ── Page Header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <Hash className="h-3 w-3" />
          {booking.referenceCode ? (
            <span className="font-mono font-medium text-foreground">{booking.referenceCode}</span>
          ) : (
            <span className="font-mono">{booking.id}</span>
          )}
          <span className="text-border">·</span>
          <span>{formatShortDate(booking.createdAt)}</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {booking.kitchen?.name || "Kitchen Booking"}
            </h1>
            {booking.location && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {booking.location.name}
                {booking.location.address && ` · ${booking.location.address}`}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {getStatusBadge(booking.status)}
            {getPaymentStatusBadge(booking.paymentStatus)}
            {isManagerView && booking.status === 'pending' && (
              <Button
                type="button"
                size="sm"
                onClick={openActionSheet}
                disabled={isUpdatingStatus}
              >
                {isUpdatingStatus ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Take Action
                  </>
                )}
              </Button>
            )}
            {isManagerView && (booking.status === 'confirmed' || booking.status === 'cancellation_requested') && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={openManagementSheet}
                disabled={isManagementProcessing}
              >
                {isManagementProcessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>Manage Booking</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Separator className="mb-8" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* ── Schedule ── */}
          <section>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Schedule</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Date</p>
                <p className="text-sm font-medium">{formatDate(booking.bookingDate)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Time</p>
                <p className="text-sm font-medium">{formatBookingTimeSlots()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Duration</p>
                <p className="text-sm font-medium">{calculateDuration()} hr{calculateDuration() !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </section>

          {/* ── Add-ons: Storage ── */}
          {allStorageBookings.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Storage
              </h2>
              <div className="space-y-2">
                {allStorageBookings.map((storage) => {
                  const voided = isItemVoided(storage);
                  const refunded = isItemRefunded(storage);
                  const cancelled = voided || refunded || storage.status === 'cancelled';
                  return (
                    <div
                      key={storage.id}
                      className={`flex items-center justify-between py-3 px-4 rounded-lg border ${
                        cancelled ? "bg-muted/40 border-border opacity-60" : "border-border"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${cancelled ? "text-muted-foreground line-through" : ""}`}>
                          {storage.storageListing?.name || `Storage #${storage.storageListingId}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {storage.storageListing?.storageType}
                          {storage.startDate && ` · ${formatShortDate(storage.startDate)} – ${formatShortDate(storage.endDate)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-sm font-mono ${cancelled ? "text-muted-foreground line-through" : ""}`}>
                          {formatCurrency(storage.totalPrice)}
                        </span>
                        {storage.status === "completed" ? (
                          <Badge variant="outline" className="text-[10px] text-success border-success/30">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />cleared
                          </Badge>
                        ) : refunded ? (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            <Receipt className="h-2.5 w-2.5 mr-0.5" />refunded
                          </Badge>
                        ) : voided ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />not charged
                          </Badge>
                        ) : storage.status === "cancelled" ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />cancelled
                          </Badge>
                        ) : storage.status === "confirmed" || storage.status === "active" ? (
                          <Badge variant="outline" className="text-[10px] text-success border-success/30">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />confirmed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />{storage.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Add-ons: Equipment ── */}
          {allEquipmentBookings.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5" />
                Equipment
              </h2>
              <div className="space-y-2">
                {allEquipmentBookings.map((equipment) => {
                  const voided = isItemVoided(equipment);
                  const refunded = isItemRefunded(equipment);
                  const cancelled = voided || refunded || equipment.status === 'cancelled';
                  return (
                    <div
                      key={equipment.id}
                      className={`flex items-center justify-between py-3 px-4 rounded-lg border ${
                        cancelled ? "bg-muted/40 border-border opacity-60" : "border-border"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${cancelled ? "text-muted-foreground line-through" : ""}`}>
                          {equipment.equipmentListing?.equipmentType || `Equipment #${equipment.equipmentListingId}`}
                        </p>
                        {equipment.equipmentListing?.brand && (
                          <p className="text-xs text-muted-foreground">{equipment.equipmentListing.brand}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-sm font-mono ${cancelled ? "text-muted-foreground line-through" : ""}`}>
                          {formatCurrency(equipment.totalPrice)}
                        </span>
                        {refunded ? (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            <Receipt className="h-2.5 w-2.5 mr-0.5" />refunded
                          </Badge>
                        ) : voided ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />not charged
                          </Badge>
                        ) : equipment.status === "cancelled" ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />cancelled
                          </Badge>
                        ) : equipment.status === "confirmed" || equipment.status === "active" ? (
                          <Badge variant="outline" className="text-[10px] text-success border-success/30">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />confirmed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />{equipment.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Notes ── */}
          {booking.specialNotes && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Notes
              </h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{booking.specialNotes}</p>
            </section>
          )}

          {/* ── Chef Information (Manager only) ── */}
          {isManagerView && booking.chef && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Chef
              </h2>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <ChefHat className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {booking.chef.fullName || booking.chef.username}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {booking.chef.username}
                    </span>
                    {booking.chef.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {booking.chef.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-6">
          <Card className="sticky top-24 border-border shadow-none">
            <CardContent className="p-5">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Payment</h3>

              <div className="space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Kitchen · {calculateDuration()} hr{calculateDuration() !== 1 ? "s" : ""}
                  </span>
                  <span className="font-mono">
                    {formatCurrency(totals.kitchen > 0 ? totals.kitchen : booking.totalPrice)}
                  </span>
                </div>

                {allStorageTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Storage</span>
                    <div className="text-right">
                      {rejectedStorageTotal > 0 && rejectedStorageTotal < allStorageTotal && (
                        <span className="font-mono text-muted-foreground line-through mr-2 text-xs">{formatCurrency(allStorageTotal)}</span>
                      )}
                      <span className={`font-mono ${rejectedStorageTotal > 0 && rejectedStorageTotal === allStorageTotal ? "text-muted-foreground line-through" : ""}`}>
                        {rejectedStorageTotal === allStorageTotal ? formatCurrency(allStorageTotal) : formatCurrency(totals.storage)}
                      </span>
                    </div>
                  </div>
                )}

                {allEquipmentTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Equipment</span>
                    <div className="text-right">
                      {rejectedEquipmentTotal > 0 && rejectedEquipmentTotal < allEquipmentTotal && (
                        <span className="font-mono text-muted-foreground line-through mr-2 text-xs">{formatCurrency(allEquipmentTotal)}</span>
                      )}
                      <span className={`font-mono ${rejectedEquipmentTotal > 0 && rejectedEquipmentTotal === allEquipmentTotal ? "text-muted-foreground line-through" : ""}`}>
                        {rejectedEquipmentTotal === allEquipmentTotal ? formatCurrency(allEquipmentTotal) : formatCurrency(totals.equipment)}
                      </span>
                    </div>
                  </div>
                )}

                <Separator className="my-3" />

                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-medium">
                    {booking.paymentStatus === 'failed' && booking.status === 'cancelled'
                      ? 'Original Quote'
                      : isRefunded
                        ? 'Amount Charged'
                        : isPartiallyRefunded
                          ? 'Amount Charged'
                          : 'Total'}
                  </span>
                  <span className={`text-lg font-semibold font-mono ${
                    (booking.paymentStatus === 'failed' && booking.status === 'cancelled') || isRefunded
                      ? 'text-muted-foreground line-through'
                      : ''
                  }`}>
                    {formatCurrency(totals.subtotal)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">{booking.currency || "CAD"}</span>
                  </span>
                </div>
              </div>

              {/* VOIDED AUTH: Show when booking was cancelled before capture — no money moved */}
              {booking.paymentStatus === 'failed' && booking.status === 'cancelled' && (
                <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-muted-foreground">
                      <p className="font-medium mb-0.5">Authorization Voided — No Charge</p>
                      <p>
                        {isManagerView
                          ? "The payment hold was released when this booking was rejected. No charge was made to the chef and no Stripe fees apply."
                          : "The payment hold on your card has been released. You were not charged for this booking."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* AUTH-HOLD AWARENESS: Show prominent banner for authorized (held) payments */}
              {booking.paymentStatus === 'authorized' && (
                <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <CreditCard className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-muted-foreground">
                      <p className="font-medium mb-0.5">Payment Held</p>
                      <p>
                        {isManagerView 
                          ? "This payment is authorized but not yet captured. Approve or reject from the action sheet to capture or release the hold."
                          : "Your card has been authorized. The charge will be finalized once the kitchen manager approves your booking."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* REFUND INFO: Show when a refund has been processed (full or partial) */}
              {hasRefund && refundAmount > 0 && (
                <div className="mt-4 p-3 bg-amber-50/50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Receipt className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-amber-800">
                      <p className="font-medium mb-0.5">
                        {isRefunded ? 'Fully Refunded' : 'Partial Refund Issued'}
                      </p>
                      <p className="text-amber-700">
                        {isManagerView
                          ? `${formatCurrency(refundAmount)} was refunded to the chef.${booking.paymentTransaction?.refundReason ? ` Reason: ${booking.paymentTransaction.refundReason}` : ''}`
                          : `You received a refund of ${formatCurrency(refundAmount)}.`}
                      </p>
                      {booking.paymentTransaction?.refundedAt && (
                        <p className="text-amber-600 mt-0.5">
                          Refunded on {formatShortDate(booking.paymentTransaction.refundedAt)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* CANCELLED WITHOUT REFUND: Show when booking is cancelled but no refund yet */}
              {booking.status === 'cancelled' && booking.paymentStatus === 'paid' && (
                <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-muted-foreground">
                      <p className="font-medium mb-0.5">Booking Cancelled</p>
                      <p>
                        {isManagerView
                          ? "This booking was cancelled. Use 'Issue Refund' from the bookings panel to process a refund if needed."
                          : "This booking has been cancelled. Contact the kitchen manager regarding any refund."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Chef View - Payment Breakdown (without Stripe fee) */}
              {/* VOIDED AUTH: Skip breakdown entirely — no money was captured */}
              {!isManagerView && booking.paymentTransaction && !(booking.paymentStatus === 'failed' && booking.status === 'cancelled') && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Breakdown</h3>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
                    </div>
                    {(() => {
                      const taxRatePercent = booking.kitchen?.taxRatePercent || 0;
                      const subtotal = totals.subtotal || 0;
                      const taxAmount = Math.round((subtotal * taxRatePercent) / 100);
                      
                      return taxRatePercent > 0 ? (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tax ({taxRatePercent}%)</span>
                          <span className="font-mono">{formatCurrency(taxAmount)}</span>
                        </div>
                      ) : null;
                    })()}
                    <Separator className="my-2" />
                    <div className="flex justify-between text-sm font-medium">
                      <span>
                        {booking.paymentStatus === 'authorized' ? 'Amount Authorized' : 'Amount Charged'}
                      </span>
                      <span className="font-mono">
                        {formatCurrency(booking.paymentTransaction.amount)}
                      </span>
                    </div>
                    {refundAmount > 0 && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-amber-600">Refunded</span>
                          <span className="font-mono text-amber-600">−{formatCurrency(refundAmount)}</span>
                        </div>
                        <Separator className="my-2" />
                        <div className="flex justify-between text-sm font-medium">
                          <span>Net Charged</span>
                          <span className="font-mono">
                            {formatCurrency(booking.paymentTransaction.amount - refundAmount)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Manager View - Revenue Breakdown (with Stripe fee) */}
              {/* VOIDED AUTH: Skip breakdown entirely — no money was captured */}
              {isManagerView && booking.paymentTransaction && !(booking.paymentStatus === 'failed' && booking.status === 'cancelled') && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                      {booking.paymentStatus === 'authorized' ? 'Authorization' : 'Revenue'}
                    </h3>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {booking.paymentStatus === 'authorized' ? 'Authorized' : 'Gross'}
                      </span>
                      <span className="font-mono">{formatCurrency(booking.paymentTransaction.amount)}</span>
                    </div>
                    {(() => {
                      const amount = booking.paymentTransaction.amount || 0;
                      const stripeFee = booking.paymentTransaction.stripeProcessingFee || 0;
                      const taxRatePercent = booking.kitchen?.taxRatePercent || 0;
                      const subtotal = totals.subtotal || 0;
                      const taxAmount = Math.round((subtotal * taxRatePercent) / 100);
                      const netRevenue = amount - taxAmount - stripeFee;
                      const isAuthorized = booking.paymentStatus === 'authorized';
                      const ptRefundAmount = booking.paymentTransaction.refundAmount || 0;
                      
                      return (
                        <>
                          {taxRatePercent > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">
                                {isAuthorized ? `Est. Tax (${taxRatePercent}%)` : `Tax (${taxRatePercent}%)`}
                              </span>
                              <span className="font-mono text-muted-foreground">−{formatCurrency(taxAmount)}</span>
                            </div>
                          )}
                          {!isAuthorized && (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Stripe Fee</span>
                              <span className="font-mono text-muted-foreground">−{formatCurrency(stripeFee)}</span>
                            </div>
                          )}
                          {!isAuthorized && ptRefundAmount > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-amber-600">Refunded</span>
                              <span className="font-mono text-amber-600">−{formatCurrency(ptRefundAmount)}</span>
                            </div>
                          )}
                          <Separator className="my-2" />
                          <div className="flex justify-between text-sm font-medium">
                            <span>
                              {isAuthorized ? 'Est. Net Revenue' : 'Net Revenue'}
                            </span>
                            <span className="font-mono">
                              {formatCurrency(isAuthorized ? amount - taxAmount : netRevenue - ptRefundAmount)}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </>
              )}

              {(booking.paymentStatus === "paid" || booking.paymentStatus === "partially_refunded" || booking.paymentStatus === "refunded") && (
                <Button
                  onClick={handleDownloadInvoice}
                  disabled={isDownloading}
                  variant="outline"
                  className="w-full mt-5"
                  size="sm"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download Invoice
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Meta ── */}
          <div className="text-xs text-muted-foreground space-y-1.5 px-1">
            <div className="flex justify-between">
              <span>Created</span>
              <span>{formatShortDate(booking.createdAt)}</span>
            </div>
            {booking.updatedAt && (
              <div className="flex justify-between">
                <span>Updated</span>
                <span>{formatShortDate(booking.updatedAt)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );

  // Render with appropriate layout
  if (isManagerView) {
    return (
      <ManagerBookingLayout
        breadcrumbs={[
          { label: "Dashboard", onClick: () => navigate("/manager/dashboard") },
          { label: "Bookings", onClick: () => navigate("/manager/dashboard") },
          { label: booking ? `Booking #${booking.id}` : "Booking Details" },
        ]}
      >
        {isLoading ? loadingContent : (error || !booking) ? errorContent : bookingContent}
        <BookingActionSheet
          open={actionSheetOpen}
          onOpenChange={setActionSheetOpen}
          booking={bookingForAction}
          isLoading={isUpdatingStatus}
          onSubmit={handleApprovalSubmit}
        />
        <BookingManagementSheet
          open={managementSheetOpen}
          onOpenChange={(open) => {
            setManagementSheetOpen(open);
          }}
          booking={bookingForManagement}
          isProcessing={isManagementProcessing}
          onSubmit={handleManagementSubmit}
        />
      </ManagerBookingLayout>
    );
  }

  // Chef view with ChefDashboardLayout
  return (
    <ChefDashboardLayout
      activeView="bookings"
      onViewChange={handleViewChange}
      breadcrumbs={[
        { label: "Dashboard", onClick: () => navigate("/dashboard") },
        { label: "My Bookings", onClick: () => navigate("/dashboard") },
        { label: booking ? `Booking #${booking.id}` : "Booking Details" },
      ]}
    >
      {isLoading ? loadingContent : (error || !booking) ? errorContent : bookingContent}
    </ChefDashboardLayout>
  );
}
