import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSuccess?: () => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const { loginMutation } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    console.log('Attempting login with username:', data.username);
    setError(null);
    
    if (isAdminMode) {
      try {
        console.log('Using admin login endpoint');
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
          throw new Error(errorData.error || 'Admin login failed');
        }
        
        const userData = await response.json();
        console.log('Admin login successful, user data:', userData);
        
        // Store userId in localStorage for persistence
        if (userData?.id) {
          localStorage.setItem('userId', userData.id.toString());
          console.log('Saved userId to localStorage:', userData.id);
          
          // Update query client with user data
          queryClient.setQueryData(["/api/user"], userData);
          console.log('Updated query client with user data');
        }
        
        // Call success callback
        if (onSuccess) {
          console.log('Calling onSuccess callback for redirect');
          onSuccess();
        }
      } catch (error: any) {
        console.error('Admin login error:', error);
        setError(error.message || 'Admin login failed');
      }
      return;
    }
    
    // Regular login
    loginMutation.mutate(data, {
      onSuccess: (userData) => {
        console.log('Login successful, user data:', userData);
        
        // Verify we got valid user data back
        if (!userData || !userData.id) {
          console.error('Login succeeded but user data is missing or incomplete');
          setError('Authentication successful but user data is incomplete. Please try again.');
          return;
        }
        
        // Call success callback
        if (onSuccess) {
          console.log('Calling onSuccess callback for redirect');
          onSuccess();
        }
      },
      onError: (error) => {
        console.error('Login error:', error);
        setError(error.message);
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-500">
            {error}
          </div>
        )}

        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="Enter your username" {...field} />
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
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="admin-mode"
              checked={isAdminMode}
              onChange={(e) => setIsAdminMode(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="admin-mode" className="text-sm font-medium">
              Admin mode
            </label>
          </div>
          {isAdminMode && (
            <div className="text-xs text-amber-600">
              Using direct admin login
            </div>
          )}
        </div>
        
        <Button
          type="submit"
          className="w-full"
          disabled={loginMutation.isPending}
        >
          {loginMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Logging in...
            </>
          ) : (
            isAdminMode ? "Login as Admin" : "Login"
          )}
        </Button>
      </form>
    </Form>
  );
}