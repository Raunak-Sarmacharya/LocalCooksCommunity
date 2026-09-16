import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { requiresEmailVerification } from "@/lib/auth-verification";
import { fetchEmailVerificationStatus } from "@/lib/email-verification-api";
import { SUPPORT_MAILTO, emailVerificationHref } from "@/lib/email-verification-nav";

interface EmailVerificationGateProps {
  open: boolean;
  /** Supplied by hosts that already know the role; otherwise read from auth. */
  role?: string | null;
  onOpenChange?: (open: boolean) => void;
}

function StatusRow({
  label,
  value,
  verified,
  verifiedLabel,
  unverifiedLabel,
}: {
  label: string;
  value: string | null;
  verified: boolean;
  verifiedLabel: string;
  unverifiedLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          verified ? "bg-emerald-500" : "bg-amber-500"
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {value || label}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          verified
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-amber-700 dark:text-amber-400"
        )}
      >
        {verified ? verifiedLabel : unverifiedLabel}
      </span>
    </div>
  );
}

/**
 * The platform gate.
 *
 * Deliberately non-dismissible: every mutating action is refused server-side while
 * the address is unconfirmed, so offering a "later" button would only send the
 * user back into a wall. The escape hatches are the ones that actually resolve
 * something — verify, sign out, or reach support.
 */
export default function EmailVerificationGate({
  open,
  role,
  onOpenChange,
}: EmailVerificationGateProps) {
  const { t } = useTranslation("auth");
  const { user, logout, refreshUserData } = useFirebaseAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const effectiveRole = role ?? user?.role;

  const [checking, setChecking] = useState(false);
  const [checkedButUnverified, setCheckedButUnverified] = useState(false);

  // Shares its cache entry with the profile card, so opening the gate does not
  // cost an extra request when the profile page is already mounted.
  const statusQuery = useQuery({
    queryKey: ["/api/user/email/verification/status", user?.uid],
    queryFn: fetchEmailVerificationStatus,
    enabled: open && !!user,
    staleTime: 15_000,
  });

  const status = statusQuery.data;
  const pendingEmail = status?.pendingEmail ?? null;
  const emailOnFile = status?.email ?? user?.email ?? null;
  const addressToVerify = pendingEmail ?? emailOnFile;

  // The gate's visibility is driven by the auth context, which only learns about a
  // confirmation when the profile is refetched. Without this, a user who verifies
  // elsewhere would keep staring at a gate that no longer applies.
  //
  // Non-forcing on purpose: this fires in the background, and forcing a token refresh
  // against a refresh token that an email change just invalidated signs the user out.
  const verifiedElsewhere = status?.emailVerified === true && user?.emailVerified !== true;
  useEffect(() => {
    if (verifiedElsewhere) void refreshUserData({ forceToken: false });
  }, [verifiedElsewhere, refreshUserData]);

  const goToVerification = useCallback(() => {
    queryClient.setQueryData(["/api/user/email/verification/status", user?.uid], status);
    onOpenChange?.(false);
    setLocation(emailVerificationHref(effectiveRole));
  }, [effectiveRole, onOpenChange, queryClient, setLocation, status, user?.uid]);

  /**
   * The link is already in the inbox — the user's job is to open it, then tell us.
   * So the primary action re-checks rather than starting anything.
   */
  const handleRecheck = useCallback(async () => {
    setChecking(true);
    setCheckedButUnverified(false);
    try {
      // Non-forcing: the profile reports the server's verification mirror, which is written
      // the instant a link is confirmed, so this answers correctly without touching the
      // token. Forcing here would sign the user out if they verified in another tab.
      const updated = await refreshUserData({ forceToken: false });
      if (updated && !requiresEmailVerification(updated, updated)) {
        // The host closes the gate off the auth context; nothing more to do.
        return;
      }
      setCheckedButUnverified(true);
    } catch {
      setCheckedButUnverified(true);
    } finally {
      setChecking(false);
      void queryClient.invalidateQueries({
        queryKey: ["/api/user/email/verification/status", user?.uid],
      });
    }
  }, [queryClient, refreshUserData, user?.uid]);

  const handleSignOut = useCallback(() => {
    onOpenChange?.(false);
    void logout();
  }, [logout, onOpenChange]);

  // The gate owns this state, so there is nothing to dismiss it with.
  const blockDismiss = (event: Event) => event.preventDefault();

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md gap-4"
        onEscapeKeyDown={blockDismiss}
        onPointerDownOutside={blockDismiss}
        onInteractOutside={blockDismiss}
      >
        <DialogHeader className="space-y-0 text-left">
          <span
            className="flex size-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400"
            aria-hidden="true"
          >
            <Mail className="size-5" />
          </span>
          <DialogTitle className="pt-3 text-base font-medium">
            {t("emailGateTitle", "Verify your email to continue")}
          </DialogTitle>
          <DialogDescription className="pt-1 text-sm leading-relaxed">
            {t(
              "emailGateBody",
              "Your email is how we send booking confirmations, payout notices and account alerts. Verify it to unlock your account."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <StatusRow
            label={t("emailGateStatusEmail", "Email")}
            value={addressToVerify}
            verified={false}
            verifiedLabel={t("emailGateVerified", "Verified")}
            unverifiedLabel={t("emailGateNotVerified", "Not verified")}
          />
          <StatusRow
            label={t("emailGateStatusPhone", "Phone")}
            value={user?.phoneNumber ?? null}
            verified={user?.phoneVerified === true}
            verifiedLabel={t("emailGateVerified", "Verified")}
            unverifiedLabel={t("emailGateNotVerified", "Not verified")}
          />
          {pendingEmail && (
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              {t("emailGatePendingSent", "We sent a link to {email}.", { email: pendingEmail })}
            </p>
          )}
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            {t("emailGatePhoneNudge", "A phone number is optional and never blocks you.")}
          </p>
        </div>

        <Button className="w-full" onClick={handleRecheck} disabled={checking}>
          {checking && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />}
          {t("emailGateIHaveVerified", "I have verified my email")}
        </Button>

        {checkedButUnverified && (
          <p
            role="alert"
            className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            {t(
              "emailGateStillUnverified",
              "We have not detected a verified email yet. Open the link in your inbox, then try again."
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={goToVerification}
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("emailGateOpenProfile", "Resend or change email")}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("emailGateSignOut", "Sign out")}
          </button>
          <a
            href={SUPPORT_MAILTO}
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("emailGateContactSupport", "Contact support")}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
