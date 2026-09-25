/**
 * ScheduleViewingWidget — request an in-person kitchen tour (visit only, not an application).
 * Guest: Date → Time → Account → Verify → Confirm → Success
 * Signed-in (including veterans): Date → Time → Confirm → Success
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, MapPin, Loader2, CheckCircle, ArrowLeft, Building2, Send, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import KitchenJourneyAuth from "@/components/auth/KitchenJourneyAuth";
import { useEmailVerificationGuard } from "@/hooks/use-email-verification-guard";
import { useLocation } from "wouter";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { saveAuthIntentFromCurrentPage, getAuthIntent, resolveVerificationReturnPath, kitchenActor, nextTourStepAfterSlot, coerceTourStepForActor, skipKitchenVerify } from "@/lib/auth-intent";
import { isPendingGoogleRegistration } from "@/lib/pending-google-registration";
import KitchenJourneyLayout, { KitchenJourneySteps } from "@/components/kitchen-application/KitchenJourneyLayout";
import { journeyCalendarClassNames, journeyCalendarContainer } from "@/components/kitchen-application/journey-calendar-style";
import KitchenJourneyTimeSlot, { formatJourneyClock } from "@/components/kitchen-application/KitchenJourneyTimeSlot";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { format, addDays, isBefore, startOfDay, endOfDay } from "date-fns";
import { ct } from "@/i18n/chef-ns";
import { useIsMobile } from "@/hooks/use-mobile";

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

type TourStep = "date" | "time" | "account" | "verify" | "confirm" | "success";

interface ScheduleViewingWidgetProps {
  locationId: number;
  locationName?: string;
  targetedKitchenId: number;
  targetedKitchenName?: string;
  kitchenImageUrl?: string | null;
  onClose?: () => void;
  onRequireOpen?: () => void;
  open?: boolean;
  presentation?: "dialog" | "page";
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

export function ScheduleViewingWidget({
  locationId,
  locationName,
  targetedKitchenId,
  targetedKitchenName,
  kitchenImageUrl,
  onClose,
  onRequireOpen,
  open = true,
  presentation = "dialog",
}: ScheduleViewingWidgetProps) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { t } = useTranslation("kitchen");
  const { user, refreshUserData } = useFirebaseAuth();
  const { guard, gate } = useEmailVerificationGuard();
  const [, setLocation] = useLocation();
  const isAuthenticated = !!user && !isPendingGoogleRegistration(auth.currentUser?.uid);
  const [registeredInFlow, setRegisteredInFlow] = useState(false);
  const actor = kitchenActor(isAuthenticated, registeredInFlow);
  const emailVerified = isUserVerified(user);
  const skipVerify = skipKitchenVerify(actor, emailVerified);

  const [step, setStep] = useState<TourStep>("date");
  const [progressRestored, setProgressRestored] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [chefNotes, setChefNotes] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const hasProgress =
    step !== "date" || !!selectedDate || !!selectedSlot || chefNotes.trim().length > 0;
  const isDataTaking = open && step !== "success";

  const storageKey = `viewing_booking_${targetedKitchenId}`;

  const persistProgress = useCallback(
    (next?: Partial<{
      date: Date | undefined;
      slot: TimeSlot | null;
      step: TourStep;
      chefNotes: string;
      registeredInFlow: boolean;
    }>) => {
      const date = next?.date !== undefined ? next.date : selectedDate;
      const slot = next?.slot !== undefined ? next.slot : selectedSlot;
      const st = next?.step ?? step;
      const notes = next?.chefNotes ?? chefNotes;
      const registering = next?.registeredInFlow ?? registeredInFlow;
      if (st === "success") {
        localStorage.removeItem(storageKey);
        return;
      }
      if (date || slot || st !== "date" || notes) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ date, slot, step: st, chefNotes: notes, registeredInFlow: registering })
        );
      } else {
        localStorage.removeItem(storageKey);
      }
    },
    [selectedDate, selectedSlot, step, chefNotes, storageKey, registeredInFlow]
  );

  useEffect(() => {
    if (!open || step === "success" || !progressRestored) return;
    persistProgress();
  }, [open, persistProgress, step, progressRestored]);

  useEffect(() => {
    try {
      const savedData = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey);
      if (!savedData) return;
      const parsed = JSON.parse(savedData);
      if (parsed.date) setSelectedDate(new Date(parsed.date));
      if (parsed.slot) setSelectedSlot(parsed.slot);
      if (parsed.chefNotes) setChefNotes(parsed.chefNotes || "");
      const registering = parsed.registeredInFlow === true;
      setRegisteredInFlow(registering);
      const restoreActor = kitchenActor(isAuthenticated, registering);
      const rawStep: string =
        parsed.step === "intake" || parsed.step === "register"
          ? "account"
          : parsed.step || (parsed.slot ? "time" : "date");
      const restored = coerceTourStepForActor(
        rawStep,
        restoreActor,
        !!parsed.slot,
        emailVerified
      ) as TourStep;
      // Resume fields only — the preview page decides whether to reopen the dialog.
      if (restored !== "date") setStep(restored);
    } catch (e) {
      console.error("Failed to restore tour booking data", e);
    } finally {
      setProgressRestored(true);
    }
    // Re-coerce once auth hydrates so signed-in chefs don't land on verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, isAuthenticated]);

  // After login / in-flow register, advance when we have a slot.
  useEffect(() => {
    if (!selectedSlot) return;
    if (step === "time" || step === "date" || step === "success") return;
    const next = nextTourStepAfterSlot(actor, emailVerified);
    if (next === "confirm" && (step === "verify" || step === "account")) {
      setStep("confirm");
      onRequireOpen?.();
    } else if (next === "verify" && step === "account") {
      setStep("verify");
      onRequireOpen?.();
    }
  }, [actor, emailVerified, selectedSlot, step, onRequireOpen]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const {
    data: availability,
    isLoading: slotsLoading,
    isFetching: slotsFetching,
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
    mutationFn: async () => {
      if (!selectedSlot) throw new Error(ct("noTimeSlotSelected"));
      const headers = await getAuthHeaders(true);
      const response = await fetch("/api/viewings/book", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          locationId,
          targetedKitchenId,
          scheduledAt: selectedSlot.scheduledAt,
          chefNotes: chefNotes || undefined,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (err.code === "SLOT_TAKEN") {
          throw new Error(
            t("timeSlotJustTaken", "This time slot was just taken. Please pick another.")
          );
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
    onSuccess: () => {
      setStep("success");
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
      queryClient.invalidateQueries({ queryKey: ["/api/viewings/chef"] });
      queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] });
      toast.success(t("kitchenTourBookedSuccess", "Tour request sent"));
    },
    onError: (error: Error) => {
      toast.error(error.message);
      if (error.message.includes("slot")) {
        setSelectedSlot(null);
        setStep("time");
      }
    },
  });

  const maxBookingDays = availability?.settings?.maxAdvanceBookingDays || 30;
  const today = startOfDay(new Date());

  const handleDateSelect = useCallback((date: Date | undefined) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    if (date) setStep("time");
  }, []);

  const continueAfterSlot = useCallback(
    (slot: TimeSlot) => {
      setSelectedSlot(slot);
      sessionStorage.removeItem("pending_application_modal");
      saveAuthIntentFromCurrentPage("tour", locationId, targetedKitchenId);

      const next = nextTourStepAfterSlot(actor, emailVerified);
      persistProgress({ slot, step: next });
      setStep(next);
    },
    [actor, emailVerified, locationId, targetedKitchenId, persistProgress]
  );

  const handleBack = useCallback(() => {
    if (step === "time") setStep("date");
    else if (step === "account") setStep("time");
    else if (step === "verify") setStep(isAuthenticated ? "time" : "account");
    else if (step === "confirm") setStep("time");
  }, [step, isAuthenticated]);

  const resetForm = useCallback(() => {
    setStep("date");
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setChefNotes("");
    setRegisteredInFlow(false);
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

  const handleCheckVerified = async () => {
    setIsCheckingVerification(true);
    setVerifyError(null);
    try {
      await auth.currentUser?.reload();
      await refreshUserData();
      const verified = isUserVerified(user);
      if (!verified) {
        setVerifyError(
          t(
            "notVerifiedYet",
            "We haven't detected a verified email address yet. Verify your email, then try again."
          )
        );
        return;
      }
      setStep("confirm");
    } catch {
      setVerifyError(t("verifyCheckFailed", "Could not check verification status. Please try again."));
    } finally {
      setIsCheckingVerification(false);
    }
  };

  const handleResendVerification = async () => {
    if (isResendingVerification || resendCooldown > 0) return;
    const email = auth.currentUser?.email || user?.email;
    if (!email) {
      setVerifyError(
        t("resendVerificationNoEmail", "No email on file. Please register again.")
      );
      return;
    }

    setIsResendingVerification(true);
    setVerifyError(null);
    try {
      await sendVerificationEmailWithFallback({
        email,
        role: "chef",
        returnUrl:
          resolveVerificationReturnPath() ||
          getAuthIntent()?.returnPath ||
          `${window.location.pathname}${window.location.search}`,
      });
      setResendCooldown(60);
      toast.success(t("verificationEmailSent", "Verification email sent"));
    } catch (err) {
      setVerifyError(
        err instanceof Error && err.message
          ? err.message
          : t("resendVerificationFailed", "Failed to resend verification email.")
      );
    } finally {
      setIsResendingVerification(false);
    }
  };

  const guidedChrome = (() => {
    switch (step) {
      case "date":
        return {
          title: t("tourModalDateTitle", "Pick a tour date"),
          subtext: t(
            "tourModalDateSubtext",
            "Choose a day to visit in person. You’re not applying — just checking if it fits."
          ),
        };
      case "time":
        return {
          title: t("tourModalTimeTitle", "Choose a time"),
          subtext: t("tourModalTimeSubtext", "Select an available time slot for your visit."),
        };
      case "account":
        return {
          title: t("tourModalAccountTitle", "Continue with your account"),
          subtext: t(
            "tourModalAccountSubtext",
            "Sign in or create an account to continue your tour request."
          ),
        };
      case "verify":
        return {
          title: t("tourModalVerifyTitle", "We’re waiting on you"),
          subtext: t(
            "tourModalVerifySubtext",
            "Check your email (and spam) and click the verify link. Nothing else happens until you do."
          ),
        };
      case "confirm":
        return {
          title: t("tourModalConfirmTitle", "Confirm your visit"),
          subtext: t(
            "tourModalConfirmSubtext",
            "Double-check the time. Optional notes help the manager prepare."
          ),
        };
      case "success":
        return {
          title: t("tourModalDoneTitle", "Tour requested"),
          subtext: t(
            "tourModalDoneSubtext",
            "Local Cooks reviews your request first. If approved, the kitchen manager will receive it. We'll email you with updates."
          ),
        };
      default:
        return {
          title: t("scheduleKitchenTour", "Request a Kitchen Tour"),
          subtext: t("bookInPersonKitchenTour", {
            defaultValue: "Request an in-person kitchen tour of {locationName}",
            locationName: locationName || t("theKitchenFacility", "the kitchen facility"),
          }),
        };
    }
  })();

  const renderGuideRail = () => {
    const steps: { id: string; label: string }[] = skipVerify
      ? [
          { id: "date", label: t("tourGuideStepDate") },
          { id: "time", label: t("tourGuideStepTime") },
          { id: "confirm", label: t("tourGuideStepConfirmShort") },
        ]
      : [
          { id: "date", label: t("tourGuideStepDate") },
          { id: "time", label: t("tourGuideStepTime") },
          { id: "account", label: t("tourGuideStepAccount") },
          { id: "confirm", label: t("tourGuideStepConfirm") },
        ];
    const railIdx = skipVerify
      ? step === "date"
        ? 0
        : step === "time"
          ? 1
          : 2
      : step === "date"
        ? 0
        : step === "time"
          ? 1
          : step === "account" || step === "verify"
            ? 2
            : 3;

    return <KitchenJourneySteps steps={steps.map((s) => s.label.replace(/^\d+\.\s*/, ""))} current={railIdx} />;
  };

  const renderDateStep = () => (
    <div className="space-y-3">
      <div className={presentation === "page" ? journeyCalendarContainer : "flex justify-center"}>
        <Calendar
          mode="single"
          numberOfMonths={presentation === "page" && !isMobile ? 2 : 1}
          pagedNavigation={presentation === "page" && !isMobile}
          selected={selectedDate}
          onSelect={handleDateSelect}
          disabled={(date) => {
            const maxDays = calMetadata?.settings?.maxAdvanceBookingDays || maxBookingDays;
            if (isBefore(date, today) || isBefore(addDays(today, maxDays), date)) return true;
            if (!calMetadata) return true;
            const dayOfWeek = date.getDay();
            const availDay = calMetadata.availability?.find((a: { dayOfWeek: number; isAvailable?: boolean }) => a.dayOfWeek === dayOfWeek);
            if (!availDay || !availDay.isAvailable) return true;
            const dStart = startOfDay(date);
            for (const b of calMetadata.blackouts || []) {
              if (
                dStart >= startOfDay(new Date(b.startDate)) &&
                dStart <= endOfDay(new Date(b.endDate))
              ) {
                return true;
              }
            }
            const ds = format(date, "yyyy-MM-dd");
            if (calMetadata.fullyBookedDates?.includes(ds)) return true;
            return false;
          }}
          className={presentation === "page" ? "w-full bg-transparent p-1" : "rounded-xl border"}
          classNames={presentation === "page" ? journeyCalendarClassNames(!isMobile) : undefined}
        />
      </div>
    </div>
  );

  const renderTimeStep = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
        </p>
        <Button variant="ghost" size="sm" className="shrink-0 text-primary" onClick={handleBack}>Change date</Button>
      </div>

      {slotsLoading || slotsFetching ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            {t("loadingAvailableTimes", "Loading available times...")}
          </span>
        </div>
      ) : availability?.slots.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <Clock className="h-10 w-10 mx-auto text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">
            {t("noAvailableTimeSlots", "No available time slots on this date.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => setStep("date")}>
            <CalendarDays className="h-4 w-4 mr-2" />
            {t("tryAnotherDate", "Try another date")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-3 sm:grid-cols-4">
          {availability?.slots.map((slot) => (
            <KitchenJourneyTimeSlot
              key={slot.scheduledAt}
              label={`${formatJourneyClock(slot.startTime)} – ${formatJourneyClock(slot.endTime)}`}
              selected={selectedSlot?.scheduledAt === slot.scheduledAt}
              onClick={() => continueAfterSlot(slot)}
            />
          ))}
        </div>
      )}
    </div>
  );

  const renderAccountStep = () => (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={handleBack} className="self-start -ml-2 text-gray-500">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Change visit time
      </Button>
      <KitchenJourneyAuth title="Continue your tour request" />
    </div>
  );

  const renderVerifyStep = () => presentation === "page" ? (
    <KitchenJourneyAuth title="Verify your email to continue" />
  ) : (
    <div className="space-y-4">
      <div className="rounded-[1.35rem] border-2 border-[#F51042]/30 bg-[#F51042]/5 p-5 text-center space-y-3">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F51042] text-white">
          <Mail className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-lg font-bold text-gray-900 leading-snug">
          {t("applyVerifyWaitingHeadline", "Open your email and verify")}
        </p>
        <ol className="text-left text-sm text-gray-800 space-y-2 max-w-sm mx-auto">
          <li className="flex gap-2">
            <span className="font-bold text-[#F51042] shrink-0">1.</span>
            <span>
              {t("applyVerifyStep1", "Open the email from Local Cooks")}
              {user?.email ? (
                <>
                  {" "}
                  (<span className="font-semibold break-all">{user.email}</span>)
                </>
              ) : null}
              {t("applyVerifyStep1Spam", " — check your spam folder if you don’t see it")}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-[#F51042] shrink-0">2.</span>
            <span>
              {t("applyVerifyStep2", "Click the “Verify my email” button in that email")}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-[#F51042] shrink-0">3.</span>
            <span>{t("applyVerifyStep3", "Come back here and tap Continue below")}</span>
          </li>
        </ol>
        <p className="text-sm font-medium text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {t("applyVerifySpamOneLiner", "Tip: it often lands in Spam or Promotions.")}
        </p>
      </div>
      {verifyError && <p className="text-sm text-red-600 text-center">{verifyError}</p>}
      <Button
        className="w-full bg-[#F51042] hover:bg-[#E00A38] text-white"
        onClick={() => void handleCheckVerified()}
        disabled={isCheckingVerification}
      >
        {isCheckingVerification ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t("checkingVerification", "Checking...")}
          </>
        ) : (
          t("applyVerifyContinueBtn", "I’ve verified — continue")
        )}
      </Button>
      <button
        type="button"
        onClick={() => void handleResendVerification()}
        disabled={isResendingVerification || resendCooldown > 0}
        className="w-full text-sm font-medium text-gray-600 hover:text-gray-900 py-1.5 flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {isResendingVerification ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t("sendingVerificationEmail", "Sending...")}
          </>
        ) : resendCooldown > 0 ? (
          t("resendVerificationWait", {
            seconds: resendCooldown,
            defaultValue: `Resend in ${resendCooldown}s`,
          })
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("resendVerificationEmail", "Resend email")}
          </>
        )}
      </button>
      <Button variant="ghost" size="sm" onClick={handleBack} className="w-full text-gray-500">
        <ArrowLeft className="h-4 w-4 mr-1" />
        {t("modalBack")}
      </Button>
    </div>
  );

  const renderConfirmStep = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{t("confirmKitchenTour", "Confirm your kitchen tour request")}</h3>
        <Button variant="ghost" size="sm" className="shrink-0 text-primary" onClick={handleBack}>Edit time</Button>
      </div>

      <Card className="border-primary/20">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {locationName || t("applyFlowKitchenFallbackName", "Kitchen")}
              </p>
              {targetedKitchenName && (
                <p className="text-xs text-muted-foreground">
                  {t("interestedIn", {
                    defaultValue: "Interested in: {name}",
                    name: targetedKitchenName,
                  })}
                </p>
              )}
            </div>
          </div>
          <Separator />
          <div className="flex items-start gap-3">
            <CalendarDays className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedSlot && `${formatJourneyClock(selectedSlot.startTime)} – ${formatJourneyClock(selectedSlot.endTime)}`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Optional after required summary */}
      <div className="space-y-2">
        <Label className="text-sm">
          {t(
            "anythingSpecificToSee",
            "Anything specific you want to see or discuss? (optional)"
          )}
        </Label>
        <Textarea
          value={chefNotes}
          onChange={(e) => setChefNotes(e.target.value)}
          placeholder={t("egEquipmentNeeds", "e.g., equipment needs, storage requirements...")}
          maxLength={500}
          rows={3}
        />
        <p className="text-xs text-muted-foreground text-right">{chefNotes.length}/500</p>
      </div>

      <Button
        className="w-full bg-[#F51042] hover:bg-[#E00A38] text-white"
        size="lg"
        data-testid="tour-request-submit"
        // Left enabled for unverified users so the guard can explain the refusal
        // instead of presenting a dead control with no reason attached.
        onClick={() => guard(() => bookMutation.mutate())}
        disabled={bookMutation.isPending || !isAuthenticated}
      >
        {bookMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t("bookingStatus", "Booking...")}
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            {t("bookKitchenTour", "Request Kitchen Tour")}
          </>
        )}
      </Button>
      <p className="text-xs text-center text-muted-foreground">
        {t(
          "receiveConfirmationNotification",
          "You'll receive a confirmation notification and email."
        )}
      </p>
    </div>
  );

  const renderSuccessStep = () => (
    <div className="text-center space-y-4 py-2">
      <div className="mx-auto w-14 h-14 rounded-full border flex items-center justify-center">
        <CheckCircle className="h-7 w-7 text-emerald-600" />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-center gap-2">
          <h3 className="text-lg font-semibold">
            {t("kitchenTourRequested", "Kitchen Tour Requested")}
          </h3>
          <InfoChip variant="warning">{t("underReview", "Under review")}</InfoChip>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("kitchenTourRequestedAwaitingApproval", {
            defaultValue:
              "Your kitchen tour at {locationName} has been sent to Local Cooks for review. If approved, it will then go to the kitchen manager.",
            locationName: locationName || t("theKitchen", "the kitchen"),
          })}
        </p>
      </div>

      <Card className="bg-muted/50 text-left">
        <CardContent className="pt-4 text-sm space-y-1.5">
          <p>
            <span className="text-muted-foreground">{t("dateLabel", "Date:")}</span>{" "}
            <span className="font-medium">
              {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">{t("timeLabel", "Time:")}</span>{" "}
            <span className="font-medium">
              {selectedSlot && `${formatJourneyClock(selectedSlot.startTime)} – ${formatJourneyClock(selectedSlot.endTime)}`}
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 pt-1">
        <Button
          className="w-full bg-[#F51042] hover:bg-[#E00A38] text-white"
          onClick={() => {
            onClose?.();
            setLocation(chefDashboardHref("viewings"));
          }}
        >
          {t("viewMyTours", "View My Tours")}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            resetForm();
            onClose?.();
          }}
        >
          {t("doneStayOnPreview", "Done")}
        </Button>
      </div>
    </div>
  );

  // In the dialog the wizard owns the scrolling, so this is its scroll body.
  // In `presentation="page"` it sits inside KitchenJourneyLayout where the
  // DOCUMENT is the scroller — and a nested overflow-y-auto that cannot scroll
  // still swallows the wheel instead of chaining it to the page, which froze
  // scrolling over the whole right column. Only be a scroll container in dialog mode.
  const body = (
    <div className={presentation === "page" ? undefined : "min-h-0 flex-1 overflow-y-auto overscroll-contain"}>
      {step === "date" && renderDateStep()}
      {step === "time" && renderTimeStep()}
      {step === "account" && renderAccountStep()}
      {step === "verify" && renderVerifyStep()}
      {step === "confirm" && renderConfirmStep()}
      {step === "success" && renderSuccessStep()}
    </div>
  );

  return (
    <>
      {presentation === "page" ? (
        <KitchenJourneyLayout
          eyebrow="Request a tour"
          title={`Visit ${targetedKitchenName || locationName || "this kitchen"}`}
          description="See the space in person before you request access. Choose a date and time, then use your Local Cooks account to send the tour request."
          imageUrl={kitchenImageUrl}
          onBack={requestClose}
          aside={<div className="flex flex-col gap-6">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">Your progress</p>
              <h2 className="text-2xl font-semibold tracking-tight">{guidedChrome.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{guidedChrome.subtext}</p>
            </div>
            {step !== "success" && renderGuideRail()}
            <div className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{targetedKitchenName || locationName}</p>
              {selectedDate && selectedSlot ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>{format(selectedDate, "EEE, MMM d, yyyy")}</span>
                  <span aria-hidden className="text-muted-foreground/60">·</span>
                  <span className="font-medium text-foreground">
                    {formatJourneyClock(selectedSlot.startTime)}–{formatJourneyClock(selectedSlot.endTime)}
                  </span>
                </p>
              ) : (
                <p className="mt-1">Pick a visit time. Local Cooks reviews each tour request before the kitchen sees it.</p>
              )}
            </div>
          </div>}
        >
          <div className="min-w-0">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-primary">{step === "date" ? "Step 1 · Choose a date" : step === "time" ? "Step 2 · Choose a time" : "Your tour request"}</p>
            <div className="max-w-3xl">{body}</div>
          </div>
        </KitchenJourneyLayout>
      ) : <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) requestClose();
        }}
      >
        <DialogContent
          showCloseButton={step === "success" || !isDataTaking}
          className={cn(
            "p-0 !overflow-hidden bg-background max-h-[90vh] flex flex-col sm:flex-row sm:max-w-[820px]"
          )}
          onPointerDownOutside={(e) => {
            if (isDataTaking) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isDataTaking) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (isDataTaking) {
              e.preventDefault();
              requestClose();
            }
          }}
        >
          <div className="hidden sm:flex sm:w-5/12 shrink-0 flex-col p-8 border-r border-gray-100 bg-[#F8F9FA] overflow-hidden">
            <DialogHeader className="text-left space-y-4">
              <DialogTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <MapPin className="h-5 w-5 text-[#F51042] shrink-0" />
                {guidedChrome.title}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="text-muted-foreground text-sm leading-relaxed space-y-6">
                  <p className="text-gray-600 text-[15px]">{guidedChrome.subtext}</p>
                  {step !== "success" && renderGuideRail()}
                </div>
              </DialogDescription>
            </DialogHeader>
            {isDataTaking && (
              <Button
                type="button"
                variant="ghost"
                className="mt-auto self-start text-gray-500"
                onClick={requestClose}
              >
                <Icon icon="mdi:close" className="size-4" aria-hidden />
                Cancel
              </Button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 px-6 pt-6 pb-4 sm:hidden">
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold text-gray-900">
                  {guidedChrome.title}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="text-muted-foreground mt-2 text-sm leading-relaxed space-y-3">
                    <p>{guidedChrome.subtext}</p>
                    {step !== "success" && renderGuideRail()}
                  </div>
                </DialogDescription>
              </DialogHeader>
              {isDataTaking && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 -ml-2 self-start text-gray-500"
                  onClick={requestClose}
                >
                  <Icon icon="mdi:close" className="size-4" aria-hidden />
                  Cancel
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 flex flex-col px-6 pb-6 sm:px-8 sm:pb-8 sm:pt-8">
              {body}
            </div>
          </div>
        </DialogContent>
      </Dialog>}

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
