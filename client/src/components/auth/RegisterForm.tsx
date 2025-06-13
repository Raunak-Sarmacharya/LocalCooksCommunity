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
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Mail, User } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(2, "Name required"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

interface RegisterFormProps {
  onSuccess?: () => void;
  setHasAttemptedLogin?: (v: boolean) => void;
}

export default function RegisterForm({ onSuccess, setHasAttemptedLogin }: RegisterFormProps) {
  const { signup, signInWithGoogle, loading, error } = useFirebaseAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", displayName: "" },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    try {
      await signup(data.email, data.password, data.displayName);
      if (onSuccess) onSuccess();
    } catch (e: any) {
      setFormError(e.message);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Google Auth Button */}
      <Button
        type="button"
        className="w-full h-12 flex items-center justify-center gap-3 bg-white border border-gray-200 text-gray-700 font-medium shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 rounded-xl"
        onClick={() => { setHasAttemptedLogin?.(true); signInWithGoogle(); }}
        disabled={loading}
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
        <span className="text-sm">Create account with Google</span>
      </Button>

      {/* Divider */}
      <div className="relative flex items-center">
        <div className="flex-grow border-t border-gray-200"></div>
        <span className="flex-shrink mx-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Or</span>
        <div className="flex-grow border-t border-gray-200"></div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {(formError || error) && (
            <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex items-start gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 flex items-center justify-center mt-0.5">
                <Lock className="w-3 h-3 text-red-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Registration failed</p>
                <p className="text-xs text-red-600 mt-1">{formError || error}</p>
              </div>
            </div>
          )}

          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel className="text-sm font-semibold text-gray-900">Full name</FormLabel>
                <FormControl>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors pointer-events-none" />
                    <Input 
                      className="pl-11 h-12 border-gray-200 rounded-xl bg-gray-50/50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all duration-200 text-sm placeholder:text-gray-400" 
                      placeholder="John Doe" 
                      {...field} 
                    />
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />

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
                    />
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
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
                      placeholder="Create a secure password" 
                      autoComplete="new-password"
                      {...field} 
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
                <span>Creating account...</span>
              </div>
            ) : (
              "Create your account"
            )}
          </Button>

          {/* Terms and Privacy */}
          <p className="text-xs text-gray-500 text-center leading-relaxed">
            By creating an account, you agree to our{' '}
            <button type="button" className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
              Terms of Service
            </button>
            {' '}and{' '}
            <button type="button" className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
              Privacy Policy
            </button>
          </p>
        </form>
      </Form>
    </div>
  );
}