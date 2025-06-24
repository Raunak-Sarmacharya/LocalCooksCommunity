import { Button } from "@/components/ui/button";
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
import { checkUserExistsByEmail } from "@/utils/user-existence-check";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSuccess?: () => void;
  setHasAttemptedLogin?: (v: boolean) => void;
}

export default function LoginForm({ onSuccess, setHasAttemptedLogin }: LoginFormProps) {
  const { login, signInWithGoogle, loading, error } = useFirebaseAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [isCheckingUser, setIsCheckingUser] = useState(false);
  
  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Check user existence when email changes
  const checkUserExistence = async (email: string) => {
    if (!email || !email.includes('@')) {
      setUserExists(null);
      return;
    }

    setIsCheckingUser(true);
    try {
      const result = await checkUserExistsByEmail(email);
      setUserExists(result.exists && result.canSignIn);
    } catch (error) {
      console.error('Error checking user existence:', error);
      setUserExists(null);
    } finally {
      setIsCheckingUser(false);
    }
  };

  const onSubmit = async (data: LoginFormData) => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    try {
      console.log('🟦 REGULAR LOGIN FORM ATTEMPT:', data.email);
      await login(data.email, data.password);
      console.log('✅ REGULAR LOGIN SUCCESS');
      if (onSuccess) onSuccess(); // Auth page will handle verification and redirect
    } catch (e: any) {
      console.log('❌ REGULAR LOGIN ERROR:', e.message);
      
      // Handle different Firebase error types with user-friendly messages
      if (e.message.includes('invalid-credential') || e.message.includes('wrong-password') || e.message.includes('user-not-found')) {
        setFormError("Invalid email or password. Please check your credentials and try again.");
      } else if (e.message.includes('user-disabled')) {
        setFormError("This account has been disabled. Please contact support.");
      } else if (e.message.includes('too-many-requests')) {
        setFormError("Too many failed attempts. Please wait a moment before trying again.");
      } else if (e.message.includes('EMAIL_NOT_VERIFIED') || e.message.includes('email')) {
        setFormError("Please verify your email address before signing in. Check your inbox for a verification link.");
      } else {
        setFormError("Sign-in failed. Please check your credentials or register for a new account.");
      }
    }
  };

  const getButtonText = () => {
    if (userExists === true) {
      return "Welcome back!";
    } else {
      return "Sign in to your account";
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Google Auth Button */}
      <Button
        type="button"
        className="w-full h-12 flex items-center justify-center gap-3 bg-white border border-gray-200 text-gray-700 font-medium shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 rounded-xl"
        onClick={async () => { 
          setHasAttemptedLogin?.(true); 
          setFormError(null); // Clear any previous errors
          try {
            await signInWithGoogle(false);
          } catch (e: any) {
            console.log('❌ GOOGLE SIGN-IN ERROR:', e.message);
            
            // Handle Google sign-in errors with user-friendly messages
            if (e.message.includes('popup-closed-by-user')) {
              setFormError("Sign-in was cancelled. Please try again.");
            } else if (e.message.includes('popup-blocked')) {
              setFormError("Pop-up blocked. Please allow pop-ups for this site and try again.");
            } else if (e.message.includes('network-request-failed')) {
              setFormError("Network error. Please check your connection and try again.");
            } else if (e.message.includes('not registered')) {
              setFormError("This Google account is not registered. Please create an account first.");
            } else {
              setFormError("Google sign-in failed. Please try again or use email/password.");
            }
          }
        }}
        disabled={loading}
        aria-label="Continue with Google"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" className="flex-shrink-0">
          <g>
            <path fill="#4285F4" d="M24 9.5c3.54 0 6.7 1.22 9.19 3.23l6.85-6.85C35.64 2.36 30.18 0 24 0 14.82 0 6.73 5.48 2.69 13.44l7.98 6.2C12.13 13.13 17.62 9.5 24 9.5z"/>
            <path fill="#34A853" d="M46.1 24.55c0-1.64-.15-3.22-.43-4.74H24v9.01h12.42c-.54 2.9-2.18 5.36-4.65 7.01l7.19 5.6C43.98 37.36 46.1 31.44 46.1 24.55z"/>
            <path fill="#FBBC05" d="M10.67 28.65c-1.01-2.99-1.01-6.31 0-9.3l-7.98-6.2C.99 17.36 0 20.57 0 24c0 3.43.99 6.64 2.69 9.44l7.98-6.2z"/>
            <path fill="#EA4335" d="M24 48c6.18 0 11.64-2.04 15.54-5.56l-7.19-5.6c-2.01 1.35-4.59 2.16-8.35 2.16-6.38 0-11.87-3.63-14.33-8.94l-7.98 6.2C6.73 42.52 14.82 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </g>
        </svg>
        <span className="text-sm">Continue with Google</span>
      </Button>

      {/* Divider */}
      <div className="relative flex items-center">
        <div className="flex-grow border-t border-gray-200"></div>
        <span className="flex-shrink mx-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Or</span>
        <div className="flex-grow border-t border-gray-200"></div>
      </div>

      {/* Login Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {formError && (
            <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex items-start gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 flex items-center justify-center mt-0.5">
                <Lock className="w-3 h-3 text-red-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Authentication failed</p>
                <p className="text-xs text-red-600 mt-1">{formError}</p>
              </div>
            </div>
          )}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel className="text-sm font-semibold text-gray-900">Email address</FormLabel>
                <FormControl>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors pointer-events-none" />
                    <Input
                      className="pl-11 h-12 border-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all duration-200 text-sm placeholder:text-gray-400"
                      placeholder="you@company.com"
                      autoComplete="email"
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        const email = e.target.value;
                        // Clear errors when user starts typing
                        if (formError) {
                          setFormError(null);
                        }
                        if (email && email.includes('@')) {
                          checkUserExistence(email);
                        }
                      }}
                    />
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
                {/* User existence status */}
                {(isCheckingUser || userExists !== null) && form.watch('email') && form.watch('email').includes('@') && (
                  <div className="mt-2 text-xs">
                    {isCheckingUser ? (
                      <span className="text-gray-500">Checking account...</span>
                    ) : userExists === true ? (
                      <span className="text-green-600">✓ Account found - welcome back!</span>
                    ) : userExists === false ? (
                      <span className="text-amber-600">⚠ No account found - you may need to register first</span>
                    ) : null}
                  </div>
                )}
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel className="text-sm font-semibold text-gray-900">Password</FormLabel>
                <FormControl>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors pointer-events-none" />
                    <Input
                      type="password"
                      className="pl-11 h-12 border-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all duration-200 text-sm placeholder:text-gray-400"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      {...field}
                      onChange={(e) => {
                        field.onChange(e);
                        // Clear errors when user starts typing
                        if (formError) {
                          setFormError(null);
                        }
                      }}
                    />
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

          <Button 
            type="submit" 
            className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all duration-200 text-sm" 
            disabled={loading}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing in...</span>
              </div>
            ) : (
              getButtonText()
            )}
          </Button>
        </form>
      </Form>
      
      {/* Forgot Password Link */}
      <div className="text-center">
        <Button
          type="button"
          variant="ghost"
          className="text-sm text-blue-600 hover:text-blue-700 font-medium p-0 h-auto hover:bg-transparent hover:underline"
        >
          Forgot your password?
        </Button>
      </div>
    </div>
  );
}