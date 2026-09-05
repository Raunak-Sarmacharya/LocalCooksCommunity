import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, ShieldCheck, Chrome } from "lucide-react";
import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { auth } from "@/lib/firebase";
import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { cn } from "@/lib/utils";

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
}

export default function ChangePassword({ onSuccess, embedded = false }: ChangePasswordProps) {
  const [hasLinkedPassword, setHasLinkedPassword] = useState(false);

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

  // Show loading while detecting provider
  if (hasPasswordProvider === null) {
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

  if (hasPasswordProvider) {
    return <ChangePasswordForm onSuccess={onSuccess} embedded={embedded} />;
  }

  return (
    <SetPasswordForm
      isGoogleUser={isGoogleUser}
      embedded={embedded}
      onSuccess={() => {
        setHasLinkedPassword(true);
        onSuccess?.();
      }}
    />
  );
}

// ─── Change Password Form (for email/password users) ───
function ChangePasswordForm({
  onSuccess,
  embedded = false,
}: {
  onSuccess?: () => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation("chef");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

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
                <Input type="password" placeholder={t("pwCurrentPlaceholder")} {...field} disabled={isSubmitting} className="h-11" />
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
                <Input type="password" placeholder={t("pwNewPlaceholder")} {...field} disabled={isSubmitting} className="h-11" />
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
                <Input type="password" placeholder={t("pwConfirmPlaceholder")} {...field} disabled={isSubmitting} className="h-11" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className={cn(embedded ? "w-full sm:w-auto" : "w-full")} disabled={isSubmitting}>
          {isSubmitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("pwChanging")}</>
          ) : (
            <><KeyRound className="mr-2 h-4 w-4" />{t("pwChangePassword")}</>
          )}
        </Button>
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

// ─── Set Password Form (for Google SSO users) ──────────
function SetPasswordForm({
  isGoogleUser,
  onSuccess,
  embedded = false,
}: {
  isGoogleUser: boolean;
  onSuccess?: () => void;
  embedded?: boolean;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<SetPasswordFormData>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: SetPasswordFormData) => {
    setIsSubmitting(true);

    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("You must be signed in to set a password");
      }

      const userEmail = currentFirebaseUser.email;
      if (!userEmail) {
        throw new Error("No email associated with this account.");
      }

      // Link email/password credential to the existing Google account
      const credential = EmailAuthProvider.credential(userEmail, data.newPassword);
      await linkWithCredential(currentFirebaseUser, credential);

      // Sync hashed password to Neon DB (non-blocking)
      await syncPasswordToNeon(data.newPassword);

      toast.success("Password set successfully", {
        description: "You can now sign in with your email and password as an alternative to Google."
      });

      form.reset();
      onSuccess?.();
    } catch (error: any) {
      logger.error('Set password error:', error);
      let errorMessage = error.message || 'Failed to set password';
      if (error.code === 'auth/weak-password') {
        errorMessage = "Password is too weak. Use at least 8 characters with a mix of letters, numbers, and symbols.";
      } else if (error.code === 'auth/requires-recent-login') {
        errorMessage = "For security reasons, please sign out and sign back in with Google, then try again.";
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

  const formBody = (
    <div className="space-y-5">
      {isGoogleUser && !embedded ? (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
          <Chrome className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            You signed in with Google. Add a password to also sign in with email.
          </p>
        </div>
      ) : null}
      {isGoogleUser && embedded ? (
        <p className="text-sm text-muted-foreground">
          You signed in with Google. Add a password to also sign in with email.
        </p>
      ) : null}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="At least 8 characters" {...field} disabled={isSubmitting} className="h-11" />
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
                  <Input type="password" placeholder="Confirm password" {...field} disabled={isSubmitting} className="h-11" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className={cn(embedded ? "w-full sm:w-auto" : "w-full")} disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
            ) : (
              <><ShieldCheck className="mr-2 h-4 w-4" />Set password</>
            )}
          </Button>
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

