import { ApplicationFormProvider, useApplicationForm } from "@/components/application/ApplicationFormContext";
import CertificationsForm from "@/components/application/CertificationsForm";
import KitchenPreferenceForm from "@/components/application/KitchenPreferenceForm";
import PersonalInfoForm from "@/components/application/PersonalInfoForm";
import ProgressIndicator from "@/components/application/ProgressIndicator";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import SEOHead from "@/components/SEO/SEOHead";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import FadeInSection from "@/components/ui/FadeInSection";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertCircle, Loader2, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useLocation } from "wouter";
import { Icon } from "@iconify/react";

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
  const { currentStep, isBusy } = useApplicationForm();
  const { t } = useTranslation("chef");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveDestination, setLeaveDestination] = useState("/dashboard?view=applications");
  const [, navigate] = useLocation();
  // Ensure page always starts at the top when step changes
  useEffect(() => {
    // Use instant scroll behavior and scroll to top of page
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Also scroll the document element for better browser compatibility
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [currentStep]);

  return (
    <>
      <div className="container mx-auto mb-4 px-4 sm:px-6">
        <ProgressIndicator step={currentStep} />
      </div>

      <div className="container mx-auto px-4 sm:px-6">
        <FadeInSection>
          <div className="mx-auto max-w-2xl rounded-2xl border bg-white p-4 shadow-sm sm:p-5" data-testid="seller-application-form">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="ghost" size="sm" className="rounded-xl" disabled={isBusy} onClick={() => { setLeaveDestination("/dashboard?view=applications"); setLeaveOpen(true); }} data-testid="seller-application-cancel">
                <Icon icon="mdi:close" className="size-4" aria-hidden />
                {t("apCancelBtn")}
              </Button>
            </div>
            <h1 className="mb-2 px-2 text-center text-xl font-semibold tracking-tight sm:text-2xl">Local Cooks Application</h1>

            {currentStep === 1 && (
              <div className="fade-in">
                <p className="mb-4 text-center text-sm text-gray-600">Please provide your personal information</p>
                <PersonalInfoForm />
              </div>
            )}

            {currentStep === 2 && (
              <div className="fade-in">
                <p className="mb-4 text-center text-sm text-gray-600">Select your kitchen preference</p>
                <KitchenPreferenceForm />
              </div>
            )}

            {currentStep === 3 && (
              <div className="fade-in">
                <p className="mb-4 text-center text-sm text-gray-600">Tell us about your food safety certifications</p>
                <CertificationsForm />
              </div>
            )}

            {currentStep === 1 && (
              <div className="mt-4 text-center">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setLeaveDestination("/"); setLeaveOpen(true); }}
                  className="rounded-xl text-gray-600 hover:text-primary transition-colors"
                >
                  <Icon icon="mdi:arrow-left" className="size-4" aria-hidden />
                  Back to Home
                </Button>
              </div>
            )}
          </div>
        </FadeInSection>
      </div>
      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent className="w-[95vw] rounded-2xl sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("apLeaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("apLeaveDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">{t("apLeaveKeep")}</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl" onClick={() => navigate(leaveDestination)}>{t("apLeaveConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function ApplicationForm() {
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  // Ensure page always starts at the top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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
  const { data: applications, isLoading: applicationsLoading, error: applicationsError, refetch: refetchApplications } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async ({ queryKey }) => {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("User not authenticated");
      }

      const token = await currentUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`
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
        navigate("/dashboard?view=applications");
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [applicationsLoading, activeApplication, navigate]);

  // Show loading state while checking authentication
  const isLoading = authLoading || !user || applicationsLoading;

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
              <Button onClick={() => navigate("/admin")} className="mt-4 rounded-xl">
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
      <div className="min-h-screen flex flex-col bg-light-gray relative">
        <SEOHead
          title="Apply as Chef — Join LocalCooks"
          description="Apply to join LocalCooks as a chef. Get approved in 24 hours, access commercial kitchens, handle compliance, and start earning with weekly Stripe payouts in St. John's, Newfoundland."
          canonicalUrl="/apply"
          breadcrumbs={[
            { name: "LocalCooks", url: "https://chef.localcooks.ca/" },
            { name: "Apply as Chef", url: "https://chef.localcooks.ca/apply" },
          ]}
        />
        <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
        <Header />
        <main className="relative z-10 flex-grow pb-10 pt-20 sm:pt-24">
          {isLoading ? (
            <div role="status" className="container mx-auto px-4 sm:px-6 flex min-h-[50vh] flex-col items-center justify-center py-8 sm:py-12">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <Loader2 className="absolute h-full w-full animate-spin text-primary/20" />
                <Loader2 className="absolute h-8 w-8 animate-spin text-primary" />
              </div>
              <p className="mt-4 font-medium text-muted-foreground animate-pulse">Loading application...</p>
            </div>
          ) : applicationsError ? (
            <div role="alert" className="mx-auto max-w-2xl space-y-3 rounded-xl border bg-white p-6">
              <p>Unable to load your applications. Please try again before starting a new application.</p>
              <Button className="rounded-xl" onClick={() => refetchApplications()}>Retry</Button>
            </div>
          ) : activeApplication ? (
            <motion.div
              className="container mx-auto px-4 sm:px-6 max-w-2xl"
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
                <Button onClick={() => navigate("/dashboard?view=applications")} className="mt-4 rounded-xl">
                  My Applications
                </Button>
              </div>
              <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Opening My Applications...</p>
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
