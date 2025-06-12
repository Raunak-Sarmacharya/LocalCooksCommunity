import { ApplicationFormProvider, useApplicationForm } from "@/components/application/ApplicationFormContext";
import CertificationsForm from "@/components/application/CertificationsForm";
import KitchenPreferenceForm from "@/components/application/KitchenPreferenceForm";
import PersonalInfoForm from "@/components/application/PersonalInfoForm";
import ProgressIndicator from "@/components/application/ProgressIndicator";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertCircle, Loader2, Shield } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

// Helper to check if an application is active (not cancelled, rejected)
const isApplicationActive = (app: Application) => {
  return app.status !== 'cancelled' && app.status !== 'rejected';
};

// Helper to check if user already has an active application
const hasActiveApplication = (applications?: Application[]) => {
  if (!applications || applications.length === 0) return false;
  return applications.some(isApplicationActive);
};

// This component renders the appropriate form based on the current step
function FormStep() {
  const { currentStep, goToPreviousStep } = useApplicationForm();
  const [, navigate] = useLocation();

  return (
    <>
      <div className="container mx-auto px-4 mb-8">
        <ProgressIndicator step={currentStep} />
      </div>

      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6 md:p-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-6 text-center">Cook Application</h1>

          {currentStep === 1 && (
            <div className="fade-in">
              <p className="text-center mb-8">Please provide your personal information</p>
              <PersonalInfoForm />
            </div>
          )}

          {currentStep === 2 && (
            <div className="fade-in">
              <p className="text-center mb-8">Select your kitchen preference</p>
              <KitchenPreferenceForm />
            </div>
          )}

          {currentStep === 3 && (
            <div className="fade-in">
              <p className="text-center mb-8">Tell us about your food safety certifications</p>
              <CertificationsForm />
            </div>
          )}

          {currentStep === 1 && (
            <div className="mt-6 text-center">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/")}
                className="text-gray-600 hover:text-primary transition-colors"
              >
                Back to Information
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function ApplicationForm() {
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  // Redirect to auth page if user is not logged in, or to admin dashboard if user is admin
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?redirect=/apply");
    } else if (!authLoading && user && user.role === "admin") {
      // Admins should not be able to submit applications
      navigate("/admin");
    }
  }, [user, authLoading, navigate]);

  // Fetch applicant's applications
  const { data: applications, isLoading: applicationsLoading } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid) {
        throw new Error("User not authenticated");
      }

      const headers: Record<string, string> = {
        'X-User-ID': user.uid.toString()
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
      }

      const rawData = await response.json();

      // Convert snake_case to camelCase for database fields
      const normalizedData = rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        email: app.email,
        phone: app.phone,
        foodSafetyLicense: app.food_safety_license || app.foodSafetyLicense,
        foodEstablishmentCert: app.food_establishment_cert || app.foodEstablishmentCert,
        kitchenPreference: app.kitchen_preference || app.kitchenPreference,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt
      }));

      return normalizedData;
    },
    enabled: !!user, // Only run if user is logged in
  });

  // Check if user has active applications
  const activeApplication = hasActiveApplication(applications);

  // Redirect to dashboard if user already has an active application
  useEffect(() => {
    if (!applicationsLoading && activeApplication) {
      // Set a small timeout to ensure UI renders before redirect
      const timer = setTimeout(() => {
        navigate("/dashboard");
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [applicationsLoading, activeApplication, navigate]);

  // Show loading state while checking authentication
  const isLoading = authLoading || (user && applicationsLoading);

  // If user is admin, they shouldn't see this page
  if (!authLoading && user && user.role === "admin") {
    return (
      <div className="min-h-screen flex flex-col bg-light-gray">
        <Header />
        <main className="flex-grow pt-28 pb-16">
          <motion.div
            className="container mx-auto px-4 max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Alert className="mb-4">
              <Shield className="h-4 w-4" />
              <AlertTitle>Admin Access</AlertTitle>
              <AlertDescription>
                Administrators cannot submit applications. You are being redirected to the admin dashboard.
              </AlertDescription>
            </Alert>
            <div className="flex justify-center">
              <Button onClick={() => navigate("/admin")} className="mt-4">
                Go to Admin Dashboard
              </Button>
            </div>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <ApplicationFormProvider>
      <div className="min-h-screen flex flex-col bg-light-gray">
        <Header />
        <main className="flex-grow pt-28 pb-16">
          {isLoading ? (
            <div className="container mx-auto px-4 flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : activeApplication ? (
            <motion.div
              className="container mx-auto px-4 max-w-2xl"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Active Application Exists</AlertTitle>
                <AlertDescription>
                  You already have an active application. Please cancel your existing application before submitting a new one.
                </AlertDescription>
              </Alert>
              <div className="flex justify-center">
                <Button onClick={() => navigate("/dashboard")} className="mt-4">
                  Go to Dashboard
                </Button>
              </div>
            </motion.div>
          ) : (
            <FormStep />
          )}
        </main>
        <Footer />
      </div>
    </ApplicationFormProvider>
  );
}
