import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, ShieldCheck, Chrome, Mail } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/firebase";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { resolvePasswordFormMode, type PasswordFormMode } from "./password-form-mode";
// The row-action hierarchy every row on the profile pages ranks its actions by. Reused
// rather than restated so this panel's buttons cannot drift from its siblings'.
import { PRIMARY_ROW_ACTION, QUIET_ROW_ACTION } from "@/components/profile/ContactVerificationRow";
// The app's ONE password-reset surface, reused rather than reimplemented — see the escape
// in `ChangePasswordForm`. A second place that POSTs to the reset endpoint is how the two
// would drift.
import ForgotPasswordForm from "./ForgotPasswordForm";
import { useQuery } from "@tanstack/react-query";

// ─── Helpers ────────────────────────────────────────────
async function syncPasswordToNeon(newPassword: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  try {
    const token = await currentUser.getIdToken();
    const res = await fetch('/api/user/sync-password', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
      logger.warn('[sync-password] Failed to sync password to database:', await res.text());
    }
  } catch (err) {
    logger.warn('[sync-password] Non-blocking error syncing password to database:', err);
  }
}

// ─── Schemas ────────────────────────────────────────────
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
}).refine((data) => data.newPassword !== data.currentPassword, {
  message: "New password must be different from your current password",
  path: ["newPassword"],
});

const setPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
type SetPasswordFormData = z.infer<typeof setPasswordSchema>;

interface ChangePasswordProps {
  role?: 'chef' | 'manager' | 'admin';
  onSuccess?: () => void;
  /** Strip Card chrome when nested inside a parent section. */
  embedded?: boolean;
  /** Fires once the form mode is known (never "loading") and again if it changes mid-session. */
  onModeResolved?: (mode: Exclude<PasswordFormMode, "loading">) => void;
  /**
   * Render a `Cancel` beside the submit, in the row-action hierarchy the profile page
   * uses.
   *
   * The action lives here rather than in the host because the submit does: a panel whose
   * primary button is rendered by one component and whose `Cancel` is rendered by
   * another cannot put them on the same line, and stacking them is what made this form's
   * buttons look unlike every other row on the page. `PhoneSignInSettings` already owns
   * both of its own, so this mirrors it.
   */
  onCancel?: () => void;
  /**
   * The `Cancel` label. Passed in because the HOST localises it — the manager profile
   * passes `mt("cancel")` ("Annuler" / "Скасувати"), and this component is shared with
   * the chef and admin surfaces, which have their own namespaces.
   */
  cancelLabel?: string;
}

export default function ChangePassword({ role, onSuccess, embedded = false, onModeResolved, onCancel, cancelLabel = "Cancel" }: ChangePasswordProps) {
  const [hasLinkedPassword, setHasLinkedPassword] = useState(false);
  const [treatPasswordAsKnown, setTreatPasswordAsKnown] = useState(false);
  // undefined = still loading token claim; null = unavailable
  const [signInProvider, setSignInProvider] = useState<string | null | undefined>(undefined);

  // Detect if user has email/password provider linked (synchronous check, no effect needed)
  const hasPasswordProvider = useMemo(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    return currentUser.providerData.some(
      (provider: { providerId: string }) => provider.providerId === 'password'
    ) || hasLinkedPassword;
  }, [hasLinkedPassword]);

  // Determine if user signed in with Google
  const isGoogleUser = useMemo(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    return currentUser.providerData.some(
      (provider: { providerId: string }) => provider.providerId === 'google.com'
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setSignInProvider(null);
      return;
    }
    currentUser
      .getIdTokenResult()
      .then((token: any) => {
        if (!cancelled) setSignInProvider(token?.signInProvider ?? null);
      })
      .catch((err: any) => {
        logger.warn("[ChangePassword] Failed to read sign-in provider:", err);
        if (!cancelled) setSignInProvider(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Firebase cannot tell a registration placeholder from a chosen password —
  // both look like a "password" provider. The server's flag is the only answer.
  const { data: profile, isError: profileUnavailable } = useQuery({
    queryKey: ["/api/user/profile", auth.currentUser?.uid],
    enabled: hasPasswordProvider !== null,
    queryFn: async () => {
      const currentUser = auth.currentUser!;
      const token = await currentUser.getIdToken();
      const response = await fetch("/api/user/profile", {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load profile");
      return response.json() as Promise<{ passwordSetByUser?: boolean | null }>;
    },
  });

  const mode = resolvePasswordFormMode({
    hasPasswordProvider,
    signInProvider,
    treatPasswordAsKnown,
    // A failed read must not deadlock on the spinner, so fall back to the
    // pre-flag behaviour (provider-derived) instead of guessing "unset".
    //
    // A read that SUCCEEDED but did not carry the flag is equally unanswerable, and it used to
    // deadlock: `undefined ?? null` is null, and null means "not loaded yet", so the section spun
    // for ever. The server always sends it (the profile handler spreads the whole row), so this
    // was only reachable from a mock — which is exactly how it went unnoticed. Same fallback,
    // because "set a password" offered to someone who already has one is the worse mistake.
    passwordSetByUser:
      profile?.passwordSetByUser ?? (profileUnavailable || profile !== undefined ? true : null),
  });

  const isPlaceholderPassword = profile?.passwordSetByUser === false;

  // Surface the resolved mode (e.g. so a parent header can say "Create" vs "Update").
  // Re-fires if the mode changes mid-session (set → change after a successful set).
  const onModeResolvedRef = useRef(onModeResolved);
  onModeResolvedRef.current = onModeResolved;
  useEffect(() => {
    if (mode !== "loading") onModeResolvedRef.current?.(mode);
  }, [mode]);

  const markPasswordKnown = () => {
    setHasLinkedPassword(true);
    setTreatPasswordAsKnown(true);
    onSuccess?.();
  };

  if (mode === "loading") {
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (mode === "change") {
    return (
      <ChangePasswordForm
        onSuccess={onSuccess}
        embedded={embedded}
        onCancel={onCancel}
        cancelLabel={cancelLabel}
        role={role}
      />
    );
  }

  return (
    <SetPasswordForm
      mode={mode}
      isGoogleUser={isGoogleUser}
      isPlaceholderPassword={isPlaceholderPassword}
      embedded={embedded}
      onSuccess={markPasswordKnown}
      onCancel={onCancel}
      cancelLabel={cancelLabel}
    />
  );
}

// ─── Change Password Form (for email/password users) ───
function ChangePasswordForm({
  onSuccess,
  embedded = false,
  onCancel,
  cancelLabel = "Cancel",
  role,
}: {
  onSuccess?: () => void;
  embedded?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
  /** Forwarded to `ForgotPasswordForm` so the reset it opens calls the right endpoint. */
  role?: 'chef' | 'manager' | 'admin';
}) {
  const { t } = useTranslation("chef");
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** The escape has been taken: show the reset flow instead of this form. */
  const [showReset, setShowReset] = useState(false);

  const form = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    mode: "onChange",
  });

  const watched = form.watch();
  const canSave =
    watched.currentPassword.length > 0 &&
    watched.newPassword.length >= 8 &&
    watched.confirmPassword === watched.newPassword &&
    watched.newPassword !== watched.currentPassword;

  /**
   * Whether to render the page's row-action shape.
   *
   * It follows the `Cancel`, because the two buttons have to match each other and a host
   * only supplies one when it is rendering an action row. That is the manager profile,
   * where the form is a disclosure inside a `ContactVerificationRow`.
   *
   * The CHEF profile nests this form permanently in a plain card — no disclosure, so no
   * Cancel and no action row — and keeps its own full-width button. Gating on `embedded`
   * alone would have restyled that page too, which nothing asked for and no harness covers.
   */
  const usesRowActions = embedded && onCancel !== undefined;

  const onSubmit = async (data: ChangePasswordFormData) => {
    setIsSubmitting(true);

    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("You must be signed in to change your password");
      }

      const userEmail = currentFirebaseUser.email;
      if (!userEmail) {
        throw new Error("No email associated with this account.");
      }

      // Step 1: Re-authenticate with current password
      const credential = EmailAuthProvider.credential(userEmail, data.currentPassword);

      try {
        await reauthenticateWithCredential(currentFirebaseUser, credential);
      } catch (reauthError: any) {
        logger.error('Reauthentication failed:', reauthError);
        if (reauthError.code === 'auth/wrong-password' || reauthError.code === 'auth/invalid-credential') {
          throw new Error("Current password is incorrect");
        } else if (reauthError.code === 'auth/too-many-requests') {
          throw new Error("Too many failed attempts. Please try again later.");
        } else if (reauthError.code === 'auth/user-mismatch') {
          throw new Error("Authentication error. Please sign out and sign back in.");
        } else {
          throw new Error("Failed to verify current password. Please try again.");
        }
      }

      // Step 2: Update password in Firebase
      await updatePassword(currentFirebaseUser, data.newPassword);

      // Step 3: Sync hashed password to Neon DB (non-blocking)
      await syncPasswordToNeon(data.newPassword);

      toast.success("Success", {
        description: "Password changed successfully"
      });

      form.reset();
      onSuccess?.();
    } catch (error: any) {
      logger.error('Password change error:', error);
      let errorMessage = error.message || 'Failed to change password';
      if (error.code === 'auth/weak-password') {
        errorMessage = "Password is too weak. Use at least 8 characters with a mix of letters, numbers, and symbols.";
      } else if (error.code === 'auth/requires-recent-login') {
        errorMessage = "For security reasons, please sign out and sign back in before changing your password.";
      }
      toast.error("Error", { description: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * The escape for someone who does not know the password this form is demanding.
   *
   * `resolvePasswordFormMode` returns `change` whenever the account HAS a password, and
   * this form then asks for the current one. OWASP requires that check — an unlocked
   * session on a shared machine must not be enough to take the account over — so the
   * answer is not to relax it, it is to give a way out. Without one a manager who signed
   * in with Google and has forgotten the password they set is simply stuck: the row
   * offers nothing else, and no amount of retyping gets past it.
   *
   * It reuses `ForgotPasswordForm` VERBATIM — same component, same
   * `/api/manager/forgot-password` endpoint, same branded email, same Firebase link — so
   * there is still exactly one place that requests a reset.
   *
   * Doing it from INSIDE the dashboard is safe, which is not obvious: a Firebase password
   * reset revokes the user's refresh tokens automatically ("the user is signed out and
   * prompted to reauthenticate"), so the flow ends on the login screen exactly as it does
   * from the sign-in screen. The copy has to say so, or being dropped out of a dashboard
   * they were just using reads as a bug rather than as the reset working.
   */
  if (showReset) {
    return (
      <div className="space-y-4">
        {/* ABOVE the form, not below it: the reset signs the user out, so the consequence
            has to be read BEFORE the button that causes it, not after. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("pwForgotSignOutNotice")}
        </p>
        <ForgotPasswordForm
          embedded
          role={role}
          initialEmail={auth.currentUser?.email ?? ""}
          onGoBack={() => setShowReset(false)}
          // Names where it goes. The form's own default is "Back to sign in", which is a lie
          // from inside the dashboard.
          backLabel={t("pwForgotBack")}
          onSuccess={() => {
            /* Stay on the success UI: it is the only place the next step is stated. */
          }}
        />
      </div>
    );
  }

  const formBody = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("pwCurrentLabel")}</FormLabel>
              <FormControl>
                <PasswordInput placeholder={t("pwCurrentPlaceholder")} {...field} disabled={isSubmitting} className="h-11" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("pwNewLabel")}</FormLabel>
              <FormControl>
                <PasswordInput placeholder={t("pwNewPlaceholder")} {...field} disabled={isSubmitting} className="h-11" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("pwConfirmLabel")}</FormLabel>
              <FormControl>
                <PasswordInput placeholder={t("pwConfirmPlaceholder")} {...field} disabled={isSubmitting} className="h-11" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/*
          Embedded: the page's row-action hierarchy, exactly as `PhoneSignInSettings`
          renders its inline editor — the completing action in PRIMARY, a text-only
          `Cancel` on the SAME line. It used to keep the marketing CTA (brand-red pill
          with a glow, `h-9`, hover lift) with `Cancel` stacked underneath on its own
          line, which read as two mismatched buttons rather than one action row. The
          `KeyRound` goes with it: no row action on this page carries a decorative icon.

          Standalone (the `Card` form used by admin): unchanged, a full-width submit.
        */}
        {usesRowActions ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="submit" size="sm" className={PRIMARY_ROW_ACTION} disabled={isSubmitting || !canSave}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  {t("pwChanging")}
                </>
              ) : (
                t("pwChangePassword")
              )}
            </Button>
            {onCancel ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={QUIET_ROW_ACTION}
                onClick={onCancel}
                disabled={isSubmitting}
              >
                {cancelLabel}
              </Button>
            ) : null}
          </div>
        ) : (
          <Button type="submit" className="w-full" disabled={isSubmitting || !canSave}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("pwChanging")}</>
            ) : (
              <><KeyRound className="mr-2 h-4 w-4" />{t("pwChangePassword")}</>
            )}
          </Button>
        )}
        {/*
          The escape, BELOW the actions and as a plain inline text link — the same shape the
          auth card uses for "Wrong email? Use a different email". Gated with the action row
          rather than on `embedded`, because today the only host that renders one is the
          manager profile; the chef nests this form permanently with no row to escape from.
        */}
        {usesRowActions ? (
          <p className="text-sm text-slate-600">
            {t("pwForgotPrompt")}{" "}
            <button
              type="button"
              onClick={() => setShowReset(true)}
              // index.css forces min-height/min-width 44px on EVERY button, which would
              // blow this inline link out of its line.
              className="!min-h-0 !min-w-0 font-medium text-[#E00A38] underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {t("pwForgotAction")}
            </button>
          </p>
        ) : null}
      </form>
    </Form>
  );

  if (embedded) return formBody;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t("pwChangePassword")}
        </CardTitle>
        <CardDescription>
          {t("pwUpdateDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {formBody}
      </CardContent>
    </Card>
  );
}

// ─── Set Password Form (Google SSO link, or email-link update) ───
function SetPasswordForm({
  mode,
  isGoogleUser,
  isPlaceholderPassword,
  onSuccess,
  embedded = false,
  onCancel,
  cancelLabel = "Cancel",
}: {
  mode: "set-link" | "set-update";
  isGoogleUser: boolean;
  /** The stored password is a registration placeholder the user never chose. */
  isPlaceholderPassword: boolean;
  onSuccess?: () => void;
  embedded?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEmailLinkSet = mode === "set-update";

  const form = useForm<SetPasswordFormData>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
    mode: "onChange",
  });

  const watched = form.watch();
  const canSave =
    watched.newPassword.length >= 8 &&
    watched.confirmPassword === watched.newPassword;
  /** See the same name in `ChangePasswordForm`. */
  const usesRowActions = embedded && onCancel !== undefined;

  const onSubmit = async (data: SetPasswordFormData) => {
    setIsSubmitting(true);

    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("You must be signed in to set a password");
      }

      if (!currentFirebaseUser.email) {
        throw new Error("No email associated with this account.");
      }

      // `updatePassword`, never `linkWithCredential` — for BOTH modes.
      //
      // Both calls add a password provider, but linking an EmailAuthProvider
      // credential makes Firebase re-evaluate who vouches for the address and
      // DEMOTE the account: `emailVerified` flips true -> false. Measured
      // 2026-09-20 in this project on a disposable user —
      //   linkWithCredential  emailVerified true -> false, providers [password]
      //   updatePassword      emailVerified true -> true,  providers [password]
      // Identical provider set, so the flag is the only difference.
      //
      // That is the whole reason a manager who registered with Google and then set a
      // password lost the email sign-in path for good: `resolveEmailVerified` and the
      // client's `hasVerifiedEmail` both read `emailVerified`, so the identifier gate
      // diverted them to "Check your email" on every attempt. Only a Google account
      // could reach this branch — it is the only kind with no password provider — and
      // the feature had never been exercised before that account, so it was also the
      // first and only one affected. There is no counter-evidence from other accounts:
      // none of them has ever set a password from the profile page.
      //
      // `updatePassword` covers the placeholder-replacement case too, which is why
      // the two modes are now one call. Either way Firebase requires a recent
      // sign-in, and `auth/requires-recent-login` is already handled below.
      await updatePassword(currentFirebaseUser, data.newPassword);

      await syncPasswordToNeon(data.newPassword);

      toast.success("Password set successfully", {
        description: isEmailLinkSet
          ? "You can now sign in with your email and password, or keep using email links."
          : "You can now sign in with your email and password as an alternative to Google.",
      });

      form.reset();
      onSuccess?.();
    } catch (error: any) {
      logger.error('Set password error:', error);
      let errorMessage = error.message || 'Failed to set password';
      if (error.code === 'auth/weak-password') {
        errorMessage = "Password is too weak. Use at least 8 characters with a mix of letters, numbers, and symbols.";
      } else if (error.code === 'auth/requires-recent-login') {
        errorMessage = isPlaceholderPassword
          ? "For security reasons, please sign out and sign back in, then try again."
          : isEmailLinkSet
            ? "For security reasons, please sign out and sign back in with your email link, then try again."
            : "For security reasons, please sign out and sign back in with Google, then try again.";
      } else if (error.code === 'auth/provider-already-linked') {
        errorMessage = "A password is already linked to this account. Try changing your password instead.";
      } else if (error.code === 'auth/email-already-in-use') {
        errorMessage = "This email is already associated with another account. Please contact support.";
      }
      toast.error("Error", { description: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hintText =
    isGoogleUser && !isEmailLinkSet
      ? "You signed in with Google. Add a password to also sign in with email."
      : isPlaceholderPassword
        ? "You have not set a password yet. Choose one to also sign in with email and password."
        : isEmailLinkSet
          ? "You signed in with an email link. Choose a password to also sign in with email and password."
          : null;

  const hint =
    hintText === null ? null : embedded ? (
      <p className="text-sm text-muted-foreground">{hintText}</p>
    ) : (
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
        {isGoogleUser && !isEmailLinkSet ? (
          <Chrome className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <p className="text-sm text-muted-foreground">{hintText}</p>
      </div>
    );

  const formBody = (
    <div className="space-y-5">
      {hint}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <PasswordInput placeholder="At least 8 characters" {...field} disabled={isSubmitting} className="h-11" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <PasswordInput placeholder="Confirm password" {...field} disabled={isSubmitting} className="h-11" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {/* Same action row as the change form, for the same reason — see `onCancel`
              on the props. The `ShieldCheck` goes with the marketing CTA. */}
          {usesRowActions ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="submit" size="sm" className={PRIMARY_ROW_ACTION} disabled={isSubmitting || !canSave}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  "Set password"
                )}
              </Button>
              {onCancel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={QUIET_ROW_ACTION}
                  onClick={onCancel}
                  disabled={isSubmitting}
                >
                  {cancelLabel}
                </Button>
              ) : null}
            </div>
          ) : (
            <Button type="submit" className="w-full" disabled={isSubmitting || !canSave}>
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : (
                <><ShieldCheck className="mr-2 h-4 w-4" />Set password</>
              )}
            </Button>
          )}
        </form>
      </Form>
    </div>
  );

  if (embedded) return formBody;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Set a Password
        </CardTitle>
        <CardDescription>
          Add email &amp; password sign-in as an alternative way to access your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {formBody}
      </CardContent>
    </Card>
  );
}
