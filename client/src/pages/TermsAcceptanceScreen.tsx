import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { AlertCircle, ChevronRight, FileText, Loader2, LogOut, ShieldCheck } from "@/components/ui/manager-icons";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { getChefPostAuthPath } from "@/config/chef-onboarding-steps";
import PrivacyContent from "@/components/legal/PrivacyContent";
import TermsContent from "@/components/legal/TermsContent";
import { postTermsRedirect } from "@/lib/post-terms-redirect";
import { useEffect, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

type DocumentKey = "terms" | "privacy";

const DOCUMENTS: Record<DocumentKey, { label: string; title: string; description: string; Icon: typeof FileText }> = {
  terms: {
    label: "Terms of Service",
    title: "Local Cooks Platform Terms of Service",
    description: "Bookings, payments, liability and conduct on the platform.",
    Icon: FileText,
  },
  privacy: {
    label: "Privacy Policy",
    title: "Local Cooks Privacy Policy",
    description: "What we collect, why, who we share it with, and how long we keep it.",
    Icon: ShieldCheck,
  },
};

type TermsUser = {
  uid?: string;
  role?: string | null;
  isManager?: boolean | null;
  managerOnboardingCompleted?: boolean | null;
  managerOnboardingStepsCompleted?: Record<string, unknown> | null;
};

/** Component wrapper around the pure {@link postTermsRedirect} helper. */
function resolvePostTermsRedirect(user: TermsUser | null | undefined): string {
  return postTermsRedirect({
    hostname: window.location.hostname,
    redirectParam: new URLSearchParams(window.location.search).get("redirect"),
    role: user?.role,
    isManager: user?.isManager,
    chefFallback: getChefPostAuthPath(user as any),
  });
}

/**
 * Agree to the Terms of Service and Privacy Policy: one short screen.
 *
 * Clickwrap, the pattern Airbnb and Uber use and courts enforce (Rudder v. Microsoft in Ontario; Meyer v. Uber,
 * Selden v. Airbnb in the US): both documents named and one tap from being read, an unticked box whose label says
 * what is being agreed to, and the button beside it. It replaced a scroll-to-the-end gate over the full text, which
 * people missed the way past (owner, Oct 24). `POST /api/user/accept-terms` still records the acceptance, time and
 * policy version.
 *
 * The documents open in a side reader rather than a new page, so reading them never loses the place.
 */
function TermsAcceptanceScreen() {
  const { user, refreshUserData, logout } = useFirebaseAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [reading, setReading] = useState<DocumentKey | null>(null);

  useEffect(() => {
    if (user?.termsAccepted && user?.termsVersion === CURRENT_POLICY_VERSION) {
      setLocation(resolvePostTermsRedirect(user), { replace: true });
    }
  }, [user, setLocation]);

  /**
   * Where to go next, decided here rather than one redirect later.
   *
   * A brand-new manager was sent to the dashboard, whose guard then loaded their locations and redirected to setup:
   * two loading screens back to back. Fetching the locations into the same cache entry the guard reads, and going
   * straight to setup when there are none, makes it one step.
   */
  const destinationAfterAgreeing = async (): Promise<string> => {
    const target = resolvePostTermsRedirect(user);
    const manager = user?.role === "manager" || user?.isManager === true;
    const started = Object.keys((user as TermsUser | null)?.managerOnboardingStepsCompleted ?? {}).length > 0;
    if (!manager || target !== "/manager/dashboard" || (user as TermsUser | null)?.managerOnboardingCompleted || started) return target;
    try {
      const locations = await queryClient.fetchQuery({
        queryKey: ["/api/manager/locations", auth.currentUser?.uid],
        queryFn: async () => {
          const token = await auth.currentUser?.getIdToken();
          const response = await fetch("/api/manager/locations", { headers: { Authorization: `Bearer ${token}` } });
          return response.ok ? response.json() : [];
        },
        staleTime: 30_000,
      });
      return Array.isArray(locations) && locations.length === 0 ? "/manager/setup" : target;
    } catch {
      return target;
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        setError("Your session expired. Sign in again to continue.");
        setIsSubmitting(false);
        return;
      }
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/user/accept-terms", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      if (!response.ok) {
        logger.error("Terms acceptance API failed:", response.status, await response.text());
        setError("We couldn't save your agreement. Try again.");
        setIsSubmitting(false);
        return;
      }
      logger.info("Terms accepted successfully");
      await refreshUserData();
      // Write the acceptance into every cached profile now: the route guards read the cache first, and a stale
      // `termsAccepted: false` bounced managers straight back here (the old redirect loop).
      const acceptedAt = new Date().toISOString();
      queryClient.setQueriesData({ queryKey: ["/api/user/profile"] }, (oldData: any) => oldData && ({
        ...oldData,
        termsAccepted: true, terms_accepted: true,
        termsAcceptedAt: acceptedAt, terms_accepted_at: acceptedAt,
        termsVersion: CURRENT_POLICY_VERSION, terms_version: CURRENT_POLICY_VERSION,
      }));
      void queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      // The button stays in its loading state until the next screen replaces this one.
      setLocation(await destinationAfterAgreeing(), { replace: true });
    } catch (err) {
      logger.error("Error submitting terms acceptance:", err);
      setError("Network error. Check your connection and try again.");
      setIsSubmitting(false);
    }
  };

  if (!user) {
    // Role-aware: managers on kitchen must not bounce to the chef /auth page.
    const fallback = window.location.hostname.includes("kitchen") || window.location.pathname.startsWith("/manager")
      ? "/manager/login"
      : "/auth";
    return <Redirect to={fallback} replace />;
  }

  const open = reading ? DOCUMENTS[reading] : null;
  // Someone who agreed to an earlier version is re-accepting, not starting out.
  const returning = Boolean(user.termsAccepted && user.termsVersion && user.termsVersion !== CURRENT_POLICY_VERSION);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FBFAF9]">
      {/* The welcome screen's brand wash, so the two read as one sequence. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-22rem] h-[34rem] w-[60rem] -translate-x-1/2 rounded-full bg-[#E10939]/[0.06] blur-3xl" />

      <header className="relative flex h-16 items-center px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo variant="brand" className="h-8 w-auto shrink-0" />
          <span className="font-logo text-lg leading-none tracking-tight text-[#E10939]">LocalCooks</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void logout()} disabled={isSubmitting}
          className="ml-auto gap-2 text-slate-500 hover:text-slate-900">
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </header>

      <main className="relative mx-auto w-full max-w-[34rem] px-5 pb-16 pt-8 sm:pt-16">
        <h1 className="text-balance text-[28px] font-bold leading-tight tracking-[-0.025em] text-slate-950 sm:text-[32px]">
          {returning ? "We've updated our terms" : "One last thing before you start"}
        </h1>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-slate-600">
          {returning
            ? "We rewrote our Terms of Service and Privacy Policy to match how Local Cooks works today: bookings, payments, payouts and your data. Please read and agree to continue."
            : "These two documents cover how Local Cooks works: bookings, payments and your data."}
        </p>

        <ul className="mt-8 divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-18px_rgba(15,23,42,0.18)]">
          {(Object.keys(DOCUMENTS) as DocumentKey[]).map(key => {
            const { label, description, Icon } = DOCUMENTS[key];
            return (
              <li key={key}>
                <button type="button" onClick={() => setReading(key)}
                  className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E10939]/[0.08] text-[#E10939]">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-slate-900">{label}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-slate-500 group-hover:text-slate-900">
                    Read<ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-7 flex items-start gap-3">
          <Checkbox id="accept-agreement" checked={agreed} disabled={isSubmitting}
            onCheckedChange={value => setAgreed(value === true)} className="mt-0.5 h-5 w-5" />
          {/* One sentence naming both documents: this is the statement that records consent. */}
          <Label htmlFor="accept-agreement" className="cursor-pointer text-[15px] font-normal leading-snug text-slate-700">
            I agree to the Local Cooks <span className="font-semibold text-slate-900">Terms of Service</span> and{" "}
            <span className="font-semibold text-slate-900">Privacy Policy</span>.
          </Label>
        </div>

        {error && (
          <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700 ring-1 ring-red-100">
            <AlertCircle className="mt-px h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button onClick={() => void handleSubmit()} disabled={!agreed || isSubmitting} size="lg"
          className="mt-6 h-12 w-full rounded-xl bg-[#E10939] text-[15px] font-semibold text-white shadow-[0_2px_6px_-1px_rgba(15,23,42,0.1),0_10px_28px_-8px_rgba(245,16,66,0.38)] transition-colors hover:bg-[#C90832] disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 disabled:shadow-none">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {isSubmitting ? "One moment…" : "Agree & continue"}
        </Button>
      </main>

      {/* The reader: full height on the right on a computer, the whole screen on a phone. */}
      <Sheet open={reading !== null} onOpenChange={value => !value && setReading(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          {open && (
            <>
              <div className="shrink-0 border-b border-slate-100 px-6 pb-4 pt-6 pr-14">
                <SheetTitle className="text-lg font-bold tracking-[-0.015em] text-slate-950">{open.title}</SheetTitle>
                <SheetDescription className="mt-1 text-[13px] text-slate-500">{open.description}</SheetDescription>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-6" tabIndex={0}>
                {reading === "terms" ? <TermsContent variant="reader" /> : <PrivacyContent variant="reader" />}
              </div>
              <div className="shrink-0 border-t border-slate-100 px-6 py-4">
                <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setReading(null)}>Done reading</Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}

export default TermsAcceptanceScreen;
