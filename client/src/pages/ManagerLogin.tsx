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
import Logo from "@/components/ui/logo";
import { queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, Lock, User } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Redirect } from "wouter";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

const registerSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  email: z.string().email("Valid email is required").optional(),
  name: z.string().min(1, "Name is required").optional(),
});

type RegisterFormData = z.infer<typeof registerSchema>;

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
  const [isRegistering, setIsRegistering] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      email: "",
      name: "",
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

  const onRegister = async (data: RegisterFormData) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      console.log('Attempting manager registration with username:', data.username);
      const response = await fetch('/api/manager-register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: data.username,
          password: data.password,
          email: data.email,
          name: data.name,
        }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Manager registration failed:', errorData);
        throw new Error(errorData.error || 'Manager registration failed');
      }
      
      const userData = await response.json();
      console.log('Manager registration successful, user data:', userData);
      
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
      
      setSuccessMessage('Account created successfully! Redirecting...');
      
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
      setTimeout(() => {
        window.location.href = redirectPath;
      }, 1500);
      
    } catch (error: any) {
      console.error('Manager registration error:', error);
      setErrorMessage(error.message || 'Failed to register');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show loading while checking session
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col md:flex-row bg-gray-50"
    >
      {/* Form Section */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="w-full md:w-1/2 p-8 flex flex-col justify-center bg-white"
      >
        <div className="max-w-md mx-auto w-full">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mb-8"
          >
            <Logo className="h-12 mb-6" />
            <motion.h1
              className="text-3xl font-bold tracking-tight text-gray-900"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {isRegistering ? 'Create Manager Account' : 'Welcome back'}
            </motion.h1>
            <motion.p
              className="text-gray-600 mt-2 leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              {isRegistering 
                ? 'Sign up to access your commercial kitchen dashboard and manage your location'
                : 'Sign in to access your commercial kitchen dashboard and manage your location'}
            </motion.p>
            
            {/* Toggle between login and register */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.2 }}
              className="mt-4"
            >
              <button
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  form.reset();
                  registerForm.reset();
                }}
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline transition-colors"
              >
                {isRegistering 
                  ? 'Already have an account? Sign in' 
                  : "Don't have an account? Sign up"}
              </button>
            </motion.div>
          </motion.div>

          {/* Form Content */}
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {isRegistering ? (
              <Form {...registerForm}>
                <form
                  onSubmit={registerForm.handleSubmit(onRegister)}
                  className="space-y-5"
                  noValidate
                >
                  {errorMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className="rounded-xl bg-red-50 border border-red-200 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-5 h-5 bg-red-100 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-red-800">{errorMessage}</p>
                      </div>
                    </motion.div>
                  )}
                  
                  {successMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className="rounded-xl bg-green-50 border border-green-200 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-green-800">{successMessage}</p>
                      </div>
                    </motion.div>
                  )}

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={registerForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium text-gray-700">Username</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                              <Input
                                placeholder="Choose a username"
                                {...field}
                                disabled={isSubmitting}
                                className="pl-10 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 h-11"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium text-gray-700">Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                              <Input
                                type="password"
                                placeholder="Create a password (min 8 characters)"
                                {...field}
                                disabled={isSubmitting}
                                className="pl-10 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 h-11"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium text-gray-700">Email (optional)</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                              <Input
                                type="email"
                                placeholder="your@email.com"
                                {...field}
                                disabled={isSubmitting}
                                className="pl-10 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 h-11"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={registerForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium text-gray-700">Full Name (optional)</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                              <Input
                                placeholder="Your full name"
                                {...field}
                                disabled={isSubmitting}
                                className="pl-10 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 h-11"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <Button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-medium text-base transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating account...
                        </span>
                      ) : (
                        "Create Account"
                      )}
                    </Button>
                  </motion.div>
                </form>
              </Form>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-5"
                  noValidate
                >
                  {errorMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className="rounded-xl bg-red-50 border border-red-200 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-5 h-5 bg-red-100 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-red-800">{errorMessage}</p>
                      </div>
                    </motion.div>
                  )}

                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-gray-700">Username</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <Input
                              placeholder="Enter your username"
                              {...field}
                              disabled={isSubmitting}
                              className="pl-10 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 h-11"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>

                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-gray-700">Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <Input
                              type="password"
                              placeholder="Enter your password"
                              {...field}
                              disabled={isSubmitting}
                              className="pl-10 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 h-11"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>

                <motion.div variants={itemVariants}>
                  <Button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-medium text-base transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Signing in...
                      </span>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </motion.div>

                  <motion.div variants={itemVariants} className="text-center">
                    <Link
                      href="/forgot-password?role=manager"
                      className="text-sm text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                    >
                      Forgot your password?
                    </Link>
                  </motion.div>
                </form>
              </Form>
            )}

            {/* Footer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="mt-8 text-center"
            >
              <p className="text-sm text-gray-500">
                Partner commercial kitchen access only
              </p>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="w-full md:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 p-8 flex items-center hidden md:flex relative overflow-hidden"
      >
        {/* Background Pattern */}
        <motion.div
          className="absolute inset-0 opacity-10"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.1 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          <div className="absolute top-10 left-10 w-20 h-20 bg-white rounded-full" />
          <div className="absolute top-32 right-20 w-16 h-16 bg-white rounded-full" />
          <div className="absolute bottom-20 left-20 w-12 h-12 bg-white rounded-full" />
          <div className="absolute bottom-40 right-10 w-24 h-24 bg-white rounded-full" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="max-w-md mx-auto text-white relative z-10"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mb-8"
          >
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-sm">
              <Building2 className="w-8 h-8 text-white" />
            </div>
          </motion.div>
          
          <motion.h2
            className="text-4xl font-bold mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            Manage Your Commercial Kitchen
          </motion.h2>
          
          <motion.p
            className="text-white/90 mb-8 text-lg leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            Access your partner dashboard to manage bookings, availability, and chef profiles for your commercial kitchen location.
          </motion.p>
          
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="space-y-4"
          >
            {[
              "Manage kitchen availability and bookings",
              "Review and approve chef profiles",
              "Track booking analytics and insights",
              "Configure location settings and policies"
            ].map((item, index) => (
              <motion.li
                key={index}
                className="flex items-center"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.8 + index * 0.1 }}
              >
                <motion.div
                  className="rounded-full bg-white/20 p-2 mr-4 backdrop-blur-sm"
                  whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.3)" }}
                  transition={{ duration: 0.2 }}
                >
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
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                </motion.div>
                <span>{item}</span>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
