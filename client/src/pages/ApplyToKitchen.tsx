import { useFirebaseAuth } from "@/hooks/use-auth";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import KitchenApplicationForm from "@/components/kitchen-application/KitchenApplicationForm";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [activeView, setActiveView] = useState("discover-kitchens");

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

  // Loading content
  const loadingContent = (
    <div className="space-y-6">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  );

  // Not found content
  const notFoundContent = (
    <Card className="border-0 shadow-lg">
      <CardContent className="p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Location Not Found</h2>
        <p className="text-muted-foreground mb-6">
          {locationError?.message || "The kitchen location you're looking for doesn't exist or has been removed."}
        </p>
        <Button onClick={() => navigate("/dashboard?view=discover-kitchens")}>
          Find Kitchens
        </Button>
      </CardContent>
    </Card>
  );

  // Main application form content
  const mainContent = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Application Form */}
      <KitchenApplicationForm
        location={location!}
        onSuccess={() => navigate("/dashboard?view=kitchen-applications")}
        onCancel={() => navigate(`/kitchen-requirements/${locationId}`)}
      />

      {/* Help Section */}
      <div className="text-center text-sm text-muted-foreground py-4">
        <p>
          Need help? Contact us at{" "}
          <a href="mailto:support@localcooks.ca" className="text-primary hover:underline">
            support@localcooks.ca
          </a>
        </p>
      </div>
    </motion.div>
  );

  // Determine what content to show
  const getContent = () => {
    if (isLoading) return loadingContent;
    if (!locationId || locationError || !location) return notFoundContent;
    return mainContent;
  };

  // If not authenticated, redirect (handled by useEffect)
  if (!user && !authLoading) {
    return null;
  }

  // If user is authenticated, wrap in ChefDashboardLayout
  if (user) {
    return (
      <ChefDashboardLayout
        activeView={activeView}
        onViewChange={(view) => {
          setActiveView(view);
          if (view === 'overview') navigate('/dashboard');
          else if (view === 'discover-kitchens') navigate('/dashboard?view=discover-kitchens');
          else if (view === 'kitchen-applications') navigate('/dashboard?view=kitchen-applications');
          else if (view === 'bookings') navigate('/dashboard?view=bookings');
          else if (view === 'applications') navigate('/dashboard?view=applications');
          else if (view === 'messages') navigate('/dashboard?view=messages');
          else if (view === 'training') navigate('/dashboard?view=training');
        }}
        breadcrumbs={[
          { label: "Dashboard", onClick: () => navigate('/dashboard') },
          { label: "Discover Kitchens", onClick: () => navigate('/dashboard?view=discover-kitchens') },
          { label: location?.name || 'Kitchen', onClick: () => navigate(`/kitchen-requirements/${locationId}`) },
          { label: "Apply" },
        ]}
      >
        {getContent()}
      </ChefDashboardLayout>
    );
  }

  // Fallback for loading state before auth is determined
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

