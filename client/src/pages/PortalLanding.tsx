import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, MapPin, Loader2, ArrowRight, Calendar, Lock, User, ChefHat } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient } from "@/lib/queryClient";

interface PublicLocation {
  id: number;
  name: string;
  address: string;
  logoUrl?: string | null;
  slug: string;
}

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function PortalLanding() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"booking" | "login">("booking");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch all public locations
  const { data: locations, isLoading, error } = useQuery<PublicLocation[]>({
    queryKey: ["/api/public/locations"],
    queryFn: async () => {
      const response = await fetch("/api/public/locations");
      if (!response.ok) throw new Error("Failed to fetch locations");
      return response.json();
    },
  });

  // Check if manager is already logged in
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
            return null;
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return {
          ...userData,
          authMethod: 'session'
        };
      } catch (error) {
        console.error('PortalLanding - Session auth error:', error);
        return null;
      }
    },
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const user = sessionUser;
  const isManager = user?.role === 'manager';

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const handleLocationClick = (slug: string) => {
    setLocation(`/portal/${slug}`);
  };

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    
    try {
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
        throw new Error(errorData.error || 'Manager login failed');
      }
      
      const userData = await response.json();
      
      if (!userData?.id || userData.role !== 'manager') {
        throw new Error('Invalid user data returned - must be manager');
      }

      localStorage.setItem('userId', userData.id.toString());
      queryClient.clear();
      
      // Redirect based on password change requirement
      let redirectPath;
      if (userData.has_seen_welcome === false) {
        redirectPath = '/manager/change-password';
      } else {
        redirectPath = '/manager/dashboard';
      }
      
      window.location.href = redirectPath;
      
    } catch (error: any) {
      console.error('Manager login error:', error);
      setErrorMessage(error.message || 'Failed to login');
    } finally {
      setIsSubmitting(false);
    }
  };

  // If manager is already logged in, redirect
  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (isManager) {
    if ((user as any)?.has_seen_welcome === false) {
      window.location.href = '/manager/change-password';
      return null;
    }
    window.location.href = '/manager/dashboard';
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Logo className="h-10 w-auto" />
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Local Cooks Community</h1>
                <p className="text-sm text-gray-600">Commercial Kitchen Booking & Management</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-blue-600" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-6">
              <Building2 className="h-8 w-8 text-blue-600" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Commercial Kitchen Portal
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Book a kitchen for your culinary needs or manage your commercial kitchen location
            </p>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "booking" | "login")} className="w-full">
            <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-8">
              <TabsTrigger value="booking" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Book a Kitchen
              </TabsTrigger>
              <TabsTrigger value="login" className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Manager Login
              </TabsTrigger>
            </TabsList>

            {/* Booking Tab */}
            <TabsContent value="booking" className="mt-6">
              <div className="space-y-8">
                {/* Locations List */}
                {isLoading && (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  </div>
                )}

                {error && (
                  <div className="text-center py-20">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md mx-auto">
                      <p className="text-red-800 font-medium">Failed to load locations</p>
                      <p className="text-red-600 text-sm mt-2">
                        Please try refreshing the page or contact support.
                      </p>
                    </div>
                  </div>
                )}

                {locations && locations.length === 0 && (
                  <div className="text-center py-20">
                    <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">No Locations Available</h3>
                    <p className="text-gray-600">There are currently no locations available for booking.</p>
                  </div>
                )}

                {locations && locations.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {locations.map((location) => (
                      <Card
                        key={location.id}
                        className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:border-blue-300 border-2"
                        onClick={() => handleLocationClick(location.slug)}
                      >
                        <CardHeader>
                          <div className="flex items-start justify-between mb-2">
                            {location.logoUrl && (
                              <img
                                src={location.logoUrl}
                                alt={`${location.name} logo`}
                                className="h-12 w-auto object-contain"
                              />
                            )}
                            <Building2 className={`h-6 w-6 text-blue-600 ${location.logoUrl ? 'ml-auto' : ''}`} />
                          </div>
                          <CardTitle className="text-xl">{location.name}</CardTitle>
                          <CardDescription className="flex items-start gap-2 mt-2">
                            <MapPin className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{location.address}</span>
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Button
                            className="w-full group"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLocationClick(location.slug);
                            }}
                          >
                            View Kitchens
                            <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Info Section */}
                <div className="mt-12">
                  <div className="bg-white rounded-lg shadow-md p-8 border border-gray-200">
                    <h3 className="text-2xl font-semibold text-gray-900 mb-4">How It Works</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-3">
                          <span className="text-blue-600 font-bold">1</span>
                        </div>
                        <h4 className="font-semibold text-gray-900 mb-2">Choose a Location</h4>
                        <p className="text-sm text-gray-600">
                          Browse available commercial kitchen locations in your area.
                        </p>
                      </div>
                      <div className="text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-3">
                          <span className="text-blue-600 font-bold">2</span>
                        </div>
                        <h4 className="font-semibold text-gray-900 mb-2">Select Date & Time</h4>
                        <p className="text-sm text-gray-600">
                          Choose a kitchen, date, and available time slot that works for you.
                        </p>
                      </div>
                      <div className="text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-3">
                          <span className="text-blue-600 font-bold">3</span>
                        </div>
                        <h4 className="font-semibold text-gray-900 mb-2">Submit Booking</h4>
                        <p className="text-sm text-gray-600">
                          Fill in your details and submit your booking request.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Manager Login Tab */}
            <TabsContent value="login" className="mt-6">
              <div className="max-w-md mx-auto">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4 mx-auto">
                      <Lock className="h-6 w-6 text-blue-600" />
                    </div>
                    <CardTitle className="text-2xl text-center">Manager Login</CardTitle>
                    <CardDescription className="text-center">
                      Sign in to access your commercial kitchen dashboard
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                        {errorMessage && (
                          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
                            <div className="flex items-center gap-3">
                              <div className="flex-shrink-0 w-5 h-5 bg-red-100 rounded-full flex items-center justify-center">
                                <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </div>
                              <p className="text-sm font-medium text-red-800">{errorMessage}</p>
                            </div>
                          </div>
                        )}

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

                        <div className="text-center">
                          <a
                            href="/password-reset?role=manager"
                            className="text-sm text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                          >
                            Forgot your password?
                          </a>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>

                {/* Manager Features */}
                <div className="mt-8 bg-white rounded-lg shadow-md p-6 border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Manager Features</h3>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      Manage kitchen availability and bookings
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      Review and approve chef profiles
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      Track booking analytics and insights
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      Configure location settings and policies
                    </li>
                  </ul>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-white mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <Logo className="h-8 w-auto mb-2" />
              <p className="text-sm text-gray-400">Commercial Kitchen Booking Platform</p>
            </div>
            <div className="text-sm text-gray-400">
              © {new Date().getFullYear()} Local Cooks Community. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
