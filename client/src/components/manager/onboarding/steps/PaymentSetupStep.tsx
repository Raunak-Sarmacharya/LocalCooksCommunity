import React from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

export default function PaymentSetupStep() {
  const { handleNext, handleBack, isFirstStep } = useManagerOnboarding();

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Payment Setup</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Connect your Stripe account to receive payments directly for kitchen bookings. The platform service fee will be automatically deducted.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Why set up payments now?</AlertTitle>
        <AlertDescription>
          While you can skip this step and set it up later, connecting Stripe now ensures you're ready to receive payments as soon as bookings start. The setup process takes about 5 minutes.
        </AlertDescription>
      </Alert>

      <StripeConnectSetup />

      <OnboardingNavigationFooter
        onNext={handleNext}
        onBack={handleBack}
        showBack={!isFirstStep}
        nextLabel="Continue"
      />
    </div>
  );
}
