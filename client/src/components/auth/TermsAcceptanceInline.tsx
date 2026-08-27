import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ScrollText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { logger } from "@/lib/logger";

interface TermsAcceptanceInlineProps {
  onSuccess: () => void;
  onRefreshUser: () => Promise<void>;
}

export default function TermsAcceptanceInline({ onSuccess, onRefreshUser }: TermsAcceptanceInlineProps) {
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    if (!accepted) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        setError("Authentication session expired. Please sign in again.");
        setIsSubmitting(false);
        return;
      }

      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/user/accept-terms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accepted: true }),
      });

      if (response.ok) {
        logger.info("Terms accepted successfully via inline modal");
        await onRefreshUser();
        
        queryClient.setQueriesData(
          { queryKey: ["/api/user/profile"] },
          (oldData: any) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              termsAccepted: true,
              terms_accepted: true,
              termsAcceptedAt: new Date().toISOString(),
              terms_accepted_at: new Date().toISOString(),
              termsVersion: CURRENT_POLICY_VERSION,
              terms_version: CURRENT_POLICY_VERSION,
            };
          }
        );
        await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
        
        onSuccess();
      } else {
        setError("Failed to save your acceptance. Please try again.");
      }
    } catch (e) {
      logger.error("Error accepting terms:", e);
      setError("A network error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto py-4"
    >
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
          <ScrollText className="w-8 h-8 text-blue-600" />
        </div>
      </div>
      
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Terms & Privacy</h2>
        <p className="text-gray-600 text-sm">
          Please review and accept our policies to continue.
        </p>
      </div>

      <div className="bg-gray-50 border rounded-lg p-4 mb-6 text-sm text-gray-600">
        By checking the box below, you acknowledge that you have read and agree to our{" "}
        <a href="/terms" target="_blank" className="text-blue-600 hover:underline font-medium">Terms & Conditions</a>
        {" "}and{" "}
        <a href="/privacy" target="_blank" className="text-blue-600 hover:underline font-medium">Privacy Policy</a>.
      </div>

      <div className="flex items-start gap-3 mb-8">
        <Checkbox 
          id="accept-terms-modal" 
          checked={accepted} 
          onCheckedChange={(c) => setAccepted(c === true)} 
          className="mt-1"
        />
        <Label htmlFor="accept-terms-modal" className="leading-relaxed cursor-pointer text-gray-700">
          I have read and agree to the Terms & Conditions and Privacy Policy.
        </Label>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 font-medium text-center">
          {error}
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={!accepted || isSubmitting}
        className="w-full h-12 text-base font-medium"
      >
        {isSubmitting ? (
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
        ) : (
          <CheckCircle2 className="w-5 h-5 mr-2" />
        )}
        {isSubmitting ? "Saving..." : "Accept & Continue"}
      </Button>
    </motion.div>
  );
}
