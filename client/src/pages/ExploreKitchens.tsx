import { useFirebaseAuth } from "@/hooks/use-auth";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import KitchenDiscovery from "@/components/kitchen-application/KitchenDiscovery";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";

export default function ExploreKitchens() {
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?redirect=/explore-kitchens");
    }
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!user) {
    return null; // Redirecting
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-white to-blue-50 relative overflow-hidden">
      {/* Animated Background */}
      <AnimatedBackgroundOrbs />
      
      <Header />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12 relative z-10">
        <div className="container mx-auto px-4">
          {/* Header Section */}
          <FadeInSection>
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <Button
                variant="ghost"
                onClick={() => navigate("/dashboard")}
                className="text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-8"
            >
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
                Explore Commercial Kitchens
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Discover and apply to commercial kitchens in your area. 
                Once approved by a kitchen manager, you can start booking cooking time.
              </p>
            </motion.div>
          </FadeInSection>

          {/* Kitchen Discovery Component */}
          <FadeInSection delay={0}>
            <KitchenDiscovery />
          </FadeInSection>

          {/* Help Section */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-12 text-center"
          >
            <div className="inline-block bg-white/80 backdrop-blur-sm rounded-xl px-6 py-4 shadow-sm">
              <p className="text-gray-600">
                Questions about the application process?{" "}
                <a 
                  href="mailto:support@localcooks.ca" 
                  className="text-blue-600 hover:underline font-medium"
                >
                  Contact Support
                </a>
              </p>
            </div>
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

