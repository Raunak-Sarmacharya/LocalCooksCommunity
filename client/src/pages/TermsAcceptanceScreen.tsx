import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { motion } from "framer-motion";
import { ShieldCheck, Loader2, ArrowRight, ScrollText, Lock } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Redirect } from "wouter";
import TermsContent from "@/components/legal/TermsContent";
import PrivacyContent from "@/components/legal/PrivacyContent";

function TermsAcceptanceScreen() {
  const { user, refreshUserData } = useFirebaseAuth();
  const [, setLocation] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasReadToBottom, setHasReadToBottom] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.termsAccepted && user?.termsVersion === CURRENT_POLICY_VERSION) {
      const params = new URLSearchParams(window.location.search);
      const redirectPath = params.get("redirect") || "/dashboard";
      setLocation(redirectPath);
    }
  }, [user, setLocation]);

  useEffect(() => {
    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollableHeight = el.scrollHeight - el.clientHeight;
    if (scrollableHeight <= 0) {
      setHasReadToBottom(true);
      setScrollProgress(100);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const scrollableHeight = scrollHeight - clientHeight;

    if (scrollableHeight <= 0) {
      setScrollProgress(100);
      setHasReadToBottom(true);
      return;
    }

    const progress = Math.min(100, Math.round((scrollTop / scrollableHeight) * 100));
    setScrollProgress(progress);

    if (scrollTop + clientHeight >= scrollHeight - 120) {
      setHasReadToBottom(true);
    }
  }, []);

  const handleSubmit = async () => {
    if (!hasReadToBottom) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        setError("Authentication session expired. Please sign in again.");
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
        logger.info("Terms accepted successfully");
        await refreshUserData();
        setSuccess(true);
        setTimeout(() => {
          const params = new URLSearchParams(window.location.search);
          const redirectPath = params.get("redirect") || "/dashboard";
          setLocation(redirectPath);
        }, 600);
      } else {
        const text = await response.text();
        logger.error("Terms acceptance API failed:", response.status, text);
        setError("Something went wrong. Please try again.");
      }
    } catch (err) {
      logger.error("Error submitting terms acceptance:", err);
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) {
    return <Redirect to="/auth" />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="shadow-2xl border-0 bg-white/90 backdrop-blur-sm">
            <CardContent className="p-6 md:p-10">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 rounded-2xl mb-4">
                  <ShieldCheck className="h-7 w-7 text-primary" />
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
                  Updated Terms & Privacy Policy
                </h1>
                <p className="text-gray-600 text-sm md:text-base max-w-lg mx-auto">
                  Please review the documents below. The acceptance button will unlock once you have scrolled through both policies.
                </p>
              </div>

              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                <ScrollText className="h-5 w-5 text-amber-600 flex-shrink-0" />
                <p className="text-sm text-amber-800 leading-relaxed">
                  <strong>Action required:</strong> Scroll through both the Terms of Service and Privacy Policy below to enable the <strong>Agree & Continue</strong> button.
                </p>
              </div>

              <div className="mb-6">
                <div
                  ref={scrollContainerRef}
                  onScroll={handleScroll}
                  className="max-h-[50vh] overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-6 md:p-8 scroll-smooth"
                >
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-4">
                      <ScrollText className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-bold text-gray-900">Terms of Service</h2>
                    </div>
                    <TermsContent />
                  </div>

                  <div className="my-8 flex items-center gap-4">
                    <div className="flex-1 h-px bg-gray-300" />
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      End of Terms of Service
                    </span>
                    <div className="flex-1 h-px bg-gray-300" />
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Lock className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-bold text-gray-900">Privacy Policy</h2>
                    </div>
                    <PrivacyContent />
                  </div>

                  <div className="mt-8 flex items-center gap-4">
                    <div className="flex-1 h-px bg-gray-300" />
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      End of Privacy Policy
                    </span>
                    <div className="flex-1 h-px bg-gray-300" />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-500">
                      Reading progress
                    </span>
                    <span className="text-xs font-bold text-gray-700">
                      {scrollProgress}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-150 ease-out rounded-full"
                      style={{ width: `${scrollProgress}%` }}
                    />
                  </div>
                  {!hasReadToBottom && (
                    <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                      <ScrollText className="h-3 w-3" />
                      Keep scrolling to unlock acceptance
                    </p>
                  )}
                  {hasReadToBottom && (
                    <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      You have reached the end. You may now accept the policies.
                    </p>
                  )}
                </div>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  {error}
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={!hasReadToBottom || isSubmitting || success}
                size="lg"
                className="w-full font-bold py-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Processing...
                  </>
                ) : success ? (
                  <>
                    <ShieldCheck className="h-5 w-5 mr-2" />
                    Accepted! Redirecting...
                  </>
                ) : !hasReadToBottom ? (
                  <>
                    <ScrollText className="h-5 w-5 mr-2" />
                    Scroll to Accept
                  </>
                ) : (
                  <>
                    Agree & Continue
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>

              <p className="text-center text-xs text-gray-400 mt-4">
                Policy version {CURRENT_POLICY_VERSION} · You must accept to continue
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

export default TermsAcceptanceScreen;
