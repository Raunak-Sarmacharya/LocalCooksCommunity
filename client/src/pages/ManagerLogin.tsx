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
import { queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Redirect } from "wouter";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function ManagerLogin() {
  // Managers use session-based authentication (like admins), not Firebase
  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
    queryKey: ["/api/user-session"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated via session
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return {
          ...userData,
          authMethod: 'session'
        };
      } catch (error) {
        console.error('ManagerLogin - Session auth error:', error);
        return null;
      }
    },
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const user = sessionUser;
  const loading = sessionLoading;
  const isManager = user?.role === 'manager';
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
      console.log('Attempting manager login with username:', data.username);
      const response = await fetch('/api/manager-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Manager login failed:', errorData);
        throw new Error(errorData.error || 'Manager login failed');
      }
      
      const userData = await response.json();
      console.log('Manager login successful, user data:', userData);
      
      // Ensure we have valid manager user data
      if (!userData?.id || userData.role !== 'manager') {
        throw new Error('Invalid user data returned - must be manager');
      }

      // Store userId in localStorage for persistence
      localStorage.setItem('userId', userData.id.toString());
      console.log('Saved userId to localStorage:', userData.id);
      
      // Clear all cached data and force a complete refresh
      queryClient.clear();
      console.log('Cleared all query cache');
      
      console.log('Manager login successful, reloading page to establish session...');
      
      // Redirect based on password change requirement
      let redirectPath;
      // Managers must change password on first login (has_seen_welcome === false)
      if (userData.has_seen_welcome === false) {
        redirectPath = '/manager/change-password';
      } else {
        redirectPath = '/manager/dashboard';
      }
      
      // Use window.location.href to force a complete page reload 
      // This ensures the session cookie is properly established
      window.location.href = redirectPath;
      
    } catch (error: any) {
      console.error('Manager login error:', error);
      setErrorMessage(error.message || 'Failed to login');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading while checking session
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-2" />
          <p className="text-sm text-gray-600">Checking manager session...</p>
        </div>
      </div>
    );
  }

  // Redirect if already logged in as manager
  if (isManager) {
    console.log('Manager already logged in, redirecting to manager dashboard');
    // Check if they need to change password
    if ((user as any).has_seen_welcome === false) {
      return <Redirect to="/manager/change-password" />;
    }
    return <Redirect to="/manager/dashboard" />;
  }
  
  // Redirect non-manager users
  if (user && !isManager) {
    console.log('Non-manager user detected, redirecting to appropriate dashboard');
    if (user.role === 'admin') {
      return <Redirect to="/admin" />;
    }
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <Card className="mx-auto w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-600">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">Kitchen Manager Login</CardTitle>
          <CardDescription className="text-gray-600">
            Access your commercial kitchen dashboard
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
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-500 border border-red-200">
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
                        placeholder="Enter your username"
                        {...field}
                        disabled={isSubmitting}
                        className="bg-white"
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
                        className="bg-white"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  "Login to Kitchen Dashboard"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="text-center text-sm text-muted-foreground">
          <p className="w-full text-gray-600">
            Partner commercial kitchen access only
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

