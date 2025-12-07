import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, Redirect } from "wouter";
import { Building2, MapPin, Loader2, ArrowRight, Calendar, Lock, LogOut, Clock, AlertCircle } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect } from "react";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";

interface PublicLocation {
  id: number;
  name: string;
  address: string;
  logoUrl?: string | null;
  slug: string;
}

export default function PortalBookingPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Check authentication
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
        });
        if (response.ok) {
          const user = await response.json();
          const isPortalUser = user?.isPortalUser || user?.is_portal_user;
          setIsAuthenticated(isPortalUser);
          if (!isPortalUser) {
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  // Check application status first
  const { data: applicationStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["/api/portal/application-status"],
    queryFn: async () => {
      const response = await fetch("/api/portal/application-status", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch application status");
      }
      return response.json();
    },
    enabled: isAuthenticated === true,
  });

  // Fetch user's assigned location (requires authentication and approved access)
  const { data: locations, isLoading, error } = useQuery<PublicLocation[]>({
    queryKey: ["/api/portal/locations"],
    queryFn: async () => {
      const response = await fetch("/api/portal/locations", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Authentication required");
        }
        if (response.status === 403) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Access denied");
        }
        throw new Error("Failed to fetch locations");
      }
      return response.json();
    },
    enabled: isAuthenticated === true && applicationStatus?.hasAccess === true,
    retry: false,
  });

  const handleLogout = async () => {
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });
      
      if (response.ok) {
        // Clear any cached queries
        queryClient.clear();
        // Redirect to login page
        window.location.href = "/portal/login";
      } else {
        console.error("Logout failed:", response.status);
        // Still redirect even if logout endpoint fails
        window.location.href = "/portal/login";
      }
    } catch (error) {
      console.error("Logout error:", error);
      // Still redirect even if logout fails
      window.location.href = "/portal/login";
    }
  };

  // Redirect to login if not authenticated
  if (isAuthenticated === false) {
    return <Redirect to="/portal/login" />;
  }

  const handleLocationClick = (slug: string) => {
    setLocation(`/portal/${slug}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 relative">
      <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
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
              <Button
                variant="ghost"
                onClick={() => setLocation("/portal")}
                className="flex items-center gap-2"
              >
                Home
              </Button>
              <Button
                variant="ghost"
                onClick={() => setLocation("/portal/my-bookings")}
                className="flex items-center gap-2"
              >
                <Calendar className="h-4 w-4" />
                My Bookings
              </Button>
              <Button
                variant="ghost"
                onClick={() => setLocation("/portal/book")}
                className="flex items-center gap-2"
              >
                <Calendar className="h-4 w-4" />
                Book a Kitchen
              </Button>
              <Button
                onClick={handleLogout}
                variant="outline"
                className="flex items-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
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
              Your Assigned Location
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Browse available kitchens at your assigned location and book your time slot.
            </p>
          </div>

          {/* Application Status Check */}
          {statusLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          )}

          {/* Awaiting Approval Message */}
          {applicationStatus && !applicationStatus.hasAccess && applicationStatus.awaitingApproval && (
            <div className="mb-16">
              <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-2xl p-8 border-2 border-yellow-200 shadow-lg max-w-2xl mx-auto">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                    <Clock className="h-8 w-8 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">Awaiting Kitchen Access</h3>
                    <p className="text-gray-700 mb-4 text-lg">
                      Your application has been submitted and is currently under review by the location manager. 
                      Once approved, you'll be able to access your assigned location and book kitchens.
                    </p>
                    <div className="bg-white rounded-lg p-4 border border-yellow-200">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                        <span>Application Status: <strong className="text-gray-900">In Review</strong></span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-4">
                      You'll receive an email notification once your application has been reviewed and approved.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Featured Locations Section */}
          {applicationStatus?.hasAccess && (
          <div className="mb-16">
            <h3 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
                Your Location
            </h3>

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
            <div className="flex flex-wrap justify-center gap-6">
              {locations.map((location) => (
                <Card
                  key={location.id}
                  className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:border-blue-300 border-2 w-full max-w-sm md:max-w-xs lg:max-w-sm"
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
          </div>
          )}

          {/* Info Section */}
          <div className="mt-16">
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

