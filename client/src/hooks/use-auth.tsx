import { createContext, ReactNode, useContext, useState, useEffect, useCallback } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { User, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { navigate } from "wouter/use-browser-location";

type AuthUser = Pick<User, "id" | "username" | "role">;

type LoginData = {
  username: string;
  password: string;
};

type RegisterData = InsertUser;

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<AuthUser, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<AuthUser, Error, RegisterData>;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [isInitialized, setIsInitialized] = useState(false);

  // Get saved user ID once on mount
  const savedUserId = localStorage.getItem('userId');

  // Create headers object once
  const headers = useCallback(() => {
    const headerObj: Record<string, string> = {};
    if (savedUserId) {
      headerObj['X-User-ID'] = savedUserId;
    }
    return headerObj;
  }, [savedUserId]);

  // Disable the query until initialization is complete
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<AuthUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({
      on401: "returnNull",
      headers: headers()
    }),
    enabled: isInitialized,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 30000, // 30 seconds
  });

  // Initialize auth state
  useEffect(() => {
    if (!isInitialized) {
      setIsInitialized(true);
    }
  }, [isInitialized]);

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      const data = await res.json();
      return data;
    },
    onSuccess: (user: AuthUser) => {
      console.log("Login success, user data:", user);
      queryClient.setQueryData(["/api/user"], user);

      // Store userId in localStorage for persistence
      if (user?.id) {
        localStorage.setItem('userId', user.id.toString());
        console.log('Saved userId to localStorage:', user.id);
      }

      toast({
        title: "Login successful",
        description: "Welcome back!",
      });

      // Verify that the user is stored in the query cache
      setTimeout(() => {
        const cachedUser = queryClient.getQueryData(["/api/user"]);
        console.log("Cached user data after login:", cachedUser);
      }, 500);
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message || "Invalid username or password",
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: RegisterData) => {
      const res = await apiRequest("POST", "/api/register", credentials);
      const data = await res.json();
      return data;
    },
    onSuccess: (user: AuthUser) => {
      queryClient.setQueryData(["/api/user"], user);

      // Store userId in localStorage for persistence
      if (user?.id) {
        localStorage.setItem('userId', user.id.toString());
        console.log('Saved userId to localStorage after registration:', user.id);
      }

      toast({
        title: "Registration successful",
        description: "Your account has been created!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message || "Username might already be taken",
        variant: "destructive",
      });
    },
  });

  // Create a stable logout function that won't cause infinite loops
  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Immediately clear local state to prevent loops
      localStorage.removeItem('userId');

      // Set user to null directly instead of invalidating
      queryClient.setQueryData(['/api/user'], null);

      try {
        // Then try to logout via the API
        const response = await fetch('/api/logout', {
          method: 'POST',
          credentials: 'include',
        });

        if (!response.ok) {
          console.error('Logout request failed but continuing anyway');
          return { success: true };
        }

        return await response.json();
      } catch (error) {
        console.error('Logout error:', error);
        // Return success even if the API call fails
        // This prevents the mutation from going to an error state
        return { success: true };
      }
    },
    onSuccess: (data) => {
      // Show success message
      toast({
        title: 'Logged out',
        description: 'You have been logged out successfully.',
      });

      // Redirect based on the response from the server
      if (data && data.redirectTo) {
        navigate(data.redirectTo);
      }
    },
    // No onError handler to prevent additional state updates
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
