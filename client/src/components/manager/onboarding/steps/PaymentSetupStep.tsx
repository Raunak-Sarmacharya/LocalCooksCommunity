import React from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { Card, CardContent } from "@/components/ui/card";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";

export default function PaymentSetupStep() {
  
  const { handleNext, handleBack, isFirstStep, isStripeOnboardingComplete, skipCurrentStep } = useManagerOnboarding();
  const { user: firebaseUser } = useFirebaseAuth();

  const { data: stripeStatus } = useQuery({
    queryKey: ['/api/manager/stripe-connect/status', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;
      const response = await fetch('/api/manager/stripe-connect/status', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!firebaseUser,
    staleTime: 1000 * 30,
  });

  const getDisabledLabel = () => {
    const stage = stripeStatus?.verificationStage;
    switch (stage) {
      case 'pending_verification': return mt("stripeWaitingVerification");
      case 'requires_additional_info': return mt("stripeProvideAdditionalInfo");
      case 'past_due': return mt("stripeUpdateOverdueInfo");
      case 'details_needed': return mt("stripeStartSetupToContinue");
      case 'payouts_disabled': return mt("stripeAddBankAccountToContinue");
      case 'rejected': return mt("stripeAccountRejectedContactSupport");
      default: return mt("stripeCompleteSetupToContinue");
    }
  };

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
        isNextDisabled={!isStripeOnboardingComplete}
        nextLabel={isStripeOnboardingComplete ? tt("continue") : getDisabledLabel()}
      />
    </div>
  );
}
