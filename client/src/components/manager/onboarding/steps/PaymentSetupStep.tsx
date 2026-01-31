import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

export default function PaymentSetupStep() {
  const { handleNext, handleBack, isFirstStep } = useManagerOnboarding();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Stripe Connect Setup */}
      <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm">
        <CardContent className="pt-6">
          <StripeConnectSetup />
        </CardContent>
      </Card>

      <OnboardingNavigationFooter
        onNext={handleNext}
        onBack={handleBack}
        showBack={!isFirstStep}
        nextLabel="Continue"
      />
    </div>
  );
}
