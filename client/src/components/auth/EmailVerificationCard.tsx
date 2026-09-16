import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2, Mail, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import i18n from "@/i18n";
import {
  ContactInfoCard,
  ContactStatusPill,
  ContactVerificationRow,
  type ContactTone,
} from "@/components/profile/ContactVerificationRow";
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
  /**
   * Render the bare row only. Set when the host page already wraps it in a
   * `ContactInfoCard` alongside the phone row, so the two share one card.
   */
  embedded?: boolean;
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
  embedded = false,
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

  const tone: ContactTone = !isVerified ? "action" : isChanging ? "pending" : "verified";
  const heading = isVerified
    ? t("emailCardVerifiedHeading", "Email address")
    : t("emailCardUnverifiedHeading", "Verify your email address");

  let secondary: ReactNode | undefined;
  let description: ReactNode | undefined;

  if (viewState === "loading") {
    description = (
      <p className="flex items-center gap-2">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        {t("emailCardLoading", "Checking your email status…")}
      </p>
    );
  } else if (viewState === "error") {
    description = (
      <p className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {t(
          "emailCardStatusFailed",
          "We could not load your email status. Refresh the page to try again."
        )}
      </p>
    );
  } else {
    if (isVerified && !isChanging) {
      secondary = status?.emailVerifiedAt
        ? t("emailCardVerifiedOn", "Verified {date}", {
            date: formatVerifiedDate(status.emailVerifiedAt),
          })
        : t("emailCardBadgeVerified", "Verified");
      if (!isEditing) {
        description = t(
          "emailCardChangeNotice",
          "Changing it requires verifying the new email first."
        );
      }
    } else if (isVerified && isChanging) {
      secondary = t("emailCardBadgePendingChange", "Change pending");
      description = t(
        "emailCardPendingChangeBody",
        "Waiting for {pendingEmail} to be confirmed. {email} stays active and verified until then.",
        { pendingEmail, email: emailOnFile ?? "" }
      );
    } else if (pendingEmail) {
      secondary = t("emailCardSecondaryLinkSent", "Link sent");
      description = t(
        "emailCardUnverifiedSentBody",
        "We sent a verification link to {email}. Until it is verified you cannot apply, request a tour, book, or receive notifications.",
        { email: pendingEmail }
      );
    } else if (emailOnFile) {
      secondary = t("emailCardSecondaryNotVerified", "Not verified");
      description = t(
        "emailCardUnverifiedBody",
        "Email is how we send booking confirmations and payout notices. Verify {email} to unlock the platform.",
        { email: emailOnFile }
      );
    } else {
      secondary = t("emailCardSecondaryNotAdded", "Not added");
      description = t(
        "emailCardAddAddressBody",
        "Add the email address we should use for booking confirmations and payout notices, then confirm it to unlock the platform."
      );
    }

    if (isBlockedState(viewState) && displayedEmail) {
      description = (
        <>
          {description}
          <p className="flex items-start gap-2 text-xs">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t("emailCardGateNotice", "Actions are locked until this address is verified.")}
          </p>
        </>
      );
    }
  }

  const row = (
    <ContactVerificationRow
      id="email-verification"
      labelId="email-verification-heading"
      icon={isVerified ? <Check className="size-4" /> : <Mail className="size-4" />}
      label={heading}
      tone={tone}
      highlighted={highlighted}
      className={className}
      badges={
        <>
          <ContactStatusPill tone={tone}>
            {isVerified
              ? t("emailCardBadgeVerified", "Verified")
              : t("emailCardBadgeActionNeeded", "Action needed")}
          </ContactStatusPill>
          {isChanging ? (
            <ContactStatusPill tone="pending">
              {t("emailCardBadgePendingChange", "Change pending")}
            </ContactStatusPill>
          ) : null}
        </>
      }
      value={
        viewState === "loading" || viewState === "error"
          ? undefined
          : displayedEmail || t("emailCardNoAddress", "No email address yet")
      }
      secondary={secondary}
      description={description}
      actions={
        viewState === "loading" || viewState === "error" || isEditing ? undefined : (
          <>
            {!isVerified ? (
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
            ) : null}
            <Button
              size="sm"
              variant={isVerified ? "outline" : "ghost"}
              onClick={beginEditing}
              disabled={isBusy}
            >
              <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
              {isVerified
                ? t("emailCardChange", "Change email")
                : t("emailCardUseDifferent", "Use a different email")}
            </Button>
            {isChanging ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => cancelMutation.mutate()}
                disabled={isBusy}
              >
                {t("emailCardCancelPending", "Cancel change")}
              </Button>
            ) : null}
          </>
        )
      }
    >
      {isEditing ? (
        <div className="max-w-md space-y-2">
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
      ) : null}
    </ContactVerificationRow>
  );

  if (embedded) return row;

  return <ContactInfoCard>{row}</ContactInfoCard>;
}
