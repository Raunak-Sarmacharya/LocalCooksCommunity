import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle,
  ArrowDown,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Home,
  Loader2,
  Lock,
  LogOut,
} from "@/components/ui/manager-icons";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import locoRedLogo from "@assets/LoCo Red.png";
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

interface DocumentMeta {
  /** Tab label and the noun used in status copy. */
  label: string;
  title: string;
  description: string;
  agreement: string;
  agreementHint: string;
}

const DOCUMENTS: Record<DocumentKey, DocumentMeta> = {
  terms: {
    label: "Terms of Service",
    title: "Local Cooks Platform Terms of Service",
    description:
      "The agreement between you and Jawrophi Delivery Inc. covering bookings, payments, liability and conduct on the platform.",
    agreement: "I have read and agree to the Terms of Service",
    agreementHint: "Required to keep using the platform",
  },
  privacy: {
    label: "Privacy Policy",
    title: "Local Cooks Privacy Policy",
    description:
      "What we collect, why we collect it, who we share it with, and how long we keep it.",
    agreement: "I have read and agree to the Privacy Policy",
    agreementHint: "Acknowledges our data processing practices",
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
 * A single agreement row.
 *
 * Mirrors the metrics and locked treatment of the manager settings
 * `SettingsRow` (same padding, same 12px hint line, same dimmed row plus lock
 * glyph when a control is deliberately inert), but leads with the checkbox:
 * consent reads as one sentence with the box it belongs to, so the control
 * cannot sit in a right-hand column detached from its label.
 */
function AgreementRow({
  id,
  checked,
  disabled,
  documentLabel,
  label,
  hint,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  /** Names the document in the copy, so the row always talks about its own. */
  documentLabel: string;
  label: string;
  hint: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  // `disabled` is the single source of truth for the locked state. Deriving the
  // copy from it means the row can never go on claiming a document is unread
  // once the reading gate has cleared.
  const locked = disabled;
  // Draw the eye to a box the reader has earned but not yet ticked — this is
  // the only thing standing between them and the primary action.
  const needsAttention = !disabled && !checked;

  return (
    <div className={cn("flex items-start gap-3 px-4 py-4", locked && "opacity-60")}>
      <div className="relative mt-0.5 flex items-center justify-center">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          className={cn(
            needsAttention && "animate-pulse ring-2 ring-primary ring-offset-2",
          )}
        />
        {needsAttention && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -m-1 animate-ping rounded-full border border-primary/50"
          />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Label
            htmlFor={id}
            className={cn(
              "text-sm font-medium",
              disabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer",
            )}
          >
            {label}
          </Label>
          {needsAttention && (
            <span className="animate-pulse rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              Click to check
            </span>
          )}
        </div>

        {/* Three states, so the line under the box always says what to do next
            rather than repeating a reason the reader has already satisfied. */}
        {locked ? (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            {`Read the ${documentLabel} first`}
          </p>
        ) : checked ? (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
            <Check className="mt-0.5 h-3 w-3 shrink-0" />
            {`Agreed to the ${documentLabel}`}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}

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
  const [accepted, setAccepted] = useState<Record<DocumentKey, boolean>>({
    terms: false,
    privacy: false,
  });

  /** The scrolling viewport on the right — the reading gate measures against it. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Closing marker of whichever document is currently mounted. */
  const endOfDocumentRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);
  /**
   * True while the document continues below the fold. Drives the bottom fade —
   * a cue that there is more to read, without the arrow the floating "scroll to
   * bottom" pill already carries.
   */
  const [canScrollMore, setCanScrollMore] = useState(false);

  const updateScrollFade = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // 2px slack absorbs sub-pixel rounding at the very bottom.
    setCanScrollMore(scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2);
  }, []);

  useEffect(() => {
    if (user?.termsAccepted && user?.termsVersion === CURRENT_POLICY_VERSION) {
      setLocation(resolvePostTermsRedirect(user), { replace: true });
    }
  }, [user, setLocation]);

  /**
   * Reading gate.
   *
   * The document counts as read once its closing marker scrolls into the right
   * column's viewport, clear of the action bar. A document short enough to fit
   * on screen therefore passes on arrival.
   */
  useEffect(() => {
    if (read[activeTab]) return;

    const root = scrollRef.current;
    const marker = endOfDocumentRef.current;
    if (!root || !marker) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRead((prev) => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
        }
      },
      { root, rootMargin: `0px 0px -${END_OF_DOCUMENT_INSET}px 0px`, threshold: 0 },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [activeTab, read]);

  /**
   * Returning the reader to the top of the document they just switched to.
   *
   * Runs as a layout effect, so the scroll position is already reset before the
   * observer above is created. Without that, switching from a long document to
   * a shorter one would leave the viewport parked at the bottom, the shorter
   * document's closing marker would land in view, and it would be marked read
   * without ever being shown.
   */
  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  /**
   * Keep the bottom fade honest. A ResizeObserver catches both the tab switch
   * (a new document of a different length) and late-loading content, so the cue
   * never lingers on a document that has already been fully revealed.
   */
  useEffect(() => {
    updateScrollFade();

    const scroller = scrollRef.current;
    if (!scroller) return;

    const observer = new ResizeObserver(() => updateScrollFade());
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);

    return () => observer.disconnect();
  }, [updateScrollFade, activeTab]);

  const changeTab = useCallback((next: DocumentKey) => setActiveTab(next), []);

  /**
   * "Scroll to bottom to read" — jumps the viewport to the end of the document
   * and clears the gate. Kept as an explicit affordance so a reader who cannot
   * scroll (or has already read the text elsewhere) is never stuck.
   */
  const scrollToBottom = useCallback(() => {
    const scroller = scrollRef.current;
    if (scroller) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    }
    setRead((prev) => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
  }, [activeTab]);

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

  const allRead = read.terms && read.privacy;
  const allAccepted = accepted.terms && accepted.privacy;
  const canSubmit = allRead && allAccepted;

  const activeRead = read[activeTab];
  const activeAccepted = accepted[activeTab];
  // This document is settled but the other one has not been opened yet — the
  // primary action moves the reader on rather than submitting.
  const canAdvance = activeRead && activeAccepted && !allRead;
  const actionEnabled = (canSubmit || canAdvance) && !isSubmitting && !success;

  const otherTab: DocumentKey = activeTab === "terms" ? "privacy" : "terms";
  const reviewedCount = DOCUMENT_ORDER.filter((key) => read[key]).length;
  const reviewedPercent = (reviewedCount / DOCUMENT_ORDER.length) * 100;

  const buttonLabel = isSubmitting
    ? "Saving…"
    : success
      ? "Redirecting…"
      : canSubmit
        ? "I Agree & Continue"
        : canAdvance
          ? `Continue to ${DOCUMENTS[otherTab].label}`
          : !activeRead
            ? `Read the ${DOCUMENTS[activeTab].label} to continue`
            : "Accept both agreements to continue";

  const handleMainAction = () => {
    if (canSubmit) {
      void handleSubmit();
      return;
    }
    if (canAdvance) changeTab(otherTab);
  };

  const handleSignOut = () => {
    void logout();
  };

  const renderDocument = (key: DocumentKey) => {
    const meta = DOCUMENTS[key];

    return (
      <Card>
        <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
          <CardTitle className="text-lg">{meta.title}</CardTitle>
          <CardDescription className="mt-1">{meta.description}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-10 pt-2 md:px-6">
          <div className="terms-legal-content mx-auto max-w-none">
            {key === "terms" ? <TermsContent /> : <PrivacyContent />}
          </div>
          {/* Closing marker for the reading gate — see the observer above. */}
          <div ref={endOfDocumentRef} aria-hidden className="h-px w-full" />
        </CardContent>
      </Card>
    );
  };

  /**
   * One row per document — the only document switcher on the page, so there is
   * no tab strip competing with it. Rendered in the left column, and again
   * below the mobile page header because that column is hidden under `lg`.
   */
  const documentList = (
    <nav className="space-y-1">
      {DOCUMENT_ORDER.map((key) => {
        const meta = DOCUMENTS[key];
        const isRead = read[key];
        const isAccepted = accepted[key];
        const isActive = activeTab === key;

        return (
          <button
            key={key}
            type="button"
            onClick={() => changeTab(key)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
              isActive ? "bg-muted" : "hover:bg-muted/50",
            )}
          >
            <FileText
              className={cn(
                "h-4 w-4 shrink-0",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            />

            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-sm font-medium",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {meta.label}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {isAccepted ? "Accepted" : isRead ? "Reviewed" : "Not read yet"}
              </span>
            </div>

            {isAccepted ? (
              <Check className="h-4 w-4 shrink-0 text-foreground" />
            ) : isRead ? (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Left column — describes the page. Mirrors the manager onboarding
          sidebar: brand block, progress, then a row per item in the flow. */}
      <aside className="hidden w-80 shrink-0 flex-col border-r border-border bg-gradient-to-b from-muted/40 to-background lg:flex xl:w-96">
        <div className="border-b border-border p-6">
          <div className="flex items-center gap-3">
            {/* Decorative: the wordmark beside it already names the brand. */}
            <img
              src={locoRedLogo}
              alt=""
              className="h-10 w-10 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="font-logo text-lg leading-none tracking-tight text-[#F51042]">
                Local Cooks
              </p>
              <h1 className="mt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Review &amp; Agreement
              </h1>
            </div>
          </div>

          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
            Please review both policies, then scroll to the bottom and check both boxes to continue.
          </p>

          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Progress</span>
              <span className="font-semibold text-primary">
                {reviewedCount} of {DOCUMENT_ORDER.length} reviewed
              </span>
            </div>
            <Progress value={reviewedPercent} className="h-2 bg-muted" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{documentList}</div>
      </aside>

      {/* Right column — the content. */}
      <main className="flex h-screen flex-1 flex-col overflow-hidden">
        <header className="z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-6">
          <nav className="flex min-w-0 items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setLocation("/dashboard")}
              aria-label="Dashboard"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Home className="h-4 w-4" />
            </button>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            <span className="shrink-0 font-medium text-muted-foreground">
              Review &amp; Agreement
            </span>
            <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/50 sm:block" />
            <span className="hidden truncate font-medium text-foreground sm:block">
              {DOCUMENTS[activeTab].label}
            </span>
          </nav>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={isSubmitting}
            className="shrink-0 gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </header>

        <div className="relative flex-1 overflow-hidden">
          <div ref={scrollRef} onScroll={updateScrollFade} className="h-full overflow-y-auto">
            <div className="p-4 pb-24 md:p-10 md:pb-28 lg:p-12 lg:pb-28">
              <div className="mx-auto w-full max-w-3xl">
                {/* Page header for viewports without the left column. */}
                <div className="mb-6 lg:hidden">
                  <div className="flex items-center gap-3">
                    <img
                      src={locoRedLogo}
                      alt=""
                      className="h-10 w-10 shrink-0 object-contain"
                    />
                    <div className="min-w-0">
                      {/* Not an h1: the left column's heading is always in the DOM,
                          this is only its stand-in while that column is hidden. */}
                      <p className="text-lg font-semibold tracking-tight text-foreground">
                        Review &amp; Agreement
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reviewedCount} of {DOCUMENT_ORDER.length} documents reviewed
                      </p>
                    </div>
                  </div>
                  <Progress value={reviewedPercent} className="mt-4 h-2 bg-muted" />
                  {/* The left column is hidden here, so its document list moves in
                      — without it there would be no way to switch documents. */}
                  <div className="mt-4">{documentList}</div>
                </div>

                {renderDocument(activeTab)}

                <Card className="mt-6">
                  <CardHeader className="p-4 pb-2 md:p-6 md:pb-3">
                    <CardTitle className="text-lg">Your agreement</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-border p-0">
                    <AgreementRow
                      id="accept-terms-check"
                      checked={accepted.terms}
                      disabled={!read.terms}
                      documentLabel={DOCUMENTS.terms.label}
                      label={DOCUMENTS.terms.agreement}
                      hint={DOCUMENTS.terms.agreementHint}
                      onCheckedChange={(checked) => {
                        setAccepted((prev) => ({ ...prev, terms: checked }));
                        if (checked && !accepted.privacy) {
                          setTimeout(() => changeTab("privacy"), 400);
                        }
                      }}
                    />
                    <AgreementRow
                      id="accept-privacy-check"
                      checked={accepted.privacy}
                      disabled={!read.privacy}
                      documentLabel={DOCUMENTS.privacy.label}
                      label={DOCUMENTS.privacy.agreement}
                      hint={DOCUMENTS.privacy.agreementHint}
                      onCheckedChange={(checked) => {
                        setAccepted((prev) => ({ ...prev, privacy: checked }));
                        if (checked && !accepted.terms) {
                          setTimeout(() => changeTab("terms"), 400);
                        }
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          {/* Bottom fade — the document continues below. Fade only: the floating
              pill below already carries the arrow and the action. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background via-background/85 to-transparent transition-opacity duration-300",
              canScrollMore ? "opacity-100" : "opacity-0",
            )}
          />

          {/* Reading status, pinned to the foot of the document viewport on the
              content side. It belongs to the document, not to the primary
              action, so it stays out of the action bar below. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
            <div className="pointer-events-auto">
              {activeRead ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-4 py-1.5 text-muted-foreground backdrop-blur-md">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-wide">
                    Documentation reviewed
                  </span>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={scrollToBottom}
                  className="h-8 gap-2 rounded-full border border-primary/20 bg-background/80 px-4 text-primary backdrop-blur-md hover:bg-primary/10 hover:text-primary"
                >
                  <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
                  <span className="text-[11px] font-bold uppercase tracking-wide">
                    Scroll to bottom to read
                  </span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Action bar — one primary action, nothing competing with it. */}
        <div className="z-20 shrink-0 border-t border-border bg-background/85 backdrop-blur-md">
          <div className="px-4 py-3 md:px-6">
            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
                <AlertCircle className="mt-px h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleMainAction}
                disabled={!actionEnabled}
                className="w-full sm:w-auto sm:min-w-[14rem]"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                {buttonLabel}
              </Button>
            </div>
          </div>
        </div>
      </main>

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
          font-size: 1.125rem !important;
          font-weight: 700 !important;
          margin-top: 2.5rem !important;
          margin-bottom: 1.25rem !important;
          color: hsl(var(--foreground)) !important;
          letter-spacing: -0.02em !important;
        }

        .terms-legal-content h3 {
          font-size: 1rem !important;
          font-weight: 600 !important;
          margin-top: 1.75rem !important;
          margin-bottom: 0.75rem !important;
          color: hsl(var(--foreground)) !important;
        }

        .terms-legal-content p,
        .terms-legal-content li {
          font-size: 0.875rem !important;
          margin-bottom: 1rem !important;
          color: hsl(var(--muted-foreground)) !important;
        }

        .terms-legal-content hr {
          margin: 2rem 0 !important;
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
