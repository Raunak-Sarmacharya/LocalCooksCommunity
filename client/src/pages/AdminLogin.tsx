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
  const [, navigate] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    
    try {
      console.log('Attempting admin login with username:', data.username);
      const response = await fetch('/api/admin-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Admin login failed:', errorData);
        throw new Error(errorData.error || 'Admin login failed');
      }
      
      const userData = await response.json();
      console.log('Admin login successful, user data:', userData);
      
      // Store userId in localStorage for persistence
      if (userData?.uid) {
        localStorage.setItem('userId', userData.uid.toString());
        console.log('Saved userId to localStorage:', userData.uid);
        
        // Update query client with user data
        queryClient.setQueryData(["/api/user"], userData);
        console.log('Updated query client with user data');
        
        // Force a complete page reload to ensure clean state
        console.log('Reloading page to ensure clean authentication state...');
        window.location.href = '/admin';
      } else {
        throw new Error('Invalid admin user data returned');
      }
    } catch (error: any) {
      console.error('Admin login error:', error);
      setErrorMessage(error.message || 'Failed to login');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Redirect if already logged in
  if (user && !loading) {
    if (user.role === 'admin') {
      return <Redirect to="/admin" />;
    } else {
      // Non-admin users should be redirected away from admin login
      return <Redirect to="/dashboard" />;
    }
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