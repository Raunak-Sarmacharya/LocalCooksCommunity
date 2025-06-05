import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";

function GooglePasswordDialog({
  open,
  onOpenChange,
  displayName,
  onSubmit,
  loading,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  onSubmit: (password: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const { register, handleSubmit } = useForm<{ password: string }>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter Password</DialogTitle>
          <DialogDescription>
            {`Welcome, ${displayName}. Please enter your password to continue.`}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) => onSubmit(data.password))}
          className="space-y-4"
        >
          <Input
            type="password"
            placeholder="Password"
            {...register("password", { required: true })}
            disabled={loading}
          />
          {error && <div className="text-red-500 text-sm">{error}</div>}
          <DialogFooter>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Processing..." : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const { user, loginMutation, registerMutation } = useAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);
  const [googleDisplayName, setGoogleDisplayName] = useState("");
  const [googlePasswordLoading, setGooglePasswordLoading] = useState(false);
  const [googlePasswordError, setGooglePasswordError] = useState<string | null>(null);
  const [googleIsSignup, setGoogleIsSignup] = useState(false);
  
  // Get redirect path from URL if it exists
  const getRedirectPath = () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const redirectPath = urlParams.get('redirect') || '/';
      console.log('Redirect path from URL:', redirectPath);
      return redirectPath;
    } catch (error) {
      console.error('Error parsing redirect URL:', error);
      return '/';
    }
  };

  // Redirect to the appropriate page if already logged in
  if (user) {
    console.log('User is already logged in:', user);
    const redirectPath = getRedirectPath();
    console.log('Redirecting to:', redirectPath);
    setLocation(redirectPath);
    return null;
  }

  const handleSuccess = () => {
    console.log('Authentication successful');
    const redirectPath = getRedirectPath();
    console.log('Redirecting to:', redirectPath);
    
    // Delay redirect slightly to ensure session is established
    setTimeout(() => {
      setLocation(redirectPath);
    }, 500);
  };

  const handleGoogleSignIn = async () => {
    if (!auth) {
      setGoogleError("Sorry, Google authentication is not configured for development environment!");
      return;
    }
    
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const displayName = result.user.displayName || result.user.email || "";
      setGoogleDisplayName(displayName);
      // Check if user exists
      const existsRes = await fetch(`/api/user-exists?username=${encodeURIComponent(displayName)}`);
      const existsData = await existsRes.json();
      setGoogleIsSignup(!existsData.exists);
      setGoogleDialogOpen(true);
    } catch (error: any) {
      setGoogleError(error.message || "Google sign-in failed");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGooglePasswordSubmit = async (password: string) => {
    setGooglePasswordLoading(true);
    setGooglePasswordError(null);
    
    const credentials = { 
      username: googleDisplayName, 
      password,
      role: "applicant" as const
    };
    
    if (googleIsSignup) {
      // Use registerMutation from useAuth
      registerMutation.mutate(credentials, {
        onSuccess: () => {
          setGoogleDialogOpen(false);
          handleSuccess();
        },
        onError: (error) => {
          setGooglePasswordError(error.message);
        },
        onSettled: () => {
          setGooglePasswordLoading(false);
        }
      });
    } else {
      // Use loginMutation from useAuth
      loginMutation.mutate(credentials, {
        onSuccess: () => {
          setGoogleDialogOpen(false);
          handleSuccess();
        },
        onError: (error) => {
          setGooglePasswordError(error.message);
        },
        onSettled: () => {
          setGooglePasswordLoading(false);
        }
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Form Section */}
      <div className="w-full md:w-1/2 p-8 flex flex-col justify-center">
        <div className="max-w-md mx-auto w-full">
          <div className="mb-8">
            <Logo className="h-12 mb-6" />
            <h1 className="text-2xl font-bold tracking-tight">
              {activeTab === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {activeTab === "login"
                ? "Enter your credentials to access your account"
                : "Sign up to track your application status"}
            </p>
          </div>

          <Tabs
            defaultValue="login"
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "login" | "register")}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <LoginForm onSuccess={handleSuccess} />
            </TabsContent>
            <TabsContent value="register">
              <RegisterForm onSuccess={handleSuccess} />
            </TabsContent>
          </Tabs>
          
          {/* Social Login Buttons */}
          <div className="flex flex-col gap-3 mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-muted-foreground/20"></span>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-[#4285F4] text-[#4285F4] hover:bg-[#4285F4]/10"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
            >
              <svg width="20" height="20" viewBox="0 0 48 48" className="mr-2"><g><path fill="#4285F4" d="M24 9.5c3.54 0 6.73 1.22 9.24 3.23l6.9-6.9C36.68 2.36 30.7 0 24 0 14.82 0 6.73 5.06 2.69 12.44l8.06 6.26C12.6 13.13 17.88 9.5 24 9.5z"/><path fill="#34A853" d="M46.1 24.5c0-1.64-.15-3.22-.42-4.74H24v9.04h12.4c-.54 2.9-2.18 5.36-4.64 7.04l7.18 5.6C43.98 37.36 46.1 31.36 46.1 24.5z"/><path fill="#FBBC05" d="M10.75 28.7c-1.1-3.2-1.1-6.7 0-9.9l-8.06-6.26C.9 16.36 0 20.06 0 24c0 3.94.9 7.64 2.69 11.46l8.06-6.26z"/><path fill="#EA4335" d="M24 48c6.7 0 12.68-2.22 16.9-6.06l-7.18-5.6c-2.02 1.36-4.6 2.16-7.72 2.16-6.12 0-11.3-3.63-13.25-8.7l-8.06 6.26C6.73 42.94 14.82 48 24 48z"/></g></svg>
              {googleLoading ? "Signing in..." : "Continue with Google"}
            </Button>
            {googleError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-500">{googleError}</div>
            )}
            <GooglePasswordDialog
              open={googleDialogOpen}
              onOpenChange={setGoogleDialogOpen}
              displayName={googleDisplayName}
              onSubmit={handleGooglePasswordSubmit}
              loading={googlePasswordLoading}
              error={googlePasswordError}
            />

          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="w-full md:w-1/2 bg-primary p-8 flex items-center hidden md:flex">
        <div className="max-w-md mx-auto text-white">
          <h2 className="text-3xl font-bold mb-4">Join Local Cooks</h2>
          <p className="text-white/90 mb-6">
            Apply to become a certified cook and start your culinary journey with
            us. Create an account to track your application status and get
            updates on your approval process.
          </p>
          <ul className="space-y-3">
            <li className="flex items-center">
              <div className="rounded-full bg-white/20 p-1 mr-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              Monitor your application progress
            </li>
            <li className="flex items-center">
              <div className="rounded-full bg-white/20 p-1 mr-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              Receive updates on your status
            </li>
            <li className="flex items-center">
              <div className="rounded-full bg-white/20 p-1 mr-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              Manage your cook profile
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}