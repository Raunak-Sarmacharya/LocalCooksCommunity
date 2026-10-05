import { CancellationRefundReview } from '@/components/booking/CancellationRefundReview';
import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { tt } from "@/i18n/common-ns";
import { mt } from "@/i18n/manager";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, X } from "@/components/ui/manager-icons";
import { useToast } from "@/hooks/use-toast";
import { ManagerShell } from "@/layouts/ManagerShell";
import { StorageExtensionApprovals } from "@/components/manager/StorageExtensionApprovals";
import { PendingCancellationRequests } from "@/components/manager/PendingCancellationRequests";
import { BookingActionDialog, type BookingForAction } from "@/components/manager/bookings/BookingActionDialog";
import { kitchenBookingBlocks } from "@/lib/kitchen-booking-blocks";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDialogContent } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DEFAULT_TIMEZONE, isBookingUpcoming, isBookingPast, createBookingDateTime, getNowInTimezone } from "@/utils/timezone-utils";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { DataTable } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { getBookingColumns, Booking } from "@/components/manager/bookings/columns";
import { auth } from "@/lib/firebase";
import { calendarDateForOperatingTime, sortTimesInOperatingWindow } from "@shared/operating-hours";

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
  onGoToKitchens?: () => void;
}

export default function ManagerBookingsPanel({ embedded = false, onGoToKitchens }: ManagerBookingsPanelProps = {}) {
  const { t } = useTranslation("manager");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, kitchens } = useManagerDashboard();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refundReviewScope, setRefundReviewScope] = useState<{ kind: 'storage' | 'equipment'; id: number } | undefined>();
  const [refundReviewId, setRefundReviewId] = useState<number | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [bookingForAction, setBookingForAction] = useState<BookingForAction | null>(null);
  const [isLoadingActionDetails, setIsLoadingActionDetails] = useState(false);
  // Check if any location has approved license
  const hasApprovedLicense = locations.some((loc: any) => loc.kitchenLicenseStatus === 'approved');

  // Fetch all bookings for this manager with real-time polling
  const { data: bookings = [], isLoading, error: bookingsError, refetch: refetchBookings } = useQuery({
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
    mutationFn: async ({ bookingId, status, storageActions, equipmentActions }: { bookingId: number; status: string; storageActions?: Array<{ storageBookingId: number; action: string }>; equipmentActions?: Array<{ equipmentBookingId: number; action: string }> }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${bookingId}/status`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ status, storageActions, equipmentActions }),
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

  // ENTERPRISE STANDARD: Fetch full booking details before opening action dialog.
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
      selectedSlots: details.selectedSlots,
      operatingWindowStartTime: details.operatingWindowStartTime,
      totalPrice: details.totalPrice,
      transactionAmount: details.paymentTransaction?.amount,
      serviceFee: details.paymentTransaction?.serviceFee,
      stripeProcessingFee: details.paymentTransaction?.stripeProcessingFee,
      managerRevenue: details.paymentTransaction?.managerRevenue,
      taxRatePercent: details.kitchen?.taxRatePercent ? Number(details.kitchen.taxRatePercent) : undefined,
      // Include ALL items with rejected flag so action dialog shows full audit trail
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

  // Single "Take Action" handler — fetches full details then opens the unified action dialog
  const handleTakeAction = async (booking: Booking) => {
    setIsLoadingActionDetails(true);
    setActionDialogOpen(true);
    try {
      const actionData = await fetchBookingDetailsForAction(booking.id);
      setBookingForAction(actionData);
    } catch (error: any) {
      logger.error('Error fetching booking details for action dialog:', error);
      toast({ title: t("error"),
        description: t("failedToLoadBookingDetailsPleaseTryAgain"),
        variant: "destructive",
      });
      setActionDialogOpen(false);
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
          setActionDialogOpen(false);
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

  const handleCancelDialogClose = () => {
    setCancelDialogOpen(false);
    setBookingToCancel(null);
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
    setRefundReviewScope(undefined); setRefundReviewId(booking.id);
  };

  const handleDeclineCancellation = (booking: Booking) => {
    cancellationRequestMutation.mutate({ bookingId: booking.id, action: 'decline' });
  };

  // Direct-call versions for PendingCancellationRequests component (has its own confirm dialog)
  const handleAcceptKitchenCancellationById = (bookingId: number) => {
    setRefundReviewScope(undefined); setRefundReviewId(bookingId);
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
    const parent = bookings.find((booking: Booking) => (booking.storageItems || []).some(item => item.storageBookingId === storageBookingId));
    if (parent) { setRefundReviewScope({ kind: 'storage', id: storageBookingId }); setRefundReviewId(parent.id); }
  };

  const handleDeclineStorageCancellation = (storageBookingId: number) => {
    storageCancellationMutation.mutate({ storageBookingId, action: 'decline' });
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
      const startDate = booking.operatingWindowStartTime
        ? calendarDateForOperatingTime(bookingDateStr, booking.startTime, booking.operatingWindowStartTime) : bookingDateStr;
      const endDate = booking.operatingWindowStartTime
        ? calendarDateForOperatingTime(bookingDateStr, booking.endTime, booking.operatingWindowStartTime)
        : booking.endTime <= booking.startTime ? calendarDateForOperatingTime(bookingDateStr, '00:00', '23:00') : bookingDateStr;

      try {
        // Timeline is the PRIMARY factor - status does NOT override timeline
        // Check if booking end time has passed - if yes, it's past (regardless of status)
        if (isBookingPast(endDate, booking.endTime, timezone)) {
          past.push(booking);
        }
        // Check if booking start time is in the future - if yes, it's upcoming
        else if (isBookingUpcoming(startDate, booking.startTime, timezone)) {
          upcoming.push(booking);
        }
        // If booking is currently happening (between start and end), check more carefully
        else {
          // Booking start time has passed but end time hasn't - check if it's very recent
          const bookingEndDateTime = createBookingDateTime(endDate, booking.endTime, timezone);
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
          const bookingEndDateTime = new Date(`${endDate}T${booking.endTime}`);
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
      const startDate = bk.operatingWindowStartTime
        ? calendarDateForOperatingTime(dateStr, bk.startTime, bk.operatingWindowStartTime) : dateStr;
      return createBookingDateTime(startDate, bk.startTime, tz).getTime();
    };
    upcoming.sort((a, b) => toStartMs(a) - toStartMs(b));
    past.sort((a, b) => toStartMs(b) - toStartMs(a));

    return { upcomingBookings: upcoming, pastBookings: past };
  }, [bookings]);

  // Filter bookings by status, time category, and search.
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
  }, [bookings, statusFilter, searchQuery, upcomingBookings, pastBookings]);

  // Counts behind the status filter cards.
  const statusFilterOptions = useMemo(() => {
    const countFor = (key: string): number => {
      if (key === 'upcoming') return upcomingBookings.length;
      if (key === 'past') return pastBookings.length;
      if (key === 'pending' || key === 'cancelled') return bookings.filter((b: Booking) => b.status === key).length;
      return bookings.length;
    };

    return [
      { key: 'all', label: mt("filterAll") },
      { key: 'upcoming', label: mt("upcoming") },
      { key: 'past', label: mt("past") },
      { key: 'pending', label: tt("pending") },
      { key: 'cancelled', label: tt("cancelled") },
    ].map((filter) => ({ ...filter, count: countFor(filter.key) }));
  }, [bookings, upcomingBookings, pastBookings]);

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

  /*
   * A plain div now, not a main element — the shell owns the main element, the page gutters and the
   * page heading. This used to carry `pt-20 sm:pt-24` to clear the fixed `ManagerHeader`, its own
   * `container` padding, and its own `text-3xl` heading in raw palette greys: three things the
   * shell already does, done a second time.
   */
  const content = (
    <div className={embedded ? "flex-1" : undefined}>
      {refundReviewId !== null && <CancellationRefundReview bookingId={refundReviewId} scope={refundReviewScope} open onOpenChange={value => { if (!value) setRefundReviewId(null); }} />}
      <div className={embedded ? "w-full" : undefined}>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-md">
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

        {/* Status filter - the same clickable stat-card pattern as the damage-claim and overstay queues */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statusFilterOptions.map((filter) => {
            const isActive = statusFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={isActive}
                className={isActive
                  ? "rounded-xl border border-primary bg-primary/[0.04] p-4 text-left transition-colors"
                  : "rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"}
              >
                <p className="text-xs text-muted-foreground">{filter.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{filter.count}</p>
              </button>
            );
          })}
        </div>

        {/* Bookings List */}
        {isLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading bookings">
            <Skeleton className="h-11 w-full rounded-xl" />
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : bookingsError ? (
          <Card className="border-destructive/40"><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-destructive">{mt("overviewActivityError")}</p>
            <Button variant="outline" size="sm" onClick={() => void refetchBookings()}>{mt("retry")}</Button>
          </CardContent></Card>
        ) : bookings.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-medium">{mt("noBookingsYet")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{mt("bookingsEmptyBody")}</p>
            {!kitchens.some((kitchen) => kitchen.listingStatus === "active") && <Button variant="outline" size="sm" onClick={onGoToKitchens ?? (() => { window.location.href = "/manager/booking-dashboard?view=kitchens" })}>
              {mt(kitchens.length ? "overviewReviewListing" : "addYourKitchen")}
            </Button>}
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            <DataTable
              columns={getBookingColumns({
                onConfirm: () => {},
                onReject: handleCancelClick,
                onCancel: handleCancelClick,
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
                onManageBooking: (booking) => { window.location.href = `/manager/booking/${booking.id}`; },
                hasApprovedLicense
              })}
              data={filteredBookings}
              onRowClick={(booking) => {
                window.location.href = `/manager/booking/${booking.id}`;
              }}
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
                                return { startTime: slot, endTime: `${(endH % 24).toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}` };
                              }
                              return slot;
                            };
                            const normalized = rawSlots.map(normalizeSlot).filter(s => s.startTime && s.endTime);
                            const sortedTimes = sortTimesInOperatingWindow(normalized.map(s => s.startTime), bookingToCancel.operatingWindowStartTime || bookingToCancel.startTime);
                            const sorted = sortedTimes.map(time => normalized.find(s => s.startTime === time)!);
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

      {/* Unified Booking Action Dialog (for pending/authorized bookings) */}
      <BookingActionDialog
        open={actionDialogOpen}
        onOpenChange={(open) => {
          setActionDialogOpen(open);
          if (!open) setBookingForAction(null);
        }}
        booking={bookingForAction}
        isLoading={updateStatusMutation.isPending}
        onSubmit={handleActionSubmit}
      />

      {/* Booking Management Dialog (for confirmed/paid bookings) */}




    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <ManagerShell
      activeView="bookings"
      title={t("bookingRequests")}
      description={t("reviewAndManageChefBookingRequests")}
    >
      {content}
    </ManagerShell>
  );
}
