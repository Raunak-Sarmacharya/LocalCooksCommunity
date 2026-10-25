/**
 * ScheduleViewingWidget — request an in-person kitchen tour (visit only, not an application).
 * Two screens for everyone, like Request to apply (owner, Oct 25): Day and time → Almost done (your details, answers, send).
 * A signed-out visitor's existing account signs in inline; a new email creates the account on send, and the request is
 * held as a server draft until the email is verified on any device, then sent through the normal booking route.
 */

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader2, Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { RequestDetails, type DetailsMode, type RequestIdentity } from "@/components/kitchen-application/RequestDetails";
import { useEmailVerifiedWatch } from "@/hooks/use-email-verified-watch";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { useEmailVerificationGuard } from "@/hooks/use-email-verification-guard";
import { useLocation } from "wouter";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { saveAuthIntentFromCurrentPage } from "@/lib/auth-intent";
import { isPendingGoogleRegistration } from "@/lib/pending-google-registration";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { Checkbox } from "@/components/ui/checkbox";
import { TourChip, TourIntakeChoice } from "@/components/tour/TourIntakeChoice";
import { requiredViewingIntakeDataSchema, type ViewingIntakeData } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { InfoChip } from "@/components/chef/info-chip";
import { Calendar } from "@/components/ui/calendar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import Header from "@/components/layout/Header";
import { useIsChefShell } from "@/layouts/chef-shell-context";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ct } from "@/i18n/chef-ns";
import { tourAvailableDate, tourToday } from "@/lib/tour-available-date";
import { DEFAULT_TIMEZONE, friendlyTimezoneName } from "@shared/timezone-utils";

async function getAuthHeaders(forceRefresh = false): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken(forceRefresh);
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return { "Content-Type": "application/json" };
}

interface TimeSlot {
  startTime: string;
  endTime: string;
  scheduledAt: string;
}

interface AvailabilityResponse {
  locationName: string;
  date: string;
  timezone: string;
  slots: TimeSlot[];
  settings: {
    defaultDurationMinutes: number;
    maxAdvanceBookingDays: number;
    advanceNoticeHours: number;
    isActive: boolean;
  } | null;
}

type TourStep = "schedule" | "details" | "success";
type HeldTour = { scheduledAt: string; chefNotes?: string; intakeData: ViewingIntakeData };

interface ScheduleViewingWidgetProps {
  locationId: number;
  locationName?: string;
  targetedKitchenId: number;
  targetedKitchenName?: string;
  kitchenImageUrl?: string | null;
  onClose?: () => void;
  /** Only the full-page flow exists; the prop stays so existing callers keep compiling. */
  presentation?: "page";
}

/**
 * Email is the gate; a missing phone never blocks a tour request. Kept in step
 * with the server, which refuses `POST /api/viewings/book` on an unverified email
 * alone — a stricter client would strand users on a wall the API would have passed.
 */
function isUserVerified(
  user: { is_verified?: boolean; isVerified?: boolean; emailVerified?: boolean } | null | undefined
): boolean {
  return hasVerifiedEmail(
    { emailVerified: Boolean(auth.currentUser?.emailVerified) },
    { is_verified: user?.is_verified, isVerified: user?.isVerified }
  );
}

const mask = (email: string) => { const [name = "", domain = ""] = email.split("@"); return domain ? `${name.slice(0, 2)}***@${domain}` : email; };

const calendarClassNames = {
  months: "w-full",
  month: "w-full space-y-3",
  caption: "flex items-center justify-between",
  caption_label: "text-[15px] font-medium text-foreground",
  nav: "flex items-center gap-1",
  nav_button: "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
  nav_button_previous: "",
  nav_button_next: "",
  table: "w-full table-fixed border-collapse",
  head_row: "",
  head_cell: "pb-2 text-center text-xs font-normal text-muted-foreground",
  row: "",
  cell: "p-0.5 text-center",
  day: "mx-auto flex h-10 w-full max-w-[52px] items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  day_selected: "!bg-foreground !text-background",
  day_today: "ring-1 ring-inset ring-foreground/25",
  day_disabled: "pointer-events-none !bg-transparent font-normal text-muted-foreground/50",
  day_outside: "invisible",
  day_hidden: "invisible",
};

export function ScheduleViewingWidget({
  locationId,
  locationName,
  targetedKitchenId,
  targetedKitchenName,
  kitchenImageUrl,
  onClose,
}: ScheduleViewingWidgetProps) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation("kitchen");
  const { t: common } = useTranslation("common");
  const locale = i18n?.language || "en-CA";
  const inChefShell = useIsChefShell();
  const { user, loading: authLoading, signup, refreshUserData, updateUserVerification } = useFirebaseAuth();
  const { guard, gate } = useEmailVerificationGuard();
  const [, setLocation] = useLocation();
  const isAuthenticated = !!user && !isPendingGoogleRegistration(auth.currentUser?.uid);
  const emailVerified = isUserVerified(user);
  // Signed in with a verified email: Request tour sends. Otherwise it is held until the email is verified.
  const readyToSend = isAuthenticated && emailVerified;

  const [step, setStep] = useState<TourStep>("schedule");
  const [progressRestored, setProgressRestored] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [chefNotes, setChefNotes] = useState("");
  const [intakeData, setIntakeData] = useState<ViewingIntakeData>({});
  const intakeResult = requiredViewingIntakeDataSchema.safeParse(intakeData);
  const intakeComplete = intakeResult.success;
  const draftOwnerUid = useRef<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [details, setDetails] = useState<{ mode: DetailsMode; identity: RequestIdentity | null; ready: boolean }>({ mode: "email", identity: null, ready: false });
  const [agreed, setAgreed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [holding, setHolding] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [slotNotice, setSlotNotice] = useState(false);
  const [resent, setResent] = useState(false);
  const sendingHeld = useRef(false);

  const hasProgress =
    step !== "schedule" || !!selectedDate || !!selectedSlot || chefNotes.trim().length > 0 || Object.keys(intakeData).length > 0;
  const isDataTaking = step !== "success";

  const storageKey = `viewing_booking_${targetedKitchenId}`;

  const persistProgress = useCallback(
    (next?: Partial<{
      date: Date | undefined;
      slot: TimeSlot | null;
      step: TourStep;
      chefNotes: string;
      intakeData: ViewingIntakeData;
    }>) => {
      if (authLoading || progressRestored !== storageKey) return;
      if (draftOwnerUid.current && draftOwnerUid.current !== auth.currentUser?.uid) return;
      const date = next?.date !== undefined ? next.date : selectedDate;
      const slot = next?.slot !== undefined ? next.slot : selectedSlot;
      const st = next?.step ?? step;
      const notes = next?.chefNotes ?? chefNotes;
      const intake = next?.intakeData ?? intakeData;
      if (st === "success") {
        localStorage.removeItem(storageKey);
        return;
      }
      if (date || slot || st !== "schedule" || notes || Object.keys(intake).length) {
        draftOwnerUid.current = auth.currentUser?.uid || draftOwnerUid.current;
        localStorage.setItem(
          storageKey,
          JSON.stringify({ date, slot, step: st, chefNotes: notes, intakeData: intake, ownerUid: draftOwnerUid.current })
        );
      } else {
        localStorage.removeItem(storageKey);
      }
    },
    [selectedDate, selectedSlot, step, chefNotes, intakeData, storageKey, authLoading, progressRestored]
  );

  useEffect(() => {
    if (authLoading || step === "success" || progressRestored !== storageKey) return;
    persistProgress();
  }, [authLoading, persistProgress, step, progressRestored, storageKey]);

  useEffect(() => {
    if (authLoading) return;
    try {
      setSelectedDate(undefined);
      setSelectedSlot(null);
      setChefNotes("");
      setIntakeData({});
      setStep("schedule");
      draftOwnerUid.current = null;
      const savedData = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey);
      if (!savedData) return;
      const parsed = JSON.parse(savedData);
      if (parsed.ownerUid && parsed.ownerUid !== auth.currentUser?.uid) {
        localStorage.removeItem(storageKey);
        sessionStorage.removeItem(storageKey);
        return;
      }
      draftOwnerUid.current = parsed.ownerUid || auth.currentUser?.uid || null;
      if (parsed.date) setSelectedDate(new Date(parsed.date));
      if (parsed.slot) setSelectedSlot(parsed.slot);
      if (parsed.chefNotes) setChefNotes(parsed.chefNotes || "");
      setIntakeData(parsed.intakeData || {});
      // Any step past day and time (including older drafts' account, verify and confirm steps) is the second screen.
      if (parsed.slot && !["schedule", "date", "time", "success"].includes(parsed.step)) setStep("details");
    } catch (e) {
      console.error("Failed to restore tour booking data", e);
    } finally {
      setProgressRestored(storageKey);
    }
    // Re-coerce once auth hydrates so signed-in chefs don't land on verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, isAuthenticated, authLoading, user?.uid]);

  // A held tour request (new account, or an account whose email isn't verified yet), saved on the server.
  const draftKey = ["/api/viewings/tour-draft", targetedKitchenId, user?.uid];
  const { data: draftState } = useQuery<{ draft: HeldTour | null }>({
    queryKey: draftKey,
    enabled: isAuthenticated,
    queryFn: async () => {
      const response = await fetch(`/api/viewings/tour-draft/${targetedKitchenId}`, { headers: await getAuthHeaders(), credentials: "include" });
      if (!response.ok) throw new Error("draft");
      return response.json();
    },
  });
  const heldTour = draftState?.draft ?? null;
  const waiting = isAuthenticated && !emailVerified && !!heldTour;
  const dropHeldTour = async () => {
    queryClient.setQueryData(draftKey, { draft: null });
    await fetch(`/api/viewings/tour-draft/${targetedKitchenId}`, { method: "DELETE", headers: await getAuthHeaders(), credentials: "include" }).catch(() => undefined);
  };

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const {
    data: availability,
    isLoading: slotsLoading,
    isFetching: slotsFetching,
    isError: slotsError,
    refetch: refetchSlots,
  } = useQuery<AvailabilityResponse>({
    queryKey: [`/api/viewings/available-slots/${targetedKitchenId}?date=${dateStr}`],
    enabled: !!selectedDate && !!dateStr,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: calMetadata } = useQuery({
    queryKey: [`/api/viewings/calendar-availability/${targetedKitchenId}`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/viewings/calendar-availability/${targetedKitchenId}`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!targetedKitchenId,
  });

  const bookMutation = useMutation({
    // With a held tour, the server sends its own saved copy; only the kitchen is named here.
    mutationFn: async (held?: HeldTour) => {
      let body: object = { fromDraft: true, locationId, targetedKitchenId };
      if (!held) {
        if (!selectedSlot) throw new Error(ct("noTimeSlotSelected"));
        const intake = requiredViewingIntakeDataSchema.safeParse(intakeData);
        if (!intake.success) throw new Error(t("tourIntakeRequired", "Answer all four questions to continue."));
        body = { locationId, targetedKitchenId, scheduledAt: selectedSlot.scheduledAt, chefNotes: chefNotes || undefined, intakeData: intake.data };
      }
      const headers = await getAuthHeaders(true);
      const response = await fetch("/api/viewings/book", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (err.code === 'TOUR_REQUEST_BLOCKED') {
          throw Object.assign(new Error(err.error || t('tourRequestBlocked', 'Open your existing tour to review its status.')),
            { code: err.code, tourId: err.tourId });
        }
        if (err.code === "SLOT_TAKEN") {
          throw Object.assign(new Error(
            t("tourSlotTakenPick", "That time was just taken. Pick another time.")
          ), { code: "SLOT_TAKEN" });
        }
        if (err.code === "ACTIVE_TOUR_EXISTS") {
          throw new Error(
            t(
              "activeTourExists",
              "You already have an active tour for this kitchen. Check My Tours."
            )
          );
        }
        throw new Error(err.error || t("failedToBookViewing", "Failed to book Kitchen Tour"));
      }
      return response.json();
    },
    onSuccess: (data, held) => {
      if (held) queryClient.setQueryData(draftKey, { draft: null });
      setStep("success");
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
      queryClient.invalidateQueries({ queryKey: ["/api/viewings/chef"] });
      queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] });
      queryClient.invalidateQueries({ queryKey: ['/api/viewings/request-access'] });
      if (data.notificationDeliveryFailed) toast.warning(t("tourSavedDeliveryFailed", "Your tour request is saved, but some notifications could not be delivered."));
      else toast.success(t("kitchenTourBookedSuccess", "Tour request sent"));
      // The sent request opens on its tour page.
      if (data?.id) setLocation(`${chefDashboardHref("viewings")}&viewing=${data.id}`);
    },
    onError: (error: Error & { code?: string; tourId?: number }, held) => {
      void queryClient.invalidateQueries({ queryKey: ['/api/viewings/request-access'] });
      if (error.code === 'TOUR_REQUEST_BLOCKED' && error.tourId) {
        // Already toured or a tour is open here: the half-filled request goes, and the tour page says why.
        if (held) void dropHeldTour();
        resetForm();
        setLocation(`${chefDashboardHref('viewings')}&viewing=${error.tourId}&notice=already`);
        return;
      }
      if (error.code === "SLOT_TAKEN") {
        if (held) {
          void dropHeldTour();
          setSelectedDate(new Date(held.scheduledAt));
          setIntakeData(held.intakeData || {});
          setChefNotes(held.chefNotes || "");
        }
        setSelectedSlot(null);
        setSlotNotice(true);
        setStep("schedule");
        void refetchSlots();
        return;
      }
      if (held) { sendingHeld.current = false; setSendError(error.message); return; }
      toast.error(error.message);
    },
  });

  // The link tapped here or on a phone continues this page by itself. The held request then waits for the chef to send it:
  // never sent on their behalf, since whoever verifies may not be who typed the request (owner, Oct 25; Airbnb returns you to checkout).
  useEmailVerifiedWatch(waiting, async () => { await updateUserVerification(); await refreshUserData({ forceToken: true }); });
  const sendHeld = () => {
    if (!heldTour || sendingHeld.current) return;
    sendingHeld.current = true;
    setSendError(null);
    bookMutation.mutate(heldTour);
  };

  // Not verified yet: create the account if needed, then hold the request on the server until the email is verified.
  const holdRequest = async () => {
    if (!selectedSlot || !intakeResult.success) return;
    if (!isAuthenticated) {
      const identity = details.identity!;
      const generated = `A1!${crypto.getRandomValues(new Uint32Array(3)).join("")}`.slice(0, 16);
      await signup(identity.email, generated, identity.fullName, "chef", true, identity.phone);
    } else {
      await sendVerificationEmailWithFallback({ email: user!.email!, role: "chef", returnUrl: `${window.location.pathname}${window.location.search}` });
    }
    const held: HeldTour = { scheduledAt: selectedSlot.scheduledAt, chefNotes: chefNotes || undefined, intakeData: intakeResult.data };
    const response = await fetch("/api/viewings/tour-draft", {
      method: "PUT", headers: await getAuthHeaders(true), credentials: "include",
      body: JSON.stringify({ locationId, targetedKitchenId, ...held }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || t("rtcSendFailed", "We couldn’t send your request. Try again."));
    // The account may be minutes old: a draft read started before the save must not overwrite it with "none".
    const key = ["/api/viewings/tour-draft", targetedKitchenId, auth.currentUser?.uid];
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData(key, { draft: held });
  };

  const today = tourToday();

  const handleDateSelect = useCallback((date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
    setSelectedSlot(null);
    setSlotNotice(false);
  }, []);

  const continueToDetails = useCallback(() => {
    if (!selectedSlot) return;
    sessionStorage.removeItem("pending_application_modal");
    saveAuthIntentFromCurrentPage("tour", locationId, targetedKitchenId);
    persistProgress({ step: "details" });
    setStep("details");
  }, [selectedSlot, locationId, targetedKitchenId, persistProgress]);

  const resetForm = useCallback(() => {
    setStep("schedule");
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setChefNotes("");
    setIntakeData({});
    draftOwnerUid.current = null;
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  const requestClose = () => {
    if (isDataTaking && hasProgress) {
      setCancelConfirmOpen(true);
      return;
    }
    onClose?.();
  };

  const confirmCancel = () => {
    resetForm();
    setCancelConfirmOpen(false);
    onClose?.();
  };

  // Times are the kitchen's (Newfoundland) clock, 12-hour, in the reader's language.
  const timezone = availability?.timezone || DEFAULT_TIMEZONE;
  const duration = availability?.settings?.defaultDurationMinutes;
  const minutes = duration ?? 30;
  const clock = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true });
  const slotStart = (slot: TimeSlot) => clock.format(new Date(slot.scheduledAt));
  const slotRange = (slot: TimeSlot) => {
    const start = new Date(slot.scheduledAt);
    // Non-breaking spaces so "11:00 a.m." never splits; lines break only around the " · ".
    return clock.formatRange(start, new Date(start.getTime() + minutes * 60_000)).replace(/\s/g, " ");
  };
  const longDate = selectedDate && new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(selectedDate);
  const shortDate = selectedDate && new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(selectedDate).replace(/\s/g, " ");
  const zoneName = friendlyTimezoneName(timezone, locale).replace(/ Time$/, " time");
  const whenLine = selectedDate && selectedSlot ? `${shortDate} · ${slotRange(selectedSlot)}` : null;

  const kitchenName = targetedKitchenName || locationName || t("applyFlowKitchenFallbackName", "Kitchen");
  const placeName = availability?.locationName && availability.locationName !== kitchenName
    ? availability.locationName
    : locationName && locationName !== kitchenName ? locationName : null;

  const stepLabels = [t("tourBookStepSchedule", "Day and time"), t("tourBookStepDetails", "Your details")];
  const stepIndex = step === "schedule" ? 0 : 1;

  const heading = step === "schedule"
    ? { title: t("tourBookTitle", "Book a tour"), subtext: t("tourBookSubtext", "Pick a day and time to see the kitchen in person. It’s free, and you’re not applying yet.") }
    : step === "success"
      ? { title: t("tourBookDoneTitle", "Tour requested"), subtext: t("tourBookDoneSubtext", "The kitchen will confirm or suggest another time.") }
      : { title: t("tourBookDetailsTitle", "Almost done"), subtext: t("tourBookDetailsSubtext", "A few quick answers help the kitchen prepare for your visit.") };

  const optional = <span className="font-normal text-muted-foreground">{t("tourBookOptional", "Optional")}</span>;

  const kitchenHeader = (
    <div className="flex items-center justify-between gap-3 border-b p-4 sm:p-5">
      <div className="flex min-w-0 items-center gap-3">
        {kitchenImageUrl && <img src={kitchenImageUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover sm:h-14 sm:w-14" />}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-foreground">{kitchenName}</p>
          {placeName && <p className="truncate text-sm text-muted-foreground">{placeName}</p>}
        </div>
      </div>
      <div className="hidden text-sm text-muted-foreground sm:block sm:text-right">
        <p>{duration ? t("tourBookDuration", { defaultValue: "{minutes}-minute tour · free", minutes: duration }) : t("tourBookFree", "Free tour")}</p>
        <p>{t("tourBookConfirmsWithin", "The kitchen confirms within 24 hours")}</p>
      </div>
    </div>
  );

  const summaryRow = whenLine && (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <p className="min-w-0">
        <span className="font-medium text-foreground">{whenLine}</span>
        <span className="block text-muted-foreground sm:ml-2 sm:inline">{zoneName}</span>
      </p>
      {step !== "success" && <button type="button" onClick={() => setStep("schedule")}
        className="min-h-9 shrink-0 rounded text-sm font-medium text-foreground underline underline-offset-4 hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("tourBookChange", "Change")}
      </button>}
    </div>
  );

  const footer = (left: ReactNode, action: ReactNode) => (
    <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 rounded-b-lg border-t bg-background px-4 py-3 shadow-[0_-1px_0_hsl(var(--border))] sm:static sm:bg-muted/60 sm:px-5 sm:py-4 sm:shadow-none">
      <div className="min-w-0 text-sm">{left}</div>
      {action}
    </div>
  );

  const renderSlots = () => {
    if (!selectedDate) return <p className="text-sm text-muted-foreground">{t("tourBookPickDay", "Pick a day to see the times.")}</p>;
    if (slotsLoading || slotsFetching) return (
      <div className="grid grid-cols-3 gap-2 md:grid-cols-1" role="status" aria-label={t("loadingAvailableTimes", "Loading available times...")}>
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-11 w-full rounded-lg" />)}
      </div>
    );
    if (slotsError) return (
      <div className="rounded-lg border p-4 text-center">
        <p className="text-sm text-muted-foreground">{t("tourBookTimesError", "We couldn’t load the times for this day.")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetchSlots()}>{t("tourBookTryAgain", "Try again")}</Button>
      </div>
    );
    if (!availability?.slots.length) return <p className="text-sm text-muted-foreground">{t("tourBookNoTimes", "No times left this day. Try another day.")}</p>;
    return (
      <div className="grid grid-cols-3 gap-2 md:max-h-[22rem] md:grid-cols-1 md:overflow-y-auto md:pr-1">
        {availability.slots.map((slot) => {
          const selected = selectedSlot?.scheduledAt === slot.scheduledAt;
          return <button key={slot.scheduledAt} type="button" aria-pressed={selected} onClick={() => setSelectedSlot(slot)}
            className={cn("min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              selected ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:border-foreground/40")}>
            {slotStart(slot)}
          </button>;
        })}
      </div>
    );
  };

  const renderScheduleStep = () => (
    <>
      {slotNotice && <p role="alert" className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mx-5 sm:mt-5">{t("tourSlotTakenPick", "That time was just taken. Pick another time.")}</p>}
      <div className="grid md:grid-cols-[minmax(0,1fr)_17.5rem]">
        <div className="p-4 sm:p-5">
          <Calendar
            mode="single"
            required
            showOutsideDays={false}
            defaultMonth={selectedDate}
            selected={selectedDate}
            onSelect={handleDateSelect}
            disabled={(date) => !tourAvailableDate(date, calMetadata, today)}
            className="w-full p-0"
            classNames={calendarClassNames}
          />
        </div>
        <div className="border-t p-4 sm:p-5 md:border-l md:border-t-0">
          {selectedDate && <div className="mb-3">
            <h2 className="text-[15px] font-medium text-foreground">{longDate}</h2>
            <p className="text-sm text-muted-foreground">{t("tourBookZoneLine", { defaultValue: "{zone} · {minutes} minutes", zone: zoneName, minutes })}</p>
          </div>}
          {renderSlots()}
        </div>
      </div>
      {footer(
        whenLine ? <span className="whitespace-nowrap font-medium text-foreground">{whenLine}</span> : <span className="text-muted-foreground">{t("tourBookPickTime", "Pick a day and time")}</span>,
        <Button className="shrink-0" disabled={!selectedSlot} onClick={continueToDetails}>{t("tourBookContinue", "Continue")}</Button>
      )}
    </>
  );

  const submitDetails = () => {
    if (!intakeComplete) return;
    if (readyToSend) {
      guard(() => bookMutation.mutate(undefined));
      return;
    }
    if (!isAuthenticated && (!details.ready || !agreed)) { setShowErrors(true); return; }
    setHolding(true); setSendError(null);
    holdRequest().catch((error: Error) => setSendError(error.message || t("rtcSendFailed", "We couldn’t send your request. Try again.")))
      .finally(() => setHolding(false));
  };

  // Not a <form>: Your details has its own sign-in form, and forms can't nest.
  const renderDetailsStep = () => (
    <div>
      <div className="max-w-2xl space-y-6 p-4 sm:p-5">
        {summaryRow}
        {/* Inside the chef dashboard the account is known: no "Sending as / Not you?" (owner, Oct 25). It stays mounted so the send logic still reads its state. */}
        <section aria-label={t("yourDetails", "Your details")} className={cn("space-y-3", inChefShell && isAuthenticated && "hidden")}>
          <RequestDetails showErrors={showErrors} onChange={setDetails} />
          {showErrors && !isAuthenticated && details.mode === "existing" && <p role="alert" className="text-sm text-destructive">{t("tourSignInToSend", "Sign in above to send your request.")}</p>}
        </section>
        <TourIntakeChoice key={`use-${targetedKitchenId}`} id="tour-intended-use"
          label={t("tourBookUse", "What will you use the kitchen for?")}
          value={intakeData.intendedUse}
          choices={[
            { value: "catering", label: common("tourIntakeUse_catering", "Catering") },
            { value: "meal_prep", label: common("tourIntakeUse_meal_prep", "Meal preparation") },
            { value: "food_truck", label: common("tourIntakeUse_food_truck", "Food truck") },
            { value: "baking", label: common("tourIntakeUse_baking", "Baking") },
          ]}
          onChange={intendedUse => setIntakeData({ ...intakeData, intendedUse })} />
        <TourIntakeChoice key={`hours-${targetedKitchenId}`} id="tour-weekly-hours"
          label={t("tourBookHours", "About how many hours a week?")}
          value={intakeData.estimatedWeeklyHours}
          choices={["1-5", "6-10", "11-20", "21-30", "31-40", "40+"].map(hours => ({ value: hours, label: hours.replace("-", "–") }))}
          onChange={estimatedWeeklyHours => setIntakeData({ ...intakeData, estimatedWeeklyHours })} />
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-medium text-foreground">{t("tourBookCertificate", "Do you have a food handler certificate?")}</legend>
          <div className="flex flex-wrap gap-2">
            {[true, false].map(answer => <TourChip key={String(answer)} name="tour-license" value={String(answer)}
              checked={intakeData.hasLicense === answer} onSelect={() => setIntakeData({ ...intakeData, hasLicense: answer })}>
              {answer ? t("tourIntakeYes", "Yes") : t("tourIntakeNo", "No")}
            </TourChip>)}
          </div>
        </fieldset>
        <div className="space-y-2.5">
          <Label htmlFor="tour-start-date" className="text-sm font-medium">{t("tourBookStart", "When would you like to start?")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <DateField id="tour-start-date" minToday={false}
              placeholder={t("tourBookStartPlaceholder", "Pick a date")}
              disabled={intakeData.targetStartDate === "not_decided"}
              value={intakeData.targetStartDate === "not_decided" ? "" : intakeData.targetStartDate || ""}
              onChange={targetStartDate => setIntakeData({ ...intakeData, targetStartDate })}
              className="min-h-10 rounded-lg sm:w-56" />
            <Label htmlFor="tour-start-undecided" className="flex min-h-10 cursor-pointer items-center gap-2.5 font-normal">
              <Checkbox id="tour-start-undecided" checked={intakeData.targetStartDate === "not_decided"}
                onCheckedChange={checked => setIntakeData({ ...intakeData, targetStartDate: checked === true ? "not_decided" : "" })} />
              {t("tourIntakeNotDecided", "Not decided yet")}
            </Label>
          </div>
        </div>
        <div className="space-y-2.5">
          <Label htmlFor="tour-notes" className="text-sm font-medium">{t("tourBookNotes", "Anything you want to see or ask?")} {optional}</Label>
          <Textarea id="tour-notes" value={chefNotes} onChange={(e) => setChefNotes(e.target.value)}
            placeholder={t("tourBookNotesPlaceholder", "Equipment you need, storage, parking…")} maxLength={500} rows={3} />
          <p className="text-right text-xs text-muted-foreground">{chefNotes.length}/500</p>
        </div>
        {/* A new account agrees once, as on Request to apply; signing in to an existing one needs nothing more. */}
        {!isAuthenticated && details.mode === "new" && <div>
          <Label htmlFor="tour-agree" className="flex cursor-pointer items-start gap-3 text-sm font-normal leading-6 text-muted-foreground">
            <Checkbox id="tour-agree" className="mt-1" checked={agreed} onCheckedChange={checked => setAgreed(checked === true)}
              aria-invalid={showErrors && !agreed} aria-describedby={showErrors && !agreed ? "tour-agree-error" : undefined} />
            <span>
              {t("onePageAgreePrefix", "I agree to Local Cooks’")}{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2 hover:text-primary/80">{t("onePageAgreeTerms", "Terms and kitchen usage policies")}</a>
              {t("onePageAgreeAnd", " and")}{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2 hover:text-primary/80">{common("privacyPolicy", "Privacy Policy")}</a>
              {t("onePageAgreeAccurate", ", and confirm my answers are accurate.")}
            </span>
          </Label>
          {showErrors && !agreed && <p id="tour-agree-error" role="alert" className="mt-1.5 text-sm text-destructive">{t("tourAgreeNeeded", "Agree to the terms to send your request.")}</p>}
        </div>}
        {sendError && <p role="alert" className="text-sm text-destructive">{sendError}</p>}
      </div>
      {footer(
        <span className="hidden text-muted-foreground sm:inline">{t("tourBookFooterNote", "The kitchen confirms within 24 hours. Cancel any time.")}</span>,
        <Button type="button" onClick={submitDetails} className="shrink-0" data-testid="tour-request-submit" disabled={bookMutation.isPending || holding || !intakeComplete}>
          {bookMutation.isPending || holding ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("tourBookSending", "Sending…")}</> : t("tourBookRequest", "Request tour")}
        </Button>
      )}
    </div>
  );

  // The held request: waiting for the email link, then sending by itself (same panel as Request to apply).
  const heldSummary = heldTour && (() => {
    const start = new Date(heldTour.scheduledAt);
    const day = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(start).replace(/\s/g, " ");
    return <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"><span className="font-medium text-foreground">{`${day} · ${clock.formatRange(start, new Date(start.getTime() + minutes * 60_000)).replace(/\s/g, " ")}`}</span>
      <span className="block text-muted-foreground sm:ml-2 sm:inline">{zoneName}</span></div>;
  })();
  const renderHeldStep = () => (
    <div className="max-w-2xl space-y-5 p-4 sm:p-5" data-testid="tour-waiting">
      {heldSummary}
      {readyToSend ? <div className="space-y-4" data-testid="tour-ready">
        <div><h2 className="text-xl font-semibold">{t("tourReadyTitle", "Your tour request is ready")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("tourReadyBody", "Your email is confirmed. Check the time and send it to the kitchen.")}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={sendHeld} disabled={bookMutation.isPending}>{bookMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}{t("tourReadySend", "Send request")}</Button>
          <Button variant="outline" disabled={bookMutation.isPending} onClick={async () => { await dropHeldTour(); resetForm(); }}>{t("tourReadyDiscard", "Discard")}</Button>
        </div>
      </div> : <div>
        <span aria-hidden className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#FCE3E9]"><Mail className="h-6 w-6 text-[#E10939]" /></span>
        <h2 className="text-xl font-semibold">{t("tourConfirmTitle", "Confirm your email to send your tour request")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("tourConfirmBody", { defaultValue: "We sent a link to {email}. Tap it on any device, then send your request from here.", email: mask(user?.email || "") })}</p>
        <p className="mt-4 flex items-center gap-2 text-sm" role="status"><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />{t("rtcWaiting", "Waiting for you to tap the link…")}</p>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>{t("rtcSaved", "Your answers are saved with your new account, so nothing is lost if you close this page.")}</li>
          <li>{t("rtcNothingYet", "Nothing yet? Check spam, or")}{" "}
            <button type="button" disabled={resent} className="!min-h-0 font-medium text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
              onClick={async () => { setResent(true); await sendVerificationEmailWithFallback({ email: user!.email!, role: "chef", returnUrl: `${window.location.pathname}${window.location.search}` }).catch(() => setResent(false)); }}>
              {resent ? t("rtcLinkSent", "link sent again") : t("rtcSendAgain", "send the link again")}</button>.</li>
        </ul>
      </div>}
      {sendError && <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{sendError}</p>
        <Button variant="outline" size="sm" onClick={() => { sendingHeld.current = false; sendHeld(); }}>{t("tourBookTryAgain", "Try again")}</Button></div>}
    </div>
  );

  const renderSuccessStep = () => (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0 space-y-1">
          <InfoChip variant="warning">{t("tourRequestPendingLabel", "Pending")}</InfoChip>
          <p className="text-sm text-muted-foreground">
            {t("kitchenTourRequestedAwaitingApproval", "Your tour request is pending. We’ll notify you when it’s confirmed or declined.")}
          </p>
          <p className="text-xs text-muted-foreground">{t('tourPendingResponseExpectation', 'We aim to respond within 24 hours. Your tour is not confirmed until you receive confirmation; a request expires when its requested start time passes.')}</p>
        </div>
      </div>
      {summaryRow}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => { onClose?.(); setLocation(chefDashboardHref("viewings")); }}>
          {t("tourBookViewMyTours", "View my tours")}
        </Button>
        <Button variant="outline" onClick={() => { resetForm(); onClose?.(); }}>
          {t("doneStayOnPreview", "Done")}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <div className={cn("min-w-0 [overflow-wrap:anywhere]", !inChefShell && "min-h-screen")}>
        {!inChefShell && <Header />}
        <div className={cn("mx-auto max-w-[57rem] px-4 pb-12 sm:px-6", inChefShell ? "pt-4 sm:pt-6" : "pt-[calc(var(--header-total)_+_1.5rem)]")}>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              {step !== "success" && <p className="mb-1 text-xs text-muted-foreground">
                {t("tourBookStep", { defaultValue: "Step {current} of {total} · {label}", current: stepIndex + 1, total: stepLabels.length, label: stepLabels[stepIndex] })}
              </p>}
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{heading.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{heading.subtext}</p>
            </div>
            {isDataTaking && <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={requestClose}>{t("tourBookCancel", "Cancel")}</Button>}
          </div>
          <div className="rounded-lg border bg-card">
            {kitchenHeader}
            {heldTour && step !== "success" ? renderHeldStep() : <>
              {step === "schedule" && renderScheduleStep()}
              {step === "details" && renderDetailsStep()}
              {step === "success" && renderSuccessStep()}
            </>}
          </div>
        </div>
      </div>

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("cancelAuthModalTitle", "Are you sure you want to cancel?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "cancelTourModalDesc",
                "Your tour progress is saved on this device. You can come back and continue later."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keepEditing", "Keep editing")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel}>
              {t("confirmCancel", "Yes, cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {gate}
    </>
  );
}

export default ScheduleViewingWidget;
