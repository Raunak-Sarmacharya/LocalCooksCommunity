import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

interface AuthModalOptions {
  title?: ReactNode;
  description?: ReactNode;
  defaultTab?: "login" | "register";
  preAuthComponent?: ReactNode;
  requireApplication?: boolean;
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
  const { t } = useTranslation("auth");
  const { user } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<AuthModalOptions>({});
  const [activeTab, setActiveTab] = useState<"login" | "register">("register");
  const [showVerificationSuccess, setShowVerificationSuccess] = useState(false);
  const [showPreAuth, setShowPreAuth] = useState(false);

  // Track whether we've already submitted pending data in this page session.
  // This protects against double-submits if the user object fires multiple
  // updates while the async submit call is in flight, and avoids a second
  // submit from the post-verification polling timer.
  const hasSubmittedRef = useRef(false);
  // Bumped by the polling safety net whenever a verification transition is
  // detected; the main submit effect watches this so it re-runs even when
  // neither `user` nor any of its nested flags create a new reference.
  const [, setVerifiedTick] = useState(0);

  // Check for verification success in URL params globally
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('verified') === 'true') {
      setShowVerificationSuccess(true);

      // Clear the URL parameter
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);

      // If the user is already authenticated and verified, don't flash the
      // login modal — the auto-close effect wouldn't fire because the user
      // state didn't change. Just show the success toast briefly.
      const alreadyVerified =
        user?.is_verified || user?.isVerified || user?.emailVerified;
      if (user && alreadyVerified) {
        setTimeout(() => {
          setShowVerificationSuccess(false);
        }, 5000);
        return;
      }

      // Open modal to login
      setOptions({ defaultTab: "login" });
      setActiveTab("login");
      setIsOpen(true);

      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setShowVerificationSuccess(false);
      }, 5000);
    }
  }, [user]);

  // Auto-close modal if user becomes authenticated and verified (e.g. cross-tab login)
  useEffect(() => {
    // Note: Drizzle uses isVerified, but some legacy code uses is_verified
    const isUserVerified = user?.is_verified || user?.isVerified || user?.emailVerified;
    if (isOpen && user && isUserVerified) {
      setIsOpen(false);
    }
  }, [user, isOpen]);

  // Submit pending registration data if user becomes verified.
  //
  // RUNTIME CONSTRAINT: The `user` reference from useFirebaseAuth is the
  // *database profile*, which only updates when the hook's periodic refresh
  // or the verify-email-complete backend call re-fetches `/api/user/profile`.
  // After the user clicks the email-verification link and lands on
  // `/auth?verified=true`, `auth.currentUser?.emailVerified` (Firebase)
  // becomes true BEFORE the database profile has `is_verified=true`. For
  // that reason we must check both:
  //   1. the Firebase native `auth.currentUser.emailVerified`
  //   2. the cached `user` profile flags
  // We also add a small polling timer so we don't miss the case where the
  // database profile flags change after this effect has already fired.
  useEffect(() => {
    const firebaseVerified = !!auth.currentUser?.emailVerified;
    const dbVerified = !!(
      user?.is_verified || user?.isVerified || user?.emailVerified
    );
    const isUserVerified = firebaseVerified || dbVerified;

    if (!user || !isUserVerified) return;
    const pendingData = window.localStorage.getItem('pendingRegistrationData');
    if (!pendingData || hasSubmittedRef.current) return;

    const submitData = async () => {
      if (hasSubmittedRef.current) return;
      hasSubmittedRef.current = true;
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) {
          hasSubmittedRef.current = false; // allow retry
          return;
        }
        const token = await firebaseUser.getIdToken();
        const applicationData = JSON.parse(pendingData);
        const formData = new FormData();

        const businessInfo = JSON.stringify({
          businessName: applicationData.shopName || "",
          businessType: applicationData.businessType || "",
          experience: applicationData.experience || "",
          description: applicationData.businessDescription || "",
          usageFrequency: "",
          sessionDuration: "",
          termsAgree: true,
          accuracyAgree: true,
        });

        Object.entries(applicationData).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value.toString().trim() !== '') {
            if (key === 'experience') {
              formData.append('cookingExperience', value.toString());
            } else if (key === 'businessDescription') {
              // Skip here, appended below as JSON
            } else if (key === 'phone') {
              // Normalize to E.164 (+1XXXXXXXXXX) only if valid. If invalid,
              // skip sending phone entirely; server will leave it empty for
              // Tier 1 and the chef can fill it later. This avoids the server
              // failing phone format validation after registration succeeded.
              const rawPhone = value.toString().trim();
              const normalized = normalizePhoneNumber(rawPhone);
              if (normalized && isValidNorthAmericanPhone(normalized)) {
                formData.append('phone', normalized);
              }
              // Otherwise: don't send. Server will default to empty string for Tier 1.
            } else {
              formData.append(key, value.toString());
            }
          }
        });
        // Provide safe defaults for enum-typed schema fields that may not be
        // present or may be empty strings when the registration form didn't
        // ask the question or user skipped it.
        const KITCHEN_PREF_VALUES = ['commercial', 'home', 'notSure'] as const;
        if (
          !applicationData.kitchenPreference ||
          !KITCHEN_PREF_VALUES.includes(applicationData.kitchenPreference as any)
        ) {
          formData.append('kitchenPreference', 'notSure');
        }
        const FOOD_SAFETY_LICENSE_VALUES = ['yes', 'no', 'notSure'] as const;
        if (
          !applicationData.foodSafetyLicense ||
          !FOOD_SAFETY_LICENSE_VALUES.includes(applicationData.foodSafetyLicense as any)
        ) {
          formData.append('foodSafetyLicense', 'notSure');
        }
        const FOOD_ESTABLISHMENT_CERT_VALUES = ['yes', 'no', 'notSure'] as const;
        if (
          !applicationData.foodEstablishmentCert ||
          !FOOD_ESTABLISHMENT_CERT_VALUES.includes(applicationData.foodEstablishmentCert as any)
        ) {
          formData.append('foodEstablishmentCert', 'notSure');
        }
        // Terms + accuracy booleans: default true (user has agreed via account creation
        // and submit action). The registration modal doesn't show these checkboxes, so
        // we explicitly send the agree flag so the server schema won't error.
        formData.append('termsAgree', 'true');
        formData.append('accuracyAgree', 'true');
        formData.append('businessDescription', businessInfo);

        // Resolve intended kitchen/location context. Prefer context that was
        // saved when the user initiated the application from a kitchen
        // page (so the correct endpoint is used even when the email
        // verification redirect drops them on /auth). The kitchen
        // application API requires a numeric `locationId`.
        let resolvedLocationId: string | null = null;
        try {
          const ctxStr = window.sessionStorage.getItem('pendingRegistrationKitchenContext');
          if (ctxStr) {
            const ctx = JSON.parse(ctxStr);
            // Prefer explicit locationId, fall back to kitchenId (legacy).
            if (ctx?.locationId) resolvedLocationId = String(ctx.locationId);
            else if (ctx?.kitchenId) resolvedLocationId = String(ctx.kitchenId);
          }
        } catch (e) {
          console.warn('Failed to parse pendingRegistrationKitchenContext', e);
        }

        const match = window.location.pathname.match(/\/(?:kitchen|apply-kitchen|kitchen-preview)\/(\d+)/);
        let endpoint = '/api/firebase/applications';
        let isKitchenApp = false;
        let targetLocationId: string | null = null;

        if (resolvedLocationId || (match && match[1])) {
          targetLocationId = resolvedLocationId || match![1];
          formData.append('locationId', targetLocationId);
          endpoint = '/api/firebase/chef/kitchen-applications';
          isKitchenApp = true;
        }


        const appResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });
        if (appResponse.ok) {
          window.localStorage.removeItem('pendingRegistrationData');
          try {
            window.sessionStorage.removeItem('pendingRegistrationKitchenContext');
          } catch (e) { /* ignore */ }
          sessionStorage.setItem('pending_application_modal', 'true');

          if (isKitchenApp) {
            queryClient.invalidateQueries({ queryKey: ["/api/firebase/chef/kitchen-applications"] });
            queryClient.invalidateQueries({ queryKey: ["/api/firebase/chef/kitchen-applications/location"] });
          } else {
            queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
          }

          // Update backend that welcome screen is seen so they aren't asked again
          await fetch('/api/user/seen-welcome', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          if (isKitchenApp && targetLocationId) {
            // Don't force the user onto the application form (they already hit
            // "Create Account" expecting to be on the kitchen page with a
            // confirmation). Instead, go back to the kitchen preview page
            // for this location. The `pending_application_modal` session
            // flag we just set will cause GuestHoursCard to open the
            // "View Application" / Step 1 Complete modal the next time
            // the user clicks Continue with selected dates, or the auto
            // useEffect in GuestHoursCard will open it immediately when
            // the page mounts (if there are saved dates in sessionStorage).
            try {
              navigate(`/kitchen-preview/${targetLocationId}`, { replace: true });
            } catch (e) { /* ignore */ }
          }
        } else {
          const errText = await appResponse.text();
          console.error('Failed to submit pending application. Status:', appResponse.status, errText);

          // Save to fallback so KitchenApplicationForm can prefill the
          // missing fields even when a direct submit couldn't.
          window.localStorage.setItem('fallbackRegistrationData', pendingData);
          window.localStorage.removeItem('pendingRegistrationData');
          try {
            window.sessionStorage.setItem(
              'pendingRegistrationKitchenContext',
              JSON.stringify({ locationId: resolvedLocationId })
            );
          } catch (e) { /* ignore */ }

          // Even if validation failed, the user already filled in their
          // details during registration. Rather than dropping them on the
          // kitchen preview with a confusing "Start Application" CTA,
          // send them straight to the kitchen-application form. It will
          // pre-fill from `fallbackRegistrationData`, so they only have
          // to fix/add the missing fields and click Submit.
          if (resolvedLocationId || (match && match[1])) {
            const lid = resolvedLocationId || match![1];
            try {
              navigate(`/apply-kitchen/${lid}`, { replace: true });
            } catch (e) { /* ignore */ }
          }
        }
      } catch (e) {
        hasSubmittedRef.current = false; // allow retry on failure
        console.error('Failed to submit pending Step 1 application:', e);
      }
    };
    submitData();
  }, [user, queryClient, navigate, setVerifiedTick]);

  // Post-verification safety net: if the user has pending registration data
  // and we can't rely on the effect deps (e.g. DB profile flags not yet
  // updated, but Firebase emailVerified is true), poll a few times. When
  // verification is detected we bump `setVerifiedTick` so the main submit
  // effect above re-runs (even if `user` object reference is unchanged).
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 6; // 0s, 1s, 2s, 3s, 4s, 5s

    const tryTick = async () => {
      if (cancelled) return;
      if (hasSubmittedRef.current) return;
      const pendingData = window.localStorage.getItem('pendingRegistrationData');
      if (!pendingData) return;

      const firebaseUser = auth.currentUser;
      const firebaseVerified = !!firebaseUser?.emailVerified;
      const dbVerified = !!(user?.is_verified || user?.isVerified || user?.emailVerified);
      if (!firebaseVerified && !dbVerified) return;

      // Force-refresh the ID token so any `verify-email-complete` backend
      // flags are picked up by the user-profile query on the next fetch.
      if (firebaseUser && firebaseVerified) {
        try {
          await firebaseUser.getIdToken(true);
        } catch (e) { /* ignore */ }
      }

      // Trigger a re-run of the main submit effect even if `user` ref
      // is the same object.
      setVerifiedTick((t) => t + 1);
    };

    const timer = setInterval(() => {
      if (cancelled) { clearInterval(timer); return; }
      attempt++;
      if (attempt > maxAttempts) { clearInterval(timer); return; }
      void tryTick();
    }, 1000);
    // Run immediately on mount as well.
    void tryTick();

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, setVerifiedTick]);

  const openAuthModal = (newOptions?: AuthModalOptions) => {
    setOptions(newOptions || {});
    setActiveTab(newOptions?.defaultTab || "register");
    setShowPreAuth(!!newOptions?.preAuthComponent);
    setIsOpen(true);
  };

  const closeAuthModal = () => {
    setIsOpen(false);
    setTimeout(() => {
      setOptions({});
      setShowPreAuth(false);
    }, 300);
  };

  const showAuthForms = () => {
    setShowPreAuth(false);
  };

  const isLandscape = !!options.description;

  return (
    <AuthModalContext.Provider value={{ isOpen, openAuthModal, closeAuthModal, showAuthForms }}>
      {children}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className={cn(
          "p-0 overflow-hidden bg-background max-h-[90vh] flex flex-col sm:flex-row",
          isLandscape ? "sm:max-w-[950px]" : "sm:max-w-[450px]"
        )}>
          {/* Landscape Left Panel (Hidden on mobile) */}
          {isLandscape && (
            <div className="hidden sm:flex sm:w-5/12 bg-[#F8F9FA] flex-col p-8 border-r border-gray-100 relative">
              <div className="relative z-10">
                <DialogHeader className="text-left">
                  <DialogTitle className="text-2xl font-bold text-gray-900">
                    {options.title || t("authModalDefaultTitle", "Welcome Back")}
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="text-muted-foreground mt-6 text-sm leading-relaxed">
                      {options.description}
                    </div>
                  </DialogDescription>
                </DialogHeader>
              </div>
            </div>
          )}

          {/* Form Content Area */}
          <div className={cn(
            "flex-1 flex flex-col h-full relative",
            isLandscape ? "p-6 sm:p-8 overflow-y-auto" : "p-6"
          )}>
            {/* Header for non-landscape OR mobile landscape */}
            <div className={cn("pb-6", isLandscape ? "sm:hidden" : "")}>
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold text-gray-900">
                  {options.title || t("authModalDefaultTitle", "Welcome Back")}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {options.description || t("authModalDefaultDesc", "Sign in to your account or create a new one.")}
                  </div>
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="flex-1 overflow-y-auto">
              {showPreAuth && options.preAuthComponent ? (
                options.preAuthComponent
              ) : activeTab === "login" ? (
                <EnhancedLoginForm 
                  onSuccess={closeAuthModal} 
                  onSwitchToRegister={() => setActiveTab("register")}
                  showVerificationSuccess={showVerificationSuccess} 
                />
              ) : (
                <EnhancedRegisterForm 
                  onSuccess={closeAuthModal} 
                  onSwitchToLogin={() => setActiveTab("login")} 
                  forceApplying={options.requireApplication}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AuthModalContext.Provider>
  );
}
