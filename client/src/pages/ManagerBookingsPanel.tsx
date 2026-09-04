import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { tt } from "@/i18n/common-ns";
import { mt } from "@/i18n/manager";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Calendar, User, MapPin, AlertTriangle, Search, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ManagerHeader from "@/components/layout/ManagerHeader";
import { StorageExtensionApprovals } from "@/components/manager/StorageExtensionApprovals";
import { PendingCancellationRequests } from "@/components/manager/PendingCancellationRequests";
import {
  BookingActionSheet,
  type BookingForAction,
} from "@/components/manager/bookings/BookingActionSheet";
import {
  BookingManagementSheet,
  type BookingForManagement,
  type ManagementSubmitParams,
} from "@/components/manager/bookings/BookingManagementSheet";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DEFAULT_TIMEZONE, isBookingUpcoming, isBookingPast, createBookingDateTime, getNowInTimezone } from "@/utils/timezone-utils";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { getBookingColumns, Booking } from "@/components/manager/bookings/columns";
import { auth } from "@/lib/firebase";

// Booking type imported from columns.tsx

async function getAuthHeaders(): Promise<HeadersInit> {
  // Use Firebase auth to get fresh token (same as KitchenDashboardOverview)
  const currentFirebaseUser = auth.currentUser;
  if (currentFirebaseUser) {
    try {
      const token = await currentFirebaseUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    } catch (error) {
      logger.error('Error getting Firebase token:', error);
    }
  }
  // Fallback to localStorage token if Firebase auth is not available
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

interface ManagerBookingsPanelProps {
  embedded?: boolean;
}

export default function ManagerBookingsPanel({ embedded = false }: ManagerBookingsPanelProps = {}) {
  const { t } = useTranslation("manager");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations } = useManagerDashboard();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [bookingToRefund, setBookingToRefund] = useState<Booking | null>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [cancelAndRefundDialogOpen, setCancelAndRefundDialogOpen] = useState(false);
  const [bookingToCancelAndRefund, setBookingToCancelAndRefund] = useState<Booking | null>(null);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [bookingForAction, setBookingForAction] = useState<BookingForAction | null>(null);
  const [isLoadingActionDetails, setIsLoadingActionDetails] = useState(false);
  // Management sheet state (for confirmed/paid bookings)
  const [managementSheetOpen, setManagementSheetOpen] = useState(false);
  const [bookingForManagement, setBookingForManagement] = useState<BookingForManagement | null>(null);
  const [isManagementProcessing, setIsManagementProcessing] = useState(false);

  // Check if any location has approved license
  const hasApprovedLicense = locations.some((loc: any) => loc.kitchenLicenseStatus === 'approved');

  // Fetch all bookings for this manager with real-time polling
  const { data: bookings = [], isLoading, error: bookingsError } = useQuery({
    queryKey: ['managerBookings'],
    queryFn: async () => {
      try {
        const headers = await getAuthHeaders();
        const headersObj = headers as Record<string, string>;
        logger.info('📋 ManagerBookingsPanel: Fetching bookings', {
          hasAuth: !!headersObj.Authorization
        });

        const response = await fetch('/api/manager/bookings', {
          headers,
          credentials: "include",
        });

        logger.info('📋 ManagerBookingsPanel: Response status:', response.status);

        if (!response.ok) {
          let errorMessage = tt("failedToFetchBookings");
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
            logger.error('❌ ManagerBookingsPanel: Error response:', errorData);
          } catch (jsonError) {
            try {
              const text = await response.text();
              errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
              logger.error('❌ ManagerBookingsPanel: Error text:', text);
            } catch (textError) {
              errorMessage = `Server returned ${response.status} ${response.statusText}`;
            }
          }
          throw new Error(errorMessage);
        }

        const contentType = response.headers.get('content-type');
        let data;
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          data = text ? JSON.parse(text) : [];
        }

        logger.info(`✅ ManagerBookingsPanel: Received ${Array.isArray(data) ? data.length : 0} bookings`);
        if (Array.isArray(data) && data.length > 0) {
          logger.info('📋 ManagerBookingsPanel: Sample booking:', data[0]);
        }

        return data;
      } catch (error) {
        logger.error('❌ ManagerBookingsPanel: Fetch error:', error);
        throw error;
      }
    },
    // Real-time polling - check frequently for new bookings or changes
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) return 10000; // 10 seconds if no data

      // Check if there are pending bookings (need manager attention)
      const hasPendingBookings = data.some((b: Booking) => b.status === "pending");

      // Check if there are upcoming bookings (chefs might cancel)
      const hasUpcomingBookings = data.some((b: Booking) => {
        const bookingDate = new Date(b.bookingDate);
        return bookingDate >= new Date();
      });

      if (hasPendingBookings) {
        // Very frequent updates when bookings need review
        return 5000; // 5 seconds
      } else if (hasUpcomingBookings) {
        // Moderate frequency for upcoming bookings
        return 15000; // 15 seconds
      } else {
        // Less frequent when no active bookings
        return 30000; // 30 seconds
      }
    },
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 10000,
  });

  // Update booking status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ bookingId, status, storageActions, equipmentActions, refundOnCancel }: { bookingId: number; status: string; storageActions?: Array<{ storageBookingId: number; action: string }>; equipmentActions?: Array<{ equipmentBookingId: number; action: string }>; refundOnCancel?: boolean }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${bookingId}/status`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ status, storageActions, equipmentActions, refundOnCancel }),
      });
      if (!response.ok) {
        let errorMessage = mt("failedToUpdateBookingStatus");
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (jsonError) {
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (textError) {
            errorMessage = `Server returned ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    onSuccess: (data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      
      // Handle different response scenarios
      if (data?.requiresManualRefund) {
        // Cancellation of confirmed booking - needs manual refund
        toast({ title: t("bookingCancelled"),
          description: mt("useIssueRefundFromMenu"),
          variant: "default",
        });
      } else if (data?.refund && status === 'cancelled') {
        // Cancel & Refund — booking cancelled with auto-refund
        toast({ title: t("bookingCancelledRefunded"),
          description: `Refund of $${(data.refund.amount / 100).toFixed(2)} processed successfully.`,
        });
      } else if (data?.refund) {
        // Rejection with auto-refund (from pending)
        toast({ title: t("bookingRejectedRefunded"),
          description: `Refund of $${(data.refund.amount / 100).toFixed(2)} processed (customer absorbs Stripe fee).`,
        });
      } else if (data?.authorizationVoided) {
        // Voided authorization — no money was captured
        toast({ title: t("bookingRejected"),
          description: t("paymentHoldReleasedNoChargeWasMadeToTheChef"),
        });
      } else {
        toast({ title: t("success"),
          description: status === 'confirmed' ? mt("bookingConfirmedToast") : mt("bookingCancelledToast"),
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: t("error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ENTERPRISE STANDARD: Fetch full booking details before opening action sheet.
  // The list endpoint returns JSONB snapshots (storageItems/equipmentItems) and raw
  // kitchen_bookings.total_price which may be stale or include bundle pricing.
  // The details endpoint recalculates kitchen-only price, fetches relational storage/equipment
  // with original dates, and returns actual Stripe payment transaction data.
  // This ensures the table "Take Action" shows identical data to the BookingDetailsPage.
  const fetchBookingDetailsForAction = async (bookingId: number): Promise<BookingForAction | null> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/manager/bookings/${bookingId}/details`, {
      headers,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(mt("failedToFetchBookingDetails", { status: response.status }));
    }

    const details = await response.json();

    return {
      id: details.id,
      kitchenName: details.kitchen?.name,
      chefName: details.chef?.fullName || details.chef?.username,
      locationName: details.location?.name,
      bookingDate: details.bookingDate,
      startTime: details.startTime,
      endTime: details.endTime,
      totalPrice: details.totalPrice,
      transactionAmount: details.paymentTransaction?.amount,
      serviceFee: details.paymentTransaction?.serviceFee,
      stripeProcessingFee: details.paymentTransaction?.stripeProcessingFee,
      managerRevenue: details.paymentTransaction?.managerRevenue,
      taxRatePercent: details.kitchen?.taxRatePercent ? Number(details.kitchen.taxRatePercent) : undefined,
      // Include ALL items with rejected flag so action sheet shows full audit trail
      // Rejected items appear as read-only, actionable items are toggleable
      storageItems: details.storageBookings
        ?.map((s: any) => ({
          id: s.id,
          storageBookingId: s.id,
          name: s.storageListing?.name || `Storage #${s.storageListingId}`,
          storageType: s.storageListing?.storageType || 'Storage',
          totalPrice: s.totalPrice,
          startDate: s.startDate,
          endDate: s.endDate,
          rejected: s.paymentStatus === 'failed' || s.status === 'cancelled',
        })),
      equipmentItems: details.equipmentBookings
        ?.map((e: any) => ({
          id: e.id,
          equipmentBookingId: e.id,
          name: e.equipmentListing?.equipmentType || `Equipment #${e.equipmentListingId}`,
          totalPrice: e.totalPrice,
          rejected: e.paymentStatus === 'failed' || e.status === 'cancelled',
        })),
      paymentStatus: details.paymentStatus,
    };
  };

  // Single "Take Action" handler — fetches full details then opens the unified action sheet
  const handleTakeAction = async (booking: Booking) => {
    setIsLoadingActionDetails(true);
    setActionSheetOpen(true);
    try {
      const actionData = await fetchBookingDetailsForAction(booking.id);
      setBookingForAction(actionData);
    } catch (error: any) {
      logger.error('Error fetching booking details for action sheet:', error);
      toast({ title: t("error"),
        description: t("failedToLoadBookingDetailsPleaseTryAgain"),
        variant: "destructive",
      });
      setActionSheetOpen(false);
    } finally {
      setIsLoadingActionDetails(false);
    }
  };

  // Legacy handlers kept for fallback (non-pending bookings)
  const handleCancelClick = (booking: Booking) => {
    // Confirmed booking cancellation — use existing cancel dialog
    setBookingToCancel(booking);
    setCancelDialogOpen(true);
  };

  const handleActionSubmit = (params: {
    bookingId: number;
    status: 'confirmed' | 'cancelled';
    storageActions?: Array<{ storageBookingId: number; action: string }>;
    equipmentActions?: Array<{ equipmentBookingId: number; action: string }>;
  }) => {
    updateStatusMutation.mutate(
      { bookingId: params.bookingId, status: params.status, storageActions: params.storageActions, equipmentActions: params.equipmentActions },
      {
        onSettled: () => {
          setActionSheetOpen(false);
          setBookingForAction(null);
        },
      }
    );
  };

  const handleCancelConfirm = () => {
    if (bookingToCancel) {
      updateStatusMutation.mutate({ bookingId: bookingToCancel.id, status: 'cancelled' });
      setCancelDialogOpen(false);
      setBookingToCancel(null);
    }
  };

  const handleCancelAndRefundClick = (booking: Booking) => {
    setBookingToCancelAndRefund(booking);
    setCancelAndRefundDialogOpen(true);
  };

  const handleCancelAndRefundConfirm = () => {
    if (bookingToCancelAndRefund) {
      updateStatusMutation.mutate(
        { bookingId: bookingToCancelAndRefund.id, status: 'cancelled', refundOnCancel: true },
        {
          onSettled: () => {
            setCancelAndRefundDialogOpen(false);
            setBookingToCancelAndRefund(null);
          },
        }
      );
    }
  };

  const handleCancelAndRefundDialogClose = () => {
    setCancelAndRefundDialogOpen(false);
    setBookingToCancelAndRefund(null);
  };

  const handleCancelDialogClose = () => {
    setCancelDialogOpen(false);
    setBookingToCancel(null);
  };

  // Refund mutation
  const refundMutation = useMutation({
    mutationFn: async ({ transactionId, amountCents }: { transactionId: number; amountCents: number }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/revenue/transactions/${transactionId}/refund`, {
        method: 'POST',
        headers,
        credentials: "include",
        body: JSON.stringify({ amount: amountCents, reason: 'Refund issued by manager' }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || mt("failedToProcessRefund"));
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/transactions'] });
      toast({ title: t("refundProcessed"),
        description: t("theRefundHasBeenSuccessfullyProcessed"),
      });
      setRefundDialogOpen(false);
      setBookingToRefund(null);
      setRefundAmount('');
    },
    onError: (error: Error) => {
      toast({ title: t("refundFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRefundClick = (booking: Booking) => {
    setBookingToRefund(booking);
    // Default to full refund amount
    const refundableAmount = (booking as any).refundableAmount || (booking as any).totalPrice || 0;
    setRefundAmount((refundableAmount / 100).toFixed(2));
    setRefundDialogOpen(true);
  };

  const handleRefundConfirm = () => {
    if (bookingToRefund && refundAmount) {
      const amountCents = Math.round(parseFloat(refundAmount) * 100);
      const transactionId = (bookingToRefund as any).transactionId;
      if (transactionId && amountCents > 0) {
        refundMutation.mutate({ transactionId, amountCents });
      } else {
        toast({ title: t("refundError"),
          description: t("noTransactionIDFoundForThisBookingPleaseUseTheRevenueDashboa"),
          variant: "destructive",
        });
      }
    }
  };

  const handleRefundDialogClose = () => {
    setRefundDialogOpen(false);
    setBookingToRefund(null);
    setRefundAmount('');
  };

  // ── Cancellation Request: Accept / Decline ──────────────────────────────
  const cancellationRequestMutation = useMutation({
    mutationFn: async ({ bookingId, action }: { bookingId: number; action: 'accept' | 'decline' }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${bookingId}/cancellation-request`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || mt("failedToProcessCancellation"));
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      if (data?.action === 'accepted') {
        toast({ title: t("cancellationAccepted"),
          description: mt("bookingCancelledUseRefund"),
        });
      } else {
        toast({ title: t("cancellationDeclined"),
          description: t("theBookingRemainsConfirmed"),
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: t("error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAcceptCancellation = (booking: Booking) => {
    cancellationRequestMutation.mutate({ bookingId: booking.id, action: 'accept' });
  };

  const handleDeclineCancellation = (booking: Booking) => {
    cancellationRequestMutation.mutate({ bookingId: booking.id, action: 'decline' });
  };

  // Direct-call versions for PendingCancellationRequests component (has its own confirm dialog)
  const handleAcceptKitchenCancellationById = (bookingId: number) => {
    cancellationRequestMutation.mutate({ bookingId, action: 'accept' });
  };
  const handleDeclineKitchenCancellationById = (bookingId: number) => {
    cancellationRequestMutation.mutate({ bookingId, action: 'decline' });
  };

  // ── Storage Cancellation Request: Accept / Decline ─────────────────────
  const storageCancellationMutation = useMutation({
    mutationFn: async ({ storageBookingId, action }: { storageBookingId: number; action: 'accept' | 'decline' }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-bookings/${storageBookingId}/cancellation-request`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || mt("failedToProcessStorageCancellation"));
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      if (data?.action === 'accepted') {
        toast({ title: t("storageCancellationAccepted"),
          description: mt("storageCancelledUseRefund"),
        });
      } else {
        toast({ title: t("storageCancellationDeclined"),
          description: t("theStorageBookingRemainsConfirmed"),
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: t("error"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAcceptStorageCancellation = (storageBookingId: number) => {
    storageCancellationMutation.mutate({ storageBookingId, action: 'accept' });
  };

  const handleDeclineStorageCancellation = (storageBookingId: number) => {
    storageCancellationMutation.mutate({ storageBookingId, action: 'decline' });
  };

  // ── Management Sheet: Fetch details & open ─────────────────────────────
  const handleManageBooking = async (booking: Booking) => {
    setManagementSheetOpen(true);
    setBookingForManagement(null); // Show loading state
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${booking.id}/details`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Failed to fetch booking details: ${response.status}`);
      const details = await response.json();

      const mgmt: BookingForManagement = {
        id: details.id,
        kitchenName: details.kitchen?.name,
        chefName: details.chef?.fullName || details.chef?.username,
        locationName: details.location?.name,
        bookingDate: details.bookingDate,
        startTime: details.startTime,
        endTime: details.endTime,
        totalPrice: details.totalPrice,
        status: details.status,
        paymentStatus: details.paymentStatus,
        transactionId: details.paymentTransaction?.id || booking.transactionId, // prefer details PT id
        transactionAmount: details.paymentTransaction?.amount,
        stripeProcessingFee: details.paymentTransaction?.stripeProcessingFee,
        managerRevenue: details.paymentTransaction?.managerRevenue,
        serviceFee:
          details.paymentTransaction?.serviceFee ||
          details.serviceFee ||
          booking.serviceFee ||
          0,
        taxRatePercent: details.kitchen?.taxRatePercent ? Number(details.kitchen.taxRatePercent) : undefined,
        refundableAmount:
          (details.paymentTransaction?.managerRevenue || 0) +
            (details.paymentTransaction?.serviceFee || details.serviceFee || booking.serviceFee || 0) ||
          booking.refundableAmount,
        refundAmount: details.paymentTransaction?.refundAmount || booking.refundAmount || 0,
        cancellationRequested: !!details.cancellationRequestedAt,
        cancellationReason: details.cancellationRequestReason,
        storageItems: details.storageBookings?.map((s: any) => ({
          id: s.id,
          storageBookingId: s.id,
          name: s.storageListing?.name || `Storage #${s.storageListingId}`,
          storageType: s.storageListing?.storageType || 'Storage',
          totalPrice: s.totalPrice,
          startDate: s.startDate,
          endDate: s.endDate,
          status: s.status,
          cancellationRequested: !!s.cancellationRequestedAt,
          cancellationReason: s.cancellationRequestReason,
        })),
        equipmentItems: details.equipmentBookings?.map((e: any) => ({
          id: e.id,
          equipmentBookingId: e.id,
          name: e.equipmentListing?.equipmentType || `Equipment #${e.equipmentListingId}`,
          totalPrice: e.totalPrice,
          status: e.status,
        })),
      };
      setBookingForManagement(mgmt);
    } catch (error: any) {
      logger.error('Error fetching management details:', error);
      toast({ title: t("error"), description: t("failedToLoadBookingDetails"), variant: "destructive" });
      setManagementSheetOpen(false);
    }
  };

  // ── Management Sheet: Submit handler (orchestrates API calls) ──────────
  const handleManagementSubmit = async (params: ManagementSubmitParams) => {
    setIsManagementProcessing(true);
    try {
      const headers = await getAuthHeaders();

      switch (params.action) {
        case "cancel-booking": {
          // Cancel entire booking, no refund
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/status`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ status: 'cancelled', storageActions: params.storageActions, equipmentActions: params.equipmentActions }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || mt("failedToCancelBooking")); }
          toast({ title: t("bookingCancelled"), description: mt("useIssueRefundOrManagement") });
          break;
        }
        case "cancel-booking-refund": {
          // Cancel entire booking + auto-refund
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/status`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ status: 'cancelled', refundOnCancel: true, storageActions: params.storageActions, equipmentActions: params.equipmentActions }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || mt("failedToCancelBooking")); }
          const data = await res.json().catch(() => ({}));
          toast({ title: t("bookingCancelledRefunded"),
            description: data?.refund ? mt("refundProcessedAmount", { amount: (data.refund.amount / 100).toFixed(2) }) : mt("bookingCancelledWithRefund"),
          });
          break;
        }
        case "partial-cancel":
        case "partial-cancel-refund": {
          // Cancel only addons (keep kitchen confirmed)
          const statusRes = await fetch(`/api/manager/bookings/${params.bookingId}/status`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ status: 'confirmed', storageActions: params.storageActions, equipmentActions: params.equipmentActions }),
          });
          if (!statusRes.ok) { const d = await statusRes.json().catch(() => ({})); throw new Error(d.error || mt("failedToUpdateBooking")); }

          // If refund requested, issue it separately
          if (params.action === "partial-cancel-refund" && params.refundAmountCents && params.refundAmountCents > 0 && bookingForManagement?.transactionId) {
            const refundRes = await fetch(`/api/manager/revenue/transactions/${bookingForManagement.transactionId}/refund`, {
              method: 'POST', headers, credentials: "include",
              body: JSON.stringify({ amount: params.refundAmountCents, reason: 'Partial cancellation refund' }),
            });
            if (!refundRes.ok) { const d = await refundRes.json().catch(() => ({})); throw new Error(d.error || mt("itemsCancelledRefundFailed")); }
            toast({ title: t("itemsCancelledRefunded"), description: `Refund of $${(params.refundAmountCents / 100).toFixed(2)} processed.` });
          } else {
            toast({ title: t("itemsCancelled"), description: t("selectedItemsHaveBeenCancelled") });
          }
          break;
        }
        case "refund-only": {
          if (!bookingForManagement?.transactionId || !params.refundAmountCents) {
            throw new Error(mt("noTransactionForRefund"));
          }
          const res = await fetch(`/api/manager/revenue/transactions/${bookingForManagement.transactionId}/refund`, {
            method: 'POST', headers, credentials: "include",
            body: JSON.stringify({ amount: params.refundAmountCents, reason: 'Refund issued by manager' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || mt("failedToProcessRefund")); }
          toast({ title: t("refundProcessed"), description: `$${(params.refundAmountCents / 100).toFixed(2)} refunded to chef.` });
          break;
        }
        case "accept-cancellation": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'accept' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || mt("failedToAcceptCancellation")); }
          toast({ title: t("cancellationAccepted"), description: t("toastBookingCancelledPerChefRequest") });
          break;
        }
        case "decline-cancellation": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'decline' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || mt("failedToDeclineCancellation")); }
          toast({ title: t("cancellationDeclined"), description: t("bookingRemainsConfirmed") });
          break;
        }
        case "accept-storage-cancel": {
          if (!params.storageCancellationId) throw new Error(mt("noStorageBookingId"));
          const res = await fetch(`/api/manager/storage-bookings/${params.storageCancellationId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'accept' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || mt("failedToAcceptStorageCancellation")); }
          toast({ title: t("storageCancellationAccepted"), description: t("storageBookingCancelled") });
          break;
        }
        case "decline-storage-cancel": {
          if (!params.storageCancellationId) throw new Error(mt("noStorageBookingId"));
          const res = await fetch(`/api/manager/storage-bookings/${params.storageCancellationId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'decline' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || mt("failedToDeclineStorageCancellation")); }
          toast({ title: t("storageCancellationDeclined"), description: t("storageBookingRemainsActive") });
          break;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/transactions'] });
      setManagementSheetOpen(false);
      setBookingForManagement(null);
    } catch (error: any) {
      toast({ title: t("error"), description: error.message || mt("somethingWentWrong"), variant: "destructive" });
    } finally {
      setIsManagementProcessing(false);
    }
  };

  // Categorize bookings by timezone-aware timeline (Upcoming, Past)
  // Confirmed bookings go into Upcoming category
  const { upcomingBookings, pastBookings } = useMemo(() => {
    const upcoming: Booking[] = [];
    const past: Booking[] = [];

    bookings.forEach((booking: Booking) => {
      if (!booking.bookingDate || !booking.startTime || !booking.endTime) return;
      if (booking.status === 'cancelled') {
        past.push(booking); // Cancelled bookings go to past
        return;
      }

      const timezone = booking.locationTimezone || DEFAULT_TIMEZONE;
      const bookingDateStr = booking.bookingDate.split('T')[0];

      try {
        // Timeline is the PRIMARY factor - status does NOT override timeline
        // Check if booking end time has passed - if yes, it's past (regardless of status)
        if (isBookingPast(bookingDateStr, booking.endTime, timezone)) {
          past.push(booking);
        }
        // Check if booking start time is in the future - if yes, it's upcoming
        else if (isBookingUpcoming(bookingDateStr, booking.startTime, timezone)) {
          upcoming.push(booking);
        }
        // If booking is currently happening (between start and end), check more carefully
        else {
          // Booking start time has passed but end time hasn't - check if it's very recent
          const bookingEndDateTime = createBookingDateTime(bookingDateStr, booking.endTime, timezone);
          const now = getNowInTimezone(timezone);

          // If end time is very close (within 1 hour), it might have just ended - use end time to decide
          const hoursSinceEnd = (now.getTime() - bookingEndDateTime.getTime()) / (1000 * 60 * 60);

          // If end time passed more than 1 hour ago, it's definitely past
          if (hoursSinceEnd > 1) {
            past.push(booking);
          } else {
            // Very recent or currently happening - treat as upcoming
            upcoming.push(booking);
          }
        }
      } catch (error) {
        // If timezone check fails, fall back to simple date comparison using end time
        try {
          const dateStr = booking.bookingDate.split('T')[0];
          const bookingEndDateTime = new Date(`${dateStr}T${booking.endTime}`);
          if (bookingEndDateTime < new Date()) {
            past.push(booking);
          } else {
            upcoming.push(booking);
          }
        } catch (fallbackError) {
          // Last resort: use booking date only
          const bookingDate = new Date(booking.bookingDate);
          if (bookingDate < new Date()) {
            past.push(booking);
          } else {
            upcoming.push(booking);
          }
        }
      }
    });

    // Sort using each booking's location timezone so two bookings in
    // different time zones compare at their actual UTC instants rather than
    // being aligned to the browser's local midnight.
    const toStartMs = (bk: Booking): number => {
      const dateStr = bk.bookingDate.split('T')[0];
      const tz = bk.locationTimezone || DEFAULT_TIMEZONE;
      return createBookingDateTime(dateStr, bk.startTime, tz).getTime();
    };
    upcoming.sort((a, b) => toStartMs(a) - toStartMs(b));
    past.sort((a, b) => toStartMs(b) - toStartMs(a));

    return { upcomingBookings: upcoming, pastBookings: past };
  }, [bookings]);

  // Filter bookings based on status filter, location filter and time category
  const filteredBookings = useMemo(() => {
    let filtered: Booking[] = [];

    if (statusFilter === 'all') {
      // Show all bookings in timeline order: Upcoming, Past
      filtered = [...upcomingBookings, ...pastBookings];
    } else if (statusFilter === 'upcoming') {
      // Show only upcoming bookings (includes confirmed bookings)
      filtered = upcomingBookings;
    } else if (statusFilter === 'past') {
      // Show only past bookings
      filtered = pastBookings;
    } else {
      // Filter by status (pending, cancelled)
      filtered = bookings.filter((booking: Booking) => booking.status === statusFilter);
    }

    // Apply location filter if not 'all'
    if (locationFilter !== 'all') {
      filtered = filtered.filter((booking: Booking) => booking.locationName === locationFilter);
    }

    // Apply search filter (includes reference code for lookup)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((booking: Booking) => {
        const searchableText = [
          booking.referenceCode || '',
          booking.id.toString(),
          booking.chefName || '',
          booking.kitchenName || '',
          booking.locationName || '',
        ].join(' ').toLowerCase();
        return searchableText.includes(query);
      });
    }

    return filtered;
  }, [bookings, statusFilter, locationFilter, searchQuery, upcomingBookings, pastBookings]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      confirmed: 'bg-green-100 text-green-800 border-green-300',
      cancelled: 'bg-red-100 text-red-800 border-red-300',
    };
    const icons = {
      pending: <Clock className="h-4 w-4" />,
      confirmed: <CheckCircle className="h-4 w-4" />,
      cancelled: <XCircle className="h-4 w-4" />,
    };
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {icons[status as keyof typeof icons]}
        <span className="font-medium capitalize">{status}</span>
      </div>
    );
  };

  const content = (
    <main className={embedded ? "flex-1 py-4 sm:py-6" : "flex-1 pt-20 sm:pt-24 pb-6 sm:pb-8"}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("bookingRequests")}</h1>
          <p className="text-gray-600 mt-2">{t("reviewAndManageChefBookingRequests")}</p>
        </div>

        {/* Location Filter (shown only when multiple locations exist) */}
        {locations.length > 1 && (
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-medium text-gray-700">{t("location2")}</label>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">{t("cmdAllLocations")}</option>
              {locations.map((loc: any) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Search Input */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("searchByRefCodeBookingIDChef")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full mb-6">
          <TabsList className="w-full gap-1">
            {[
              { key: 'all', label: mt("filterAll") },
              { key: 'upcoming', label: mt("upcoming") },
              { key: 'past', label: mt("past") },
              { key: 'pending', label: tt("pending") },
              { key: 'cancelled', label: tt("cancelled") },
            ].map((filter) => {
              const baseBookings = locationFilter === 'all'
                ? bookings
                : bookings.filter((b: Booking) => b.locationName === locationFilter);

              let count = 0;
              if (filter.key === 'all') {
                count = baseBookings.length;
              } else if (filter.key === 'upcoming') {
                count = upcomingBookings.filter((b: Booking) => locationFilter === 'all' || b.locationName === locationFilter).length;
              } else if (filter.key === 'past') {
                count = pastBookings.filter((b: Booking) => locationFilter === 'all' || b.locationName === locationFilter).length;
              } else {
                count = baseBookings.filter((b: Booking) => b.status === filter.key).length;
              }

              return (
                <TabsTrigger key={filter.key} value={filter.key} className="flex-1 text-xs sm:text-sm px-2 py-1.5">
                  {filter.label} <Badge variant="count" className="ml-1">{count}</Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Bookings List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-4">
            <DataTable
              columns={getBookingColumns({
                onConfirm: () => {},
                onReject: handleCancelClick,
                onCancel: handleCancelClick,
                onRefund: handleRefundClick,
                onCancelAndRefund: handleCancelAndRefundClick,
                onAcceptCancellation: handleAcceptCancellation,
                onDeclineCancellation: handleDeclineCancellation,
                onAcceptStorageCancellation: handleAcceptStorageCancellation,
                onDeclineStorageCancellation: handleDeclineStorageCancellation,
                onTakeAction: (booking) => {
                  if (!hasApprovedLicense) {
                    toast({ title: t("licenseNotApproved"),
                      description: t("yourKitchenLicenseMustBeApprovedByAnAdminBeforeYouCanConfirm"),
                      variant: "destructive",
                    });
                    return;
                  }
                  handleTakeAction(booking as any);
                },
                onManageBooking: (booking) => handleManageBooking(booking as any),
                hasApprovedLicense
              })}
              data={filteredBookings}
              filterColumn="chefName" // filter by Chef name by default
              filterPlaceholder={mt("filterByChef")}
              defaultSorting={[{ id: 'createdAt', desc: true }]}
              initialColumnVisibility={{ createdAt: false }}
              pageSize={15}
            />
          </div>
        )}

        {/* Cancellation Requests + Storage Extensions — side-by-side below bookings */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <PendingCancellationRequests
            bookings={bookings as any}
            onAcceptKitchenCancellation={handleAcceptKitchenCancellationById}
            onDeclineKitchenCancellation={handleDeclineKitchenCancellationById}
            onAcceptStorageCancellation={handleAcceptStorageCancellation}
            onDeclineStorageCancellation={handleDeclineStorageCancellation}
            isProcessing={cancellationRequestMutation.isPending || storageCancellationMutation.isPending}
          />
          <StorageExtensionApprovals />
        </div>
      </div>

      {/* Cancellation Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {bookingToCancel?.status === 'pending' ? mt("rejectBookingRequest") : mt("cancelBookingConfirmation")}
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-4">
              <div className="space-y-3">
                <p className="font-medium">
                  {bookingToCancel?.status === 'pending'
                    ? mt("rejectRequestConfirm")
                    : mt("cancelBookingConfirm")}
                </p>
                {bookingToCancel?.status === 'pending' ? (
                  <p className="text-sm text-muted-foreground">{t("theCustomerWillReceiveAnAutomaticRefundMinusNonRefundableStr")}</p>
                ) : (
                  <p className="text-sm text-orange-600 font-medium">
                    ⚠️ {mt("refundsNotAutomaticConfirmed")}
                  </p>
                )}
                {bookingToCancel && (
                  <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t("chef2")}</span>
                      <span>{bookingToCancel.chefName || mt("chefNumber", { id: bookingToCancel.chefId })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t("kitchen2")}</span>
                      <span>{bookingToCancel.kitchenName || mt("kitchenHeader")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t("date2")}</span>
                      <span>{formatDate(bookingToCancel.bookingDate)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t("time2")}</span>
                      <span>
                        {(() => {
                          const rawSlots = bookingToCancel.selectedSlots as Array<string | { startTime: string; endTime: string }> | undefined;
                          if (rawSlots && rawSlots.length > 0) {
                            // Normalize slots to handle both old string format and new object format
                            const normalizeSlot = (slot: string | { startTime: string; endTime: string }) => {
                              if (typeof slot === 'string') {
                                const [h, m] = slot.split(':').map(Number);
                                const endMins = h * 60 + m + 60;
                                const endH = Math.floor(endMins / 60);
                                const endM = endMins % 60;
                                return { startTime: slot, endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}` };
                              }
                              return slot;
                            };
                            const normalized = rawSlots.map(normalizeSlot).filter(s => s.startTime && s.endTime);
                            const sorted = [...normalized].sort((a, b) => a.startTime.localeCompare(b.startTime));
                            // Check if contiguous
                            let isContiguous = true;
                            for (let i = 1; i < sorted.length; i++) {
                              if (sorted[i - 1].endTime !== sorted[i].startTime) {
                                isContiguous = false;
                                break;
                              }
                            }
                            if (!isContiguous) {
                              return sorted.map(s => `${formatTime(s.startTime)}-${formatTime(s.endTime)}`).join(', ');
                            }
                          }
                          return `${formatTime(bookingToCancel.startTime)} - ${formatTime(bookingToCancel.endTime)}`;
                        })()}
                      </span>
                    </div>
                  </div>
                )}
                <p className="text-muted-foreground mt-3">{t("theChefWillBeNotifiedViaEmail")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDialogClose}>{t("keepBooking")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelConfirm}
              className="bg-destructive hover:bg-destructive/90 focus:ring-destructive"
              disabled={updateStatusMutation.isPending}
            >
              {updateStatusMutation.isPending ? mt("processingEllipsis") : (bookingToCancel?.status === 'pending' ? mt("rejectRequest") : mt("yesCancelBooking"))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unified Booking Action Sheet (for pending/authorized bookings) */}
      <BookingActionSheet
        open={actionSheetOpen}
        onOpenChange={(open) => {
          setActionSheetOpen(open);
          if (!open) setBookingForAction(null);
        }}
        booking={bookingForAction}
        isLoading={updateStatusMutation.isPending}
        onSubmit={handleActionSubmit}
      />

      {/* Booking Management Sheet (for confirmed/paid bookings) */}
      <BookingManagementSheet
        open={managementSheetOpen}
        onOpenChange={(open) => {
          setManagementSheetOpen(open);
          if (!open) setBookingForManagement(null);
        }}
        booking={bookingForManagement}
        isProcessing={isManagementProcessing}
        onSubmit={handleManagementSubmit}
      />

      {/* Refund Dialog */}
      <AlertDialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-600">{t("issueRefund")}</AlertDialogTitle>
            <AlertDialogDescription className="pt-4">
              <div className="space-y-4">
                <p className="font-medium">{t("enterTheRefundAmountForThisBooking")}</p>
                {bookingToRefund && (
                  <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t("chef2")}</span>
                      <span>{bookingToRefund.chefName || mt("chefNumber", { id: bookingToRefund.chefId })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t("kitchen2")}</span>
                      <span>{bookingToRefund.kitchenName || mt("kitchenHeader")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t("totalCharged2")}</span>
                      <span>${((bookingToRefund.transactionAmount || bookingToRefund.totalPrice || 0) / 100).toFixed(2)}</span>
                    </div>
                    {(bookingToRefund.refundAmount || 0) > 0 && (
                      <div className="flex items-center gap-2 text-orange-600">
                        <span className="font-medium">{t("alreadyRefunded2")}</span>
                        <span>${((bookingToRefund.refundAmount || 0) / 100).toFixed(2)}</span>
                      </div>
                    )}
                    {/* Max refundable includes platform service fee; Stripe fee is sunk */}
                    <div className="border-t pt-3 mt-3 space-y-2">
                      {(bookingToRefund.stripeProcessingFee || 0) > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{t("stripeFeeNonRefundable")}</span>
                          <span>${((bookingToRefund.stripeProcessingFee || 0) / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between font-semibold text-green-600 bg-green-50 p-2 rounded-md">
                        <span>{t("availableToRefund")}</span>
                        <span>${((bookingToRefund.refundableAmount || 0) / 100).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Refund Input with Real-time Preview */}
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="refundAmount">{t("refundAmount")}</Label>
                    <CurrencyInput
                      id="refundAmount"
                      value={refundAmount}
                      onValueChange={setRefundAmount}
                      placeholder="0.00"
                    />
                  </div>
                  
                  {/* Real-time Refund Preview */}
                  {refundAmount && parseFloat(refundAmount) > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                      <div className="text-sm font-medium text-blue-800">{t("refundPreview")}</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700">{t("customerReceives")}</span>
                          <span className="font-semibold text-blue-900">${parseFloat(refundAmount).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700">{t("yourAccountDebited")}</span>
                          <span className="font-semibold text-blue-900">${parseFloat(refundAmount).toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="text-xs text-blue-600 mt-1">
                        ✓ {mt("sameAmountRefundNote")}
                      </div>
                    </div>
                  )}
                </div>
                
                <p className="text-muted-foreground text-xs">
                  {mt("refundArrivalNote")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleRefundDialogClose}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRefundConfirm}
              className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500"
              disabled={refundMutation.isPending || !refundAmount || parseFloat(refundAmount) <= 0}
            >
              {refundMutation.isPending ? mt("processingEllipsis") : mt("processRefund")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel & Refund Sheet */}
      <Sheet open={cancelAndRefundDialogOpen} onOpenChange={setCancelAndRefundDialogOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {mt("cancelAndRefundBooking")}
            </SheetTitle>
            <SheetDescription>{t("cancelThisBookingAndRefundTheChefUpToYourAvailableBalance")}</SheetDescription>
          </SheetHeader>

          {bookingToCancelAndRefund && (
            <div className="space-y-4 py-4">
              {/* Booking Details */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("chef")}</span>
                  <span className="font-medium">{bookingToCancelAndRefund.chefName || mt("chefNumber", { id: bookingToCancelAndRefund.chefId })}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("kitchen")}</span>
                  <span className="font-medium">{bookingToCancelAndRefund.kitchenName || mt("kitchenHeader")}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("date")}</span>
                  <span className="font-medium">{formatDate(bookingToCancelAndRefund.bookingDate)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("time")}</span>
                  <span className="font-medium">
                    {formatTime(bookingToCancelAndRefund.startTime)} - {formatTime(bookingToCancelAndRefund.endTime)}
                  </span>
                </div>
              </div>

              <Separator />

              {/* Refund breakdown — includes platform service fee; Stripe fee is sunk */}
              <div className="space-y-2 text-sm">
                <p className="font-medium text-sm">{t("refundBreakdown")}</p>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("totalChargedToChef")}</span>
                  <span>${((bookingToCancelAndRefund.transactionAmount || bookingToCancelAndRefund.totalPrice || 0) / 100).toFixed(2)}</span>
                </div>
                {(bookingToCancelAndRefund.managerRevenue || 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("yourRevenueAfterFees")}</span>
                    <span>${((bookingToCancelAndRefund.managerRevenue || 0) / 100).toFixed(2)}</span>
                  </div>
                )}
                {(bookingToCancelAndRefund.refundAmount || 0) > 0 && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{t("alreadyRefunded")}</span>
                    <span>-${((bookingToCancelAndRefund.refundAmount || 0) / 100).toFixed(2)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex items-center justify-between font-semibold text-green-700 bg-green-50 p-2 rounded-md">
                  <span>{t("maxRefundYourAvailableBalance")}</span>
                  <span>${((bookingToCancelAndRefund.refundableAmount || bookingToCancelAndRefund.managerRemainingBalance || 0) / 100).toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t("youCanOnlyRefundUpToWhatYouReceivedStripeProcessingFeesAreAS")}</p>
              </div>

              <Separator />

              <p className="text-xs text-muted-foreground">{t("theChefWillBeNotifiedViaEmailRefundsTypicallyArriveWithin510")}</p>
            </div>
          )}

          <SheetFooter className="flex flex-row gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCancelAndRefundDialogClose}
              disabled={updateStatusMutation.isPending}
            >{t("keepBooking")}</Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleCancelAndRefundConfirm}
              disabled={updateStatusMutation.isPending}
            >
              {updateStatusMutation.isPending ? mt("processingEllipsis") : mt("cancelAndRefundBooking")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </main>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ManagerHeader />
      {content}
    </div>
  );
}

