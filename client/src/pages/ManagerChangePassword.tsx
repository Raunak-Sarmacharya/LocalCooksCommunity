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
import { useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { 
  EmailAuthProvider, 
  reauthenticateWithCredential, 
  updatePassword 
} from "firebase/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, Shield } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, Redirect } from "wouter";
import { z } from "zod";
import { toast } from "../hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

export default function ManagerChangePassword() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Verify user is a manager using Firebase auth
  const { user: firebaseUser } = useFirebaseAuth();
  
  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) {
        throw new Error("Not authenticated");
      }
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) {
          throw new Error("Not authenticated");
        }
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          throw new Error("Not authenticated");
        }
        return response.json();
      } catch (error) {
        logger.error('Error fetching user profile:', error);
        throw error;
      }
    },
    enabled: !!firebaseUser,
  });

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
      // Get current Firebase user
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("You must be signed in to change your password");
      }
      
      const userEmail = currentFirebaseUser.email;
      if (!userEmail) {
        throw new Error("No email associated with this account. Password change requires an email-based account.");
      }
      
      // Step 1: Re-authenticate user with current password
      // This is required by Firebase for security-sensitive operations
      const credential = EmailAuthProvider.credential(userEmail, data.currentPassword);
      
      try {
        await reauthenticateWithCredential(currentFirebaseUser, credential);
      } catch (reauthError: any) {
        logger.error('Reauthentication failed:', reauthError);
        
        // Provide user-friendly error messages for common reauthentication errors
        if (reauthError.code === 'auth/wrong-password' || reauthError.code === 'auth/invalid-credential') {
          throw new Error("Current password is incorrect");
        } else if (reauthError.code === 'auth/too-many-requests') {
          throw new Error("Too many failed attempts. Please try again later.");
        } else if (reauthError.code === 'auth/user-mismatch') {
          throw new Error("Authentication error. Please sign out and sign back in.");
        } else if (reauthError.code === 'auth/user-not-found') {
          throw new Error("User account not found. Please sign out and sign back in.");
        } else {
          throw new Error("Failed to verify current password. Please try again.");
        }
      }
      
      // Step 2: Update password using Firebase Auth
      await updatePassword(currentFirebaseUser, data.newPassword);
      
      // Step 3: Sync hashed password to Neon DB (non-blocking)
      try {
        const token = await currentFirebaseUser.getIdToken();
        await fetch('/api/user/sync-password', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ newPassword: data.newPassword }),
        });
      } catch (syncError) {
        logger.warn('Failed to sync password to database:', syncError);
      }
      
      // Step 4: Mark welcome as seen (password changed) via API
      try {
        const token = await currentFirebaseUser.getIdToken();
        await fetch('/api/user/seen-welcome', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
      } catch (seenError) {
        logger.warn('Failed to mark welcome as seen:', seenError);
        // Non-blocking - continue with success flow
      }
      
      toast({ 
        title: "Success", 
        description: "Password changed successfully" 
      });
      
      // Clear cache and redirect to manager dashboard
      queryClient.clear();
      window.location.href = '/manager/dashboard';
      
    } catch (error: any) {
      logger.error('Password change error:', error);
      
      // Handle Firebase-specific errors with user-friendly messages
      let errorMessage = error.message || 'Failed to change password';
      
      if (error.code === 'auth/weak-password') {
        errorMessage = "New password is too weak. Please use at least 6 characters with a mix of letters, numbers, and symbols.";
      } else if (error.code === 'auth/requires-recent-login') {
        errorMessage = "For security reasons, please sign out and sign back in before changing your password.";
      }
      
      toast({ 
        title: "Error", 
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || user.role !== 'manager') {
    return <Redirect to="/manager/login" />;
  }

  // If password already changed, redirect to dashboard
  if (user.has_seen_welcome !== false) {
    setLocation('/manager/dashboard');
    return null;
  }

  // Google-only users don't have a password to change — skip this gate
  const currentFirebaseUserCheck = auth.currentUser;
  const isGoogleOnly = currentFirebaseUserCheck?.providerData.some(
    (p: { providerId: string }) => p.providerId === 'google.com'
  ) && !currentFirebaseUserCheck?.providerData.some(
    (p: { providerId: string }) => p.providerId === 'password'
  );
  if (isGoogleOnly) {
    // Mark welcome as seen and redirect
    (async () => {
      try {
        const token = await currentFirebaseUserCheck!.getIdToken();
        await fetch('/api/user/seen-welcome', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          credentials: 'include',
        });
      } catch { /* non-blocking */ }
      queryClient.clear();
      window.location.href = '/manager/dashboard';
    })();
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">Change Password Required</CardTitle>
          <CardDescription>
            For security reasons, you must change your password before accessing the manager dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your current password"
                        {...field}
                        disabled={isSubmitting}
                      />
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
                      <Input
                        type="password"
                        placeholder="Enter your new password (min 8 characters)"
                        {...field}
                        disabled={isSubmitting}
                      />
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
                      <Input
                        type="password"
                        placeholder="Confirm your new password"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Changing Password...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    Change Password
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

