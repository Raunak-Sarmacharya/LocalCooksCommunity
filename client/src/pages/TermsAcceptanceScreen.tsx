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
  ArrowDown,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

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

  const handleScroll = useCallback((ref: React.RefObject<HTMLDivElement>, setRead: (read: boolean) => void) => {
    const el = ref.current;
    if (!el) return;
    
    const { scrollTop, scrollHeight, clientHeight } = el;
    
    // Handle non-scrollable content
    if (scrollHeight <= clientHeight + 1) {
      setRead(true);
      return;
    }
    
    const progress = Math.min(100, Math.round((scrollTop / (scrollHeight - clientHeight)) * 100));
    
    if (progress > 95) {
      setRead(true);
    }
  }, []);

  useEffect(() => {
    // Initial check for short content
    const checkInitialRead = () => {
      if (termsRef.current) handleScroll(termsRef, setTermsRead);
      if (privacyRef.current) handleScroll(privacyRef, setPrivacyRead);
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
  const allAccepted = termsAccepted && privacyAccepted;
  
  const canContinueToNext = (activeTab === "terms" && termsRead && termsAccepted && !privacyRead) || 
                            (activeTab === "privacy" && privacyRead && privacyAccepted && !termsRead);

  const handleMainAction = () => {
    if (allRead && allAccepted) {
      handleSubmit();
    } else if (activeTab === "terms" && termsRead && termsAccepted) {
      setActiveTab("privacy");
    } else if (activeTab === "privacy" && privacyRead && privacyAccepted) {
      setActiveTab("terms");
    }
  };

  return (
    <div className="relative h-screen w-full bg-slate-50 flex items-center justify-center px-4 overflow-hidden font-sans">
      {/* Premium Background Elements */}
      <AnimatedBackgroundOrbs variant="both" intensity="normal" className="opacity-30" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none" />
      
      <div className="w-full max-w-5xl relative z-10 max-h-[90vh] flex flex-col">
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 flex flex-col min-h-0"
        >
          <Card className="flex-1 flex flex-col shadow-[0_20px_50px_rgba(0,0,0,0.08),0_0_0_1px_rgba(255,255,255,0.5)] border-none bg-white/80 backdrop-blur-2xl rounded-[2rem] overflow-hidden min-h-0">
            <CardContent className="p-0 flex-1 flex flex-col min-h-0">
              <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0">
                
                {/* Brand Sidebar */}
                <div className="hidden lg:flex lg:col-span-4 bg-primary/5 p-10 flex-col justify-between relative overflow-hidden border-r border-gray-100">
                  {/* Decorative Elements */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[100px] -mr-32 -mt-32 opacity-50" />
                  
                  <div className="relative z-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-primary text-white rounded-2xl shadow-lg shadow-primary/20 mb-10">
                      <ShieldCheck className="h-8 w-8" />
                    </div>
                    <h1 className="text-2xl font-semibold text-slate-900 leading-tight mb-4 tracking-tight">
                      Review & Agreement
                    </h1>
                    <p className="text-sm text-slate-500 leading-relaxed mb-10">
                      To continue using the platform, please review our updated policies. Your security and privacy are our top priorities.
                    </p>
                    
                    {/* Removed redundant sidebar links */}
                  </div>
                  
                  <div className="relative z-10">
                    <div className="p-4 bg-white/40 rounded-2xl border border-white/50 backdrop-blur-sm">
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] mb-1">Last Updated</p>
                      <p className="text-sm text-gray-700 font-semibold">May 2026 • {CURRENT_POLICY_VERSION}</p>
                    </div>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="lg:col-span-8 p-6 md:p-10 flex flex-col h-full bg-white/40 min-h-0">
                  {/* Mobile Header - Only visible on small screens */}
                  <div className="lg:hidden mb-8">
                    <h2 className="text-xl font-semibold text-slate-900 tracking-tight mb-2">Review & Agreement</h2>
                    <p className="text-xs text-slate-500 font-medium">Please review our latest policies to continue.</p>
                  </div>

                  <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                    <TabsList className="w-full bg-slate-100/50 p-1.5 rounded-2xl mb-6 border border-slate-200/50">
                      <TabsTrigger value="terms" className="flex-1 rounded-xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-[0_2px_10px_rgba(0,0,0,0.05)] text-sm font-semibold transition-all duration-300">
                        Terms of Service
                      </TabsTrigger>
                      <TabsTrigger value="privacy" className="flex-1 rounded-xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-[0_2px_10px_rgba(0,0,0,0.05)] text-sm font-semibold transition-all duration-300">
                        Privacy Policy
                      </TabsTrigger>
                    </TabsList>

                    <div className="flex-1 relative mb-6 min-h-0">
                      <div className="h-full relative overflow-hidden rounded-2xl border border-slate-200/50 bg-white/50">
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                            className="h-full"
                          >
                            <div 
                              ref={activeTab === 'terms' ? termsRef : privacyRef}
                              onScroll={() => handleScroll(activeTab === 'terms' ? termsRef : privacyRef, activeTab === 'terms' ? setTermsRead : setPrivacyRead)}
                              className="h-full overflow-y-auto custom-scrollbar px-6 md:px-10 pt-8 pb-16"
                            >
                              <div className="premium-legal-content max-w-2xl mx-auto">
                                {activeTab === 'terms' ? <TermsContent /> : <PrivacyContent />}
                              </div>
                            </div>
                            
                            {/* Visual Scroll Fades */}
                            <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-white to-transparent pointer-events-none" />
                            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
                          </motion.div>
                        </AnimatePresence>

                        {/* Integrated Status Footer - Inside the content container */}
                        <div className="absolute bottom-0 left-0 right-0 py-3 bg-slate-50/80 backdrop-blur-md border-t border-slate-100 flex items-center justify-center z-20">
                          <AnimatePresence mode="wait">
                            {((activeTab === 'terms' && !termsRead) || (activeTab === 'privacy' && !privacyRead)) ? (
                              <motion.div 
                                key="need-scroll"
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                                className="flex items-center gap-2 text-slate-400"
                              >
                                <ArrowDown className="h-3 w-3 animate-bounce" />
                                <span className="text-[11px] font-semibold tracking-wide uppercase">Scroll to read all {activeTab === 'terms' ? 'Terms' : 'Policies'}</span>
                              </motion.div>
                            ) : (
                              <motion.div 
                                key="is-read"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex items-center gap-2 text-green-600"
                              >
                                <CheckCircle2 className="h-3.5 h-3.5" />
                                <span className="text-[11px] font-bold tracking-wide uppercase">Documentation Reviewed</span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-6">
                      {/* Minimal shadcn Acceptance Area */}
                      <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-6 space-y-4">
                        <div className="flex items-start space-x-3 group cursor-pointer">
                          <Checkbox 
                            id="terms-check" 
                            checked={termsAccepted} 
                            onCheckedChange={(checked) => termsRead && setTermsAccepted(checked as boolean)}
                            disabled={!termsRead}
                            className="mt-0.5 border-slate-300 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-all duration-300"
                          />
                          <div className="grid gap-1.5 leading-none">
                            <Label 
                              htmlFor="terms-check" 
                              className={`text-sm font-semibold leading-tight cursor-pointer transition-colors ${!termsRead ? 'text-slate-400' : 'text-slate-700 group-hover:text-primary'}`}
                            >
                              I agree to the Terms of Service
                            </Label>
                            <p className="text-[11px] text-slate-500 font-medium">
                              Required agreement for platform usage
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start space-x-3 group cursor-pointer">
                          <Checkbox 
                            id="privacy-check" 
                            checked={privacyAccepted} 
                            onCheckedChange={(checked) => privacyRead && setPrivacyAccepted(checked as boolean)}
                            disabled={!privacyRead}
                            className="mt-0.5 border-slate-300 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-all duration-300"
                          />
                          <div className="grid gap-1.5 leading-none">
                            <Label 
                              htmlFor="privacy-check" 
                              className={`text-sm font-semibold leading-tight cursor-pointer transition-colors ${!privacyRead ? 'text-slate-400' : 'text-slate-700 group-hover:text-primary'}`}
                            >
                              I agree to the Privacy Policy
                            </Label>
                            <p className="text-[11px] text-slate-500 font-medium">
                              Acknowledgment of data processing practices
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Final Submit / Guidance Button */}
                      <div className="relative">
                        {error && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="absolute -top-14 left-0 right-0 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-xs font-semibold"
                          >
                            <AlertCircle className="h-4 w-4" />
                            {error}
                          </motion.div>
                        )}
                        <Button
                          onClick={handleMainAction}
                          disabled={(!allRead && !canContinueToNext) || (!allAccepted && !canContinueToNext) || isSubmitting || success}
                          className="w-full py-7 rounded-2xl text-base font-bold shadow-xl shadow-primary/20 hover:shadow-2xl hover:shadow-primary/30 transition-all duration-300 relative overflow-hidden group bg-primary text-white"
                        >
                          <AnimatePresence mode="wait">
                            {isSubmitting ? (
                              <motion.div key="submitting" className="flex items-center gap-3">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                Processing acceptance...
                              </motion.div>
                            ) : success ? (
                              <motion.div key="success" className="flex items-center gap-3">
                                Redirecting...
                              </motion.div>
                            ) : (
                              <motion.div key="action" className="flex items-center gap-3">
                                {allRead && allAccepted ? (
                                  <>I Agree & Continue</>
                                ) : !allRead ? (
                                  <>{activeTab === 'terms' ? 'Read Terms to Proceed' : 'Read Privacy to Proceed'}</>
                                ) : (
                                  <>Complete Both Agreements</>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                          
                          {/* Shimmer effect */}
                          {(allRead || canContinueToNext) && !isSubmitting && !success && (
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-shimmer pointer-events-none" />
                          )}
                        </Button>
                      </div>
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
          width: 5px;
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
          animation: shimmer 1.5s infinite linear;
        }

        .premium-legal-content {
          font-family: 'Inter', -apple-system, sans-serif;
          font-size: 0.875rem !important;
          line-height: 1.7 !important;
          color: #475569 !important;
          letter-spacing: -0.01em !important;
        }
        
        .premium-legal-content {
          font-family: inherit;
          color: #334155;
          line-height: 1.6;
        }

        .premium-legal-content h1 {
          display: none !important;
        }
        
        .premium-legal-content h2 {
          font-size: 1.125rem !important;
          font-weight: 700 !important;
          margin-top: 2.5rem !important;
          margin-bottom: 1.25rem !important;
          color: #0f172a !important;
          letter-spacing: -0.02em !important;
        }
        
        .premium-legal-content p, .premium-legal-content li {
          font-size: 0.875rem !important;
          margin-bottom: 1rem !important;
          color: #475569 !important;
        }
        
        .premium-legal-content hr {
          margin: 2rem 0 !important;
          border: none;
          height: 1px;
          background: #f1f5f9;
        }

        .premium-legal-content strong {
          color: #0f172a !important;
          font-weight: 600 !important;
        }

        .premium-legal-content ul, .premium-legal-content ol {
          padding-left: 1.25rem !important;
          margin-bottom: 1.25rem !important;
        }

        .premium-legal-content blockquote {
          background: #f8fafc;
          border-radius: 0.75rem;
          padding: 1.25rem;
          font-style: italic;
          border-left: 4px solid #e2e8f0;
          margin: 1.5rem 0;
        }
      `}} />
    </div>
  );
}

export default TermsAcceptanceScreen;

