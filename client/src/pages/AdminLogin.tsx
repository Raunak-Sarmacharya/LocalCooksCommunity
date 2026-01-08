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
import { auth } from "@/lib/firebase";
import { signInWithCustomToken } from "firebase/auth";
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
    
    const loginIdentifier = data.username.trim();
    const isEmailFormat = loginIdentifier.includes('@');

    // If it's not an email format (likely a username), try migration login first
    if (!isEmailFormat) {
      console.log('🔄 Username detected, trying migration login for old admin...');
      
      try {
        const migrateResponse = await fetch('/api/admin-migrate-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: loginIdentifier,
            password: data.password
          })
        });

        if (migrateResponse.ok) {
          const migrateData = await migrateResponse.json();
          
          if (migrateData.customToken) {
            // Sign in with custom token
            const userCredential = await signInWithCustomToken(auth, migrateData.customToken);
            console.log('✅ Migration login successful');
            
            // Force token refresh and sync user data
            if (userCredential.user) {
              await userCredential.user.getIdToken(true);
              
              // Trigger user sync with backend
              try {
                const token = await userCredential.user.getIdToken();
                const syncResponse = await fetch('/api/user/profile', {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                });
                
                if (syncResponse.ok) {
                  console.log('✅ User profile synced after migration login');
                }
              } catch (syncError) {
                console.error('❌ Error syncing user profile after migration:', syncError);
              }
            }
            
            // Clear all cached data
            queryClient.clear();
            
            // Wait a bit for auth state to update
            setTimeout(() => {
              setIsSubmitting(false);
            }, 2000);
            return;
          }
        } else {
          // Migration login failed - try Firebase as fallback if it's an email
          const errorData = await migrateResponse.json().catch(() => ({}));
          console.log('Migration login failed:', errorData);
        }
      } catch (migrateError) {
        console.log('Migration login error, trying Firebase as fallback:', migrateError);
      }
    }

    // Try Firebase login (for email-based accounts or as fallback)
    try {
      // Only try Firebase if it looks like an email, otherwise skip
      if (isEmailFormat) {
        console.log('Attempting admin login with Firebase Auth:', loginIdentifier);
        
        // Use Firebase Auth login (email/password)
        await login(loginIdentifier, data.password);
        
        console.log('Firebase login successful, checking admin role...');
        
        // Clear all cached data
        queryClient.clear();
      } else {
        // Username format and migration failed - show error
        setErrorMessage('Incorrect username or password. Please check your credentials and try again.');
        setIsSubmitting(false);
        return;
      }
      
    } catch (error: any) {
      console.error('Admin login error:', error);
      
      // If Firebase login fails, try migration login for old admins (if we haven't already)
      if (isEmailFormat && (error.message?.includes('invalid-credential') || error.message?.includes('wrong-password') || error.message?.includes('user-not-found'))) {
        console.log('🔄 Firebase login failed, trying migration login for old admin...');
        
        try {
          // Try migration login (for old admins with username/password in Neon DB)
          // First try the email as username, then try without @ if it's an email
          const usernameAttempts = [loginIdentifier];
          if (loginIdentifier.includes('@')) {
            // Try the part before @ as username
            usernameAttempts.push(loginIdentifier.split('@')[0]);
          }
          
          for (const usernameAttempt of usernameAttempts) {
            const migrateResponse = await fetch('/api/admin-migrate-login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                username: usernameAttempt,
                password: data.password
              })
            });

            if (migrateResponse.ok) {
              const migrateData = await migrateResponse.json();
              
              if (migrateData.customToken) {
                // Sign in with custom token
                const userCredential = await signInWithCustomToken(auth, migrateData.customToken);
                console.log('✅ Migration login successful');
                
                // Force token refresh and sync user data
                if (userCredential.user) {
                  await userCredential.user.getIdToken(true);
                  
                  // Trigger user sync with backend
                  try {
                    const token = await userCredential.user.getIdToken();
                    const syncResponse = await fetch('/api/user/profile', {
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                      }
                    });
                    
                    if (syncResponse.ok) {
                      console.log('✅ User profile synced after migration login');
                    }
                  } catch (syncError) {
                    console.error('❌ Error syncing user profile after migration:', syncError);
                  }
                }
                
                // Clear all cached data
                queryClient.clear();
                
                // Wait a bit for auth state to update
                setTimeout(() => {
                  setIsSubmitting(false);
                }, 2000);
                return;
              }
            }
          }
        } catch (migrateError) {
          console.log('Migration login also failed, continuing with Firebase error handling');
        }
      }
      
      // Provide user-friendly error messages
      let errorMsg = 'Failed to login';
      if (error.message?.includes('invalid-credential') || error.message?.includes('wrong-password')) {
        errorMsg = 'Incorrect username or password. Please check your credentials and try again.';
      } else if (error.message?.includes('user-not-found')) {
        errorMsg = 'No account found with this username/email';
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