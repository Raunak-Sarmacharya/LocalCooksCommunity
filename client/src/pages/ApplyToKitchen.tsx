import { useFirebaseAuth } from "@/hooks/use-auth";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import KitchenApplicationForm from "@/components/kitchen-application/KitchenApplicationForm";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Building2, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEffect } from "react";
import { motion } from "framer-motion";

interface PublicLocation {
  id: number;
  name: string;
  address: string;
  city?: string;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
}

export default function ApplyToKitchen() {
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const params = useParams<{ locationId: string }>();
  const locationId = params.locationId ? parseInt(params.locationId) : null;

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/auth?redirect=/apply-kitchen/${locationId}`);
    }
  }, [user, authLoading, navigate, locationId]);

  // Fetch location details
  const { data: location, isLoading: locationLoading, error: locationError } = useQuery<PublicLocation>({
    queryKey: ["/api/public/locations", locationId, "details"],
    queryFn: async () => {
      if (!locationId) throw new Error("No location ID provided");
      
      const response = await fetch(`/api/public/locations/${locationId}/details`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Location not found");
        }
        throw new Error("Failed to fetch location");
      }
      return response.json();
    },
    enabled: !!locationId,
  });

  const isLoading = authLoading || locationLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
          <div className="container mx-auto px-4 max-w-3xl">
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!user) {
    return null; // Redirecting to auth
  }

  if (!locationId || locationError || !location) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
          <div className="container mx-auto px-4 max-w-3xl">
            <Card>
              <CardContent className="p-8 text-center">
                <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">Location Not Found</h2>
                <p className="text-gray-600 mb-6">
                  {locationError?.message || "The kitchen location you're looking for doesn't exist or has been removed."}
                </p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={() => navigate("/dashboard")}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Dashboard
                  </Button>
                  <Button onClick={() => navigate("/explore-kitchens")}>
                    Explore Kitchens
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
        <div className="container mx-auto px-4 max-w-3xl">
          {/* Breadcrumb */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Button
              variant="ghost"
              onClick={() => window.history.back()}
              className="text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </motion.div>

          {/* Application Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <KitchenApplicationForm
              location={location}
              onSuccess={() => navigate("/dashboard")}
              onCancel={() => window.history.back()}
            />
          </motion.div>

          {/* Help Section */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-8 text-center text-sm text-gray-600"
          >
            <p>
              Need help? Contact us at{" "}
              <a href="mailto:support@localcooks.ca" className="text-blue-600 hover:underline">
                support@localcooks.ca
              </a>
            </p>
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

