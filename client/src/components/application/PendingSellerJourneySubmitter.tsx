import { useEffect, useRef, useState } from "react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { clearSellerJourneyDraft, getSellerJourneyDraft, sellerJourneyPayload } from "@/lib/seller-journey";
import { hasVerifiedEmail } from "@/lib/auth-verification";
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
    const draft = getSellerJourneyDraft();
    if (!draft || draft.email.toLowerCase() !== user.email?.toLowerCase()) return;
    if (!hasVerifiedEmail(user, user) && !auth.currentUser?.emailVerified) return;

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
