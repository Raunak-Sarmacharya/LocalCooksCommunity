import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import Logo from "@/components/ui/logo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const { user, loading } = useFirebaseAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);

  // Get redirect path from URL if it exists
  const getRedirectPath = () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const redirectPath = urlParams.get('redirect') || '/';
      return redirectPath;
    } catch {
      return '/';
    }
  };

  // Redirect to the appropriate page if already logged in and login was attempted
  useEffect(() => {
    if (!loading && user && hasAttemptedLogin) {
      setTimeout(() => setLocation(getRedirectPath()), 500);
    }
  }, [user, loading, hasAttemptedLogin]);

  if (loading) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  // If user is already logged in and did NOT just log in, show a friendly message and options
  if (user && !hasAttemptedLogin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Logo className="h-12 mb-6" />
        <h1 className="text-2xl font-bold mb-2">You're already logged in</h1>
        <p className="mb-6 text-gray-600">
          Welcome back, <span className="font-semibold">{user.displayName || user.email}</span>!
        </p>
        <div className="flex gap-4">
          <button
            className="bg-primary text-white px-6 py-2 rounded font-semibold hover:bg-primary/90 transition"
            onClick={() => setLocation(user.role === 'admin' ? '/admin' : '/dashboard')}
          >
            Go to {user.role === 'admin' ? 'Admin Dashboard' : 'Dashboard'}
          </button>
          <button
            className="bg-gray-100 text-gray-700 px-6 py-2 rounded font-semibold hover:bg-gray-200 transition border border-gray-300"
            onClick={async () => {
              // Log out and reload to allow switching accounts
              const { logout } = await import("@/hooks/use-auth");
              await logout();
              window.location.reload();
            }}
          >
            Switch Account
          </button>
        </div>
      </div>
    );
  }

  if (user && hasAttemptedLogin) return null;

  const handleSuccess = () => {
    setHasAttemptedLogin(true);
    setTimeout(() => setLocation(getRedirectPath()), 500);
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
                ? "Sign in with Google or email to access your account"
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
              <LoginForm onSuccess={handleSuccess} setHasAttemptedLogin={setHasAttemptedLogin} />
            </TabsContent>
            <TabsContent value="register">
              <RegisterForm onSuccess={handleSuccess} setHasAttemptedLogin={setHasAttemptedLogin} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Hero Section */}
      <div className="w-full md:w-1/2 bg-primary p-8 flex items-center hidden md:flex">
        <div className="max-w-md mx-auto text-white">
          <h2 className="text-3xl font-bold mb-4">Join Local Cooks</h2>
          <p className="text-white/90 mb-6">
            Apply to become a verified cook and start your culinary journey with
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