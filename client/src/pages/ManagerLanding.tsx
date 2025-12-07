import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import { Building2, Loader2, Lock, ArrowRight, Calendar, Users, Settings } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";

export default function ManagerLanding() {
  const [, setLocation] = useLocation();

  // Check if manager is logged in
  const { data: sessionUser, isLoading } = useQuery({
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
        console.error('ManagerLanding - Session auth error:', error);
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

  // Show loading while checking session
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-2" />
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If not logged in, show welcome page with login option
  if (!isManager) {
    return (
      <GradientHero variant="cool" className="min-h-screen">
        {/* Header */}
        <header className="bg-white/10 backdrop-blur-sm border-b border-white/20">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Logo className="h-10 w-auto" />
                <div>
                  <h1 className="text-xl font-semibold text-white">Manager Portal</h1>
                  <p className="text-sm text-blue-100">Commercial Kitchen Management</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <div className="container mx-auto px-4 py-16">
          <FadeInSection>
            <div className="max-w-4xl mx-auto text-center mb-16">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 rounded-full mb-8 backdrop-blur-sm">
                <Building2 className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-5xl md:text-6xl font-bold text-white mb-6">
                Manage Your Commercial Kitchen
              </h2>
            <p className="text-xl text-blue-100 max-w-2xl mx-auto mb-8">
              Access your dashboard to manage bookings, availability, chef profiles, and location settings.
            </p>
              <Button
                size="lg"
                className="bg-white text-blue-600 hover:bg-blue-50 text-lg px-8 py-6 h-auto btn-glow"
                onClick={() => setLocation("/manager/login")}
              >
                <Lock className="mr-2 h-5 w-5" />
                Sign In to Your Dashboard
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </FadeInSection>

          {/* Features */}
          <FadeInSection delay={1}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20 text-white card-hover">
              <CardHeader>
                <Calendar className="h-8 w-8 text-white mb-3" />
                <CardTitle className="text-white">Manage Bookings</CardTitle>
                <CardDescription className="text-blue-100">
                  View and manage all kitchen bookings from third-party users and chefs.
                </CardDescription>
              </CardHeader>
            </Card>

              <Card className="bg-white/10 backdrop-blur-sm border-white/20 text-white card-hover">
                <CardHeader>
                  <Settings className="h-8 w-8 text-white mb-3" />
                  <CardTitle className="text-white">Set Availability</CardTitle>
                  <CardDescription className="text-blue-100">
                    Configure kitchen availability, time slots, and booking policies.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-white/10 backdrop-blur-sm border-white/20 text-white card-hover">
                <CardHeader>
                  <Users className="h-8 w-8 text-white mb-3" />
                  <CardTitle className="text-white">Chef Profiles</CardTitle>
                  <CardDescription className="text-blue-100">
                    Review and manage chef profiles and access permissions.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </FadeInSection>
        </div>
      </GradientHero>
    );
  }

  // If logged in as manager, redirect to dashboard
  if (isManager) {
    // Check if they need to change password
    if ((user as any)?.has_seen_welcome === false) {
      return <Redirect to="/manager/change-password" />;
    }
    return <Redirect to="/manager/dashboard" />;
  }

  // Fallback - should not reach here
  return <Redirect to="/manager/login" />;
}

