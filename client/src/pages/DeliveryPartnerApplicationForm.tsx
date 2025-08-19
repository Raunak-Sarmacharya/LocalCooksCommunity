import DeliveryPartnerAddressForm from "@/components/application/DeliveryPartnerAddressForm";
import DeliveryPartnerDocumentsForm from "@/components/application/DeliveryPartnerDocumentsForm";
import { DeliveryPartnerFormProvider, useDeliveryPartnerForm } from "@/components/application/DeliveryPartnerFormContext";
import DeliveryPartnerPersonalInfoForm from "@/components/application/DeliveryPartnerPersonalInfoForm";
import DeliveryPartnerVehicleForm from "@/components/application/DeliveryPartnerVehicleForm";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useLocation } from "wouter";

// Progress indicator component
function ProgressIndicator({ step }: { step: number }) {
  const steps = [
    { number: 1, title: "Personal Info" },
    { number: 2, title: "Address" },
    { number: 3, title: "Vehicle Details" },
    { number: 4, title: "Documents" }
  ];

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        {steps.map((stepInfo, index) => (
          <div key={stepInfo.number} className="flex items-center">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
              stepInfo.number <= step 
                ? 'bg-primary border-primary text-white' 
                : 'border-gray-300 text-gray-500'
            }`}>
              {stepInfo.number < step ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                stepInfo.number
              )}
            </div>
            {index < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-4 ${
                stepInfo.number < step ? 'bg-primary' : 'bg-gray-300'
              }`} />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2">
        {steps.map((stepInfo) => (
          <span
            key={stepInfo.number}
            className={`text-xs ${
              stepInfo.number <= step ? 'text-primary font-medium' : 'text-gray-500'
            }`}
          >
            {stepInfo.title}
          </span>
        ))}
      </div>
    </div>
  );
}

// Form step component
function FormStep() {
  const { currentStep } = useDeliveryPartnerForm();

  return (
    <>
      <div className="container mx-auto px-4 mb-8">
        <ProgressIndicator step={currentStep} />
      </div>

      <div className="container mx-auto px-3 sm:px-4">
        <div className="max-w-2xl mx-auto bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 md:p-8 mobile-safe-area">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 sm:mb-6 text-center">
            Delivery Partner Application
          </h1>

          <AnimatePresence mode="wait">
            {currentStep === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-center text-sm sm:text-base mb-6 sm:mb-8 text-gray-600">
                  Let's start with your personal information
                </p>
                <DeliveryPartnerPersonalInfoForm />
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-center text-sm sm:text-base mb-6 sm:mb-8 text-gray-600">
                  Where are you located?
                </p>
                <DeliveryPartnerAddressForm />
              </motion.div>
            )}

            {currentStep === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-center text-sm sm:text-base mb-6 sm:mb-8 text-gray-600">
                  Tell us about your vehicle
                </p>
                <DeliveryPartnerVehicleForm />
              </motion.div>
            )}

            {currentStep === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <p className="text-center text-sm sm:text-base mb-6 sm:mb-8 text-gray-600">
                  Upload required documents
                </p>
                <DeliveryPartnerDocumentsForm />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

export default function DeliveryPartnerApplicationForm() {
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();

  // Ensure page always starts at the top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Redirect to auth page if user is not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?redirect=/delivery-partner-apply");
    }
  }, [authLoading, user, navigate]);

  // Show loading while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  // Don't render anything if user is not authenticated
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow py-8">
        <DeliveryPartnerFormProvider>
          <FormStep />
        </DeliveryPartnerFormProvider>
      </main>
      <Footer />
    </div>
  );
}
