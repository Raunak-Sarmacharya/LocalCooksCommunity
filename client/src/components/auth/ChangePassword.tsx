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
import { auth } from "@/lib/firebase";
import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

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
      console.warn('[sync-password] Failed to sync password to database:', await res.text());
    }
  } catch (err) {
    console.warn('[sync-password] Non-blocking error syncing password to database:', err);
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
}

export default function ChangePassword({ onSuccess }: ChangePasswordProps) {
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
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (hasPasswordProvider) {
    return <ChangePasswordForm onSuccess={onSuccess} />;
  }

  return (
    <SetPasswordForm
      isGoogleUser={isGoogleUser}
      onSuccess={() => {
        setHasLinkedPassword(true);
        onSuccess?.();
      }}
    />
  );
}

// ─── Change Password Form (for email/password users) ───
function ChangePasswordForm({ onSuccess }: { onSuccess?: () => void }) {
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
        console.error('Reauthentication failed:', reauthError);
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
      console.error('Password change error:', error);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Change Password
        </CardTitle>
        <CardDescription>
          Update your account password. Make sure to use a strong password with at least 8 characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Enter your current password" {...field} disabled={isSubmitting} />
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
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Enter your new password (min 8 characters)" {...field} disabled={isSubmitting} />
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
                  <FormLabel>Confirm New Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Confirm your new password" {...field} disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Changing Password...</>
              ) : (
                <><KeyRound className="mr-2 h-4 w-4" />Change Password</>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ─── Set Password Form (for Google SSO users) ──────────
function SetPasswordForm({
  isGoogleUser,
  onSuccess,
}: {
  isGoogleUser: boolean;
  onSuccess?: () => void;
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
      console.error('Set password error:', error);
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
        {/* Google sign-in info banner */}
        {isGoogleUser && (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background border border-border">
              <Chrome className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-tight">Signed in with Google</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your account uses Google for authentication. You can optionally set a
                password below to also sign in with your email and password.
              </p>
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Choose a strong password (min 8 characters)" {...field} disabled={isSubmitting} />
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
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Re-enter your password" {...field} disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Success hint */}
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
              <span>After setting a password, you can sign in with either Google or your email and password.</span>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting Password...</>
              ) : (
                <><KeyRound className="mr-2 h-4 w-4" />Set Password</>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

