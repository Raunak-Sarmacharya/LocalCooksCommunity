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
import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { 
  EmailAuthProvider, 
  reauthenticateWithCredential, 
  updatePassword 
} from "firebase/auth";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

interface ChangePasswordProps {
  role?: 'manager' | 'admin';
  onSuccess?: () => void;
}

export default function ChangePassword({ role = 'manager', onSuccess }: ChangePasswordProps) {
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
        console.error('Reauthentication failed:', reauthError);
        
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
      
      toast.success("Success", { 
        description: "Password changed successfully" 
      });
      
      // Reset form
      form.reset();
      
      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      }
      
    } catch (error: any) {
      console.error('Password change error:', error);
      
      // Handle Firebase-specific errors with user-friendly messages
      let errorMessage = error.message || 'Failed to change password';
      
      if (error.code === 'auth/weak-password') {
        errorMessage = "New password is too weak. Please use at least 6 characters with a mix of letters, numbers, and symbols.";
      } else if (error.code === 'auth/requires-recent-login') {
        errorMessage = "For security reasons, please sign out and sign back in before changing your password.";
      }
      
      toast.error("Error", { 
        description: errorMessage
      });
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
  );
}

