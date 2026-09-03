/**
 * ScheduleViewingWidget — request an in-person kitchen tour (visit only, not an application).
 * Guest: Date → Time → Account → Verify → Confirm → Success
 * Signed-in (including veterans): Date → Time → Confirm → Success
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  MapPin,
  Loader2,
  CheckCircle,
  ArrowLeft,
  Building2,
  Send,
  Mail,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import { useLocation } from "wouter";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { saveAuthIntentFromCurrentPage, getAuthIntent, resolveVerificationReturnPath, kitchenActor, nextTourStepAfterSlot, coerceTourStepForActor, skipKitchenVerify } from "@/lib/auth-intent";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { format, addDays, isBefore, startOfDay, endOfDay } from "date-fns";
import { ct } from "@/i18n/chef-ns";

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
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
  targetedKitchenId?: number;
  targetedKitchenName?: string;
  onClose?: () => void;
  onRequireOpen?: () => void;
  open?: boolean;
}

function isUserVerified(
  user: { is_verified?: boolean; isVerified?: boolean; emailVerified?: boolean } | null | undefined
): boolean {
  const firebaseVerified = !!auth.currentUser?.emailVerified;
  const dbVerified = !!(user?.is_verified || user?.isVerified || user?.emailVerified);
  return firebaseVerified || dbVerified;
}

export function ScheduleViewingWidget({
  locationId,
  locationName,
  targetedKitchenId,
  targetedKitchenName,
  onClose,
  onRequireOpen,
  open = true,
}: ScheduleViewingWidgetProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("kitchen");
  const { user, refreshUserData } = useFirebaseAuth();
  const [, setLocation] = useLocation();
  const isAuthenticated = !!user;
  const [registeredInFlow, setRegisteredInFlow] = useState(false);
  const actor = kitchenActor(isAuthenticated, registeredInFlow);
  const skipVerify = skipKitchenVerify(actor);

  const [step, setStep] = useState<TourStep>("date");
  const [authTab, setAuthTab] = useState<"register" | "login">("register");
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

  const storageKey = `viewing_booking_${locationId}`;

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
        sessionStorage.removeItem(storageKey);
        return;
      }
      if (date || slot || st !== "date" || notes) {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ date, slot, step: st, chefNotes: notes, registeredInFlow: registering })
        );
      } else {
        sessionStorage.removeItem(storageKey);
      }
    },
    [selectedDate, selectedSlot, step, chefNotes, storageKey, registeredInFlow]
  );

  useEffect(() => {
    if (!open || step === "success") return;
    persistProgress();
  }, [open, persistProgress, step]);

  useEffect(() => {
    try {
      const savedData = sessionStorage.getItem(storageKey);
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
      const restored = coerceTourStepForActor(rawStep, restoreActor, !!parsed.slot) as TourStep;
      // Resume fields only — the preview page decides whether to reopen the dialog.
      if (restored !== "date") setStep(restored);
    } catch (e) {
      console.error("Failed to restore tour booking data", e);
    }
    // Re-coerce once auth hydrates so signed-in chefs don't land on verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, isAuthenticated]);

  // After login / in-flow register, advance when we have a slot.
  useEffect(() => {
    if (!selectedSlot) return;
    if (step === "time" || step === "date" || step === "success") return;
    const next = nextTourStepAfterSlot(actor);
    if (next === "confirm" && (step === "verify" || step === "account")) {
      setStep("confirm");
      onRequireOpen?.();
    } else if (next === "verify" && step === "account") {
      setStep("verify");
      onRequireOpen?.();
    }
  }, [actor, selectedSlot, step, onRequireOpen]);

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
    queryKey: [`/api/viewings/available-slots/${locationId}?date=${dateStr}`],
    enabled: !!selectedDate && !!dateStr,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: calMetadata } = useQuery({
    queryKey: [`/api/viewings/calendar-availability/${locationId}`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/viewings/calendar-availability/${locationId}`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!locationId,
  });

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error(ct("noTimeSlotSelected"));
      const headers = await getAuthHeaders();
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
        throw new Error(err.error || t("failedToBookViewing", "Failed to book viewing"));
      }
      return response.json();
    },
    onSuccess: () => {
      setStep("success");
      sessionStorage.removeItem(storageKey);
      queryClient.invalidateQueries({ queryKey: ["/api/viewings/chef"] });
      queryClient.invalidateQueries({ queryKey: ["/api/viewings", "chef"] });
      toast.success(t("kitchenTourBookedSuccess", "Kitchen tour booked!"));
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

      const next = nextTourStepAfterSlot(actor);
      persistProgress({ slot, step: next });
      if (next === "account") setAuthTab("register");
      setStep(next);
    },
    [actor, locationId, targetedKitchenId, persistProgress]
  );

  const handleBack = useCallback(() => {
    if (step === "time") setStep("date");
    else if (step === "account") setStep("time");
    else if (step === "verify") setStep(isAuthenticated ? "time" : "account");
    else if (step === "confirm") setStep(skipVerify ? "time" : "verify");
  }, [step, skipVerify, isAuthenticated]);

  const resetForm = useCallback(() => {
    setStep("date");
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setChefNotes("");
    setRegisteredInFlow(false);
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
      const verified =
        !!auth.currentUser?.emailVerified || isUserVerified(user);
      if (!verified) {
        setVerifyError(
          t(
            "notVerifiedYet",
            "We haven't detected your verification yet. Click the link in your email, wait a few seconds, and try again."
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
          title: t("tourModalAccountTitle", "Create your account"),
          subtext: t(
            "tourModalAccountSubtext",
            "We need an account so the kitchen can confirm your visit. You’re not applying yet."
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
            "The kitchen will review and email you. Check spam for that email too."
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

    return (
      <ol className="space-y-2.5">
        {steps.map((s, idx) => {
          const done = step === "success" || idx < railIdx;
          const current = step !== "success" && idx === railIdx;
          return (
            <li key={s.id} className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done && "bg-[#F51042] text-white",
                  current && "bg-[#F51042]/15 text-[#F51042] ring-2 ring-[#F51042]/25",
                  !done && !current && "bg-gray-100 text-gray-400"
                )}
              >
                {done ? <CheckCircle className="h-4 w-4" /> : idx + 1}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  current || done ? "text-gray-900" : "text-gray-400"
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    );
  };

  const renderDateStep = () => (
    <div className="space-y-3">
      <div className="flex justify-center">
        <Calendar
          mode="single"
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
          className="rounded-md border"
        />
      </div>
    </div>
  );

  const renderTimeStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="text-sm text-muted-foreground">
          {selectedDate && format(selectedDate, "EEEE, MMMM d, yyyy")}
        </p>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[280px] overflow-y-auto">
          {availability?.slots.map((slot) => (
            <Button
              key={slot.scheduledAt}
              variant={selectedSlot?.scheduledAt === slot.scheduledAt ? "default" : "outline"}
              className={cn(
                "h-auto py-3 flex flex-col gap-0.5",
                selectedSlot?.scheduledAt === slot.scheduledAt &&
                  "ring-2 ring-primary ring-offset-2"
              )}
              onClick={() => continueAfterSlot(slot)}
            >
              <span className="text-sm font-medium">{slot.startTime}</span>
              <span className="text-[10px] text-muted-foreground">
                {t("toTime", { defaultValue: "to {endTime}", endTime: slot.endTime })}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );

  const renderAccountStep = () => (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={handleBack} className="self-start -ml-2 text-gray-500">
        <ArrowLeft className="h-4 w-4 mr-1" />
        {t("modalBack")}
      </Button>
      {authTab === "login" ? (
        <EnhancedLoginForm
          onSuccess={async () => {
            await refreshUserData();
            setRegisteredInFlow(false);
            setStep("confirm");
            persistProgress({ step: "confirm", registeredInFlow: false });
          }}
          onSwitchToRegister={() => setAuthTab("register")}
        />
      ) : (
        <EnhancedRegisterForm
          hideApplyingToggle
          onSwitchToLogin={() => setAuthTab("login")}
          onRegistrationComplete={() => {
            // signup() already sends verification — avoid a second send (rate limits).
            setRegisteredInFlow(true);
            setStep("verify");
            persistProgress({ step: "verify", registeredInFlow: true });
          }}
          onSuccess={async () => {
            await refreshUserData();
            if (auth.currentUser?.emailVerified) {
              setRegisteredInFlow(false);
              setStep("confirm");
              persistProgress({ step: "confirm", registeredInFlow: false });
            } else {
              setRegisteredInFlow(true);
              setStep("verify");
              persistProgress({ step: "verify", registeredInFlow: true });
              const email = auth.currentUser?.email;
              if (email) {
                try {
                  await sendVerificationEmailWithFallback({
                    email,
                    role: "chef",
                    returnUrl:
                      resolveVerificationReturnPath() ||
                      getAuthIntent()?.returnPath ||
                      `${window.location.pathname}${window.location.search}`,
                  });
                } catch (err) {
                  console.error("Tour Google verification email send failed:", err);
                  setVerifyError(
                    err instanceof Error && err.message
                      ? err.message
                      : t(
                          "resendVerificationFailed",
                          "Failed to send verification email. Tap Resend below."
                        )
                  );
                }
              }
            }
          }}
        />
      )}
    </div>
  );

  const renderVerifyStep = () => (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-[#F51042]/30 bg-[#F51042]/5 p-5 text-center space-y-3">
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
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-base font-semibold">{t("confirmKitchenTour", "Confirm your kitchen tour request")}</h3>
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
                {selectedSlot?.startTime} — {selectedSlot?.endTime}
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
        onClick={() => bookMutation.mutate()}
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
          <Badge variant="success">{t("confirmed", "Confirmed")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("kitchenTourRequestedAwaitingApproval", {
            defaultValue:
              "Your kitchen tour at {locationName} has been requested and is awaiting manager approval.",
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
              {selectedSlot?.startTime} — {selectedSlot?.endTime}
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

  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
      <Dialog
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
                  Cancel
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 flex flex-col px-6 pb-6 sm:px-8 sm:pb-8 sm:pt-8">
              {body}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </>
  );
}

export default ScheduleViewingWidget;
