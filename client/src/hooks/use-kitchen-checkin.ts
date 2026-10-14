import type { BookingCloseout, VisitCloseout } from '@shared/clock-closeout';
import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { createBookingDateTime, DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { calendarDateForBookingTime } from '@shared/operating-hours';
import { VisitDutyValidationError, type VisitDuties } from '@shared/visit-duties';
import type { ChefVisitCodeState, VisitCodeErrorCode } from '@shared/visit-code';
import type { RunningLateState } from '@shared/running-late';

/** Arrival rejected by the visit-code gate. Carries the stable server code; never the code itself. */
export class VisitCodeError extends VisitDutyValidationError {
  constructor(message: string, public code: VisitCodeErrorCode, public attemptsLeft?: number) {
    super(message, {});
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type KitchenCheckinStatus =
  | "not_checked_in"
  | "checked_in"
  | "checkout_requested"
  | "checked_out"
  | "no_show"
  | "checkout_claim_filed";

export interface CheckinStatusData {
  closeout?: BookingCloseout;
  visitCloseout?: VisitCloseout;
  visitDuties?: VisitDuties;
  currentVisitDuties?: VisitDuties;
  checkoutReviewDeadline?: string | null;
  checkinEnabled?: boolean;
  checkoutEnabled?: boolean;
  id: number;
  chefId: number;
  kitchenId: number;
  locationId: number;
  status: string;
  checkinStatus: KitchenCheckinStatus | null;
  checkedInAt: string | null;
  checkedInMethod: string | null;
  checkoutRequestedAt: string | null;
  checkedOutAt: string | null;
  checkoutApprovedAt: string | null;
  noShowDetectedAt: string | null;
  actualStartTime: string | null;
  actualEndTime: string | null;
  checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null;
  checkoutChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  // Authoritative timezone for the check-in window. Defaults to Newfoundland
  // if the server doesn't send it, but server now always includes it.
  timezone?: string | null;
  // Location-aware windows mirrored from the server so client + server agree
  // on exactly when the check-in button should be enabled.
  checkinWindowMinutesBefore?: number;
  noShowGraceMinutes?: number;
  visits?: Array<{
    id: number;
    blockIndex: number;
    closeout?: VisitCloseout;
    startTime: string;
    endTime: string;
    checkinStatus: KitchenCheckinStatus;
    checkedInAt: string | null;
    checkoutRequestedAt: string | null;
    checkedOutAt: string | null;
    checkoutApprovedAt: string | null;
    noShowDetectedAt: string | null;
    checkoutReviewDeadline?: string | null;
    checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null;
    checkoutChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null;
    visitCode?: ChefVisitCodeState | null;
    /** Missing = released (older server). Instruction text is null before release. */
    instructionsReleased?: boolean;
    instructionsReleaseAt?: string;
  }>;
  visitId?: number;
  /** Visit-code projection for the booking-level target. Null/absent for legacy bookings. */
  visitCode?: ChefVisitCodeState | null;
  instructionsReleased?: boolean;
  instructionsReleaseAt?: string;
  /** The chef's latest "running late" heads-up to the kitchen, if any. */
  runningLate?: RunningLateState | null;
}

interface CheckinResult {
  success: boolean;
  error?: string;
  checkinStatus?: KitchenCheckinStatus;
}

interface CheckoutResult {
  success: boolean;
  error?: string;
  checkinStatus?: KitchenCheckinStatus;
}

// ─── Auth Helper ──────────────────────────────────────────────────────────────

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
  return { "Content-Type": "application/json" };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useKitchenCheckin(bookingId: number | null, selectedVisitId?: number | null) {
  const queryClient = useQueryClient();

  // Fetch check-in status for a specific booking
  const statusQuery = useQuery<CheckinStatusData>({
    queryKey: ["kitchen-checkin-status", bookingId],
    enabled: !!bookingId && bookingId > 0,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/bookings/${bookingId}/checkin-status`,
        { credentials: "include", headers }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to fetch checkin status (${response.status})`
        );
      }
      return response.json();
    },
    refetchInterval: (query) => {
      if (!bookingId || bookingId <= 0) return false;
      const data = query.state.data;
      if (!data) return false;
      if (data.closeout?.nextDueAt) return 30_000;
      if (data.status !== "confirmed") return false;
      const visits = data.visits?.length ? data.visits : [data];
      return visits.some(visit => !["checked_out", "no_show", "checkout_claim_filed"].includes(visit.checkinStatus || "not_checked_in"))
        ? 30_000 : false;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // A chef waiting at the door (locked, or code reissued by the manager) must see the new state when
  // the tab comes back, without waiting for the next 30 s poll.
  const refetchStatus = statusQuery.refetch;
  useEffect(() => {
    if (!bookingId || bookingId <= 0) return;
    const onVisible = () => { if (document.visibilityState === "visible") void refetchStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [bookingId, refetchStatus]);

  // Chef check-in mutation
  const checkinMutation = useMutation<
    CheckinResult,
    Error,
    { checkinNotes?: string; checkinPhotoUrls?: string[]; checkinChecklistItems?: Array<{ id: string; label: string; checked: boolean }>;
      visitCode?: string; requestKey?: string }
  >({
    mutationFn: async ({ checkinNotes, checkinPhotoUrls, checkinChecklistItems, visitCode, requestKey }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/bookings/${bookingId}/checkin`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ checkinNotes, checkinPhotoUrls, checkinChecklistItems, visitId: status?.visitId,
            ...(visitCode ? { visitCode, requestKey } : {}) }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (typeof errorData.code === "string" && errorData.code.startsWith("VISIT_CODE_")) {
          throw new VisitCodeError(errorData.error || "Failed to check in", errorData.code,
            typeof errorData.attemptsLeft === "number" ? errorData.attemptsLeft : undefined);
        }
        throw new VisitDutyValidationError(errorData.error || "Failed to check in", errorData.fieldErrors || {});
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["kitchen-checkin-status", bookingId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] }),
        queryClient.invalidateQueries({ queryKey: [`/api/chef/bookings/${bookingId}/details`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/chef/bookings/${bookingId}/attendance`] }),
      ]);
    },
  });

  // Chef checkout request mutation
  const checkoutMutation = useMutation<
    CheckoutResult,
    Error,
    { checkoutNotes?: string; checkoutPhotoUrls?: string[]; checkoutChecklistItems?: Array<{ id: string; label: string; checked: boolean }> }
  >({
    mutationFn: async ({ checkoutNotes, checkoutPhotoUrls, checkoutChecklistItems }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/bookings/${bookingId}/checkout`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ checkoutNotes, checkoutPhotoUrls, checkoutChecklistItems, visitId: status?.visitId }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new VisitDutyValidationError(errorData.error || "Failed to request checkout", errorData.fieldErrors || {});
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["kitchen-checkin-status", bookingId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] }),
        queryClient.invalidateQueries({ queryKey: [`/api/chef/bookings/${bookingId}/details`] }),
        queryClient.invalidateQueries({ queryKey: [`/api/chef/bookings/${bookingId}/attendance`] }),
      ]);
    },
  });

  const rawStatus = statusQuery.data;
  const visits = rawStatus?.visits || [];
  const currentVisit = visits.find(visit => visit.id === selectedVisitId)
    || visits.find(visit => visit.checkinStatus === 'checked_in')
    || visits.find(visit => {
      if (['checked_out', 'no_show', 'checkout_claim_filed'].includes(visit.checkinStatus)) return false;
      const date = rawStatus!.bookingDate.split('T')[0];
      const endDate = calendarDateForBookingTime(date, visit.endTime, rawStatus!.operatingWindowStartTime, visit.startTime);
      return createBookingDateTime(endDate, visit.endTime, rawStatus!.timezone || DEFAULT_TIMEZONE) >= new Date();
    }) || visits[visits.length - 1];
  const status = rawStatus && currentVisit ? {
    ...rawStatus, ...currentVisit, closeout: rawStatus.closeout, visitCloseout: currentVisit.closeout, visitId: currentVisit.id,
  } : rawStatus;

  // Helpers
  const canCheckin = (): boolean => {
    const s = status;
    if (!s) return false;
    if (s.status !== "confirmed") return false;
    if (["booked_time_ended", "ended"].includes((s.visitCloseout || s.closeout?.visits[0])?.phase || "")) return false;
    if (
      s.checkinStatus &&
      s.checkinStatus !== "not_checked_in"
    )
      return false;

    // Compute the check-in window using the LOCATION's timezone (not the
    // browser's local timezone). The server validates in the location's
    // timezone, so the client must match exactly — otherwise the button
    // could appear enabled while the POST returns "Check-in opens in N min".
    const timezone = s.timezone || DEFAULT_TIMEZONE;
    const windowMinutesBefore = s.checkinWindowMinutesBefore ?? 15;

    const now = new Date();
    const dateOnly = s.bookingDate.split("T")[0]; // Extract YYYY-MM-DD from ISO timestamp
    const bookingStart = createBookingDateTime(calendarDateForBookingTime(dateOnly, s.startTime, s.operatingWindowStartTime), s.startTime, timezone);
    const bookingEnd = createBookingDateTime(calendarDateForBookingTime(dateOnly, s.endTime, s.operatingWindowStartTime, s.startTime), s.endTime, timezone);
    const checkinOpens = new Date(
      bookingStart.getTime() - windowMinutesBefore * 60 * 1000,
    );

    return now >= checkinOpens && now <= bookingEnd;
  };

  const canCheckout = (): boolean => {
    const s = status;
    if (!s) return false;
    if (s.status !== 'confirmed') return false;
    const phase = (s.visitCloseout || s.closeout?.visits[0])?.phase || "";
    // A chef still on site when booked time ends can check out until the service-end grace closes.
    if (s.checkinStatus === 'checked_in' && phase === 'booked_time_ended') return true;
    if (["booked_time_ended", "ended"].includes(phase)) return false;
    if (s.checkinStatus === 'checked_in') return true;
    const legacyDepartureOnly = s.visitDuties?.version === 1 && !s.visitDuties.arrival.enabled && s.visitDuties.departure.enabled;
    if (!legacyDepartureOnly || ![null, 'not_checked_in'].includes(s.checkinStatus)) return false;
    const start = createBookingDateTime(calendarDateForBookingTime(s.bookingDate.split('T')[0], s.startTime, s.operatingWindowStartTime), s.startTime, s.timezone || DEFAULT_TIMEZONE);
    return new Date() >= start;
  };

  return {
    status,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    refetch: statusQuery.refetch,

    checkin: checkinMutation.mutateAsync,
    isCheckingIn: checkinMutation.isPending,
    checkinError: checkinMutation.error,

    checkout: checkoutMutation.mutateAsync,
    isCheckingOut: checkoutMutation.isPending,
    checkoutError: checkoutMutation.error,

    canCheckin: canCheckin(),
    canCheckout: canCheckout(),
  };
}
