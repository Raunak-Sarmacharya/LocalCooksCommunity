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
import clsx from "clsx";
import { ArrowLeft, CheckCircle2, Loader2, Lock, Mail } from "lucide-react";
import { useEffect, useState } from "react";
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
  const { login, signInWithGoogle, loading, error, sendEmailLink, handleEmailLinkSignIn } = useFirebaseAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [showEmailLink, setShowEmailLink] = useState(false);
  const [emailForLink, setEmailForLink] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    handleEmailLinkSignIn().then(() => {
      if (onSuccess) onSuccess();
    });
    // eslint-disable-next-line
  }, []);

  const onSubmit = async (data: LoginFormData) => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    try {
      await login(data.email, data.password);
      if (onSuccess) onSuccess();
    } catch (e: any) {
      setFormError(e.message);
    }
  };

  const handleSendEmailLink = async () => {
    setFormError(null);
    try {
      await sendEmailLink(emailForLink);
      setLinkSent(true);
    } catch (e: any) {
      setFormError(e.message);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto animate-fade-in">
      {/* Google Auth Button */}
      <Button
        type="button"
        className="w-full mb-5 flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-900 font-semibold shadow-sm hover:bg-gray-50 transition"
        style={{ boxShadow: "0 1px 2px rgba(60,64,67,.08)" }}
        onClick={() => { setHasAttemptedLogin?.(true); signInWithGoogle(); }}
        disabled={loading}
        aria-label="Continue with Google"
      >
        {/* Inline Google SVG icon from the internet */}
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 48 48">
          <g>
            <path fill="#4285F4" d="M24 9.5c3.54 0 6.7 1.22 9.19 3.23l6.85-6.85C35.64 2.36 30.18 0 24 0 14.82 0 6.73 5.48 2.69 13.44l7.98 6.2C12.13 13.13 17.62 9.5 24 9.5z"/>
            <path fill="#34A853" d="M46.1 24.55c0-1.64-.15-3.22-.43-4.74H24v9.01h12.42c-.54 2.9-2.18 5.36-4.65 7.01l7.19 5.6C43.98 37.36 46.1 31.44 46.1 24.55z"/>
            <path fill="#FBBC05" d="M10.67 28.65c-1.01-2.99-1.01-6.31 0-9.3l-7.98-6.2C.99 17.36 0 20.57 0 24c0 3.43.99 6.64 2.69 9.44l7.98-6.2z"/>
            <path fill="#EA4335" d="M24 48c6.18 0 11.64-2.04 15.54-5.56l-7.19-5.6c-2.01 1.35-4.59 2.16-8.35 2.16-6.38 0-11.87-3.63-14.33-8.94l-7.98 6.2C6.73 42.52 14.82 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </g>
        </svg>
        Continue with Google
      </Button>

      {/* Divider */}
      <div className="flex items-center my-6">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="mx-3 text-gray-400 text-xs uppercase tracking-wider">or</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* Animated Section Switch */}
      <div className={clsx("transition-all duration-300", showEmailLink ? "opacity-100" : "")}>
        {!showEmailLink ? (
          <>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                {(formError || error) && (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    {formError || error}
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <Input
                            className="pl-10"
                            placeholder="Enter your email"
                            autoComplete="email"
                            {...field}
                          />
                        </div>
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
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <Input
                            type="password"
                            className="pl-10"
                            placeholder="Enter your password"
                            autoComplete="current-password"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
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
            <div className="mt-4 text-center">
              <Button
                type="button"
                variant="ghost"
                className="w-full text-blue-600 hover:underline font-medium"
                onClick={() => setShowEmailLink(true)}
                aria-label="Sign in with email link (passwordless)"
              >
                <Mail className="w-4 h-4 mr-2 inline" />
                Sign in with email link (passwordless)
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-5 animate-fade-in">
            {linkSent ? (
              <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Email link sent! Check your inbox.
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="email-link" className="block text-sm font-medium text-gray-700 mb-1">
                    Email for sign-in link
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="email-link"
                      type="email"
                      placeholder="Enter your email"
                      value={emailForLink}
                      onChange={e => setEmailForLink(e.target.value)}
                      disabled={loading}
                      className="pl-10"
                      autoComplete="email"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">We'll send a secure sign-in link to your email.</p>
                </div>
                <Button
                  type="button"
                  className="w-full mt-2"
                  onClick={handleSendEmailLink}
                  disabled={loading || !emailForLink}
                  aria-label="Send sign-in link"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                  Send sign-in link
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full mt-2 text-gray-600 hover:text-blue-600 flex items-center justify-center"
                  onClick={() => setShowEmailLink(false)}
                  aria-label="Back to password login"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to password login
                </Button>
              </>
            )}
            {formError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-500 flex items-center gap-2">
                <Lock className="w-4 h-4" />
                {formError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}