import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ShieldCheck, 
  Loader2, 
  ArrowRight, 
  ScrollText, 
  Lock, 
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Redirect } from "wouter";
import TermsContent from "@/components/legal/TermsContent";
import PrivacyContent from "@/components/legal/PrivacyContent";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";

function TermsAcceptanceScreen() {
  const { user, refreshUserData } = useFirebaseAuth();
  const [, setLocation] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [activeTab, setActiveTab] = useState("terms");
  const [termsRead, setTermsRead] = useState(false);
  const [privacyRead, setPrivacyRead] = useState(false);
  const [termsProgress, setTermsProgress] = useState(0);
  const [privacyProgress, setPrivacyProgress] = useState(0);

  const termsRef = useRef<HTMLDivElement>(null);
  const privacyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.termsAccepted && user?.termsVersion === CURRENT_POLICY_VERSION) {
      const params = new URLSearchParams(window.location.search);
      const redirectPath = params.get("redirect") || "/dashboard";
      setLocation(redirectPath);
    }
  }, [user, setLocation]);

  // Prevent back navigation during terms acceptance
  useEffect(() => {
    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleScroll = useCallback((ref: React.RefObject<HTMLDivElement>, setRead: (read: boolean) => void, setProgress: (p: number) => void) => {
    const el = ref.current;
    if (!el) return;
    
    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const scrollableHeight = scrollHeight - clientHeight;

    if (scrollableHeight <= 0) {
      setProgress(100);
      setRead(true);
      return;
    }

    const progress = Math.min(100, Math.round((scrollTop / scrollableHeight) * 100));
    setProgress(progress);

    if (scrollTop + clientHeight >= scrollHeight - 50) {
      setRead(true);
      setProgress(100);
    }
  }, []);

  useEffect(() => {
    // Initial check for short content
    const checkInitialRead = () => {
      if (termsRef.current) handleScroll(termsRef, setTermsRead, setTermsProgress);
      if (privacyRef.current) handleScroll(privacyRef, setPrivacyRead, setPrivacyProgress);
    };
    
    // Small delay to ensure content is rendered
    const timer = setTimeout(checkInitialRead, 500);
    return () => clearTimeout(timer);
  }, [activeTab, handleScroll]);

  const handleSubmit = async () => {
    if (!termsRead || !privacyRead) return;
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
        }, 800);
      } else {
        const text = await response.text();
        logger.error("Terms acceptance API failed:", response.status, text);
        setError("Something went wrong while saving your acceptance. Please try again.");
      }
    } catch (err) {
      logger.error("Error submitting terms acceptance:", err);
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) {
    return <Redirect to="/auth" />;
  }

  const allRead = termsRead && privacyRead;
  const canContinueToNext = (activeTab === "terms" && termsRead && !privacyRead) || 
                            (activeTab === "privacy" && privacyRead && !termsRead);

  const handleMainAction = () => {
    if (allRead) {
      handleSubmit();
    } else if (activeTab === "terms" && termsRead) {
      setActiveTab("privacy");
    } else if (activeTab === "privacy" && privacyRead) {
      setActiveTab("terms");
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex items-center justify-center px-4 py-4 sm:py-12 overflow-hidden">
      {/* Premium Background Elements */}
      <AnimatedBackgroundOrbs variant="both" intensity="normal" className="opacity-40" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none" />
      
      <div className="w-full max-w-4xl relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <Card className="shadow-2xl border border-white/20 bg-white/70 backdrop-blur-xl rounded-3xl overflow-hidden">
            <CardContent className="p-0">
              <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px] lg:min-h-[650px]">
                
                {/* Sidebar Info - Hidden on mobile, useful for premium look */}
                <div className="hidden lg:flex lg:col-span-4 bg-primary/5 border-r border-gray-100 p-8 flex-col justify-between">
                  <div>
                    <div className="inline-flex items-center justify-center w-14 h-14 bg-primary text-white rounded-2xl shadow-lg shadow-primary/20 mb-8">
                      <ShieldCheck className="h-7 w-7" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 leading-tight mb-4">
                      Security & Compliance
                    </h1>
                    <p className="text-gray-600 text-sm leading-relaxed mb-8">
                      We've updated our legal framework to better protect our community. Please take a moment to review both policies.
                    </p>
                    
                    <div className="space-y-6">
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 p-1 rounded-full ${termsRead ? 'bg-green-100' : 'bg-gray-100'}`}>
                          {termsRead ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <ScrollText className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Terms of Service</p>
                          <p className="text-xs text-gray-500">{termsRead ? 'Read and completed' : 'Required reading'}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 p-1 rounded-full ${privacyRead ? 'bg-green-100' : 'bg-gray-100'}`}>
                          {privacyRead ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Lock className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Privacy Policy</p>
                          <p className="text-xs text-gray-500">{privacyRead ? 'Read and completed' : 'Required reading'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-auto">
                    <p className="text-xs text-gray-400">
                      Version {CURRENT_POLICY_VERSION}
                    </p>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="lg:col-span-8 p-4 md:p-10 flex flex-col h-full">
                  <div className="lg:hidden mb-6 text-center">
                     <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-xl mb-4">
                      <ShieldCheck className="h-6 w-6 text-primary" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Legal Updates</h1>
                  </div>

                  <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                    <TabsList className="w-full bg-gray-100/50 p-1 rounded-xl mb-3 lg:mb-6">
                      <TabsTrigger value="terms" className="flex-1 rounded-lg py-2 lg:py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2 text-xs lg:text-sm">
                        <ScrollText className="h-4 w-4" />
                        <span className="hidden sm:inline">Terms of Service</span>
                        <span className="sm:hidden">Terms</span>
                        {termsRead && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      </TabsTrigger>
                      <TabsTrigger value="privacy" className="flex-1 rounded-lg py-2 lg:py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2 text-xs lg:text-sm">
                        <Lock className="h-4 w-4" />
                        <span className="hidden sm:inline">Privacy Policy</span>
                        <span className="sm:hidden">Privacy</span>
                        {privacyRead && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      </TabsTrigger>
                    </TabsList>

                    <div className="flex-1 relative min-h-[300px] lg:min-h-[350px]">
                      <TabsContent value="terms" className="m-0 h-full">
                        <div 
                          ref={termsRef}
                          onScroll={() => handleScroll(termsRef, setTermsRead, setTermsProgress)}
                          className="absolute inset-0 overflow-y-auto pr-2 custom-scrollbar bg-gray-50/30 rounded-xl border border-gray-100 p-4 md:p-8"
                        >
                          <TermsContent />
                        </div>
                      </TabsContent>
                      
                      <TabsContent value="privacy" className="m-0 h-full">
                        <div 
                          ref={privacyRef}
                          onScroll={() => handleScroll(privacyRef, setPrivacyRead, setPrivacyProgress)}
                          className="absolute inset-0 overflow-y-auto pr-2 custom-scrollbar bg-gray-50/30 rounded-xl border border-gray-100 p-4 md:p-8"
                        >
                          <PrivacyContent />
                        </div>
                      </TabsContent>
                    </div>

                    <div className="mt-4 lg:mt-6 flex flex-col gap-4 lg:gap-6">
                      {/* Reading Indicator */}
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <motion.div 
                            className={`h-full ${activeTab === 'terms' ? 'bg-primary' : 'bg-primary/80'}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${activeTab === 'terms' ? termsProgress : privacyProgress}%` }}
                            transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          {activeTab === 'terms' ? termsProgress : privacyProgress}% Read
                        </span>
                      </div>

                      {/* Error State */}
                      {error && (
                        <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          {error}
                        </div>
                      )}

                      {/* Action Button */}
                      <Button
                        onClick={handleMainAction}
                        disabled={(!allRead && !canContinueToNext) || isSubmitting || success}
                        size="lg"
                        className="w-full py-6 lg:py-7 rounded-2xl text-base font-bold shadow-xl shadow-primary/20 hover:shadow-2xl hover:shadow-primary/30 transition-all duration-300 relative overflow-hidden group"
                      >
                        <AnimatePresence mode="wait">
                          {isSubmitting ? (
                            <motion.div 
                              key="submitting"
                              initial={{ opacity: 0 }} 
                              animate={{ opacity: 1 }}
                              className="flex items-center justify-center"
                            >
                              <Loader2 className="h-5 w-5 animate-spin mr-2" />
                              Applying preferences...
                            </motion.div>
                          ) : success ? (
                            <motion.div 
                              key="success"
                              initial={{ opacity: 0, y: 10 }} 
                              animate={{ opacity: 1, y: 0 }}
                              className="flex items-center justify-center"
                            >
                              <CheckCircle2 className="h-5 w-5 mr-2" />
                              All set! Redirecting...
                            </motion.div>
                          ) : canContinueToNext ? (
                            <motion.div 
                              key="continue"
                              initial={{ opacity: 0, x: 10 }} 
                              animate={{ opacity: 1, x: 0 }}
                              className="flex items-center justify-center"
                            >
                              Continue to {activeTab === "terms" ? "Privacy Policy" : "Terms of Service"}
                              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                            </motion.div>
                          ) : !allRead ? (
                            <motion.div 
                              key="not-ready"
                              initial={{ opacity: 0 }} 
                              animate={{ opacity: 1 }}
                              className="flex items-center justify-center gap-2 opacity-80"
                            >
                              {!termsRead && activeTab === "terms" ? 'Scroll to read Terms' : 
                               !privacyRead && activeTab === "privacy" ? 'Scroll to read Privacy' : 
                               activeTab === "terms" ? 'Continue to Privacy' : 'Continue to Terms'}
                              <ArrowRight className="h-4 w-4" />
                            </motion.div>
                          ) : (
                            <motion.div 
                              key="ready"
                              initial={{ opacity: 0, scale: 0.95 }} 
                              animate={{ opacity: 1, scale: 1 }}
                              className="flex items-center justify-center"
                            >
                              I Agree to Both Policies
                              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                            </motion.div>
                          )}
                        </AnimatePresence>
                        
                        {/* Shimmer effect on hover when ready */}
                        {(allRead || canContinueToNext) && !isSubmitting && !success && (
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                        )}
                      </Button>
                      
                      {!allRead && (
                        <p className="text-center text-xs text-gray-500 animate-pulse">
                          Scroll through both tabs to enable acceptance
                        </p>
                      )}
                    </div>
                  </Tabs>
                </div>
              </div>
            </CardContent>

          </Card>
        </motion.div>
      </div>
      
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}} />
    </div>
  );
}

export default TermsAcceptanceScreen;

