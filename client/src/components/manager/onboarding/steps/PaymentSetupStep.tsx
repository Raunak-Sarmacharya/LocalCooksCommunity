import React from "react";
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
      case 'pending_verification': return 'Waiting for Stripe Verification...';
      case 'requires_additional_info': return 'Provide Additional Info to Continue';
      case 'past_due': return 'Update Overdue Info to Continue';
      case 'details_needed': return 'Start Stripe Setup to Continue';
      case 'payouts_disabled': return 'Add Bank Account to Continue';
      case 'rejected': return 'Account Rejected — Contact Support';
      default: return 'Complete Stripe Setup to Continue';
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
        onSkip={skipCurrentStep}
        showBack={!isFirstStep}
        showSkip={true}
        isNextDisabled={!isStripeOnboardingComplete}
        nextLabel={isStripeOnboardingComplete ? "Continue" : getDisabledLabel()}
      />
    </div>
  );
}
