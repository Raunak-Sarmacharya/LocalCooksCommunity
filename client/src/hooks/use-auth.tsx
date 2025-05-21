import { createContext, ReactNode, useContext, useEffect } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { User, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

  // Check for stored userId in localStorage on initial load
  const savedUserId = localStorage.getItem('userId');

  // Custom headers to include userId if available
  const headers: Record<string, string> = {};
  if (savedUserId) {
    headers['X-User-ID'] = savedUserId;
    console.log('Found userId in localStorage, adding to headers:', savedUserId);
  }

  // Function to ensure userId is in localStorage
  const ensureUserIdInStorage = (user: AuthUser | null) => {
    if (user?.id) {
      const currentStoredId = localStorage.getItem('userId');
      if (currentStoredId !== user.id.toString()) {
        localStorage.setItem('userId', user.id.toString());
        console.log('Updated userId in localStorage:', user.id);
      }
    }
  }

  const {
    data: user,
    error,
    isLoading,
  } = useQuery<AuthUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({
      on401: "returnNull",
      headers
    })
  });

  // Store user ID in localStorage whenever it changes
  useEffect(() => {
    if (user) {
      ensureUserIdInStorage(user);
    }
  }, [user]);

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

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      // Clear user from query cache
      queryClient.setQueryData(["/api/user"], null);

      // Clear user ID from localStorage for persistence
      localStorage.removeItem('userId');
      console.log('Cleared userId from localStorage on logout');

      toast({
        title: "Logout successful",
        description: "You have been logged out",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
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