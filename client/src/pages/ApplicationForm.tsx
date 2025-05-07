import { useLocation } from "wouter";
import { useEffect } from "react";
import { ApplicationFormProvider, useApplicationForm } from "@/components/application/ApplicationFormContext";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProgressIndicator from "@/components/application/ProgressIndicator";
import PersonalInfoForm from "@/components/application/PersonalInfoForm";
import CertificationsForm from "@/components/application/CertificationsForm";
import KitchenPreferenceForm from "@/components/application/KitchenPreferenceForm";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Application } from "@shared/schema";
import { Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  const { user } = useAuth();
  const [, navigate] = useLocation();
  
  // Fetch applicant's applications
  const { data: applications, isLoading } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    enabled: !!user,
  });

  // Check if user has active applications
  const activeApplication = hasActiveApplication(applications);
  
  // Redirect to dashboard if user already has an active application
  useEffect(() => {
    if (!isLoading && activeApplication) {
      // Set a small timeout to ensure UI renders before redirect
      const timer = setTimeout(() => {
        navigate("/dashboard");
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading, activeApplication, navigate]);

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
