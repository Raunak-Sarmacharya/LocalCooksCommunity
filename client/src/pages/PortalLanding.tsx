import { useLocation, Redirect } from "wouter";
import { Building2, ArrowRight, Calendar, Lock, LogOut, Loader2 } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";

export default function PortalLanding() {
  const [, setLocation] = useLocation();
  const [isPortalUser, setIsPortalUser] = useState<boolean | null>(null);

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
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
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
                  onClick={() => setLocation("/portal/book")}
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
          <div className="text-center mb-16 mt-12">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-6">
              <Building2 className="h-10 w-10 text-blue-600" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Commercial Kitchen Booking
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
              Find and book commercial kitchens for your culinary business. Perfect for chefs, caterers, and food entrepreneurs.
            </p>
            <Button
              size="lg"
              onClick={() => setLocation("/portal/book")}
              className="flex items-center gap-2 mx-auto"
            >
              <Calendar className="h-5 w-5" />
              Browse Available Kitchens
              <ArrowRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Info Section */}
          <div className="mt-16">
            <div className="bg-white rounded-lg shadow-md p-8 md:p-12 border border-gray-200">
              <h3 className="text-3xl font-semibold text-gray-900 mb-8 text-center">How It Works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                    <span className="text-blue-600 font-bold text-xl">1</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2 text-lg">Choose a Location</h4>
                  <p className="text-sm text-gray-600">
                    Browse available commercial kitchen locations in your area and find the perfect space for your needs.
                  </p>
                </div>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                    <span className="text-blue-600 font-bold text-xl">2</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2 text-lg">Select Date & Time</h4>
                  <p className="text-sm text-gray-600">
                    Choose a kitchen, date, and available time slot that works for your schedule.
                  </p>
                </div>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                    <span className="text-blue-600 font-bold text-xl">3</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2 text-lg">Submit Booking</h4>
                  <p className="text-sm text-gray-600">
                    Fill in your details and submit your booking request. The kitchen manager will confirm your booking.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Features Section */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="border-2">
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <Calendar className="h-6 w-6 text-green-600" />
                </div>
                <CardTitle>Flexible Booking</CardTitle>
                <CardDescription>
                  Book commercial kitchens by the hour or day. Choose from multiple locations and time slots.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                  <Building2 className="h-6 w-6 text-purple-600" />
                </div>
                <CardTitle>Professional Kitchens</CardTitle>
                <CardDescription>
                  Access fully equipped commercial kitchens with all the tools and space you need for your culinary business.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
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
    </div>
  );
}
