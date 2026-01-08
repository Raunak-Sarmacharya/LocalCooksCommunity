import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
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
import { useFirebaseAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChefHat, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Redirect, useLocation } from "wouter";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const { user, loading } = useFirebaseAuth();
  const isAdmin = user?.role === 'admin';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const { login } = useFirebaseAuth();

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    
    try {
      console.log('Attempting admin login with Firebase Auth:', data.username);
      
      // Use Firebase Auth login (email/password)
      await login(data.username, data.password);
      
      // After successful login, verify user is admin
      // The useFirebaseAuth hook will update the user state
      // We'll check this in the redirect logic below
      
      console.log('Firebase login successful, checking admin role...');
      
      // Clear all cached data
      queryClient.clear();
      
      // Redirect will be handled by the redirect logic below
      // which checks if user.role === 'admin'
      
    } catch (error: any) {
      console.error('Admin login error:', error);
      
      // Provide user-friendly error messages
      let errorMsg = 'Failed to login';
      if (error.message?.includes('invalid-credential') || error.message?.includes('wrong-password')) {
        errorMsg = 'Invalid email or password';
      } else if (error.message?.includes('user-not-found')) {
        errorMsg = 'No account found with this email';
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
    console.log('Admin already logged in, redirecting to admin panel');
    return <Redirect to="/admin" />;
  }
  
  // Redirect non-admin users
  if (!loading && user && !isAdmin) {
    console.log('Non-admin user detected, redirecting to appropriate dashboard');
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
            <ChefHat className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">Admin Login</CardTitle>
          <CardDescription>
            Enter your credentials to access the admin dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="admin"
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
                    Logging in...
                  </>
                ) : (
                  "Login"
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