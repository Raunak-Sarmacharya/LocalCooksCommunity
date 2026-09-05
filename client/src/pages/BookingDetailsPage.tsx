import { logger } from "@/lib/logger";
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import ManagerBookingLayout from "@/layouts/ManagerBookingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
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
  LogIn,
  LogOut,
  Camera,
  FileWarning,
  Clock,
} from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import {
  BookingActionSheet,
  type BookingForAction,
} from "@/components/manager/bookings/BookingActionSheet";
import {
  BookingManagementSheet,
  type BookingForManagement,
  type ManagementSubmitParams,
} from "@/components/manager/bookings/BookingManagementSheet";
import { KitchenCheckinTracker } from "@/components/booking/KitchenCheckinTracker";
import { StripeProcessingFeeRefundInfo } from "@/components/booking/StripeProcessingFeeRefundInfo";
import { SmartImage } from "@/components/ui/smart-image";
import { tt } from "@/i18n/common-ns";
import {
  ChefBookingReceiptBreakdown,
  KitchenPayoutStatementBreakdown,
} from "@/components/booking/BookingPricingBreakdown";

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
    taxAmount?: number;
  /** Admin-configured service fee rate (fraction, e.g. 0.07) */
  platformCommissionRate?: number;
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
    id?: number;
    amount: number;
    serviceFee: number;
    taxAmount?: number;
    managerRevenue: number;
    status: string;
    stripeProcessingFee?: number;
    paidAt?: string;
    refundAmount?: number;
    netAmount?: number;
    refundedAt?: string;
    refundReason?: string;
  };
  // ── Kitchen Check-In / Check-Out Lifecycle ──────────────────────────────
  checkinStatus?: string | null;
  checkedInAt?: string | null;
  checkedInMethod?: string | null;
  checkoutRequestedAt?: string | null;
  checkedOutAt?: string | null;
  checkoutApprovedAt?: string | null;
  noShowDetectedAt?: string | null;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  checkinPhotoUrls?: string[] | null;
  checkoutPhotoUrls?: string[] | null;
  checkinNotes?: string | null;
  checkoutNotes?: string | null;
  checkinChecklistItems?: Array<{ id: string; label: string; checked: boolean }> | null;
  checkoutChecklistItems?: Array<{ id: string; label: string; checked: boolean }> | null;
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
  const { t: tStrict, i18n } = useTranslation("chef");
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string;

  const { loading: authLoading } = useFirebaseAuth();
  const { toast } = useToast();

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [managementSheetOpen, setManagementSheetOpen] = useState(false);
  const [isManagementProcessing, setIsManagementProcessing] = useState(false);
  const [checkinTrackerOpen, setCheckinTrackerOpen] = useState(false);
  const queryClient = useQueryClient();

  // When the chef clicks a sidebar tab from this booking-detail sub-page, we
  // REPLACE the current /booking/:id history entry with the dashboard view
  // instead of pushing a new one. That way the back button doesn't bounce
  // them through the booking detail again — it goes straight to wherever
  // they came from before opening this page.
  const handleViewChange = (view: string) => {
    navigate(`/dashboard?view=${view}`, { replace: true });
  };

  useEffect(() => {
    if (!bookingId) {
      setError("No booking ID provided");
      setIsLoading(false);
      return;
    }

    // Wait for Firebase auth to finish initializing before fetching.
    // On a hard refresh, auth.currentUser is null until Firebase restores the
    // session asynchronously. Fetching immediately would send an unauthenticated
    // request (401), which the server correctly rejects — but the UI was
    // incorrectly showing "Booking Not Found" instead of waiting for auth.
    if (authLoading) {
      return; // auth not ready yet — effect will re-run when authLoading becomes false
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
          if (response.status === 401) {
            throw new Error(t("bdErrSessionExpired"));
          }
          if (response.status === 404) {
            throw new Error(t("bdErrNotFound"));
          }
          if (response.status === 403) {
            throw new Error(t("bdErrForbidden"));
          }
          throw new Error(t("bdErrFetch"));
        }

        const data = await response.json();
        setBooking(data);
      } catch (err) {
        logger.error("Error fetching booking details:", err);
        setError(err instanceof Error ? err.message : t("bdErrLoad"));
      } finally {
        setIsLoading(false);
      }
    };

    fetchBookingDetails();
  }, [bookingId, isManagerView, authLoading]);

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
        throw new Error(tt("failedToGenerateInvoice"));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;

      const bookingDate = booking.bookingDate
        ? new Date(booking.bookingDate).toISOString().split("T")[0]
        : "unknown";
      a.download = isManagerView
        ? `LocalCooks-Payout-Statement-${booking.id}-${bookingDate}.pdf`
        : `LocalCooks-Booking-Receipt-${booking.id}-${bookingDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: t("bdInvoiceDownloadedTitle"),
        description: t("bdInvoiceDownloadedDesc"),
      });
    } catch (err) {
      logger.error("Error downloading invoice:", err);
      toast({
        title: t("bdDownloadFailedTitle"),
        description: err instanceof Error ? err.message : t("bdDownloadFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return "";
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes || 0, 0, 0);
    return new Intl.DateTimeFormat(i18n.language, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.language, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.language, {
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
            {t("bdStatusConfirmed")}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="warning" className="font-medium">
            <AlertCircle className="h-3 w-3 mr-1" />
            {t("bdStatusPending")}
          </Badge>
        );
      case "cancelled": {
        // Industry standard: distinguish by cause
        const isExpired = booking?.paymentStatus === 'failed';
        const isRefunded = booking?.paymentStatus === 'refunded';
        const cancelledLabel = isExpired ? t("bdStatusExpired") : isRefunded ? t("bdStatusRefunded") : t("bdStatusCancelled");
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

  const getCheckinStatusBadge = (checkinStatus: string | null | undefined) => {
    if (!checkinStatus || checkinStatus === 'not_checked_in') {
      return (
        <Badge variant="outline" className="font-medium text-muted-foreground border-border">
          <Clock className="h-3 w-3 mr-1" />
          {t("bdCiNotCheckedIn")}
        </Badge>
      );
    }
    if (checkinStatus === 'checked_in') {
      return (
        <Badge variant="success" className="font-medium">
          <LogIn className="h-3 w-3 mr-1" />
          {t("bdCiCheckedIn")}
        </Badge>
      );
    }
    if (checkinStatus === 'checkout_requested') {
      return (
        <Badge variant="info" className="font-medium">
          <Camera className="h-3 w-3 mr-1" />
          {t("bdCiCheckoutPending")}
        </Badge>
      );
    }
    if (checkinStatus === 'checked_out') {
      return (
        <Badge variant="success" className="font-medium">
          <LogOut className="h-3 w-3 mr-1" />
          {t("bdCiCheckedOut")}
        </Badge>
      );
    }
    if (checkinStatus === 'no_show') {
      return (
        <Badge variant="destructive" className="font-medium">
          <XCircle className="h-3 w-3 mr-1" />
          {t("bdCiNoShow")}
        </Badge>
      );
    }
    if (checkinStatus === 'checkout_claim_filed') {
      return (
        <Badge variant="warning" className="font-medium">
          <FileWarning className="h-3 w-3 mr-1" />
          {t("bdCiClaimFiled")}
        </Badge>
      );
    }
    return null;
  };

  const getPaymentStatusBadge = (status: string | undefined) => {
    switch (status) {
      case "authorized":
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            <CreditCard className="h-3 w-3 mr-1" />
            {t("bdPayHeld")}
          </Badge>
        );
      case "paid":
        return (
          <Badge variant="success" className="font-medium">
            <CreditCard className="h-3 w-3 mr-1" />
            {t("bdPayPaid")}
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            {t("bdPayProcessing")}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="warning" className="font-medium">
            <AlertCircle className="h-3 w-3 mr-1" />
            {t("bdPayPending")}
          </Badge>
        );
      case "refunded":
        return (
          <Badge variant="outline" className="text-muted-foreground border-border font-medium">
            <Receipt className="h-3 w-3 mr-1" />
            {t("bdPayRefunded")}
          </Badge>
        );
      case "partially_refunded":
        return (
          <Badge variant="warning" className="font-medium">
            <Receipt className="h-3 w-3 mr-1" />
            {t("bdPayPartialRefund")}
          </Badge>
        );
      case "failed":
        // Distinguish voided authorization (cancelled booking with 'failed' payment) from actual failures
        if (booking?.status === 'cancelled') {
          return (
            <Badge variant="outline" className="text-muted-foreground border-border font-medium">
              <CreditCard className="h-3 w-3 mr-1" />
              {t("bdPayAuthVoided")}
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
            {t("bdPayCanceled")}
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

  const pricingBreakdownInput = useMemo(() => {
    if (!booking) return null;
    const subtotal = totals.subtotal || 0;
    const serviceFee = totals.serviceFee || booking.paymentTransaction?.serviceFee || 0;
    // Label the fee with the admin-configured rate. Deriving it from the stored
    // amount over the displayed subtotal rounds wrong whenever an add-on was
    // voided after checkout (the fee was charged on the original subtotal).
    const platformFeeRate =
      booking.platformCommissionRate != null
        ? Number(booking.platformCommissionRate)
        : subtotal > 0 && serviceFee > 0
          ? serviceFee / subtotal
          : 0;

    return {
      kitchenBaseSubtotalCents: subtotal,
      kitchenHstRatePercent: Number(booking.kitchen?.taxRatePercent) || 0,
      kitchenHstAmountCents: booking.paymentTransaction?.taxAmount,
      platformFeeRate,
      platformFeeAmountCents: serviceFee,
      paymentProcessorFeeCents: booking.paymentTransaction?.stripeProcessingFee || 0,
      kitchenNetPayoutCents: booking.paymentTransaction?.managerRevenue,
      refundAmountCents: booking.paymentTransaction?.refundAmount || 0,
      hourlyRateCents: booking.hourlyRate,
      bookedHours: booking.durationHours,
      showPaymentProcessorFee: (booking.paymentTransaction?.stripeProcessingFee || 0) > 0,
    };
  }, [booking, totals]);

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
    serviceFee: totals.serviceFee || booking.paymentTransaction?.serviceFee || 0,
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
          title: t("bdBookingRejectedRefundedTitle"),
          description: t("bdRefundProcessedDesc", { amount: `$${(responseData.refund.amount / 100).toFixed(2)}` }),
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
          title: t("bdBookingRejectedToast"),
          description: t("bdHoldReleasedDesc"),
        });
      } else if (responseData.requiresManualRefund) {
        toast({
          title: t("bdBookingCancelledToast"),
          description: t("bdIssueRefundRevenueDesc"),
        });
      } else {
        toast({
          title: t("bdSuccessTitle"),
          description: params.status === 'confirmed' ? t("bdBookingConfirmedDesc") : t("bdBookingRejectedDesc"),
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
    transactionId: booking.paymentTransaction?.id,
    transactionAmount: booking.paymentTransaction?.amount,
    stripeProcessingFee: booking.paymentTransaction?.stripeProcessingFee,
    managerRevenue: booking.paymentTransaction?.managerRevenue,
    serviceFee: booking.paymentTransaction?.serviceFee || booking.serviceFee || 0,
    taxRatePercent: booking.kitchen?.taxRatePercent ? Number(booking.kitchen.taxRatePercent) : undefined,
    // Gross pool (manager + service fee); sheet subtracts alreadyRefunded.
    refundableAmount:
      (booking.paymentTransaction?.managerRevenue || 0) +
      (booking.paymentTransaction?.serviceFee || booking.serviceFee || 0),
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
          toast({ title: t("bdBookingCancelledToast"), description: data?.refund ? t("bdRefundProcessedDesc", { amount: `$${(data.refund.amount / 100).toFixed(2)}` }) : t("bdBookingCancelledDesc") });
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

          if (
            params.action === "partial-cancel-refund" &&
            params.refundAmountCents &&
            params.refundAmountCents > 0 &&
            bookingForManagement?.transactionId
          ) {
            const refundRes = await fetch(
              `/api/manager/revenue/transactions/${bookingForManagement.transactionId}/refund`,
              {
                method: 'POST', headers, credentials: "include",
                body: JSON.stringify({
                  amount: params.refundAmountCents,
                  reason: 'Partial cancellation refund',
                }),
              },
            );
            if (!refundRes.ok) {
              const d = await refundRes.json().catch(() => ({}));
              throw new Error(d.error || 'Items cancelled but refund failed');
            }
            toast({
              title: t("bdItemsCancelledToast"),
              description: t("bdRefundProcessedDesc", {
                amount: `$${(params.refundAmountCents / 100).toFixed(2)}`,
              }),
            });
          } else {
            toast({ title: t("bdItemsCancelledToast"), description: t("bdItemsCancelledDesc") });
          }
          window.location.reload();
          break;
        }
        case "refund-only": {
          if (!bookingForManagement?.transactionId || !params.refundAmountCents) {
            throw new Error(t("bdRefundPanelInfo"));
          }
          const refundRes = await fetch(
            `/api/manager/revenue/transactions/${bookingForManagement.transactionId}/refund`,
            {
              method: 'POST', headers, credentials: "include",
              body: JSON.stringify({
                amount: params.refundAmountCents,
                reason: 'Refund issued by manager',
              }),
            },
          );
          if (!refundRes.ok) {
            const d = await refundRes.json().catch(() => ({}));
            throw new Error(d.error || 'Failed to process refund');
          }
          toast({
            title: t("bdRefundProcessedDesc", {
              amount: `$${(params.refundAmountCents / 100).toFixed(2)}`,
            }),
          });
          window.location.reload();
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
          if (!params.storageCancellationId) throw new Error(tt("noStorageBookingId"));
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
          if (!params.storageCancellationId) throw new Error(tt("noStorageBookingId"));
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
      toast({ title: t("bdErrorTitle"), description: error.message || t("bdSomethingWrong"), variant: "destructive" });
    } finally {
      setIsManagementProcessing(false);
    }
  };

  const handleBack = () => {
    // Use browser history so the user returns to wherever they came from
    // (bookings list, calendar view, manager panel, etc.) rather than always
    // hard-redirecting to the dashboard root.
    if (window.history.length > 1) {
      window.history.back();
    } else if (isManagerView) {
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
        <p className="text-sm text-muted-foreground">{t("bdLoading")}</p>
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
        <h1 className="text-lg font-semibold mb-2">{t("bdNotFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground mb-6">{error || t("bdNotFoundBody")}</p>
        <Button onClick={handleBack} variant="outline" size="sm">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {t("bdGoBack")}
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
              {booking.kitchen?.name || t("bdKitchenBookingFallback")}
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
            {(booking.status === 'confirmed' || booking.status === 'completed') &&
              getCheckinStatusBadge(booking.checkinStatus)}
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
                    {t("bdTakeAction")}
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
                  <>{t("bdManageBooking")}</>
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
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">{t("bdSchedule")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("bdDate")}</p>
                <p className="text-sm font-medium">{formatDate(booking.bookingDate)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("bdTime")}</p>
                <p className="text-sm font-medium">{formatBookingTimeSlots()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("bdDuration")}</p>
                <p className="text-sm font-medium">{t("bdHours", { count: calculateDuration() })}</p>
              </div>
            </div>
          </section>

          {/* ── Check-In / Check-Out CTA (Chef View — confirmed bookings) ── */}
          {!isManagerView && booking.status === 'confirmed' && (
            (!booking.checkinStatus || booking.checkinStatus === 'not_checked_in' || booking.checkinStatus === 'checked_in') && (
            <section className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <LogIn className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold">
                    {!booking.checkinStatus || booking.checkinStatus === 'not_checked_in'
                      ? t("bdCheckInRequired")
                      : t("bdReadyToCheckOut")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {!booking.checkinStatus || booking.checkinStatus === 'not_checked_in'
                      ? t("bdCheckInBody")
                      : t("bdCheckOutBody")}
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => setCheckinTrackerOpen(true)}
                  >
                    {!booking.checkinStatus || booking.checkinStatus === 'not_checked_in'
                      ? (<><LogIn className="h-3.5 w-3.5 mr-1.5" />{t("bdCheckInNow")}</>)
                      : (<><LogOut className="h-3.5 w-3.5 mr-1.5" />{t("bdCheckOutNow")}</>)}
                  </Button>
                </div>
              </div>
            </section>
          )
          )}

          {/* ── Check-In / Check-Out Timeline (only for confirmed or completed bookings) ── */}
          {(booking.status === 'confirmed' || booking.status === 'completed') &&
            (booking.checkinStatus || booking.checkedInAt || booking.checkoutRequestedAt) && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <LogIn className="h-3.5 w-3.5" />
                {t("bdCiCoSection")}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("bdCurrentStatus")}</p>
                  <div>{getCheckinStatusBadge(booking.checkinStatus)}</div>
                </div>
                {booking.checkedInAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t("bdCheckedInAt")}</p>
                    <p className="text-sm font-medium">
                      {formatShortDate(booking.checkedInAt)}
                      {booking.actualStartTime && ` · ${booking.actualStartTime}`}
                    </p>
                    {booking.checkedInMethod && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {booking.checkedInMethod === 'self' ? t("bdViaSelf") : t("bdVia", { method: booking.checkedInMethod })}
                      </p>
                    )}
                  </div>
                )}
                {booking.checkoutRequestedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t("bdCheckoutRequested")}</p>
                    <p className="text-sm font-medium">
                      {formatShortDate(booking.checkoutRequestedAt)}
                      {booking.actualEndTime && ` · ${booking.actualEndTime}`}
                    </p>
                  </div>
                )}
                {booking.checkoutApprovedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t("bdCheckedOutCleared")}</p>
                    <p className="text-sm font-medium">{formatShortDate(booking.checkoutApprovedAt)}</p>
                  </div>
                )}
                {booking.noShowDetectedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t("bdNoShowDetected")}</p>
                    <p className="text-sm font-medium text-destructive">{formatShortDate(booking.noShowDetectedAt)}</p>
                  </div>
                )}
              </div>
              {/* Check-in / checkout notes */}
              {(booking.checkinNotes || booking.checkoutNotes) && (
                <div className="mt-3 space-y-2">
                  {booking.checkinNotes && (
                    <div className="p-3 rounded-lg border border-border bg-muted/30">
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-1">{t("bdCheckinNotes")}</p>
                      <p className="text-sm whitespace-pre-wrap">{booking.checkinNotes}</p>
                    </div>
                  )}
                  {booking.checkoutNotes && (
                    <div className="p-3 rounded-lg border border-border bg-muted/30">
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-1">{t("bdCheckoutNotes")}</p>
                      <p className="text-sm whitespace-pre-wrap">{booking.checkoutNotes}</p>
                    </div>
                  )}
                </div>
              )}
              {/* Photos & Checklist Audit */}
              {((booking.checkinPhotoUrls && booking.checkinPhotoUrls.length > 0) ||
                (booking.checkoutPhotoUrls && booking.checkoutPhotoUrls.length > 0) ||
                (booking.checkinChecklistItems && booking.checkinChecklistItems.length > 0) ||
                (booking.checkoutChecklistItems && booking.checkoutChecklistItems.length > 0)) && (
                <div className="mt-3 space-y-3">
                  {/* Check-in checklist audit */}
                  {booking.checkinChecklistItems && booking.checkinChecklistItems.length > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> {t("bdCheckinChecklist")}
                      </p>
                      <div className="space-y-1">
                        {booking.checkinChecklistItems.map((item, index) => (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <Checkbox checked={item.checked} disabled className="pointer-events-none h-3 w-3" />
                            <span className="tabular-nums text-[11px] font-medium text-muted-foreground">{index + 1}.</span>
                            <span className={`text-[11px] ${item.checked ? "text-success" : "text-destructive line-through"}`}>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {booking.checkinPhotoUrls && booking.checkinPhotoUrls.length > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Camera className="h-3 w-3" /> {t("bdCheckinPhotos", { count: booking.checkinPhotoUrls.length })}
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {booking.checkinPhotoUrls.map((url, i) => {
                          const proxied = getR2ProxyUrl(url);
                          return (
                            <a
                              key={`ci-${i}`}
                              href={proxied}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <SmartImage
                                src={proxied}
                                alt={t("bdCheckinPhotoAlt", { n: i + 1 })}
                                className="w-full h-20 object-cover rounded-md border hover:opacity-80 transition-opacity"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                              />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {booking.checkoutPhotoUrls && booking.checkoutPhotoUrls.length > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Camera className="h-3 w-3" /> {t("bdCheckoutPhotos", { count: booking.checkoutPhotoUrls.length })}
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {booking.checkoutPhotoUrls.map((url, i) => {
                          const proxied = getR2ProxyUrl(url);
                          return (
                            <a
                              key={`co-${i}`}
                              href={proxied}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <SmartImage
                                src={proxied}
                                alt={t("bdCheckoutPhotoAlt", { n: i + 1 })}
                                className="w-full h-20 object-cover rounded-md border hover:opacity-80 transition-opacity"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }}
                              />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Check-out checklist audit */}
                  {booking.checkoutChecklistItems && booking.checkoutChecklistItems.length > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-2 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> {t("bdCheckoutChecklist")}
                      </p>
                      <div className="space-y-1">
                        {booking.checkoutChecklistItems.map((item, index) => (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <Checkbox checked={item.checked} disabled className="pointer-events-none h-3 w-3" />
                            <span className="tabular-nums text-[11px] font-medium text-muted-foreground">{index + 1}.</span>
                            <span className={`text-[11px] ${item.checked ? "text-success" : "text-destructive line-through"}`}>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Add-ons: Storage ── */}
          {allStorageBookings.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                {t("bdStorageSection")}
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
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusCleared")}
                          </Badge>
                        ) : refunded ? (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            <Receipt className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusRefunded")?.toLowerCase()}
                          </Badge>
                        ) : voided ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusNotCharged")}
                          </Badge>
                        ) : storage.status === "cancelled" ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusCancelled")?.toLowerCase()}
                          </Badge>
                        ) : storage.status === "confirmed" || storage.status === "active" ? (
                          <Badge variant="outline" className="text-[10px] text-success border-success/30">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusConfirmed")?.toLowerCase()}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                            {storage.status === 'pending' ? t("bdStatusPending")?.toLowerCase() : 
                             storage.status === 'expired' ? t("bdStatusExpired")?.toLowerCase() : 
                             storage.status}
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
                {t("bdEquipmentSection")}
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
                            <Receipt className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusRefunded")?.toLowerCase()}
                          </Badge>
                        ) : voided ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusNotCharged")}
                          </Badge>
                        ) : equipment.status === "cancelled" ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusCancelled")?.toLowerCase()}
                          </Badge>
                        ) : equipment.status === "confirmed" || equipment.status === "active" ? (
                          <Badge variant="outline" className="text-[10px] text-success border-success/30">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />{t("bdStatusConfirmed")?.toLowerCase()}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                            {equipment.status === 'pending' ? t("bdStatusPending")?.toLowerCase() : 
                             equipment.status === 'expired' ? t("bdStatusExpired")?.toLowerCase() : 
                             equipment.status}
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
                {t("bdNotesSection")}
              </h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{booking.specialNotes}</p>
            </section>
          )}

          {/* ── Chef Information (Manager only) ── */}
          {isManagerView && booking.chef && (
            <section>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {t("bdChefSection")}
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
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">{t("bdPaymentSection")}</h3>

              <div className="space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("bdKitchenLine", { duration: t("bdHours", { count: calculateDuration() }) })}
                  </span>
                  <span className="font-mono">
                    {formatCurrency(totals.kitchen > 0 ? totals.kitchen : booking.totalPrice)}
                  </span>
                </div>

                {allStorageTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("bdStorageLine")}</span>
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
                    <span className="text-muted-foreground">{t("bdEquipmentLine")}</span>
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

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {booking.paymentStatus === 'failed' && booking.status === 'cancelled'
                      ? t("bdOriginalQuote")
                      : isRefunded || isPartiallyRefunded
                        ? t("bdAmountCharged")
                        : t("bdSubtotal")}
                  </span>
                  <span className={`font-mono tabular-nums ${
                    (booking.paymentStatus === 'failed' && booking.status === 'cancelled') || isRefunded
                      ? 'text-muted-foreground line-through'
                      : ''
                  }`}>
                    {formatCurrency(totals.subtotal)}
                  </span>
                </div>

                {/* Taxes, fees and total continue the same list — no second header */}
                {/* VOIDED AUTH: skip entirely — no money was captured */}
                {booking.paymentTransaction && pricingBreakdownInput && !(booking.paymentStatus === 'failed' && booking.status === 'cancelled') && (
                  isManagerView ? (
                    <KitchenPayoutStatementBreakdown
                      {...pricingBreakdownInput}
                      currency={booking.currency || "CAD"}
                      title={
                        booking.paymentStatus === 'authorized'
                          ? t("bdEstimatedPayout", { defaultValue: "Estimated payout" })
                          : t("bdYourPayout", { defaultValue: "Your payout" })
                      }
                      showProcessorFee={pricingBreakdownInput.showPaymentProcessorFee}
                      processingFeeLabel={t("bdProcessingFee")}
                      refundLabel={t("bdRefund")}
                      hstLabel={t("bdHstPercent", {
                        percent: pricingBreakdownInput.kitchenHstRatePercent ?? 0,
                      })}
                    />
                  ) : (
                    <ChefBookingReceiptBreakdown
                      {...pricingBreakdownInput}
                      currency={booking.currency || "CAD"}
                      totalLabel={booking.paymentStatus === 'authorized' ? t("bdAmountAuthorized") : t("bdAmountCharged")}
                      platformFeeLabel={t("bdLocalCooksServiceFee", {
                        percent: Math.round((pricingBreakdownInput.platformFeeRate || 0) * 100),
                        defaultValue: "Service fee ({percent}%)",
                      })}
                    />
                  )
                )}

                {!isManagerView && refundAmount > 0 && (
                  <div className="flex justify-between text-sm items-center gap-2">
                    <span className="text-warning inline-flex items-center gap-1">
                      {t("bdRefundedLine")}
                      <StripeProcessingFeeRefundInfo iconClassName="h-3 w-3" />
                    </span>
                    <span className="font-mono tabular-nums text-warning">−{formatCurrency(refundAmount)}</span>
                  </div>
                )}
              </div>

              {/* VOIDED AUTH: Show when booking was cancelled before capture — no money moved */}
              {booking.paymentStatus === 'failed' && booking.status === 'cancelled' && (
                <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-muted-foreground">
                      <p className="font-medium mb-0.5">{t("bdAuthVoidedTitle")}</p>
                      <p>
                        {isManagerView
                          ? t("bdAuthVoidedManager")
                          : t("bdAuthVoidedChef")}
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
                      <p className="font-medium mb-0.5">{t("bdPaymentHeldTitle")}</p>
                      <p>
                        {isManagerView 
                          ? t("bdPaymentHeldManager")
                          : t("bdPaymentHeldChef")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* REFUND INFO: Show when a refund has been processed (full or partial) */}
              {hasRefund && refundAmount > 0 && (
                <div className="mt-4 p-3 rounded-lg border">
                  <div className="flex items-start gap-2">
                    <Receipt className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-muted-foreground min-w-0">
                      <p className="font-medium text-foreground mb-0.5 inline-flex items-center gap-1.5">
                        {isRefunded ? t("bdFullyRefunded") : t("bdPartialRefundIssued")}
                        {!isManagerView && <StripeProcessingFeeRefundInfo />}
                      </p>
                      <p>
                        {isManagerView
                          ? `${t("bdRefundedToChef", { amount: formatCurrency(refundAmount) })}${booking.paymentTransaction?.refundReason ? ` ${t("bdRefundReason", { reason: booking.paymentTransaction.refundReason })}` : ''}`
                          : t("bdRefundedYou", { amount: formatCurrency(refundAmount) })}
                      </p>
                      {booking.paymentTransaction?.refundedAt && (
                        <p className="mt-0.5">
                          {t("bdRefundedOn", { date: formatShortDate(booking.paymentTransaction.refundedAt) })}
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
                      <p className="font-medium mb-0.5">{t("bdBookingCancelledTitle")}</p>
                      <p>
                        {isManagerView
                          ? t("bdBookingCancelledManager")
                          : t("bdBookingCancelledChef")}
                      </p>
                    </div>
                  </div>
                </div>
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
                      {t("bdGenerating")}
                    </>
                  ) : (
                    <>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {isManagerView
                        ? t("bdDownloadPayoutStatement", { defaultValue: "Download payout statement" })
                        : t("bdDownloadReceipt", { defaultValue: "Download booking receipt" })}
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Meta ── */}
          <div className="text-xs text-muted-foreground space-y-1.5 px-1">
            <div className="flex justify-between">
              <span>{t("bdCreated")}</span>
              <span>{formatShortDate(booking.createdAt)}</span>
            </div>
            {booking.updatedAt && (
              <div className="flex justify-between">
                <span>{t("bdUpdated")}</span>
                <span>{formatShortDate(booking.updatedAt)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );

  const bookingBreadcrumbs = useMemo(
    () => [
      { label: t("shellDashboard"), onClick: () => navigate("/dashboard"), navId: "overview" as const },
      {
        label: t("shellMyBookings"),
        onClick: () => navigate("/dashboard?view=bookings"),
        navId: "bookings" as const,
      },
      { label: booking ? t("bdBookingRef", { id: booking.id }) : t("bdBookingDetails") },
    ],
    [t, navigate, booking]
  );

  const inShell = useChefShellChrome({
    activeView: "bookings",
    onViewChange: handleViewChange,
    breadcrumbs: bookingBreadcrumbs,
  });

  // Render with appropriate layout
  if (isManagerView) {
    return (
      <ManagerBookingLayout
        bookingLocationId={booking?.location?.id ?? booking?.kitchen?.locationId ?? null}
        breadcrumbs={[
          { label: t("shellDashboard"), onClick: () => navigate("/manager/dashboard") },
          { label: t("bkMyBookings"), onClick: () => window.history.back() },
          { label: booking ? t("bdBookingRef", { id: booking.id }) : t("bdBookingDetails") }
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

  const chefBody = (
    <>
      {isLoading ? loadingContent : (error || !booking) ? errorContent : bookingContent}
      {booking && (
        <KitchenCheckinTracker
          open={checkinTrackerOpen}
          onOpenChange={(open) => {
            setCheckinTrackerOpen(open);
            if (!open) queryClient.invalidateQueries({ queryKey: [`/api/chef/bookings/${bookingId}/details`] });
          }}
          bookingId={booking.id}
          kitchenName={booking.kitchen?.name}
          bookingDate={booking.bookingDate?.split('T')[0]}
          startTime={booking.startTime}
          endTime={booking.endTime}
        />
      )}
    </>
  );

  if (inShell) return chefBody;

  return (
    <ChefDashboardLayout
      activeView="bookings"
      onViewChange={handleViewChange}
      breadcrumbs={bookingBreadcrumbs}
    >
      {chefBody}
    </ChefDashboardLayout>
  );
}

