import { useEffect, useRef, useState } from "react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { clearSellerJourneyDraft, getSellerJourneyDraft, sellerJourneyPayload } from "@/lib/seller-journey";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { getSubdomainFromHostname } from "@shared/subdomain-utils";
import { shouldAutoSubmitSellerJourney } from "@/lib/pending-seller-journey-guard";
import { logger } from "@/lib/logger";
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import LoadingOverlay from "@/components/auth/LoadingOverlay";

export default function PendingSellerJourneySubmitter() {
  const { user, loading } = useFirebaseAuth();
  const submitting = useRef(false);
  const [transitioning, setTransitioning] = useState(false);
  const { showAlert } = useCustomAlerts();

  useEffect(() => {
    if (loading || !user || submitting.current) return;

    // Seller journey is a chef-portal flow. This component is mounted globally, so
    // without this guard a leftover draft (same Google email) would fire after a
    // kitchen-manager signup, replace the URL with /dashboard, and App.tsx would
    // hard-redirect them onto chef.localhost — exactly the "saw kitchen onboarding
    // for a second, then got forced to chef" report.
    if (
      !shouldAutoSubmitSellerJourney({
        subdomain: getSubdomainFromHostname(window.location.hostname),
        role: user.role,
        isManager: user.isManager,
        journeyActive: new URLSearchParams(window.location.search).get("journey") === "seller",
      })
    ) {
      return;
    }

    const draft = getSellerJourneyDraft();
    const verifiedEmail = user.email;
    if (!draft || !verifiedEmail || (draft.email && draft.email.toLowerCase() !== verifiedEmail.toLowerCase())) return;
    if (!hasVerifiedEmail(user, user)) return;

    const submit = async () => {
      submitting.current = true;
      setTransitioning(true);
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) return;
        const token = await currentUser.getIdToken();
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const existingResponse = await fetch("/api/firebase/applications/my", { headers });
        if (!existingResponse.ok) throw new Error("Could not check existing applications");
        const existing = await existingResponse.json();
        if (Array.isArray(existing) && existing.some((app) => !["cancelled", "rejected"].includes(app.status))) {
          clearSellerJourneyDraft();
          window.sessionStorage.setItem("localcooks:seller-journey-result", "existing");
          window.location.replace("/dashboard?view=applications&journey=existing");
          return;
        }

        // The authenticated profile owns the application identity. A chef may
        // choose a different Google account from the address entered initially.
        const currentDraft = {
          ...draft,
          email: verifiedEmail,
          fullName: user.displayName?.trim() || draft.fullName,
          phone: user.phoneNumber || "",
        };
        if (!user.phoneNumber) throw new Error("Add a phone number to your account before applying.");
        if (!currentDraft.fullName.trim()) throw new Error("Add your full name to your account before applying.");
        const response = await fetch("/api/firebase/applications", {
          method: "POST",
          headers,
          body: JSON.stringify(sellerJourneyPayload(currentDraft)),
        });
        if (!response.ok) throw new Error(await response.text());
        clearSellerJourneyDraft();
        window.dispatchEvent(new CustomEvent("localcooks:seller-journey-submitted"));
        window.sessionStorage.setItem("localcooks:seller-journey-result", "submitted");
        window.location.replace("/dashboard?view=applications&journey=submitted");
      } catch (error) {
        logger.error("Unable to submit pending seller journey application", error);
        setTransitioning(false);
        const missingProfile = error instanceof Error && (error.message.includes("phone number") || error.message.includes("full name"));
        showAlert({
          title: "Application not submitted",
          description: missingProfile
            ? error.message
            : "Your account is ready, but we couldn’t submit the application yet. Your plans are saved.",
          type: "error",
          secondaryText: missingProfile ? "Open account profile" : "Try again",
          onSecondary: () => missingProfile ? window.location.assign("/dashboard?view=profile") : window.location.reload(),
        });
      } finally {
        submitting.current = false;
      }
    };
    void submit();
  }, [loading, user, showAlert]);

  return (
    <LoadingOverlay
      isVisible={transitioning}
      message="Submitting your application…"
      submessage="Your account is ready. We’re securely saving your application before opening My Application."
      type="verifying"
    />
  );
}
