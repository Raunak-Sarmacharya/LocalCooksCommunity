import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, MapPin, Loader2, ArrowRight, Calendar, Lock } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PublicLocation {
  id: number;
  name: string;
  address: string;
  logoUrl?: string | null;
  slug: string;
}

export default function PortalLanding() {
  const [, setLocation] = useLocation();

  // Fetch all public locations
  const { data: locations, isLoading, error } = useQuery<PublicLocation[]>({
    queryKey: ["/api/public/locations"],
    queryFn: async () => {
      const response = await fetch("/api/public/locations");
      if (!response.ok) throw new Error("Failed to fetch locations");
      return response.json();
    },
  });

  const handleLocationClick = (slug: string) => {
    setLocation(`/portal/${slug}`);
  };

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
              <Button
                variant="ghost"
                onClick={() => setLocation("/portal/book")}
                className="flex items-center gap-2"
              >
                <Calendar className="h-4 w-4" />
                Book a Kitchen
              </Button>
              <Button
                onClick={() => setLocation("/manager")}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <Lock className="h-4 w-4" />
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
          <div className="text-center mb-16">
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

          {/* Locations Preview */}
          <div className="mb-16">
            <h3 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
              Featured Locations
            </h3>
            
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                {locations.slice(0, 6).map((location) => (
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

            {locations && locations.length > 6 && (
              <div className="text-center">
                <Button
                  variant="outline"
                  onClick={() => setLocation("/portal/book")}
                  className="flex items-center gap-2 mx-auto"
                >
                  View All Locations
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
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
