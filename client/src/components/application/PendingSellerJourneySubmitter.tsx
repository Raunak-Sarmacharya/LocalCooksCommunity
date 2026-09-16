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
      })
    ) {
      return;
    }

    const draft = getSellerJourneyDraft();
    if (!draft || draft.email.toLowerCase() !== user.email?.toLowerCase()) return;
    // Only the email is required to submit. A missing phone must not hold a
    // completed seller journey hostage, since the server accepts it on an
    // unverified-email check alone.
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

        const response = await fetch("/api/firebase/applications", {
          method: "POST",
          headers,
          body: JSON.stringify(sellerJourneyPayload(draft)),
        });
        if (!response.ok) throw new Error(await response.text());
        clearSellerJourneyDraft();
        window.dispatchEvent(new CustomEvent("localcooks:seller-journey-submitted"));
        window.sessionStorage.setItem("localcooks:seller-journey-result", "submitted");
        window.location.replace("/dashboard?view=applications&journey=submitted");
      } catch (error) {
        logger.error("Unable to submit pending seller journey application", error);
        setTransitioning(false);
        showAlert({
          title: "Application not submitted",
          description: "Your account is ready, but we couldn’t submit the application yet. Please try again from My Application.",
          type: "error",
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
