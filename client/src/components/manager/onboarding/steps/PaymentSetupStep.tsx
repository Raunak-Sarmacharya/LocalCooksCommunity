import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { Card } from "@/components/ui/card";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";

export default function PaymentSetupStep() {
  const {
    handleNext,
    handleBack,
    isFirstStep,
    isStripeOnboardingComplete,
    saveAndExit,
    isSubmitting,
  } = useManagerOnboarding();
  const { user: firebaseUser } = useFirebaseAuth();

  /*
   * Only for the DISABLED label below — the gate itself is `isStripeOnboardingComplete`
   * from the context, which this query must agree with or the button contradicts the card.
   *
   * Both read the same endpoint, so both see `detailsSubmitted` flip at the same moment;
   * this query exists because the label needs the granular `verificationStage` (which stage
   * of setup remains), while the gate only needs "is there anything left for the manager to
   * do". Shared cache key, so this is not a second request.
   */
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

  /*
   * What to say while the step CANNOT move on.
   *
   * Reached only when the manager still owes Stripe something they can act on — the form is
   * unfinished, or Stripe has asked for more. The moment they submit, the step unlocks (see
   * `isStripeOnboardingComplete`), so none of these strings ever sits next to an enabled
   * button.
   *
   * `pending_verification` is intentionally absent from the enabled path too: it is a
   * post-submission state, and a submitted account has already unlocked Continue. On the
   * off chance it shows here (an account Stripe queued without `detailsSubmitted` reaching
   * us), the generic default is a truthful fallback.
   */
  const getDisabledLabel = () => {
    switch (stripeStatus?.verificationStage) {
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
      <Card>
        <div className="p-5">
          <StripeConnectSetup />
        </div>
      </Card>

      <OnboardingNavigationFooter
        onNext={handleNext}
        onBack={handleBack}
        onSaveAndExit={() => void saveAndExit()}
        showBack={!isFirstStep}
        isNextDisabled={!isStripeOnboardingComplete}
        nextLabel={isStripeOnboardingComplete ? tt("continue") : getDisabledLabel()}
        isSavingAndExiting={isSubmitting}
      />
    </div>
  );
}
