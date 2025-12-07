import { useLocation, Redirect } from "wouter";
import { Building2, ArrowRight, Calendar, Lock, LogOut, Loader2 } from "lucide-react";
import Logo from "@/components/ui/logo";
import Preloader from "@/components/ui/Preloader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";

export default function PortalLanding() {
  const [, setLocation] = useLocation();
  const [isPortalUser, setIsPortalUser] = useState<boolean | null>(null);
  const [showPreloader, setShowPreloader] = useState(true);

  // Check if user is already logged in as portal user
  const { data: sessionUser, isLoading: sessionLoading } = useQuery({
    queryKey: ["/api/user-session"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
        });
        if (!response.ok) {
          return null;
        }
        return response.json();
      } catch (error) {
        return null;
      }
    },
    retry: false,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (sessionUser) {
      const isPortal = sessionUser?.isPortalUser || sessionUser?.is_portal_user;
      setIsPortalUser(isPortal);
      // If already logged in as portal user, redirect to portal booking page
      if (isPortal) {
        setLocation("/portal/book");
      }
    } else if (!sessionLoading && sessionUser === null) {
      setIsPortalUser(false);
    }
  }, [sessionUser, sessionLoading, setLocation]);

  const handleLogout = async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });
      setIsPortalUser(false);
      window.location.reload();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // Check if user is portal user for display purposes
  const isPortalUserForDisplay = sessionUser && (sessionUser?.isPortalUser || sessionUser?.is_portal_user);

  // If already logged in as portal user, redirect (handled in useEffect)
  if (sessionLoading || (sessionUser && isPortalUserForDisplay)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        {showPreloader && (
          <Preloader
            onComplete={() => setShowPreloader(false)}
            duration={3000}
          />
        )}
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {showPreloader && (
        <Preloader
          onComplete={() => setShowPreloader(false)}
          duration={3000}
        />
      )}
      <GradientHero variant="cool" className="min-h-screen">
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
            <div className="flex items-center gap-4">
              {!isPortalUserForDisplay && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setLocation("/portal/register")}
                    className="flex items-center gap-2"
                  >
                    Register
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setLocation("/portal/login")}
                    className="flex items-center gap-2"
                  >
                    <Lock className="h-4 w-4" />
                    Portal Login
                  </Button>
                </>
              )}
              {isPortalUserForDisplay && (
              <Button
                variant="ghost"
                onClick={() => setLocation("/portal/my-bookings")}
                className="flex items-center gap-2"
              >
                <Calendar className="h-4 w-4" />
                  My Bookings
                </Button>
              )}
              {isPortalUserForDisplay && (
                <Button
                  onClick={handleLogout}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
              </Button>
              )}
              <Button
                onClick={() => setLocation("/manager/login")}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              >
                Manager Login
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Hero Section */}
          <FadeInSection>
            <div className="text-center mb-16 mt-12">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-6">
                <Building2 className="h-10 w-10 text-blue-600" />
              </div>
              <h2 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
                Commercial Kitchen Booking
              </h2>
              <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto mb-10 leading-relaxed font-medium">
                Find and book commercial kitchens for your culinary business. Perfect for chefs, caterers, and food entrepreneurs.
              </p>
              <Button
                size="lg"
                onClick={() => setLocation("/portal/book")}
                className="flex items-center gap-2 mx-auto btn-glow"
              >
                <Calendar className="h-5 w-5" />
                Browse Available Kitchens
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          </FadeInSection>

          {/* Info Section */}
          <div className="mt-20">
            <FadeInSection delay={1}>
              <div className="bg-white rounded-3xl shadow-2xl p-10 md:p-16 border border-gray-100 card-hover relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <div className="relative z-10">
                  <div className="text-center mb-12">
                    <span className="inline-block text-blue-600 font-semibold mb-4 font-mono text-xs md:text-sm uppercase tracking-widest px-4 py-2 bg-blue-100 rounded-full">
                      Simple Process
                    </span>
                    <h3 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">How It Works</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
                    <div className="text-center group/item">
                      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-100 to-blue-50 rounded-2xl mb-6 shadow-lg group-hover/item:scale-110 transition-transform duration-300">
                        <span className="text-blue-600 font-bold text-3xl">1</span>
                      </div>
                      <h4 className="font-bold text-gray-900 mb-3 text-xl md:text-2xl">Choose a Location</h4>
                      <p className="text-base md:text-lg text-gray-600 leading-relaxed">
                        Browse available commercial kitchen locations in your area and find the perfect space for your needs.
                      </p>
                    </div>
                    <div className="text-center group/item">
                      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl mb-6 shadow-lg group-hover/item:scale-110 transition-transform duration-300">
                        <span className="text-green-600 font-bold text-3xl">2</span>
                      </div>
                      <h4 className="font-bold text-gray-900 mb-3 text-xl md:text-2xl">Select Date & Time</h4>
                      <p className="text-base md:text-lg text-gray-600 leading-relaxed">
                        Choose a kitchen, date, and available time slot that works for your schedule.
                      </p>
                    </div>
                    <div className="text-center group/item">
                      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-purple-100 to-purple-50 rounded-2xl mb-6 shadow-lg group-hover/item:scale-110 transition-transform duration-300">
                        <span className="text-purple-600 font-bold text-3xl">3</span>
                      </div>
                      <h4 className="font-bold text-gray-900 mb-3 text-xl md:text-2xl">Submit Booking</h4>
                      <p className="text-base md:text-lg text-gray-600 leading-relaxed">
                        Fill in your details and submit your booking request. The kitchen manager will confirm your booking.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </FadeInSection>
          </div>

          {/* Features Section */}
          <FadeInSection delay={2}>
            <div className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10">
              <Card className="border border-gray-100 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <CardHeader className="relative z-10">
                  <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Calendar className="h-8 w-8 text-green-600" />
                  </div>
                  <CardTitle className="text-2xl md:text-3xl font-bold text-gray-900 group-hover:text-green-600 transition-colors duration-300">Flexible Booking</CardTitle>
                  <CardDescription className="text-base md:text-lg leading-relaxed mt-3">
                    Book commercial kitchens by the hour or day. Choose from multiple locations and time slots.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="border border-gray-100 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 bg-white group relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <CardHeader className="relative z-10">
                  <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-purple-50 rounded-2xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform duration-300">
                    <Building2 className="h-8 w-8 text-purple-600" />
                  </div>
                  <CardTitle className="text-2xl md:text-3xl font-bold text-gray-900 group-hover:text-purple-600 transition-colors duration-300">Professional Kitchens</CardTitle>
                  <CardDescription className="text-base md:text-lg leading-relaxed mt-3">
                    Access fully equipped commercial kitchens with all the tools and space you need for your culinary business.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </FadeInSection>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-white mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
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
    </GradientHero>
    </>
  );
}
