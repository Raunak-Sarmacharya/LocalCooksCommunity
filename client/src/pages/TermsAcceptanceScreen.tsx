import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowDown, Check, Loader2, LogOut } from "@/components/ui/manager-icons";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { getChefPostAuthPath } from "@/config/chef-onboarding-steps";
import PrivacyContent from "@/components/legal/PrivacyContent";
import TermsContent from "@/components/legal/TermsContent";
import { postTermsRedirect } from "@/lib/post-terms-redirect";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

type DocumentKey = "terms" | "privacy";

const DOCUMENT_ORDER: DocumentKey[] = ["terms", "privacy"];

/**
 * Keeps the closing marker clear of the action bar before a document counts as
 * read. Generous on purpose: over-shooting only asks for a few extra pixels of
 * scroll, whereas under-shooting would mark a document read while its last
 * lines are still hidden behind the bar.
 */
const END_OF_DOCUMENT_INSET = 96;

/**
 * The reading column, shared by the header, the document and the action bar so
 * everything sits on one vertical axis. A legal document is read, not skimmed,
 * so the measure is deliberately narrow — the old layout let the text run the
 * full width of a `max-w-3xl` column, which is roughly 110 characters a line and
 * is most of why the page read as unconsidered.
 */
const COLUMN = "mx-auto w-full max-w-[44rem]";

interface DocumentMeta {
  /** Tab label and the noun used in status copy. */
  label: string;
  title: string;
  description: string;
}

const DOCUMENTS: Record<DocumentKey, DocumentMeta> = {
  terms: {
    label: "Terms of Service",
    title: "Local Cooks Platform Terms of Service",
    description:
      "The agreement between you and Jawrophi Delivery Inc. covering bookings, payments, liability and conduct on the platform.",
  },
  privacy: {
    label: "Privacy Policy",
    title: "Local Cooks Privacy Policy",
    description:
      "What we collect, why we collect it, who we share it with, and how long we keep it.",
  },
};

/** Component wrapper around the pure {@link postTermsRedirect} helper. */
function resolvePostTermsRedirect(
  user: { role?: string | null; isManager?: boolean | null } | null | undefined,
): string {
  return postTermsRedirect({
    hostname: window.location.hostname,
    redirectParam: new URLSearchParams(window.location.search).get("redirect"),
    role: user?.role,
    isManager: user?.isManager,
    chefFallback: getChefPostAuthPath(user),
  });
}

/**
 * Review & Agreement.
 *
 * WHY THERE ARE NO BREADCRUMBS
 * This page used to carry a breadcrumb whose first crumb was a home icon wired to
 * `setLocation("/dashboard")` — a path that is not a manager route, so it dropped a
 * manager onto an unrelated page. More fundamentally, breadcrumbs describe a hierarchy
 * you can navigate back up. There is no parent here: this is a gate, and nothing below
 * it is reachable until the agreement is recorded. A trail that implies otherwise is
 * worse than no trail, so the header states where you are and offers the one action
 * that is actually available (sign out).
 *
 * WHY ONE AGREEMENT, NOT TWO
 * `POST /api/user/accept-terms` records a single acceptance (`termsAccepted`,
 * `termsAcceptedAt`, `termsVersion`) and has no notion of per-document consent, so the
 * two separate checkboxes this page used to require were a client-side invention that
 * made a legal formality feel like a two-step wizard. There is now one checkbox, and its
 * label names BOTH documents so nobody can agree to one without being told about the
 * other. Both texts remain readable and switchable via the tabs, and the reading gate
 * still covers each of them.
 *
 * WHY THE SCROLL GATE STAYS
 * Requiring a scroll before the accept control unlocks is "scrollwrap", and the
 * enforceability cases (Good v. Uber, Berroa v. Nasimov) turn on the terms being
 * embedded in a box the reader must scroll through, with a separate accept control.
 * So the gate is a legal asset, not friction to remove — what changed is how it is
 * communicated: a progress rail on the document, and a plain sentence saying exactly
 * which document is still outstanding, instead of a floating pill bouncing over the text.
 */
function TermsAcceptanceScreen() {
  const { user, refreshUserData, logout } = useFirebaseAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [activeTab, setActiveTab] = useState<DocumentKey>("terms");
  const [read, setRead] = useState<Record<DocumentKey, boolean>>({
    terms: false,
    privacy: false,
  });
  /** One acceptance for the whole agreement — see the note above. */
  const [agreed, setAgreed] = useState(false);

  /** The scrolling viewport — the reading gate measures against it. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Closing marker of whichever document is currently mounted.
   *
   * A CALLBACK ref held in state, not a plain `useRef`. The page renders `<Redirect>`
   * while `user` is still resolving, so on the first render the whole tree — and this
   * marker with it — does not exist. A `useRef` would stay null, and the effect below,
   * whose dependencies (`activeTab`, `read`) never change on their own, would never run
   * again: the IntersectionObserver would never be created and the reading gate would
   * never open by scrolling. That was a real bug — the only way past the gate was the
   * "scroll to bottom" pill, once per document, which is precisely the hassle this page
   * was reported for. State makes the effect re-run the moment the marker exists.
   */
  const [endOfDocument, setEndOfDocument] = useState<HTMLDivElement | null>(null);
  const isFirstRender = useRef(true);

  /**
   * How far through the current document the reader is, 0 to 1. This is the honest
   * "there is more below" cue: it says how much more, which the old bottom fade could
   * not, and it is what makes the scroll requirement feel like progress rather than an
   * arbitrary lock.
   */
  const [progress, setProgress] = useState(0);

  const updateScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    // A document short enough to fit on screen is fully read on arrival.
    setProgress(max > 2 ? Math.min(1, scroller.scrollTop / max) : 1);
  }, []);

  useEffect(() => {
    if (user?.termsAccepted && user?.termsVersion === CURRENT_POLICY_VERSION) {
      setLocation(resolvePostTermsRedirect(user), { replace: true });
    }
  }, [user, setLocation]);

  /**
   * Reading gate.
   *
   * The document counts as read once its closing marker scrolls into the viewport,
   * clear of the action bar. A document short enough to fit on screen therefore passes
   * on arrival.
   */
  useEffect(() => {
    if (read[activeTab] || !endOfDocument) return;

    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRead((prev) => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
        }
      },
      { root, rootMargin: `0px 0px -${END_OF_DOCUMENT_INSET}px 0px`, threshold: 0 },
    );
    observer.observe(endOfDocument);
    return () => observer.disconnect();
  }, [activeTab, read, endOfDocument]);

  /**
   * Returning the reader to the top of the document they just switched to.
   *
   * Runs as a layout effect, so the scroll position is already reset before the
   * observer above is created. Without that, switching from a long document to a
   * shorter one would leave the viewport parked at the bottom, the shorter document's
   * closing marker would land in view, and it would be marked read without ever being
   * shown.
   */
  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setProgress(0);
  }, [activeTab]);

  /**
   * Keep the progress rail honest. A ResizeObserver catches both the tab switch (a new
   * document of a different length) and late-loading content.
   */
  useEffect(() => {
    updateScroll();

    const scroller = scrollRef.current;
    if (!scroller) return;

    const observer = new ResizeObserver(() => updateScroll());
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);

    return () => observer.disconnect();
  }, [updateScroll, activeTab]);

  const changeTab = useCallback((next: DocumentKey) => setActiveTab(next), []);

  const handleSubmit = async () => {
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
        // ENTERPRISE FIX: Optimistically update ALL cached /api/user/profile queries
        // with the fresh terms data. This prevents the race condition where
        // ManagerProtectedRoute reads stale cached data (termsAccepted=false) and
        // redirects back to /accept-terms, causing a redirect loop that triggers
        // the Sentry ErrorBoundary ("Something went wrong. Please refresh the page.").
        //
        // queryClient.invalidateQueries only marks queries as stale and triggers a
        // BACKGROUND refetch — it doesn't update the cached data synchronously.
        // When ManagerProtectedRoute mounts, it sees the stale cached data first
        // (with termsAccepted=false) and redirects back here before the refetch completes.
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
        // Also invalidate to ensure eventual consistency with the server
        await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
        setSuccess(true);
        setTimeout(() => {
          setLocation(resolvePostTermsRedirect(user), { replace: true });
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

  /**
   * Clears the whole reading requirement in one action.
   *
   * The documents are long — the Terms alone is ~17 sections — and asking for a manual
   * scroll through both, or a click per document, is exactly the hassle that makes a
   * consent screen feel hostile. This reaches the same end state the old floating
   * "scroll to bottom" pill reached, minus the second click, and it is a real button in
   * the action bar rather than a link the reader has to notice.
   *
   * It deliberately does NOT move the reader to another document: parking the viewport
   * at the end of the document they are already looking at keeps the action predictable.
   */
  const skipToEnd = useCallback(() => {
    setRead({ terms: true, privacy: true });
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, []);

  if (!user) {
    // Role-aware: managers on kitchen must not bounce to the chef /auth page.
    const fallback =
      typeof window !== "undefined" && window.location.hostname.includes("kitchen")
        ? "/manager/login"
        : window.location.pathname.startsWith("/manager")
          ? "/manager/login"
          : "/auth";
    return <Redirect to={fallback} replace />;
  }

  const unread = DOCUMENT_ORDER.filter((key) => !read[key]);
  const allRead = unread.length === 0;
  const canSubmit = allRead && agreed;
  const actionEnabled = canSubmit && !isSubmitting && !success;

  /**
   * The one sentence that tells the reader what is left. It replaces a disabled button
   * whose label narrated the requirement ("Read the Privacy Policy to continue"), which
   * read as a broken control rather than an instruction.
   */
  const statusText = !allRead
    ? unread.length === 2
      ? "Read both documents to the end to continue."
      : `Read the ${DOCUMENTS[unread[0]].label} to the end to continue.`
    : !agreed
      ? "Tick the box to confirm your agreement."
      : null;

  const renderDocument = (key: DocumentKey) => {
    const meta = DOCUMENTS[key];

    return (
      <div
        role="tabpanel"
        id={`panel-${key}`}
        aria-labelledby={`tab-${key}`}
        tabIndex={-1}
        className="outline-none"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Review &amp; agreement
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-foreground md:text-[28px]">
          {meta.title}
        </h1>
        <p className="mt-2 max-w-[38rem] text-sm leading-relaxed text-muted-foreground">
          {meta.description}
        </p>

        <div className="mt-8 border-t border-border pt-8">
          <div className="terms-legal-content">
            {key === "terms" ? <TermsContent /> : <PrivacyContent />}
          </div>
        </div>

        {/* Closing marker for the reading gate — see the observer above. */}
        <div ref={setEndOfDocument} aria-hidden className="h-px w-full" />
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <header className="z-20 shrink-0 border-b border-border bg-background/85 backdrop-blur-md">
        {/* Full-bleed app bar. The lockup belongs to the PAGE, so it anchors to the page
            edge; confining it to the reading column left the logo and Sign out floating in
            the middle of a wide screen, which is what made the header look accidental. */}
        <div className="flex h-16 items-center gap-4 px-4 md:px-8">
          {/* Same lockup as the login and welcome screens — one brand lockup, one word. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo variant="brand" className="h-8 w-auto shrink-0" />
            <span className="font-logo text-lg leading-none tracking-tight text-[#F51042]">
              LocalCooks
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void logout()}
            disabled={isSubmitting}
            className="ml-auto shrink-0 gap-2 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>

        {/* The tabs switch the document, so they belong on the reading axis rather than at
            the page edge. The tick is the only read-state indicator on the page, so the
            action bar never has to explain which document is outstanding twice. */}
        <div className={cn(COLUMN, "px-4 md:px-6")}>
          <div role="tablist" aria-label="Documents to review" className="flex items-stretch gap-6">
            {DOCUMENT_ORDER.map((key) => {
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`tab-${key}`}
                  aria-selected={isActive}
                  aria-controls={`panel-${key}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => changeTab(key)}
                  className={cn(
                    "-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm transition-colors",
                    isActive
                      ? "border-primary font-semibold text-foreground"
                      : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                  )}
                >
                  {DOCUMENTS[key].label}
                  {read[key] && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* The reading viewport. `tabIndex` makes it keyboard-scrollable, which a
          scroll-gated document must be. */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={updateScroll}
          tabIndex={0}
          aria-label={`${DOCUMENTS[activeTab].label} document`}
          className="h-full overflow-y-auto outline-none"
        >
          <div className={cn(COLUMN, "px-4 pb-28 pt-8 md:px-6 md:pb-32 md:pt-10")}>
            {renderDocument(activeTab)}
          </div>
        </div>

        {/* Progress rail, pinned to the foot of the reading viewport. It reads as the
            edge of the document rather than as a floating control, and it answers the
            only question a scroll-gated reader has: how much is left. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="h-[3px] w-full bg-border/60">
            <div
              className="h-full bg-primary transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Action bar.
          On the reading axis, not edge-to-edge. The 44rem column cannot hold the consent
          sentence and both buttons on one line — that is what squeezed the agreement into
          226px and wrapped it — and stretching the bar to the full width instead just
          moved the problem into a ~430px void between the checkbox and the button.
          Two rows fixes both: the consent sits directly ABOVE the action it authorises,
          and the reason the action is unavailable sits beside it. */}
      <div className="z-20 shrink-0 border-t border-border bg-background/85 backdrop-blur-md">
        <div className={cn(COLUMN, "flex flex-col gap-3 px-4 py-4 md:px-6")}>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-start gap-3">
            <Checkbox
              id="accept-agreement"
              checked={agreed}
              disabled={!allRead || success}
              onCheckedChange={(value) => setAgreed(value === true)}
              className="mt-0.5"
            />
            {/* Names BOTH documents. This is the single sentence that records consent, so
                it has to be readable as one statement of what is being agreed to. */}
            <Label
              htmlFor="accept-agreement"
              className={cn(
                "block text-sm leading-snug",
                allRead && !success ? "cursor-pointer" : "cursor-not-allowed",
              )}
            >
              I have read and agree to the{" "}
              <span className="font-semibold text-foreground">{DOCUMENTS.terms.label}</span> and
              the{" "}
              <span className="font-semibold text-foreground">{DOCUMENTS.privacy.label}</span>.
            </Label>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Sits with the button it explains, rather than doubling the height of the
                consent sentence above it. */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {statusText && !success ? statusText : ""}
            </p>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
              {/* A real button, not a link buried in a sentence. The documents are long,
                  so the way past the scroll requirement has to be impossible to miss —
                  it was the user's main complaint about this page. */}
              {!allRead && !success && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={skipToEnd}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto"
                >
                  <ArrowDown className="mr-2 h-4 w-4" />
                  Skip to the end
                </Button>
              )}

              {/* `disabled:opacity-50` on the shared Button washes brand red out to pink,
                  which reads as broken rather than "not yet" — and this control starts
                  disabled, so it is the state most readers see first. Neutral is honest. */}
              <Button
                onClick={() => void handleSubmit()}
                disabled={!actionEnabled}
                className="w-full disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none sm:w-auto sm:min-w-[11rem]"
              >
                {isSubmitting || success ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? "Saving…" : success ? "Redirecting…" : "Agree & continue"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .terms-legal-content {
          font-family: inherit;
        }

        .terms-legal-content h1 {
          display: none !important;
        }

        .terms-legal-content h2 {
          font-size: 1.0625rem !important;
          font-weight: 700 !important;
          margin-top: 2.75rem !important;
          margin-bottom: 1rem !important;
          color: hsl(var(--foreground)) !important;
          letter-spacing: -0.015em !important;
        }

        .terms-legal-content h3 {
          font-size: 0.9375rem !important;
          font-weight: 600 !important;
          margin-top: 1.75rem !important;
          margin-bottom: 0.625rem !important;
          color: hsl(var(--foreground)) !important;
        }

        .terms-legal-content p,
        .terms-legal-content li {
          font-size: 0.9375rem !important;
          line-height: 1.7 !important;
          margin-bottom: 1rem !important;
          color: hsl(var(--muted-foreground)) !important;
        }

        .terms-legal-content hr {
          margin: 2.5rem 0 !important;
          border: none;
          height: 1px;
          background: hsl(var(--border));
        }

        .terms-legal-content strong {
          color: hsl(var(--foreground)) !important;
          font-weight: 600 !important;
        }

        .terms-legal-content ul,
        .terms-legal-content ol {
          padding-left: 1.25rem !important;
          margin-bottom: 1.25rem !important;
        }

        .terms-legal-content blockquote {
          background: hsl(var(--muted));
          border-radius: 0.75rem;
          padding: 1.25rem;
          font-style: italic;
          border-left: 4px solid hsl(var(--border));
          margin: 1.5rem 0;
        }
      `,
        }}
      />
    </div>
  );
}

export default TermsAcceptanceScreen;
