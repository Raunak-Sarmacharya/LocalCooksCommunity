import { useEffect, useRef } from "react";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { clearSellerJourneyDraft, getSellerJourneyDraft, sellerJourneyPayload } from "@/lib/seller-journey";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { logger } from "@/lib/logger";

export default function PendingSellerJourneySubmitter() {
  const { user, loading } = useFirebaseAuth();
  const submitting = useRef(false);

  useEffect(() => {
    if (loading || !user || submitting.current) return;
    const draft = getSellerJourneyDraft();
    if (!draft || draft.email.toLowerCase() !== user.email?.toLowerCase()) return;
    if (!hasVerifiedEmail(user, user) && !auth.currentUser?.emailVerified) return;

    const submit = async () => {
      submitting.current = true;
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
      } catch (error) {
        logger.error("Unable to submit pending seller journey application", error);
      } finally {
        submitting.current = false;
      }
    };
    void submit();
  }, [loading, user]);

  return null;
}
