import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import EnhancedLoginForm from "./EnhancedLoginForm";
import EnhancedRegisterForm from "./EnhancedRegisterForm";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  normalizePhoneNumber,
  isValidNorthAmericanPhone,
} from "@shared/phone-validation";
import { KitchenNextStepsDescription } from "@/components/common/KitchenNextStepsDescription";
import {
  getPendingApplicationModal,
  savePendingApplicationModal,
  clearPendingApplicationModal,
  clearAbandonedApplicationSession,
  getAuthIntent,
  resolveVerificationReturnPath,
  kitchenActor,
  skipKitchenVerify,
  resolvePendingApplyPhase,
  type KitchenActor,
  type PendingApplicationPhase,
  type PendingApplicationReview,
} from "@/lib/auth-intent";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { resolveChefDashboardNavigation } from "@shared/subdomain-utils";
import { CheckCircle2, Loader2, Clock, RefreshCw, Mail } from "lucide-react";
import {
  KitchenBookingPreferencesPanel,
  type EquipmentListingOption,
  type StorageListingOption,
} from "@/components/kitchen-application/KitchenBookingPreferencesPanel";
import { BookingPriceSummary } from "@/components/kitchen-application/BookingPriceSummary";
import {
  RequestToApplyFields,
  EMPTY_REQUEST_TO_APPLY_DRAFT,
  type RequestToApplyDraft,
} from "@/components/kitchen-application/request-to-apply-fields";
import {
  usePersistedBookingPricePreview,
  type PersistedBookingPricePreview,
} from "@/lib/persisted-booking-prefs";
import { Button } from "@/components/ui/button";

function ApplyBookingPriceFooter({
  preview,
  isLoading,
  kitchenName,
  className,
}: {
  preview: PersistedBookingPricePreview | null;
  isLoading?: boolean;
  kitchenName?: string;
  className?: string;
}) {
  const { t } = useTranslation("kitchen");

  if (isLoading && !preview) {
    return (
      <div
        className={cn(
          "rounded-xl border border-gray-200 bg-white px-3 py-4 flex items-center justify-center gap-2",
          className
        )}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 animate-spin text-[#F51042]" aria-hidden />
        <span className="text-xs text-muted-foreground">
          {t("calculatingPrice", "Calculating estimate...")}
        </span>
      </div>
    );
  }

  if (preview) {
    return (
      <div className={cn("relative", className)}>
        <BookingPriceSummary
          compact
          className={cn(isLoading && "opacity-50 pointer-events-none")}
          estimate={preview.estimate}
          hourlyRateCents={preview.hourlyRateCents}
          currency={preview.currency}
          kitchenName={kitchenName}
          dateLabel={preview.dateLabel}
          slotsLabel={preview.slotsLabel}
        />
        {isLoading ? (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-5 w-5 animate-spin text-[#F51042]" aria-hidden />
            <span className="sr-only">{t("calculatingPrice", "Calculating estimate...")}</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-gray-200 bg-white/70 px-3 py-3",
        className
      )}
    >
      <p className="text-xs font-medium text-gray-500">
        {t("priceFooterPlaceholderTitle", "Estimated total")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {t(
          "priceFooterPlaceholderDesc",
          "Select a date and hours to see kitchen price, taxes, and fees."
        )}
      </p>
    </div>
  );
}

export interface AuthBookingContext {
  kitchenId: string;
  kitchenName?: string;
  equipmentListings?: { included?: EquipmentListingOption[]; rental?: EquipmentListingOption[] } | null;
  storageListings?: StorageListingOption[] | null;
}

interface AuthModalOptions {
  title?: ReactNode;
  description?: ReactNode;
  defaultTab?: "login" | "register";
  preAuthComponent?: ReactNode;
  requireApplication?: boolean;
  bookingContext?: AuthBookingContext;
}

interface RegistrationReviewData extends PendingApplicationReview {}

function isUserVerified(
  user: { is_verified?: boolean; isVerified?: boolean; emailVerified?: boolean } | null | undefined
): boolean {
  const firebaseVerified = !!auth.currentUser?.emailVerified;
  const dbVerified = !!(user?.is_verified || user?.isVerified || user?.emailVerified);
  return firebaseVerified || dbVerified;
}

function reviewFromFormData(data: Record<string, unknown>, email: string): RegistrationReviewData {
  return {
    fullName: (data.displayName as string) || (data.fullName as string),
    email: (data.email as string) || email,
    phone: data.phone as string,
    shopName: data.shopName as string,
    shopAddress: data.shopAddress as string,
    businessType: data.businessType as string,
    experience: data.experience as string,
    businessDescription: data.businessDescription as string,
    kitchenPreference: data.kitchenPreference as string,
    foodSafetyLicense: data.foodSafetyLicense as string,
    foodEstablishmentCert: data.foodEstablishmentCert as string,
  };
}

type ApplyUiStep = "request" | "details" | "verify" | "submit" | "done";

function applyStepFromPhase(
  applicationPhase: PendingApplicationPhase | null,
  skipVerify: boolean
): ApplyUiStep | null {
  if (applicationPhase === "submitted") return "done";
  if (applicationPhase === "ready_to_submit") return skipVerify ? "details" : "submit";
  if (applicationPhase === "awaiting_verification") return skipVerify ? "details" : "verify";
  return null;
}

type ApplyDraft = RequestToApplyDraft;
const EMPTY_APPLY_DRAFT = EMPTY_REQUEST_TO_APPLY_DRAFT;

function ApplyGuideRail({ step, skipVerify }: { step: ApplyUiStep; skipVerify?: boolean }) {
  const { t } = useTranslation("kitchen");
  const steps: { id: "request" | "verify" | "submit"; label: string }[] = skipVerify
    ? [
        { id: "request", label: t("applyGuideStepRequest") },
        { id: "submit", label: t("applyGuideStepDetailsSubmit") },
      ]
    : [
        { id: "request", label: t("applyGuideStepRequest") },
        { id: "verify", label: t("applyGuideStepVerify") },
        { id: "submit", label: t("applyGuideStepSubmit") },
      ];
  const railStep: "request" | "verify" | "submit" = skipVerify
    ? step === "request"
      ? "request"
      : "submit"
    : step === "request" || step === "details"
      ? "request"
      : step === "verify"
        ? "verify"
        : "submit";
  const order = (skipVerify ? ["request", "submit"] : ["request", "verify", "submit"]) as readonly (
    | "request"
    | "verify"
    | "submit"
  )[];
  const currentIdx = order.indexOf(railStep);

  return (
    <ol className="space-y-2.5">
      {steps.map((s, idx) => {
        const done = step === "done" || idx < currentIdx;
        const current = step !== "done" && idx === currentIdx;
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
              {done ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
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
}

interface AuthModalContextType {
  isOpen: boolean;
  openAuthModal: (options?: AuthModalOptions) => void;
  closeAuthModal: () => void;
  showAuthForms: () => void;
}

const AuthModalContext = createContext<AuthModalContextType | undefined>(undefined);

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error("useAuthModal must be used within an AuthModalProvider");
  }
  return context;
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation(["kitchen", "auth"]);
  const { user, updateUserVerification, loading: authLoading } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<AuthModalOptions>({});
  const [activeTab, setActiveTab] = useState<"login" | "register">("register");
  const [showVerificationSuccess, setShowVerificationSuccess] = useState(false);
  const [showPreAuth, setShowPreAuth] = useState(false);
  const [registrationReview, setRegistrationReview] = useState<RegistrationReviewData | null>(null);
  const [applicationPhase, setApplicationPhase] = useState<PendingApplicationPhase | null>(null);
  const [isSubmittingApplication, setIsSubmittingApplication] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingPrefsValid, setBookingPrefsValid] = useState(true);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [applyDraft, setApplyDraft] = useState<ApplyDraft>(EMPTY_APPLY_DRAFT);
  const [applyUiStep, setApplyUiStep] = useState<ApplyUiStep>("request");
  const [stepValid, setStepValid] = useState(false);

  const hasSubmittedRef = useRef(false);
  const pendingRestoredRef = useRef(false);
  const [registeredInFlow, setRegisteredInFlow] = useState(false);
  const actor: KitchenActor = kitchenActor(!!user, registeredInFlow);
  const skipVerify = skipKitchenVerify(actor);
  const showBookingPrefs = !!options.bookingContext;
  const { preview: bookingPricePreview, isLoading: bookingPriceLoading } =
    usePersistedBookingPricePreview(
      isOpen && options.bookingContext?.kitchenId
        ? options.bookingContext.kitchenId
        : undefined
    );
  const isDataTakingFlow =
    isOpen && applicationPhase !== "submitted";

  const restorePendingModal = (
    pending: NonNullable<ReturnType<typeof getPendingApplicationModal>>,
    restoreSkipVerify: boolean
  ) => {
    const intent = getAuthIntent();
    const modalType = pending.modalType || intent?.type || "book";
    const kitchenId = intent?.kitchenId?.toString();
    setOptions({
      requireApplication: true,
      title: pending.title || t("authModalNextStepsTitle", "Almost there!"),
      description: <KitchenNextStepsDescription type={modalType} />,
      defaultTab: "register",
      bookingContext:
        modalType === "book" && kitchenId
          ? { kitchenId, kitchenName: undefined }
          : undefined,
    });
    setRegistrationReview(pending.review);
    setApplicationPhase(pending.phase);
    setApplyUiStep(
      applyStepFromPhase(pending.phase, restoreSkipVerify) ||
        (restoreSkipVerify ? "details" : "verify")
    );
    setActiveTab("register");
    // Request step already collected dates/slots before verify — don't leave Submit disabled.
    setBookingPrefsValid(true);
    setIsOpen(true);
  };

  // Restore after auth hydrates so signed-in chefs aren't sent to the guest verify step.
  useEffect(() => {
    if (authLoading || pendingRestoredRef.current) return;
    pendingRestoredRef.current = true;
    const pending = getPendingApplicationModal();
    if (!pending || pending.phase === "submitted") return;
    const registering = pending.registeredInFlow === true;
    setRegisteredInFlow(registering);
    const restoreActor = kitchenActor(!!user, registering);
    const phase = resolvePendingApplyPhase(
      pending.phase,
      restoreActor,
      isUserVerified(user)
    );
    if (phase !== pending.phase) {
      savePendingApplicationModal({ ...pending, phase, registeredInFlow: registering });
    }
    restorePendingModal({ ...pending, phase, registeredInFlow: registering }, skipKitchenVerify(restoreActor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  // Check for verification success in URL params globally
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("verified") !== "true") return;

    setShowVerificationSuccess(true);
    const newUrl = window.location.pathname;
    window.history.replaceState({}, "", newUrl);

    const pending = getPendingApplicationModal();
    if (pending && pending.phase !== "submitted") {
      const registering = pending.registeredInFlow === true;
      setRegisteredInFlow(registering);
      const urlActor = kitchenActor(!!user, registering);
      const phase = resolvePendingApplyPhase(
        pending.phase,
        urlActor,
        isUserVerified(user)
      );
      savePendingApplicationModal({ ...pending, phase, registeredInFlow: registering });
      restorePendingModal(
        { ...pending, phase, registeredInFlow: registering },
        skipKitchenVerify(urlActor)
      );
      setTimeout(() => setShowVerificationSuccess(false), 5000);
      return;
    }

    if (user && isUserVerified(user)) {
      setTimeout(() => setShowVerificationSuccess(false), 5000);
      return;
    }

    setOptions({ defaultTab: "login" });
    setActiveTab("login");
    setIsOpen(true);
    setTimeout(() => setShowVerificationSuccess(false), 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // When email becomes verified during an in-progress kitchen application flow,
  // advance to ready_to_submit and reopen the modal if it was dismissed.
  // Already-signed-in chefs skip verification entirely.
  useEffect(() => {
    if (applicationPhase !== "awaiting_verification") return;
    if (!user) return;
    if (!skipVerify && !isUserVerified(user)) return;

    setApplicationPhase("ready_to_submit");
    const pending = getPendingApplicationModal();
    if (pending) {
      savePendingApplicationModal({ ...pending, phase: "ready_to_submit" });
    }
    setBookingPrefsValid(true);
    setIsOpen(true);
  }, [user, applicationPhase, skipVerify]);

  useEffect(() => {
    if (!isOpen) return;
    let stored: Record<string, string> = {};
    try {
      const raw = window.localStorage.getItem("pendingRegistrationData");
      if (raw) stored = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    setApplyDraft((d) => ({
      ...d,
      fullName:
        d.fullName ||
        stored.fullName ||
        stored.displayName ||
        user?.displayName ||
        (user as { fullName?: string } | null)?.fullName ||
        registrationReview?.fullName ||
        "",
      phone: d.phone || stored.phone || registrationReview?.phone || "",
      shopName: d.shopName || stored.shopName || registrationReview?.shopName || "",
      businessType: d.businessType || stored.businessType || registrationReview?.businessType || "",
      businessDescription:
        d.businessDescription || stored.businessDescription || registrationReview?.businessDescription || "",
      foodSafetyLicense:
        (stored.foodSafetyLicense as ApplyDraft["foodSafetyLicense"]) ||
        (registrationReview?.foodSafetyLicense as ApplyDraft["foodSafetyLicense"]) ||
        d.foodSafetyLicense,
      usageFrequency: d.usageFrequency || stored.usageFrequency || "",
    }));
  }, [isOpen, user, registrationReview]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Keep apply step in sync once verification / submit phases begin.
  useEffect(() => {
    const fromPhase = applyStepFromPhase(applicationPhase, skipVerify);
    if (fromPhase) setApplyUiStep(fromPhase);
    // Prefs were collected earlier; never leave Submit gated on the missing panel.
    if (fromPhase === "verify" || fromPhase === "submit" || fromPhase === "done") {
      setBookingPrefsValid(true);
    }
  }, [applicationPhase, skipVerify]);

  // Never auto-close during an active kitchen application modal flow.
  useEffect(() => {
    if (!isOpen || !user || !isUserVerified(user)) return;
    if (options.requireApplication) return;
    if (applicationPhase && applicationPhase !== "submitted") return;
    setIsOpen(false);
  }, [user, isOpen, options.requireApplication, applicationPhase]);

  const submitPendingApplication = async () => {
    if (hasSubmittedRef.current || isSubmittingApplication) return;
    const pendingData = window.localStorage.getItem("pendingRegistrationData");
    if (!pendingData) {
      setSubmitError("Application data not found. Please register again.");
      return;
    }
    if (!isUserVerified(user) && !skipVerify) {
      setSubmitError("Please verify your email first, then click Submit.");
      return;
    }

    setIsSubmittingApplication(true);
    setSubmitError(null);
    hasSubmittedRef.current = true;

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        hasSubmittedRef.current = false;
        setSubmitError("Please sign in again to submit your application.");
        return;
      }
      const token = await firebaseUser.getIdToken();
      const applicationData = JSON.parse(pendingData);
      if (!applicationData.fullName && applicationData.displayName) {
        applicationData.fullName = applicationData.displayName;
      }
      const formData = new FormData();

      const businessInfo = JSON.stringify({
        businessName: applicationData.shopName || "",
        businessType: applicationData.businessType || "",
        experience: applicationData.experience || "",
        description: applicationData.businessDescription || "",
        usageFrequency: applicationData.usageFrequency || "",
        sessionDuration: "",
        termsAgree: true,
        accuracyAgree: true,
      });

      Object.entries(applicationData).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value.toString().trim() !== "") {
          if (key === "experience") {
            formData.append("cookingExperience", value.toString());
          } else if (key === "businessDescription") {
            /* appended below */
          } else if (key === "phone") {
            const rawPhone = value.toString().trim();
            const normalized = normalizePhoneNumber(rawPhone);
            if (normalized && isValidNorthAmericanPhone(normalized)) {
              formData.append("phone", normalized);
            }
          } else {
            formData.append(key, value.toString());
          }
        }
      });

      const KITCHEN_PREF_VALUES = ["commercial", "home", "notSure"] as const;
      if (
        !applicationData.kitchenPreference ||
        !KITCHEN_PREF_VALUES.includes(applicationData.kitchenPreference as typeof KITCHEN_PREF_VALUES[number])
      ) {
        formData.append("kitchenPreference", "notSure");
      }
      const FOOD_SAFETY_LICENSE_VALUES = ["yes", "no", "notSure"] as const;
      if (
        !applicationData.foodSafetyLicense ||
        !FOOD_SAFETY_LICENSE_VALUES.includes(applicationData.foodSafetyLicense as typeof FOOD_SAFETY_LICENSE_VALUES[number])
      ) {
        formData.append("foodSafetyLicense", "notSure");
      }
      const FOOD_ESTABLISHMENT_CERT_VALUES = ["yes", "no", "notSure"] as const;
      if (
        !applicationData.foodEstablishmentCert ||
        !FOOD_ESTABLISHMENT_CERT_VALUES.includes(applicationData.foodEstablishmentCert as typeof FOOD_ESTABLISHMENT_CERT_VALUES[number])
      ) {
        formData.append("foodEstablishmentCert", "notSure");
      }
      formData.append("termsAgree", "true");
      formData.append("accuracyAgree", "true");
      formData.append("businessDescription", businessInfo);

      let resolvedLocationId: string | null = null;
      try {
        const ctxStr = window.sessionStorage.getItem("pendingRegistrationKitchenContext");
        if (ctxStr) {
          const ctx = JSON.parse(ctxStr);
          if (ctx?.locationId) resolvedLocationId = String(ctx.locationId);
          else if (ctx?.kitchenId) resolvedLocationId = String(ctx.kitchenId);
        }
      } catch {
        /* ignore */
      }

      const match = window.location.pathname.match(/\/(?:kitchen|apply-kitchen|kitchen-preview)\/([^/]+)/);
      let endpoint = "/api/firebase/applications";
      let isKitchenApp = false;
      let targetLocationId: string | null = null;

      if (resolvedLocationId || (match && match[1])) {
        targetLocationId = resolvedLocationId || match![1];
        formData.append("locationId", targetLocationId);
        endpoint = "/api/firebase/chef/kitchen-applications";
        isKitchenApp = true;
      }

      const appResponse = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!appResponse.ok) {
        hasSubmittedRef.current = false;
        const errText = await appResponse.text();
        setSubmitError(`Submission failed. ${errText || "Please try again."}`);
        return;
      }

      window.localStorage.removeItem("pendingRegistrationData");

      if (isKitchenApp) {
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/chef/kitchen-applications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/chef/kitchen-applications/location"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
      }

      await fetch("/api/user/seen-welcome", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      setApplicationPhase("submitted");
      const pending = getPendingApplicationModal();
      if (pending) {
        savePendingApplicationModal({ ...pending, phase: "submitted" });
      }

      if (isKitchenApp && targetLocationId) {
        const intent = getAuthIntent();
        const returnPath = intent?.returnPath || `/kitchen-preview/${targetLocationId}`;
        if (!window.location.pathname.includes("/kitchen-preview/")) {
          navigate(returnPath, { replace: true });
        }
      }
    } catch (e) {
      hasSubmittedRef.current = false;
      console.error("Failed to submit pending Step 1 application:", e);
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setIsSubmittingApplication(false);
    }
  };

  const openAuthModal = (newOptions?: AuthModalOptions) => {
    setRegisteredInFlow(false);
    setApplyDraft({
      ...EMPTY_APPLY_DRAFT,
      fullName: auth.currentUser?.displayName || "",
    });
    setOptions(newOptions || {});
    setActiveTab(newOptions?.defaultTab || "register");
    setShowPreAuth(!!newOptions?.preAuthComponent);
    setBookingPrefsValid(!newOptions?.bookingContext);
    setStepValid(false);
    if (!newOptions?.requireApplication) {
      setRegistrationReview(null);
      setApplicationPhase(null);
      setApplyUiStep("request");
    } else {
      setApplyUiStep(newOptions?.bookingContext ? "request" : "details");
    }
    setIsOpen(true);
  };

  const goToMyApplicationsAfterSubmit = () => {
    clearPendingApplicationModal();
    setRegistrationReview(null);
    setApplicationPhase(null);
    setIsOpen(false);
    setOptions({});
    setShowPreAuth(false);
    const { path, href, sameOrigin } = resolveChefDashboardNavigation(
      "applications",
      window.location.hostname,
      window.location.port,
      import.meta.env.VITE_VERCEL_ENV
    );
    if (sameOrigin) {
      navigate(path, { replace: true });
    } else {
      window.location.href = href;
    }
  };

  const closeAuthModal = () => {
    setIsOpen(false);
    if (applicationPhase === "submitted") {
      setRegistrationReview(null);
      setApplicationPhase(null);
      clearPendingApplicationModal();
    }
    setTimeout(() => {
      if (applicationPhase === "submitted") {
        setOptions({});
        setShowPreAuth(false);
      }
    }, 300);
  };

  const requestCloseModal = () => {
    if (isDataTakingFlow) {
      setCancelConfirmOpen(true);
      return;
    }
    closeAuthModal();
  };

  const confirmCancelModal = () => {
    clearAbandonedApplicationSession();
    setCancelConfirmOpen(false);
    setIsOpen(false);
    setRegistrationReview(null);
    setApplicationPhase(null);
    setApplyDraft(EMPTY_APPLY_DRAFT);
    setApplyUiStep("request");
    setOptions({});
    setShowPreAuth(false);
    setSubmitError(null);
    setVerifyError(null);
    hasSubmittedRef.current = false;
    setRegisteredInFlow(false);
  };

  const handleCheckVerified = async () => {
    if (isCheckingVerification) return;
    setIsCheckingVerification(true);
    setVerifyError(null);
    try {
      const updatedUser = await updateUserVerification();
      const verified =
        isUserVerified(updatedUser) ||
        isUserVerified(user) ||
        !!auth.currentUser?.emailVerified;

      if (!verified) {
        setVerifyError(
          t(
            "notVerifiedYet",
            "We haven't detected your verification yet. Click the link in your email, wait a few seconds, and try again."
          )
        );
        return;
      }

      const pending = getPendingApplicationModal();
      if (pending) {
        savePendingApplicationModal({ ...pending, phase: "ready_to_submit" });
      }
      setApplicationPhase("ready_to_submit");
      setBookingPrefsValid(true);
      window.location.reload();
    } catch {
      setVerifyError(
        t("verifyCheckFailed", "Could not check verification status. Please try again.")
      );
    } finally {
      setIsCheckingVerification(false);
    }
  };

  const handleResendVerification = async () => {
    if (isResendingVerification || resendCooldown > 0) return;
    const email = auth.currentUser?.email || registrationReview?.email;
    if (!email) {
      setResendError(
        t("resendVerificationNoEmail", "No email on file. Please register again.")
      );
      return;
    }

    setIsResendingVerification(true);
    setResendError(null);
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
    } catch (err) {
      setResendError(
        err instanceof Error && err.message
          ? err.message
          : t(
              "resendVerificationFailed",
              "Failed to resend verification email. Please try again later."
            )
      );
    } finally {
      setIsResendingVerification(false);
    }
  };

  const showAuthForms = () => {
    setShowPreAuth(false);
  };

  const intentType = getAuthIntent()?.type;
  const isApplyFlow = !!options.requireApplication || intentType === "book";
  const isKitchenApplicationFlow = !!(registrationReview && applicationPhase);
  const isSignedInApply =
    !!options.requireApplication &&
    skipVerify &&
    applicationPhase !== "submitted" &&
    applyUiStep === "details";
  const showJourneySidebar = isApplyFlow || isKitchenApplicationFlow || !!options.description;
  const isLandscape = showJourneySidebar && isApplyFlow;
  const collectingSteps =
    isApplyFlow && !registrationReview && !applicationPhase;
  const canStepBack = collectingSteps && applyUiStep === "details" && showBookingPrefs;

  const guidedChrome = (() => {
    switch (applyUiStep) {
      case "request":
        return {
          title: t("applyModalRequestTitle", "Your preferred time slots"),
          subtext: t(
            "applyModalRequestSubtext",
            "Pick dates and hours you’d like to cook. You won’t be charged yet."
          ),
        };
      case "details":
        return {
          title: isSignedInApply
            ? t("applyModalDetailsSignedInTitle", "Almost ready")
            : t("applyModalDetailsTitle", "Your details"),
          subtext: isSignedInApply
            ? t(
                "applyModalDetailsSignedInSubtext",
                "Review and edit your details, then submit your request to apply."
              )
            : t(
                "applyModalDetailsSubtext",
                "Create your account and share food safety + how often you’ll use the kitchen."
              ),
        };
      case "verify":
        return {
          title: t("applyModalVerifyTitle", "We’re waiting on you"),
          subtext: t(
            "applyModalVerifySubtext",
            "Check your email (and spam) and click the verify link."
          ),
        };
      case "submit":
        return {
          title: t("applyModalSubmitTitle", "Submit your request"),
          subtext: t(
            "applyModalSubmitSubtext",
            "Review and edit your details, then submit your request to apply."
          ),
        };
      case "done":
        return {
          title: t("applyModalDoneTitle", "Request submitted"),
          subtext: t(
            "applyModalDoneSubtext",
            "Admins will review your request and email you when approved. Check spam for that email too."
          ),
        };
      default:
        return {
          title:
            (typeof options.title === "string" && options.title) ||
            t("requestToApply", "Request to apply"),
          subtext: t(
            "applyModalRequestFallbackSubtext",
            "Lock in preferred dates and time slots, then create your account."
          ),
        };
    }
  })();

  const goApplyBack = () => {
    if (applyUiStep === "details") {
      setStepValid(false);
      setApplyUiStep("request");
    }
  };

  const goApplyContinue = () => {
    if (!stepValid) return;
    if (applyUiStep === "request") {
      setBookingPrefsValid(true);
      setApplyUiStep("details");
    }
  };

  const applyDraftReady =
    applyDraft.fullName.trim().split(/\s+/).length >= 2 && !!applyDraft.usageFrequency;

  const persistApplyDraft = () => {
    const email = user?.email || registrationReview?.email || "";
    const data = {
      fullName: applyDraft.fullName.trim(),
      displayName: applyDraft.fullName.trim(),
      email,
      phone: applyDraft.phone,
      shopName: applyDraft.shopName,
      businessType: applyDraft.businessType,
      businessDescription: applyDraft.businessDescription,
      foodSafetyLicense: applyDraft.foodSafetyLicense,
      foodEstablishmentCert: "notSure",
      kitchenPreference: "commercial",
      usageFrequency: applyDraft.usageFrequency,
    };
    window.localStorage.setItem("pendingRegistrationData", JSON.stringify(data));
    return reviewFromFormData(data, email);
  };

  const submitApplyDraft = () => {
    const review = persistApplyDraft();
    setRegistrationReview(review);
    savePendingApplicationModal({
      phase: "ready_to_submit",
      review,
      returnPath: window.location.pathname + window.location.search,
      title: typeof options.title === "string" ? options.title : undefined,
      modalType: "book",
      registeredInFlow: false,
    });
    void submitPendingApplication();
  };

  return (
    <AuthModalContext.Provider value={{ isOpen, openAuthModal, closeAuthModal, showAuthForms }}>
      {children}
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            requestCloseModal();
            return;
          }
          setIsOpen(true);
        }}
      >
        <DialogContent
          showCloseButton={!isDataTakingFlow}
          className={cn(
            "p-0 !overflow-hidden bg-background flex flex-col sm:flex-row",
            isApplyFlow
              ? "max-h-[min(960px,96vh)] sm:min-h-[640px]"
              : "max-h-[90vh]",
            isLandscape
              ? "sm:max-w-[1100px] w-[min(1100px,96vw)]"
              : isApplyFlow
                ? "sm:max-w-[520px]"
                : "sm:max-w-[450px]"
          )}
          onPointerDownOutside={(e) => {
            if (isDataTakingFlow) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isDataTakingFlow) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (isDataTakingFlow) {
              e.preventDefault();
              requestCloseModal();
            }
          }}
        >
          {/* Landscape left panel — guided steps + price pinned to bottom */}
          {isLandscape && (
            <div className="hidden sm:flex sm:w-[42%] shrink-0 flex-col p-8 border-r border-gray-100 bg-[#F8F9FA] overflow-hidden">
              <div className="min-h-0 flex-1">
                <DialogHeader className="text-left space-y-4">
                  <DialogTitle className="text-2xl font-bold text-gray-900">
                    {guidedChrome.title}
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="text-muted-foreground text-sm leading-relaxed space-y-6">
                      <p className="text-gray-600 text-[15px]">{guidedChrome.subtext}</p>
                      <ApplyGuideRail step={applyUiStep} skipVerify={skipVerify} />
                    </div>
                  </DialogDescription>
                </DialogHeader>
              </div>
              {showBookingPrefs && (
                <div className="shrink-0 mt-auto pt-5 border-t border-gray-200/80 space-y-3">
                  <ApplyBookingPriceFooter
                    preview={bookingPricePreview}
                    isLoading={bookingPriceLoading}
                    kitchenName={options.bookingContext?.kitchenName}
                  />
                  {isDataTakingFlow && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="self-start text-gray-500 -ml-2"
                      onClick={requestCloseModal}
                    >
                      {t("modalCancel")}
                    </Button>
                  )}
                </div>
              )}
              {!showBookingPrefs && isDataTakingFlow && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-auto self-start text-gray-500"
                  onClick={requestCloseModal}
                >
                  {t("modalCancel")}
                </Button>
              )}
            </div>
          )}

          {/* Right column — header pinned, stepped body (no scroll on apply) */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header for non-landscape OR mobile */}
            <div className={cn("shrink-0 px-6 pt-6 pb-4", isLandscape ? "sm:hidden" : "")}>
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold text-gray-900">
                  {isApplyFlow ? guidedChrome.title : (options.title || t("authModalDefaultTitle", "Welcome Back"))}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {isApplyFlow ? (
                      <>
                        <p>{guidedChrome.subtext}</p>
                        <div className="mt-4">
                          <ApplyGuideRail step={applyUiStep} skipVerify={skipVerify} />
                        </div>
                      </>
                    ) : (
                      options.description || t("authModalDefaultDesc", "Sign in to your account or create a new one.")
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>
              {isDataTakingFlow && !isLandscape && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 -ml-2 self-start text-gray-500"
                  onClick={requestCloseModal}
                >
                  {t("modalCancel")}
                </Button>
              )}
            </div>

            <div
              className={cn(
                "min-h-0 flex-1 flex flex-col px-6 pb-6 pr-12 sm:px-8 sm:pb-8",
                isApplyFlow
                  ? "overflow-hidden"
                  : "overflow-y-auto overscroll-contain mobile-momentum-scroll",
                isLandscape && "pt-6 sm:pt-8"
              )}
            >
              {showPreAuth && options.preAuthComponent ? (
                options.preAuthComponent
              ) : registrationReview && applicationPhase ? (
                <div className="min-h-0 flex-1 space-y-4 overflow-hidden">
                  {applicationPhase === "submitted" ? (
                    <>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-[#F51042]" />
                        <h3 className="text-lg font-semibold text-gray-900">
                          {t("step1CompleteTitle", "Request to apply submitted")}
                        </h3>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "step1CompleteDesc",
                          "Your request to apply was submitted. Our Team will review it and email you when it’s approved."
                        )}
                      </p>
                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <h4 className="font-semibold text-sm text-gray-900 mb-3">
                          {t("applicationDetails", "Application Details")}
                        </h4>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">{t("nameLabel", "Name")}</p>
                            <p className="font-medium text-gray-900">{registrationReview.fullName || "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">{t("emailLabel", "Email")}</p>
                            <p className="font-medium text-gray-900 truncate">{registrationReview.email || "—"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">{t("phoneLabel", "Phone")}</p>
                            <p className="font-medium text-gray-900">{registrationReview.phone || "—"}</p>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={goToMyApplicationsAfterSubmit}
                        className="w-full rounded-lg bg-[#F51042] hover:bg-[#E00A38] text-white text-sm font-medium py-2.5 transition-colors"
                      >
                        {t("viewApplicationBtn", "View application")}
                      </button>
                    </>
                  ) : (
                    <>
                      {applicationPhase === "awaiting_verification" && !skipVerify ? (
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
                                  {registrationReview.email ? (
                                    <>
                                      {" "}
                                      (
                                      <span className="font-semibold break-all">
                                        {registrationReview.email}
                                      </span>
                                      )
                                    </>
                                  ) : null}
                                  {t(
                                    "applyVerifyStep1Spam",
                                    " — check your spam folder if you don’t see it"
                                  )}
                                </span>
                              </li>
                              <li className="flex gap-2">
                                <span className="font-bold text-[#F51042] shrink-0">2.</span>
                                <span>
                                  {t(
                                    "applyVerifyStep2",
                                    "Click the “Verify my email” button in that email"
                                  )}
                                </span>
                              </li>
                              <li className="flex gap-2">
                                <span className="font-bold text-[#F51042] shrink-0">3.</span>
                                <span>
                                  {t(
                                    "applyVerifyStep3",
                                    "Come back here and tap Continue below"
                                  )}
                                </span>
                              </li>
                            </ol>
                            <p className="text-sm font-medium text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                              {t(
                                "applyVerifySpamOneLiner",
                                "Tip: it often lands in Spam or Promotions."
                              )}
                            </p>
                          </div>
                          {verifyError && (
                            <p className="text-sm text-red-600 text-center">{verifyError}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleCheckVerified()}
                            disabled={isCheckingVerification}
                            className="w-full rounded-lg bg-[#F51042] hover:bg-[#E00A38] text-white text-sm font-semibold py-3 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                          >
                            {isCheckingVerification ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t("checkingVerification", "Checking...")}
                              </>
                            ) : (
                              t("applyVerifyContinueBtn", "I’ve verified — continue")
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleResendVerification()}
                            disabled={isResendingVerification || resendCooldown > 0}
                            className="w-full text-sm font-medium text-gray-600 hover:text-gray-900 py-1.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                          >
                            {isResendingVerification ? (
                              <>
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                {t("sendingVerificationEmail", "Sending...")}
                              </>
                            ) : resendCooldown > 0 ? (
                              <>
                                <Clock className="h-3.5 w-3.5" />
                                {t("resendVerificationWait", {
                                  seconds: resendCooldown,
                                  defaultValue: `Resend in ${resendCooldown}s`,
                                })}
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3.5 w-3.5" />
                                {t("resendVerificationEmail", "Resend email")}
                              </>
                            )}
                          </button>
                          {resendError && (
                            <p className="text-sm text-red-600 text-center">{resendError}</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="min-h-0 flex-1 space-y-4">
                            <RequestToApplyFields
                              draft={applyDraft}
                              onChange={(patch) => setApplyDraft((d) => ({ ...d, ...patch }))}
                              email={registrationReview.email || user?.email || undefined}
                            />
                            {submitError && (
                              <p className="text-sm text-red-600">{submitError}</p>
                            )}
                            <button
                              type="button"
                              onClick={submitApplyDraft}
                              disabled={isSubmittingApplication || !applyDraftReady}
                              className="w-full rounded-lg bg-[#F51042] hover:bg-[#E00A38] text-white text-sm font-medium py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                              {isSubmittingApplication ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t("submittingApplication", "Submitting...")}
                                </>
                              ) : (
                                t("submitRequestToApply", "Submit request to apply")
                              )}
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              ) : collectingSteps && showBookingPrefs && options.bookingContext && applyUiStep === "request" ? (
                <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1">
                    <KitchenBookingPreferencesPanel
                      kitchenId={options.bookingContext.kitchenId}
                      kitchenName={options.bookingContext.kitchenName}
                      equipmentListings={options.bookingContext.equipmentListings}
                      storageListings={options.bookingContext.storageListings}
                      stage="schedule"
                      onValidityChange={(valid) => {
                        setStepValid(valid);
                        setBookingPrefsValid(valid);
                      }}
                    />
                  </div>
                  <div className="mt-4 flex shrink-0 gap-3">
                    <Button
                      type="button"
                      className="flex-1 bg-[#F51042] hover:bg-[#E00A38] text-white"
                      disabled={!stepValid}
                      onClick={goApplyContinue}
                    >
                      {t("continueApplication")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex flex-1 flex-col overflow-hidden space-y-4">
                  {isSignedInApply ? (
                    <div className="min-h-0 flex flex-1 flex-col space-y-4">
                      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                        <RequestToApplyFields
                          draft={applyDraft}
                          onChange={(patch) => setApplyDraft((d) => ({ ...d, ...patch }))}
                          email={user?.email || undefined}
                        />
                        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
                      </div>
                      <div className="flex shrink-0 gap-3">
                        {canStepBack ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={goApplyBack}
                          >
                            {t("modalPrevious", "Previous")}
                          </Button>
                        ) : null}
                        <button
                          type="button"
                          disabled={isSubmittingApplication || !applyDraftReady}
                          onClick={submitApplyDraft}
                          className="flex-1 rounded-lg bg-[#F51042] hover:bg-[#E00A38] text-white text-sm font-medium py-2.5 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {isSubmittingApplication ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t("submittingApplication", "Submitting...")}
                            </>
                          ) : (
                            t("submitRequestToApply", "Submit request to apply")
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div className={cn("min-h-0 flex flex-1 flex-col overflow-hidden", !bookingPrefsValid && showBookingPrefs && collectingSteps && "opacity-50 pointer-events-none")}>
                  {activeTab === "login" ? (
                <>
                <div className="min-h-0 flex-1 overflow-hidden">
                <EnhancedLoginForm 
                  onSuccess={() => {
                    if (options.requireApplication) {
                      setRegisteredInFlow(false);
                      setApplyUiStep((s) => (s === "request" ? "request" : "details"));
                      return;
                    }
                    closeAuthModal();
                  }}
                  onSwitchToRegister={() => setActiveTab("register")}
                  showVerificationSuccess={showVerificationSuccess} 
                />
                </div>
                {canStepBack ? (
                  <div className="mt-4 flex shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={goApplyBack}
                    >
                      {t("modalPrevious", "Previous")}
                    </Button>
                  </div>
                ) : null}
                </>
              ) : (
                <EnhancedRegisterForm 
                  onSuccess={() => {
                    if (!options.requireApplication) closeAuthModal();
                  }}
                  onRegistrationComplete={(email, data) => {
                    if (options.requireApplication && data) {
                      const review = reviewFromFormData(data as unknown as Record<string, unknown>, email);
                      setRegisteredInFlow(true);
                      setRegistrationReview(review);
                      setApplicationPhase("awaiting_verification");
                      const intent = getAuthIntent();
                      savePendingApplicationModal({
                        phase: "awaiting_verification",
                        review,
                        returnPath: window.location.pathname + window.location.search,
                        title: typeof options.title === "string" ? options.title : undefined,
                        modalType: intent?.type || "book",
                        registeredInFlow: true,
                      });
                    }
                  }}
                  reviewAfterRegistration={options.requireApplication}
                  onSwitchToLogin={() => setActiveTab("login")} 
                  forceApplying={options.requireApplication}
                  onPreviousStep={canStepBack ? goApplyBack : undefined}
                />
              )}
                  </div>
                  )}
                </div>
              )}
            </div>
            {showBookingPrefs && (
              <div className="shrink-0 border-t border-gray-100 bg-background px-6 py-3 sm:hidden">
                <ApplyBookingPriceFooter
                  preview={bookingPricePreview}
                  isLoading={bookingPriceLoading}
                  kitchenName={options.bookingContext?.kitchenName}
                />
              </div>
            )}
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
                "cancelAuthModalDesc",
                "Your request will not be submitted. You can start again later."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("keepEditing", "Keep editing")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancelModal}>
              {t("confirmCancel", "Yes, cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AuthModalContext.Provider>
  );
}
