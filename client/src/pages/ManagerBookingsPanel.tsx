import { fetchManagerBookings } from "@/lib/manager-bookings-query";
import { CancellationRefundReview } from '@/components/booking/CancellationRefundReview';
import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { mt } from "@/i18n/manager";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ManagerShell } from "@/layouts/ManagerShell";
import { PendingCancellationRequests } from "@/components/manager/PendingCancellationRequests";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { ManagerBookingsAgenda } from "@/components/manager/bookings/ManagerBookingsAgenda";
import type { Booking } from "@/components/manager/bookings/ManagerBookingPayment";
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
  onGoToKitchens?: () => void;
}

export default function ManagerBookingsPanel({ embedded = false, onGoToKitchens }: ManagerBookingsPanelProps = {}) {
  const [, navigate] = useLocation();
  const { t } = useTranslation("manager");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, kitchens } = useManagerDashboard();
  const [refundReviewScope, setRefundReviewScope] = useState<{ kind: 'storage' | 'equipment'; id: number } | undefined>();
  const [refundReviewId, setRefundReviewId] = useState<number | null>(null);
  // Check if any location has approved license
  const hasApprovedLicense = locations.some((loc: any) => loc.kitchenLicenseStatus === 'approved');

  // Fetch all bookings for this manager with real-time polling
  const { data: bookings = [], isLoading, error: bookingsError, refetch: refetchBookings } = useQuery({
    queryKey: ['managerBookings'],
    queryFn: fetchManagerBookings,
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
          <ManagerBookingsAgenda bookings={bookings as Booking[]} onReviewRequest={(booking) => {
            if (!hasApprovedLicense) {
              toast({ title: t("licenseNotApproved"),
                description: t("yourKitchenLicenseMustBeApprovedByAnAdminBeforeYouCanConfirm"),
                variant: "destructive",
              });
              return;
            }
            // Requests are answered on their own page.
            navigate(`/manager/booking/${booking.id}/review`);
          }} />
        )}

        {/* Cancellation requests — side-by-side grid kept for future panels; empty when none. */}
        {/* Storage-item requests only (kitchen cancellation requests are rows under "Needs action"); nothing when empty. */}
        <div className="mt-8 grid grid-cols-1 gap-6 empty:hidden lg:grid-cols-2">
          <PendingCancellationRequests
            storageOnly
            hideWhenEmpty
            bookings={bookings as any}
            onAcceptKitchenCancellation={handleAcceptKitchenCancellationById}
            onDeclineKitchenCancellation={handleDeclineKitchenCancellationById}
            onAcceptStorageCancellation={handleAcceptStorageCancellation}
            onDeclineStorageCancellation={handleDeclineStorageCancellation}
            isProcessing={cancellationRequestMutation.isPending || storageCancellationMutation.isPending}
          />
        </div>
      </div>


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
