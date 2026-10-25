import { logger } from "@/lib/logger";
/**
 * Where Stripe's hosted onboarding sends a kitchen back (same tab).
 *
 * Stripe's return_url "doesn't mean that all information has been collected", so this page asks Stripe for the
 * account's real stage and says that, the way the email-verification page does: payouts on, details under review
 * (nothing to do), more details needed (continue with Stripe), or rejected (contact support). Then it returns to the
 * step the kitchen left: the Payments step of setup, or Payment settings.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, AlertCircle, XCircle } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Logo from "@/components/ui/logo";
import { auth } from "@/lib/firebase";
import { mt } from "@/i18n/manager";

type Outcome = "loading" | "connected" | "reviewing" | "needs_more" | "rejected" | "unknown";

const params = () => new URLSearchParams(window.location.search);
function destination() {
  const role = params().get("role") || "manager";
  if (role === "chef") return "/chef/dashboard";
  return params().get("from") === "setup" ? "/manager/setup?step=payment-setup" : "/manager/dashboard?view=revenue&tab=payouts";
}
function outcomeFor(stage: string | undefined, detailsSubmitted: boolean): Outcome {
  if (stage === "complete") return "connected";
  if (stage === "rejected") return "rejected";
  if (stage === "pending_verification" || (detailsSubmitted && !stage)) return "reviewing";
  return "needs_more";
}

export default function StripeConnectReturn() {
  const [outcome, setOutcome] = useState<Outcome>("loading");
  const [continuing, setContinuing] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const goBack = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); window.location.assign(destination()); };

  useEffect(() => {
    const role = params().get("role") || "manager";
    const unsubscribe = onAuthStateChanged(auth, async user => {
      if (!user) { setOutcome("unknown"); return; }
      try {
        const token = await user.getIdToken();
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        await fetch(`/api/${role === "chef" ? "chef" : "manager"}/stripe-connect/sync`, { method: "POST", headers });
        // Tell any other open tab (an older setup tab) that Stripe's state moved.
        try { const channel = new BroadcastChannel("stripe_onboarding_channel"); channel.postMessage({ type: "STRIPE_SETUP_COMPLETE" }); channel.close(); } catch { /* unsupported */ }
        if (role === "chef") { setOutcome("connected"); return; }
        const response = await fetch("/api/manager/stripe-connect/status", { headers });
        if (!response.ok) { setOutcome("unknown"); return; }
        const status = await response.json();
        setOutcome(outcomeFor(status.verificationStage, status.detailsSubmitted === true));
      } catch (error) {
        logger.error("Error checking Stripe status after return:", error);
        setOutcome("unknown");
      }
    });
    return () => { unsubscribe(); if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  }, []);

  // Nothing to decide on a good outcome: go back on our own, like the email-verification page.
  useEffect(() => {
    if (outcome === "connected" || outcome === "reviewing") leaveTimer.current = setTimeout(goBack, 3500);
  }, [outcome]);

  const continueWithStripe = async () => {
    setContinuing(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const from = params().get("from") === "setup" ? "?from=setup" : "";
      const response = await fetch(`/api/manager/stripe-connect/onboarding-link${from}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("link");
      window.location.assign((await response.json()).url);
    } catch {
      setContinuing(false);
      setOutcome("unknown");
    }
  };

  const view = {
    loading: { icon: <Loader2 className="h-7 w-7 animate-spin text-[#E10939]" />, tone: "", title: mt("srChecking"), body: mt("srCheckingBody") },
    connected: { icon: <CheckCircle2 className="h-6 w-6 text-emerald-600" />, tone: "bg-emerald-50", title: mt("srConnected"), body: mt("srConnectedBody") },
    reviewing: { icon: <Clock className="h-6 w-6 text-sky-600" />, tone: "bg-sky-50", title: mt("srReviewing"), body: mt("srReviewingBody") },
    needs_more: { icon: <AlertCircle className="h-6 w-6 text-amber-600" />, tone: "bg-amber-50", title: mt("srNeedsMore"), body: mt("srNeedsMoreBody") },
    rejected: { icon: <XCircle className="h-6 w-6 text-red-600" />, tone: "bg-red-50", title: mt("srRejected"), body: mt("srRejectedBody") },
    unknown: { icon: <AlertCircle className="h-6 w-6 text-stone-500" />, tone: "bg-stone-100", title: mt("srUnknown"), body: mt("srUnknownBody") },
  }[outcome];
  const backLabel = params().get("from") === "setup" ? mt("srBackToSetup") : mt("srBackToPayments");

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#FAFAF9] px-4 py-12 sm:py-20">
      <Logo className="h-10" />
      <Card className="mt-10 w-full max-w-[440px] rounded-2xl border border-stone-200 bg-white shadow-sm">
        <CardContent className="p-7 text-center sm:p-9" role={outcome === "loading" ? "status" : undefined}>
          <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${view.tone}`} aria-hidden>{view.icon}</span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-stone-950">{view.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">{view.body}</p>
          {outcome === "needs_more" && <>
            <Button onClick={() => void continueWithStripe()} disabled={continuing} className="mt-7 h-12 w-full rounded-lg bg-[#E10939] text-base font-semibold text-white hover:bg-[#C90832]">
              {continuing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{mt("srContinueWithStripe")}
            </Button>
            <Button variant="ghost" onClick={goBack} className="mt-2 h-11 w-full rounded-lg text-stone-700">{backLabel}</Button>
          </>}
          {outcome === "rejected" && <>
            <Button asChild className="mt-7 h-12 w-full rounded-lg bg-[#E10939] text-base font-semibold text-white hover:bg-[#C90832]">
              <a href="mailto:support@localcooks.ca?subject=Stripe%20account%20rejected">{mt("srContactSupport")}</a>
            </Button>
            <Button variant="ghost" onClick={goBack} className="mt-2 h-11 w-full rounded-lg text-stone-700">{backLabel}</Button>
          </>}
          {(outcome === "connected" || outcome === "reviewing" || outcome === "unknown") && <>
            <Button onClick={goBack} className="mt-7 h-12 w-full rounded-lg bg-[#E10939] text-base font-semibold text-white hover:bg-[#C90832]">{backLabel}</Button>
            {outcome !== "unknown" && <p className="mt-3 text-xs text-stone-500" role="status">{mt("srTakingYouBack")}</p>}
          </>}
        </CardContent>
      </Card>
      <p className="mt-6 text-center text-xs text-stone-500">
        {mt("srNeedHelp")} <a className="underline underline-offset-2 hover:text-stone-700" href="mailto:support@localcooks.ca">support@localcooks.ca</a>
      </p>
    </main>
  );
}
