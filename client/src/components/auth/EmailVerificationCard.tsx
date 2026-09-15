import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2, Mail, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import {
  EmailVerificationError,
  cancelEmailVerification,
  fetchEmailVerificationStatus,
  startEmailVerification,
} from "@/lib/email-verification-api";
import {
  canRequestVerificationLink,
  deriveEmailVerificationViewState,
  isBlockedState,
  resolveDisplayedEmail,
} from "@/lib/email-verification-state";

interface EmailVerificationCardProps {
  /** Ringed and scrolled to when deep-linked from the gate or Getting started. */
  highlighted?: boolean;
  /** Fired once when the address becomes verified, so the host can refresh. */
  onVerified?: () => void;
  className?: string;
}

function formatVerifiedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The single place an address is added, verified or changed.
 *
 * Deliberately stateful rather than a form: the server holds the pending address,
 * so the card can honestly represent four situations — never verified, verified,
 * verified with a change in flight, and editing. Because the confirmed address is
 * only replaced once the new one is proven, an account is never left without a
 * working email.
 */
export default function EmailVerificationCard({
  highlighted = false,
  onVerified,
  className,
}: EmailVerificationCardProps) {
  const { t } = useTranslation("auth");
  const { user } = useFirebaseAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const notifiedVerification = useRef(false);

  const statusQuery = useQuery({
    queryKey: ["/api/user/email/verification/status", user?.uid],
    queryFn: fetchEmailVerificationStatus,
    enabled: !!user,
    // A link is often opened on another device, so poll while one is outstanding.
    refetchInterval: (query) =>
      query.state.data?.pendingEmail ? 15_000 : false,
  });

  const status = statusQuery.data;
  const isVerified = status?.emailVerified === true;
  const pendingEmail = status?.pendingEmail ?? null;
  const emailOnFile = status?.email ?? null;

  const viewState = deriveEmailVerificationViewState({
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    email: emailOnFile,
    pendingEmail,
    emailVerified: isVerified,
  });
  const isChanging = viewState === "verified-changing";

  // Fall back to the address the user registered with while the status loads, so
  // the card never flashes an empty field.
  const displayedEmail = resolveDisplayedEmail(status, user?.email);

  useEffect(() => {
    setCooldown(status?.resendAvailableInSeconds ?? 0);
  }, [status?.resendAvailableInSeconds]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((remaining) => (remaining <= 1 ? 0 : remaining - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!isVerified) {
      notifiedVerification.current = false;
      return;
    }
    if (notifiedVerification.current) return;
    notifiedVerification.current = true;
    onVerified?.();
  }, [isVerified, onVerified]);

  // Deep-linked from the gate or the Getting started checklist.
  useEffect(() => {
    if (!highlighted) return;
    const node = document.getElementById("email-verification");
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlighted]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["/api/user/email/verification/status", user?.uid],
    });
    void queryClient.invalidateQueries({ queryKey: ["/api/user/profile", user?.uid] });
  }, [queryClient, user?.uid]);

  const startMutation = useMutation({
    mutationFn: startEmailVerification,
    onSuccess: (next) => {
      invalidate();
      setIsEditing(false);
      setCooldown(next.resendAvailableInSeconds ?? 0);
      toast({
        title: t("emailCardSentTitle", "Verification link sent"),
        description: t(
          "emailCardSentBody",
          "Check your inbox and spam folder, then open the link to confirm."
        ),
      });
    },
    onError: (error: unknown) => {
      if (error instanceof EmailVerificationError && error.retryAfterSeconds) {
        setCooldown(error.retryAfterSeconds);
      }
      toast({
        title: t("emailCardSendFailedTitle", "We could not send that link"),
        description:
          error instanceof Error ? error.message : t("emailCardTryAgain", "Please try again."),
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelEmailVerification,
    onSuccess: () => {
      invalidate();
      setIsEditing(false);
      toast({
        title: t("emailCardChangeCancelledTitle", "Change cancelled"),
        description: t(
          "emailCardChangeCancelledBody",
          "Your current email address is unchanged."
        ),
      });
    },
    onError: () => {
      toast({
        title: t("emailCardCancelFailedTitle", "We could not cancel that change"),
        description: t("emailCardTryAgain", "Please try again."),
        variant: "destructive",
      });
    },
  });

  const isBusy = startMutation.isPending || cancelMutation.isPending;

  const canSendLink = canRequestVerificationLink({
    state: viewState,
    cooldownSeconds: cooldown,
    displayedEmail,
    isBusy,
  });
  const canSubmit = useMemo(() => {
    const value = draftEmail.trim().toLowerCase();
    if (!value) return false;
    if (value === displayedEmail?.toLowerCase()) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }, [draftEmail, displayedEmail]);

  const beginEditing = () => {
    setDraftEmail(pendingEmail ?? "");
    setIsEditing(true);
  };

  const submitDraft = () => {
    if (!canSubmit) return;
    startMutation.mutate(draftEmail.trim().toLowerCase());
  };

  if (!user) return null;

  const heading = isVerified
    ? t("emailCardVerifiedHeading", "Email address")
    : t("emailCardUnverifiedHeading", "Verify your email address");

  return (
    <section
      id="email-verification"
      aria-labelledby="email-verification-heading"
      className={cn(
        "scroll-mt-24 rounded-xl border bg-card p-4 sm:p-5",
        isVerified ? "border-border" : "border-amber-500/40 bg-amber-500/[0.04]",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            isVerified
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          )}
          aria-hidden="true"
        >
          {isVerified ? <Check className="size-4" /> : <Mail className="size-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="email-verification-heading" className="text-sm font-medium text-foreground">
              {heading}
            </h3>
            {isVerified ? (
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {t("emailCardBadgeVerified", "Verified")}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                {t("emailCardBadgeActionNeeded", "Action needed")}
              </span>
            )}
            {isChanging && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {t("emailCardBadgePendingChange", "Change pending")}
              </span>
            )}
          </div>

          {viewState === "loading" ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t("emailCardLoading", "Checking your email status…")}
            </p>
          ) : viewState === "error" ? (
            <div className="mt-2 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t(
                  "emailCardStatusFailed",
                  "We could not load your email status. Refresh the page to try again."
                )}
              </span>
            </div>
          ) : (
            <>
              {displayedEmail && (
                <p className="mt-2 break-all text-sm font-medium text-foreground">
                  {displayedEmail}
                </p>
              )}

              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {isVerified && isChanging
                  ? t(
                      "emailCardPendingChangeBody",
                      "Waiting for {pendingEmail} to be confirmed. {email} stays active and verified until then.",
                      { pendingEmail, email: emailOnFile ?? "" }
                    )
                  : isVerified
                    ? status?.emailVerifiedAt
                      ? t("emailCardVerifiedOn", "Verified {date}", {
                          date: formatVerifiedDate(status.emailVerifiedAt),
                        })
                      : t("emailCardVerifiedBody", "This address is confirmed.")
                    : pendingEmail
                      ? t(
                          "emailCardUnverifiedSentBody",
                          "We sent a verification link to {email}. Until it is verified you cannot apply, request a tour, book, or receive notifications.",
                          { email: pendingEmail }
                        )
                      : emailOnFile
                        ? t(
                            "emailCardUnverifiedBody",
                            "Email is how we send booking confirmations and payout notices. Verify {email} to unlock the platform.",
                            { email: emailOnFile }
                          )
                        : t(
                            "emailCardAddAddressBody",
                            "Add the email address we should use for booking confirmations and payout notices, then confirm it to unlock the platform."
                          )}
              </p>

              {isEditing ? (
                <div className="mt-4 space-y-2">
                  <Label htmlFor="email-verification-input" className="text-xs font-medium">
                    {t("emailCardEditLabel", "New email address")}
                  </Label>
                  <Input
                    id="email-verification-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    value={draftEmail}
                    onChange={(event) => setDraftEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitDraft();
                      }
                      if (event.key === "Escape") setIsEditing(false);
                    }}
                    placeholder={t("emailCardEditPlaceholder", "you@example.com")}
                    disabled={isBusy}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {emailOnFile
                      ? t(
                          "emailCardEditBody",
                          "Your current address {email} stays active and verified until you confirm the new one, so you are never left without a working email.",
                          { email: emailOnFile }
                        )
                      : t(
                          "emailCardEditBodyNew",
                          "We will email a confirmation link. The address is only added once you open it."
                        )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" onClick={submitDraft} disabled={!canSubmit || isBusy}>
                      {isBusy && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />}
                      {t("emailCardEditSubmit", "Send verification link")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsEditing(false)}
                      disabled={isBusy}
                    >
                      {t("emailCardEditCancel", "Cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!isVerified && (
                    <Button
                      size="sm"
                      onClick={() =>
                        startMutation.mutate((pendingEmail ?? emailOnFile ?? "").toLowerCase())
                      }
                      disabled={!canSendLink}
                    >
                      {startMutation.isPending && (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                      )}
                      {cooldown > 0
                        ? t("emailCardResendIn", "Resend in {time}", {
                            time: formatCountdown(cooldown),
                          })
                        : pendingEmail
                          ? t("emailCardResend", "Resend link")
                          : t("emailCardSendLink", "Send verification link")}
                    </Button>
                  )}
                  <Button size="sm" variant={isVerified ? "outline" : "ghost"} onClick={beginEditing} disabled={isBusy}>
                    <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
                    {isVerified
                      ? t("emailCardChange", "Change email")
                      : t("emailCardUseDifferent", "Use a different email")}
                  </Button>
                  {isChanging && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelMutation.mutate()}
                      disabled={isBusy}
                    >
                      {t("emailCardCancelPending", "Cancel change")}
                    </Button>
                  )}
                  {isVerified && !isChanging && (
                    <span className="text-xs text-muted-foreground">
                      {t(
                        "emailCardChangeNotice",
                        "Changing it requires verifying the new address first."
                      )}
                    </span>
                  )}
                </div>
              )}

              {isBlockedState(viewState) && displayedEmail && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t(
                      "emailCardGateNotice",
                      "Actions are locked until this address is verified."
                    )}
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
