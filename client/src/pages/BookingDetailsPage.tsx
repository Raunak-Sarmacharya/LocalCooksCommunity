import { logger } from "@/lib/logger";
import { getHourlySlotStarts, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import ManagerBookingLayout from "@/layouts/ManagerBookingLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPhoneForDisplay, normalizePhoneNumber } from "@shared/phone-validation";
import { ArrowLeft, MapPin, Calendar, Package, Wrench, FileText, Download, Loader2, CheckCircle2, XCircle, AlertCircle, CreditCard, Phone, Mail, Receipt, Hash, Info, LogIn, LogOut, Camera, FileWarning, Clock } from "lucide-react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { BookingActionSheet, type BookingForAction } from "@/components/manager/bookings/BookingActionSheet";
import { BookingManagementSheet, type BookingForManagement, type ManagementSubmitParams } from "@/components/manager/bookings/BookingManagementSheet";
import { KitchenCheckinTracker } from "@/components/booking/KitchenCheckinTracker";
import { StripeProcessingFeeRefundInfo } from "@/components/booking/StripeProcessingFeeRefundInfo";
import { ServiceFeeInfoPopover } from "@/components/booking/ServiceFeeInfoPopover";
import { SmartImage } from "@/components/ui/smart-image";
import { tt } from "@/i18n/common-ns";
import { mt } from "@/i18n/manager";
import { ChefBookingReceiptBreakdown, KitchenPayoutStatementBreakdown } from "@/components/booking/BookingPricingBreakdown";
import { kitchenCheckinPolicyTimes } from '@/lib/kitchen-checkin-policy';

interface BookingDetails {
  id: number;
  referenceCode?: string | null;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  selectedSlots?: Array<{ startTime: string; endTime: string }>;
  status: string;
  paymentStatus?: string;
  specialNotes?: string;
  totalPrice?: number;
  hourlyRate?: number;
  durationHours?: number;
  pricingMode?: "hourly" | "daily";
    serviceFee?: number;
    taxAmount?: number;
  /** Admin-configured service fee rate (fraction, e.g. 0.07) */
  platformCommissionRate?: number;
  currency?: string;
  createdAt: string;
  updatedAt?: string;
  paymentIntentId?: string;
  kitchenContact?: { email: string; phone: string | null } | null;
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
    /** Pre-capture estimate from platform_settings (when stripeProcessingFee is 0) */
    estimatedStripeProcessingFee?: number;
    estimatedManagerPayout?: number;
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
  checkinEnabled?: boolean;
  checkoutEnabled?: boolean;
  checkinWindowMinutesBefore?: number;
  noShowGraceMinutes?: number;
  visits?: Array<{ id: number; blockIndex: number; startTime: string; endTime: string; checkinStatus: string; checkedInAt: string | null; checkoutRequestedAt: string | null; checkedOutAt: string | null; checkoutApprovedAt: string | null; noShowDetectedAt: string | null }>;
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

    let cancelled = false;

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
        if (!cancelled) setBooking(data);
      } catch (err) {
        if (cancelled) return;
        logger.error("Error fetching booking details:", err);
        setError(err instanceof Error ? err.message : t("bdErrLoad"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchBookingDetails();
    return () => {
      cancelled = true;
    };
  }, [bookingId, isManagerView, authLoading]);

  const reloadBookingDetails = async () => {
    if (!bookingId) return;
    try {
      const headers = await getAuthHeaders();
      const endpoint = isManagerView
        ? `/api/manager/bookings/${bookingId}/details`
        : `/api/chef/bookings/${bookingId}/details`;
      const response = await fetch(endpoint, { credentials: "include", headers });
      if (!response.ok) return;
      const data = await response.json();
      setBooking(data);
    } catch (err) {
      logger.error("Error reloading booking details:", err);
    }
  };

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

  const handleClearCheckout = async (visitId?: number) => {
    if (!booking?.id || (visitId
      ? !booking.visits?.some(visit => visit.id === visitId && visit.checkinStatus === 'checkout_requested')
      : booking.checkinStatus !== "checkout_requested")) return;
    if (!window.confirm(mt("acceptCheckoutConfirm", { defaultValue: "Accept this checkout and mark the booking complete?" }))) return;

    setIsUpdatingStatus(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${booking.id}/clear-kitchen-checkout`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ visitId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || mt("failedToAcceptCheckout", { defaultValue: "Failed to accept checkout" }));

      const now = new Date().toISOString();
      setBooking((current) => current ? visitId ? {
        ...current,
        status: data.bookingCompleted ? 'completed' : current.status,
        visits: current.visits?.map(visit => visit.id === visitId
          ? { ...visit, checkinStatus: 'checked_out', checkedOutAt: now } : visit),
      } : {
        ...current, status: 'completed', checkinStatus: 'checked_out',
        checkoutApprovedAt: now, updatedAt: now,
      } : current);
      queryClient.invalidateQueries({ queryKey: ["managerBookings"] });
      toast({ title: tt("checkoutClearedNoIssues") });
    } catch (err) {
      toast({
        title: t("bdErrorTitle"),
        description: err instanceof Error ? err.message : mt("failedToAcceptCheckout", { defaultValue: "Failed to accept checkout" }),
        variant: "destructive",
      });
    } finally {
      setIsUpdatingStatus(false);
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

  const formatEventTimestamp = (dateStr: string) => new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: booking?.location?.timezone || 'America/St_Johns',
  }).format(new Date(dateStr));

  const formatCurrency = (cents: number | undefined | null) => {
    if (cents === undefined || cents === null) return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatBookingTimeSlots = (): string[] => {
    if (!booking) return [];
    const rawSlots = booking.selectedSlots;

    if (!rawSlots || rawSlots.length === 0) {
      return [`${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`];
    }

    const slotOrder = sortTimesInOperatingWindow(rawSlots.map(slot => slot.startTime),
      booking.operatingWindowStartTime || booking.startTime);
    const sorted = slotOrder.map(time => rawSlots.find(slot => slot.startTime === time)!);

    let isContiguous = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].endTime !== sorted[i].startTime) {
        isContiguous = false;
        break;
      }
    }

    if (isContiguous) {
      return [`${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}`];
    }

    return sorted.map((s) => `${formatTime(s.startTime)} - ${formatTime(s.endTime)}`);
  };

  const formatContactPhone = (phone: string) => {
    const formatted = formatPhoneForDisplay(phone);
    return normalizePhoneNumber(phone)?.startsWith('+1') ? `+1 ${formatted}` : formatted;
  };
  const bookingTimeSlots = formatBookingTimeSlots();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <InfoChip variant="success" icon={<CheckCircle2 className="h-3 w-3" />}>
            {t("bdStatusConfirmed")}
          </InfoChip>
        );
      case "pending":
        return (
          <InfoChip variant="warning" icon={<AlertCircle className="h-3 w-3" />}>
            {t("bdStatusPending")}
          </InfoChip>
        );
      case "cancelled": {
        // Industry standard: distinguish by cause
        const isExpired = booking?.paymentStatus === 'failed';
        const isRefunded = booking?.paymentStatus === 'refunded';
        const cancelledLabel = isExpired ? t("bdStatusExpired") : isRefunded ? t("bdStatusRefunded") : t("bdStatusCancelled");
        const cancelledIcon = isExpired ? <AlertCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />;
        return (
          <InfoChip variant="outline" icon={cancelledIcon}>
            {cancelledLabel}
          </InfoChip>
        );
      }
      default:
        return <InfoChip variant="outline">{status}</InfoChip>;
    }
  };

  const getCheckinStatusBadge = (checkinStatus: string | null | undefined) => {
    if (!checkinStatus || checkinStatus === 'not_checked_in') {
      return (
        <InfoChip variant="outline" icon={<Clock className="h-3 w-3" />}>
          {t("bdCiNotCheckedIn")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checked_in') {
      return (
        <InfoChip variant="success" icon={<LogIn className="h-3 w-3" />}>
          {t("bdCiCheckedIn")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checkout_requested') {
      return (
        <InfoChip variant="info" icon={<Camera className="h-3 w-3" />}>
          {t("bdCiCheckoutPending")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checked_out') {
      return (
        <InfoChip variant="success" icon={<LogOut className="h-3 w-3" />}>
          {t("bdCiCheckedOut")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'no_show') {
      return (
        <InfoChip variant="destructive" icon={<XCircle className="h-3 w-3" />}>
          {t("bdCiNoShow")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checkout_claim_filed') {
      return (
        <InfoChip variant="warning" icon={<FileWarning className="h-3 w-3" />}>
          {t("bdCiClaimFiled")}
        </InfoChip>
      );
    }
    return null;
  };

  const getPaymentStatusBadge = (status: string | undefined) => {
    switch (status) {
      case "authorized":
        return (
          <InfoChip variant="outline" icon={<CreditCard className="h-3 w-3" />}>
            {t("bdPayHeld")}
          </InfoChip>
        );
      case "paid":
        return (
          <InfoChip variant="success" icon={<CreditCard className="h-3 w-3" />}>
            {t("bdPayPaid")}
          </InfoChip>
        );
      case "processing":
        return (
          <InfoChip variant="outline" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
            {t("bdPayProcessing")}
          </InfoChip>
        );
      case "pending":
        return (
          <InfoChip variant="warning" icon={<AlertCircle className="h-3 w-3" />}>
            {t("bdPayPending")}
          </InfoChip>
        );
      case "refunded":
        return (
          <InfoChip variant="outline" icon={<Receipt className="h-3 w-3" />}>
            {t("bdPayRefunded")}
          </InfoChip>
        );
      case "partially_refunded":
        return (
          <InfoChip variant="warning" icon={<Receipt className="h-3 w-3" />}>
            {t("bdPayPartialRefund")}
          </InfoChip>
        );
      case "failed":
        // Distinguish voided authorization (cancelled booking with 'failed' payment) from actual failures
        if (booking?.status === 'cancelled') {
          return (
            <InfoChip variant="outline" icon={<CreditCard className="h-3 w-3" />}>
              {t("bdPayAuthVoided")}
            </InfoChip>
          );
        }
        return (
          <InfoChip variant="destructive" icon={<XCircle className="h-3 w-3" />}>
            Failed
          </InfoChip>
        );
      case "canceled":
        return (
          <InfoChip variant="outline" icon={<XCircle className="h-3 w-3" />}>
            {t("bdPayCanceled")}
          </InfoChip>
        );
      default:
        return null;
    }
  };

  const paymentMessage = (() => {
    if (!booking) return null;
    const status = booking.paymentStatus;
    if (status === 'authorized') return { summary: t('bdPaymentHeldSummary', { defaultValue: 'Your payment is on hold.' }), detail: t(isManagerView ? 'bdPaymentHeldManager' : 'bdPaymentHeldChef') };
    if (status === 'failed' && booking.status === 'cancelled') return { summary: t('bdAuthVoidedSummary', { defaultValue: 'Your payment hold was released.' }), detail: t(isManagerView ? 'bdAuthVoidedManager' : 'bdAuthVoidedChef') };
    if (status === 'refunded' || status === 'partially_refunded') return {
      summary: status === 'refunded' ? t('bdRefundedSummary', { defaultValue: 'Your payment was refunded.' }) : t('bdPartialRefundSummary', { defaultValue: 'Part of your payment was refunded.' }),
      detail: `${booking.paymentTransaction?.refundAmount ? (isManagerView ? t('bdRefundedToChef', { amount: formatCurrency(booking.paymentTransaction.refundAmount) }) : t('bdRefundedYou', { amount: formatCurrency(booking.paymentTransaction.refundAmount) })) : t('bdRefundAmountUnavailable', { defaultValue: 'The refund amount is not yet available.' })}${booking.paymentTransaction?.refundedAt ? ` ${t('bdRefundedOn', { date: formatShortDate(booking.paymentTransaction.refundedAt) })}` : ''}${booking.paymentTransaction?.refundReason && isManagerView ? ` ${t('bdRefundReason', { reason: booking.paymentTransaction.refundReason })}` : ''}`,
    };
    if (status === 'paid' && booking.status === 'cancelled') return { summary: t('bdCancelledPaidSummary', { defaultValue: 'Your booking was cancelled after payment.' }), detail: t(isManagerView ? 'bdBookingCancelledManager' : 'bdBookingCancelledChef') };
    if (status === 'paid') return { summary: t('bdPaidSummary', { defaultValue: 'Your payment was collected.' }), detail: t('bdPaymentCapturedInfo', { defaultValue: 'Your payment has been captured for this booking.' }) };
    if (status === 'processing') return { summary: t('bdProcessingSummary', { defaultValue: 'Your payment is processing.' }), detail: t('bdPaymentProcessingInfo', { defaultValue: 'Your payment is being processed. This page will show the final status once it is available.' }) };
    if (status === 'pending') return { summary: t('bdPendingSummary', { defaultValue: 'Your payment is pending.' }), detail: t('bdPaymentPendingInfo', { defaultValue: 'Payment has not been completed yet.' }) };
    if (status === 'failed') return { summary: t('bdPaymentFailedInfo', { defaultValue: 'Payment failed.' }), detail: t('bdPaymentFailedDetail', { defaultValue: 'The payment could not be completed. Contact Local Cooks if you need help.' }) };
    if (status === 'canceled') return { summary: t('bdCanceledSummary', { defaultValue: 'Your payment was canceled.' }), detail: t('bdPaymentCanceledInfo', { defaultValue: 'The payment was canceled before it was completed.' }) };
    return { summary: t('bdUnknownPaymentSummary', { defaultValue: 'Payment status is unavailable.' }), detail: t('bdUnknownPaymentDetail', { defaultValue: 'Contact Local Cooks if you need help with this payment.' }) };
  })();

  const calculateDuration = () => {
    if (!booking) return 0;
    if (booking.durationHours) return booking.durationHours;
    if (booking.selectedSlots && booking.selectedSlots.length > 0) {
      return booking.selectedSlots.length;
    }
    return getHourlySlotStarts(booking.startTime, booking.endTime).length;
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
    const actualStripe = booking.paymentTransaction?.stripeProcessingFee || 0;
    const estimatedStripe = booking.paymentTransaction?.estimatedStripeProcessingFee || 0;
    const isAuthorizedHold = booking.paymentStatus === "authorized";
    const stripeFee =
      actualStripe > 0
        ? actualStripe
        : isAuthorizedHold
          ? estimatedStripe
          : 0;
    const feesAreEstimated = isAuthorizedHold && actualStripe <= 0 && stripeFee > 0;

    return {
      kitchenBaseSubtotalCents: subtotal,
      kitchenHstRatePercent: Number(booking.kitchen?.taxRatePercent) || 0,
      kitchenHstAmountCents: booking.paymentTransaction?.taxAmount,
      platformFeeRate,
      platformFeeAmountCents: serviceFee,
      paymentProcessorFeeCents: stripeFee,
      // Pre-capture manager_revenue is still kitchen gross — force estimate path.
      kitchenNetPayoutCents: feesAreEstimated
        ? null
        : booking.paymentTransaction?.managerRevenue,
      chargeAmountCents: booking.paymentTransaction?.amount,
      refundAmountCents: booking.paymentTransaction?.refundAmount || 0,
      hourlyRateCents: booking.hourlyRate,
      bookedHours: booking.durationHours,
      showPaymentProcessorFee: stripeFee > 0,
      paymentProcessorFeeIsEstimate: feesAreEstimated,
      showPlatformFeeLine: serviceFee > 0,
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
    selectedSlots: booking.selectedSlots,
    operatingWindowStartTime: booking.operatingWindowStartTime,
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

      // Capture + Connect transfer update payment_transactions asynchronously.
      // Never keep the pre-capture paymentTransaction on the client — that shows
      // kitchen gross (subtotal+tax) as "Your payout" instead of the transfer net.
      if (
        params.status === "confirmed" &&
        (booking.paymentStatus === "authorized" || updatedPaymentStatus === "paid")
      ) {
        queryClient.invalidateQueries({ queryKey: ["managerBookings"] });
        toast({
          title: t("bdSuccessTitle"),
          description: t("bdBookingConfirmedDesc"),
        });
        await reloadBookingDetails();
        // Transfer may land slightly after capture; one short follow-up refresh.
        window.setTimeout(() => {
          void reloadBookingDetails();
        }, 2500);
        setIsUpdatingStatus(false);
        setActionSheetOpen(false);
        return;
      }

      // For non-refund scenarios (void or simple status change), update local state directly
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
    selectedSlots: booking.selectedSlots,
    operatingWindowStartTime: booking.operatingWindowStartTime,
    totalPrice: booking.totalPrice,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    transactionId: booking.paymentTransaction?.id,
    transactionAmount: booking.paymentTransaction?.amount,
    stripeProcessingFee: booking.paymentTransaction?.stripeProcessingFee,
    managerRevenue: booking.paymentTransaction?.managerRevenue,
    serviceFee: booking.paymentTransaction?.serviceFee || booking.serviceFee || 0,
    taxRatePercent: booking.kitchen?.taxRatePercent ? Number(booking.kitchen.taxRatePercent) : undefined,
    managerRemainingBalance: Math.max(
      0,
      (booking.paymentTransaction?.managerRevenue || 0) -
        (booking.paymentTransaction?.refundAmount || 0),
    ),
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
              storageActions: params.storageActions,
              equipmentActions: params.equipmentActions,
            }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to cancel'); }
          if (params.action === "cancel-booking-refund" && bookingForManagement?.transactionId) {
            const requestRes = await fetch(`/api/manager/revenue/transactions/${bookingForManagement.transactionId}/full-refund-request`, {
              method: 'POST', headers, credentials: 'include',
              body: JSON.stringify({ reason: 'Full refund requested after manager cancellation' }),
            });
            if (!requestRes.ok) { const d = await requestRes.json().catch(() => ({})); throw new Error(d.error || 'Booking cancelled, but the full refund request failed'); }
          }
          toast({
            title: t("bdBookingCancelledToast"),
            description: params.action === "cancel-booking-refund" ? 'Full refund sent to admin for approval.' : t("bdBookingCancelledDesc"),
          });
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
        case "request-full-refund": {
          if (!bookingForManagement?.transactionId) throw new Error(t("bdRefundPanelInfo"));
          const requestRes = await fetch(`/api/manager/revenue/transactions/${bookingForManagement.transactionId}/full-refund-request`, {
            method: 'POST', headers, credentials: 'include',
            body: JSON.stringify({ reason: 'Full refund requested by manager' }),
          });
          if (!requestRes.ok) {
            const d = await requestRes.json().catch(() => ({}));
            throw new Error(d.error || 'Failed to request full refund');
          }
          toast({ title: 'Full refund requested', description: 'An admin will review and control the final refund.' });
          setManagementSheetOpen(false);
          break;
        }
        case "accept-cancellation": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'accept' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
          setBooking({ ...booking, status: 'cancelled' });
          toast({ title: mt("cancellationAccepted") });
          break;
        }
        case "decline-cancellation": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'decline' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
          setBooking({ ...booking, status: 'confirmed' });
          toast({ title: mt("cancellationDeclined") });
          break;
        }
        case "accept-storage-cancel": {
          if (!params.storageCancellationId) throw new Error(tt("noStorageBookingId"));
          const res = await fetch(`/api/manager/storage-bookings/${params.storageCancellationId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'accept' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
          toast({ title: mt("storageCancellationAccepted") });
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
          toast({ title: mt("storageCancellationDeclined") });
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
  const hasMultipleVisits = (booking?.visits?.length ?? 0) > 1;
  const chefCanCheckIn = !isManagerView && booking?.status === 'confirmed' &&
    booking.checkinEnabled === true && (!booking.checkinStatus || booking.checkinStatus === 'not_checked_in');
  const chefCanCheckOut = !isManagerView && booking?.status === 'confirmed' &&
    booking.checkoutEnabled === true && booking.checkinStatus === 'checked_in';
  const renderChefCheckinPolicy = (startTime: string) => {
    if (!booking || isManagerView || booking.checkinWindowMinutesBefore == null || booking.noShowGraceMinutes == null) return null;
    const times = kitchenCheckinPolicyTimes(
      booking.bookingDate.split('T')[0], startTime,
      booking.operatingWindowStartTime || booking.startTime,
      booking.location?.timezone || 'America/St_Johns',
      booking.checkinWindowMinutesBefore, booking.noShowGraceMinutes,
    );
    return (
      <div className="mt-4 border-t pt-4">
        <div className="grid gap-5 sm:grid-cols-3 sm:divide-x sm:divide-border">
          <div className="sm:pr-4">
            <p className="text-xs text-muted-foreground">{t('bdCheckinOpens', { defaultValue: 'Check-in opens' })}</p>
            <p className="mt-1 text-sm font-medium">{formatEventTimestamp(times.opensAt.toISOString())}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('bdMinutesBeforeStart', { count: booking.checkinWindowMinutesBefore, defaultValue: `${booking.checkinWindowMinutesBefore} minutes before start` })}</p>
          </div>
          <div className="sm:px-4">
            <p className="text-xs text-muted-foreground">{t('bdVisitStarts', { defaultValue: 'Visit starts' })}</p>
            <p className="mt-1 text-sm font-medium">{formatEventTimestamp(times.startsAt.toISOString())}</p>
          </div>
          <div className="sm:pl-4">
            <p className="text-xs text-muted-foreground">{t('bdNoShowAfter', { defaultValue: 'No-show may be recorded after' })}</p>
            <p className="mt-1 text-sm font-medium">{formatEventTimestamp(times.noShowAfter.toISOString())}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('bdMinutesAfterStart', { count: booking.noShowGraceMinutes, defaultValue: `${booking.noShowGraceMinutes} minutes after start` })}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('bdKitchenLocalTime', { defaultValue: 'Times are shown in the kitchen’s local time (St. John’s).' })}</p>
      </div>
    );
  };
  const bookingContent = booking && (
    <TooltipProvider>
    <div className="max-w-4xl mx-auto">
      {/* ── Page Header ── */}
      <div className="mb-8 rounded-2xl border bg-card p-5 sm:p-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            {booking.referenceCode ? (
              <span className="font-mono font-medium text-foreground">{booking.referenceCode}</span>
            ) : (
              <span className="font-mono">{booking.id}</span>
            )}
            <span className="text-border">·</span>
            <span>{formatShortDate(booking.createdAt)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {getStatusBadge(booking.status)}
            {(booking.status === 'confirmed' || booking.status === 'completed') &&
              (booking.checkinEnabled === true || booking.checkoutEnabled === true) &&
              (hasMultipleVisits
                ? <InfoChip variant="outline" icon={<Clock className="h-3 w-3" />}>{t('bdVisitCount', { count: booking.visits?.length ?? 0, defaultValue: `${booking.visits?.length ?? 0} visits` })}</InfoChip>
                : getCheckinStatusBadge(booking.checkinStatus))}
            {getPaymentStatusBadge(booking.paymentStatus)}
          </div>
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

          {isManagerView && (booking.status === 'pending' || booking.status === 'confirmed' || booking.status === 'cancellation_requested' || booking.checkinStatus === 'checkout_requested') && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            {booking.status === 'pending' && (
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
            {(booking.status === 'confirmed' || booking.status === 'cancellation_requested') && (
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
            {!hasMultipleVisits && booking.checkinStatus === "checkout_requested" && (
              <Button
                type="button"
                size="sm"
                onClick={() => handleClearCheckout()}
                disabled={isUpdatingStatus}
              >
                {isUpdatingStatus ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                )}
                {mt("clearNoIssues")}
              </Button>
            )}
            </div>
          )}
        </div>
      </div>

      <Separator className="mb-8" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* ── Schedule ── */}
          <section className="rounded-2xl border bg-card p-5 sm:p-6">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-5">{t("bdSchedule")}</h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.6fr)] sm:divide-x sm:divide-border">
              <div className="sm:pr-4">
                <p className="text-xs text-muted-foreground mb-1">{t("bdDate")}</p>
                <p className="text-sm font-medium">{formatDate(booking.bookingDate)}</p>
              </div>
              <div className="sm:px-4">
                <p className="text-xs text-muted-foreground mb-1">{t("bdTime")}</p>
                <div className="text-sm font-medium">
                  {bookingTimeSlots.slice(0, 2).map((slot, index) => <div key={`${slot}-${index}`} className="whitespace-nowrap">{slot}</div>)}
                  {bookingTimeSlots.length > 2 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {t('bdShowAllTimes', { defaultValue: 'Show all times' })}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="max-h-64 w-64 overflow-y-auto text-sm">
                        <p className="mb-2 font-semibold">{t('bdBookedTimes', { defaultValue: 'Booked times' })}</p>
                        <div className="space-y-1">{bookingTimeSlots.map((slot, index) => <div key={`${slot}-${index}`} className="whitespace-nowrap">{slot}</div>)}</div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
              <div className="sm:pl-4">
                <p className="text-xs text-muted-foreground mb-1">{t("bdDuration")}</p>
                <p className="text-sm font-medium">{t("bdHours", { count: calculateDuration() })}</p>
              </div>
            </div>
          </section>

          {hasMultipleVisits && (booking.status === 'confirmed' || booking.status === 'completed') && (
            <section className="rounded-2xl border bg-card p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" />{t("bdCiCoSection")}
                </h2>
                {!isManagerView && booking.status === 'confirmed' && (
                  <Button variant="outline" size="sm" className="h-8 border-primary/30 px-3 text-xs font-semibold text-primary shadow-none hover:bg-primary/5 hover:text-primary" onClick={() => setCheckinTrackerOpen(true)}>
                    {t('bdManageVisits', { defaultValue: 'Manage visits' })}
                  </Button>
                )}
              </div>
              <div className="divide-y border-t">
                {booking.visits?.map(visit => (
                  <div key={visit.id} className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t('bdVisitNumber', { number: visit.blockIndex + 1, defaultValue: `Visit ${visit.blockIndex + 1}` })}: {formatTime(visit.startTime)}–{formatTime(visit.endTime)}</p>
                      <div className="mt-1">{getCheckinStatusBadge(visit.checkinStatus)}</div>
                      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {visit.checkedInAt && <p>{t("bdCheckedInAt")}: {formatEventTimestamp(visit.checkedInAt)}</p>}
                        {visit.checkoutRequestedAt && <p>{t("bdCheckoutRequested")}: {formatEventTimestamp(visit.checkoutRequestedAt)}</p>}
                        {visit.checkedOutAt && <p>{t("bdCheckedOutCleared")}: {formatEventTimestamp(visit.checkedOutAt)}</p>}
                        {visit.checkinStatus === 'checkout_claim_filed' && visit.checkoutApprovedAt && <p>{t("bdCiClaimFiled")}: {formatEventTimestamp(visit.checkoutApprovedAt)}</p>}
                        {visit.noShowDetectedAt && <p>{t("bdNoShowDetected")}: {formatEventTimestamp(visit.noShowDetectedAt)}</p>}
                      </div>
                      {(visit.checkinStatus === 'not_checked_in' || visit.checkinStatus === 'no_show') && renderChefCheckinPolicy(visit.startTime)}
                    </div>
                    {isManagerView && visit.checkinStatus === 'checkout_requested' && (
                      <Button type="button" size="sm" disabled={isUpdatingStatus}
                        onClick={() => handleClearCheckout(visit.id)}>{mt('clearNoIssues')}</Button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Single-visit check-in / checkout ── */}
          {!hasMultipleVisits && (booking.status === 'confirmed' || booking.status === 'completed') &&
            (booking.checkinEnabled === true || booking.checkoutEnabled === true) &&
            (chefCanCheckIn || chefCanCheckOut || booking.checkedInAt || booking.checkoutRequestedAt || booking.checkoutApprovedAt || booking.noShowDetectedAt) && (
            <section className="rounded-2xl border bg-card p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <LogIn className="h-3.5 w-3.5" />{t("bdCiCoSection")}
                </h2>
                {(chefCanCheckIn || chefCanCheckOut) && (
                  <Button variant="outline" size="sm" className="h-8 border-primary/30 px-3 text-xs font-semibold text-primary shadow-none hover:bg-primary/5 hover:text-primary" onClick={() => setCheckinTrackerOpen(true)}>
                    {chefCanCheckIn ? t("bdOpenCheckin") : t("bdCheckOutNow")}
                  </Button>
                )}
              </div>
              <div>
                {(chefCanCheckIn || chefCanCheckOut) && (
                  <div>
                    <p className="text-sm font-medium">{chefCanCheckIn ? t("bdCheckInRequired") : t("bdReadyToCheckOut")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{chefCanCheckIn ? t("bdCheckInBody") : t("bdCheckOutBody")}</p>
                  </div>
                )}
                {(booking.checkinStatus === 'not_checked_in' || booking.checkinStatus === 'no_show' || chefCanCheckIn) && renderChefCheckinPolicy(booking.startTime)}
                {(booking.checkedInAt || booking.checkoutRequestedAt || booking.checkoutApprovedAt || booking.noShowDetectedAt) && (
                <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${(chefCanCheckIn || chefCanCheckOut) ? 'mt-4 border-t pt-4' : ''}`}>
                {booking.checkedInAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t("bdCheckedInAt")}</p>
                    <p className="text-sm font-medium">
                      {formatEventTimestamp(booking.checkedInAt)}
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
                      {formatEventTimestamp(booking.checkoutRequestedAt)}
                    </p>
                  </div>
                )}
                {booking.checkoutApprovedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t("bdCheckedOutCleared")}</p>
                    <p className="text-sm font-medium">{formatEventTimestamp(booking.checkoutApprovedAt)}</p>
                  </div>
                )}
                {booking.noShowDetectedAt && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t("bdNoShowDetected")}</p>
                    <p className="text-sm font-medium text-destructive">{formatEventTimestamp(booking.noShowDetectedAt)}</p>
                  </div>
                )}
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
                          <InfoChip variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>
                            {t("bdStatusCleared")}
                          </InfoChip>
                        ) : refunded ? (
                          <InfoChip variant="warning" icon={<Receipt className="h-2.5 w-2.5" />}>
                            {t("bdStatusRefunded")?.toLowerCase()}
                          </InfoChip>
                        ) : voided ? (
                          <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>
                            {t("bdStatusNotCharged")}
                          </InfoChip>
                        ) : storage.status === "cancelled" ? (
                          <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>
                            {t("bdStatusCancelled")?.toLowerCase()}
                          </InfoChip>
                        ) : storage.status === "confirmed" || storage.status === "active" ? (
                          <InfoChip variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>
                            {t("bdStatusConfirmed")?.toLowerCase()}
                          </InfoChip>
                        ) : (
                          <InfoChip variant="warning" icon={<AlertCircle className="h-2.5 w-2.5" />}>
                            {storage.status === 'pending' ? t("bdStatusPending")?.toLowerCase() : 
                             storage.status === 'expired' ? t("bdStatusExpired")?.toLowerCase() : 
                             storage.status}
                          </InfoChip>
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
                          <InfoChip variant="warning" icon={<Receipt className="h-2.5 w-2.5" />}>
                            {t("bdStatusRefunded")?.toLowerCase()}
                          </InfoChip>
                        ) : voided ? (
                          <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>
                            {t("bdStatusNotCharged")}
                          </InfoChip>
                        ) : equipment.status === "cancelled" ? (
                          <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>
                            {t("bdStatusCancelled")?.toLowerCase()}
                          </InfoChip>
                        ) : equipment.status === "confirmed" || equipment.status === "active" ? (
                          <InfoChip variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>
                            {t("bdStatusConfirmed")?.toLowerCase()}
                          </InfoChip>
                        ) : (
                          <InfoChip variant="warning" icon={<AlertCircle className="h-2.5 w-2.5" />}>
                            {equipment.status === 'pending' ? t("bdStatusPending")?.toLowerCase() : 
                             equipment.status === 'expired' ? t("bdStatusExpired")?.toLowerCase() : 
                             equipment.status}
                          </InfoChip>
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

          {/* Contact details follow the booking content in either view. */}
          {!isManagerView && booking.kitchenContact?.email && (
            <section className="rounded-2xl border bg-card p-5 sm:p-6">
              <h2 className="text-sm font-semibold">{t('bdContactKitchen', { defaultValue: 'Contact the kitchen' })}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('bdContactKitchenHint', { defaultValue: 'Questions about your visit? Reach the kitchen directly.' })}</p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                <a className="inline-flex min-w-0 items-center gap-2 text-foreground underline-offset-4 hover:underline" href={`mailto:${booking.kitchenContact.email}`}><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-all">{booking.kitchenContact.email}</span></a>
                {booking.kitchenContact.phone && <a className="inline-flex items-center gap-2 text-foreground underline-offset-4 hover:underline" href={`tel:${booking.kitchenContact.phone}`}><Phone className="h-4 w-4 text-muted-foreground" />{formatContactPhone(booking.kitchenContact.phone)}</a>}
              </div>
            </section>
          )}

          {isManagerView && booking.chef && (
            <section className="rounded-2xl border bg-card p-5 sm:p-6">
              <h2 className="text-sm font-semibold">{t('bdContactChef', { defaultValue: 'Contact the chef' })}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{booking.chef.fullName || booking.chef.username}</p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                <a className="inline-flex min-w-0 items-center gap-2 text-foreground underline-offset-4 hover:underline" href={`mailto:${booking.chef.username}`}>
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-all">{booking.chef.username}</span>
                </a>
                {booking.chef.phone && (
                  <a className="inline-flex items-center gap-2 text-foreground underline-offset-4 hover:underline" href={`tel:${booking.chef.phone}`}>
                    <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />{formatContactPhone(booking.chef.phone)}
                  </a>
                )}
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
                    {t("bdKitchenLine", {
                      duration: booking.pricingMode === "daily"
                        ? t("bdDailyRate")
                        : t("bdHours", { count: calculateDuration() }),
                    })}
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
                      processingFeeLabel={
                        pricingBreakdownInput.paymentProcessorFeeIsEstimate
                          ? t("bdEstProcessingFee", {
                              defaultValue: "Est. processing fee",
                            })
                          : t("bdProcessingFee")
                      }
                      platformFeeLabel={t("bdLocalCooksServiceFee", {
                        percent: Math.round((pricingBreakdownInput.platformFeeRate || 0) * 100),
                        defaultValue: "Service fee ({percent}%)",
                      })}
                      platformFeeChefPaidLabel={t("bdLocalCooksFeePaidByChef", {
                        defaultValue: "Service fee",
                      })}
                      platformFeeInfo={<ServiceFeeInfoPopover iconClassName="h-3 w-3" />}
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

              {paymentMessage && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs">
                  <span className="min-w-0 flex-1 text-muted-foreground">{paymentMessage.summary}</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('bdPaymentMoreInfo', { defaultValue: 'More about payment status' })}>
                        <Info className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" side="top" className="w-64 max-w-[calc(100vw-2rem)] text-xs leading-relaxed">{paymentMessage.detail}</PopoverContent>
                  </Popover>
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

          <Card className="border-border shadow-none">
            <CardContent className="p-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('bdContactSupport', { defaultValue: 'Contact Local Cooks' })}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('bdContactSupportHint', { defaultValue: 'Need help with your booking or payment?' })}</p>
              <div className="mt-4 space-y-3 text-sm">
                <a className="flex min-w-0 items-center gap-2 text-foreground underline-offset-4 hover:underline" href="mailto:support@localcook.shop"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-all">support@localcook.shop</span></a>
                <a className="flex items-center gap-2 text-foreground underline-offset-4 hover:underline" href="tel:+17096318480"><Phone className="h-4 w-4 shrink-0 text-muted-foreground" />+1 (709) 631-8480</a>
              </div>
            </CardContent>
          </Card>

          {booking.updatedAt && Date.parse(booking.updatedAt) > Date.parse(booking.createdAt) && (
            <div className="px-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>{t("bdUpdated")}</span>
                <span>{formatEventTimestamp(booking.updatedAt)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </TooltipProvider>
  );

  const bookingBreadcrumbs = useMemo(
    () => [
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
            if (!open) void reloadBookingDetails();
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
