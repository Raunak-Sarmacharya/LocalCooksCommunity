import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Redirect, useLocation } from "wouter";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const { user, loading, login, signInWithGoogle } = useFirebaseAuth();
  const isAdmin = user?.role === 'admin';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await signInWithGoogle(false);
      queryClient.clear();
    } catch (error: any) {
      logger.error('Admin Google sign-in error:', error);

      if (error.message?.includes('popup-closed-by-user')) {
        setErrorMessage('Sign-in was cancelled. Please try again.');
      } else if (error.message?.includes('popup-blocked')) {
        setErrorMessage('Pop-up blocked. Please allow pop-ups and try again.');
      } else if (error.message?.includes('not registered') || error.message?.includes('Account not found')) {
        setErrorMessage('This Google account is not an existing Local Cooks account.');
      } else {
        setErrorMessage(error.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login(data.email.trim(), data.password);
      queryClient.clear();
    } catch (error: any) {
      logger.error('Admin login error:', error);
      let errorMsg = 'Failed to sign in';
      if (error.message?.includes('invalid-credential') || error.message?.includes('wrong-password')) {
        errorMsg = 'Incorrect email or password. Please check your credentials and try again.';
      } else if (error.message?.includes('user-not-found')) {
        errorMsg = 'No account found with this email address.';
      } else if (error.message?.includes('too-many-requests')) {
        errorMsg = 'Too many failed attempts. Please wait a few minutes.';
      } else {
        errorMsg = error.message || 'Failed to login';
      }
      
      setErrorMessage(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Redirect if already logged in as admin
  if (!loading && isAdmin) {
    logger.info('Admin already logged in, redirecting to admin panel');
    return <Redirect to="/admin" />;
  }
  
  // Redirect non-admin users
  if (!loading && user?.role && !isAdmin) {
    logger.info('Non-admin user detected, redirecting to appropriate dashboard');
    if (user.role === 'manager') {
      return <Redirect to="/manager/dashboard" />;
    }
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary">
            <Calendar className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">Admin Login</CardTitle>
          <CardDescription>
            Sign in with an existing administrator account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="mb-4 w-full"
            onClick={handleGoogleSignIn}
            disabled={isSubmitting || loading}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" className="mr-2 flex-shrink-0" aria-hidden="true">
              <path fill="#4285F4" d="M24 9.5c3.54 0 6.7 1.22 9.19 3.23l6.85-6.85C35.64 2.36 30.18 0 24 0 14.82 0 6.73 5.48 2.69 13.44l7.98 6.2C12.13 13.13 17.62 9.5 24 9.5z" />
              <path fill="#34A853" d="M46.1 24.55c0-1.64-.15-3.22-.43-4.74H24v9.01h12.42c-.54 2.9-2.18 5.36-4.65 7.01l7.19 5.6C43.98 37.36 46.1 31.44 46.1 24.55z" />
              <path fill="#FBBC05" d="M10.67 28.65c-1.01-2.99-1.01-6.31 0-9.3l-7.98-6.2C.99 17.36 0 20.57 0 24c0 3.43.99 6.64 2.69 9.44l7.98-6.2z" />
              <path fill="#EA4335" d="M24 48c6.18 0 11.64-2.04 15.54-5.56l-7.19-5.6c-2.01 1.35-4.59 2.16-8.35 2.16-6.38 0-11.87-3.63-14.33-8.94l-7.98 6.2C6.73 42.52 14.82 48 24 48z" />
            </svg>
            Continue with Google
          </Button>

          <div className="relative mb-4 flex items-center" aria-hidden="true">
            <div className="flex-grow border-t border-border" />
            <span className="mx-3 flex-shrink text-xs uppercase tracking-wider text-muted-foreground">Or continue with email</span>
            <div className="flex-grow border-t border-border" />
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              {errorMessage && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-500">
                  {errorMessage}
                </div>
              )}
              
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        autoComplete="email"
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
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your password"
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
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="text-center text-sm text-muted-foreground">
          <p className="w-full">
            This area is restricted to authorized personnel only.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
