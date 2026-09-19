
import WelcomeStep from '@/components/manager/onboarding/steps/WelcomeStep';
import LocationStep from '@/components/manager/onboarding/steps/LocationStep';
import CreateKitchenStep from '@/components/manager/onboarding/steps/CreateKitchenStep';
import ApplicationRequirementsStep from '@/components/manager/onboarding/steps/ApplicationRequirementsStep';
import PaymentSetupStep from '@/components/manager/onboarding/steps/PaymentSetupStep';
import AvailabilityStep from '@/components/manager/onboarding/steps/AvailabilityStep';
import CompletionSummaryStep from '@/components/manager/onboarding/steps/CompletionSummaryStep';

export const componentRegistry = {
    'welcome': WelcomeStep,
    'location': LocationStep,
    'create-kitchen': CreateKitchenStep,
    'application-requirements': ApplicationRequirementsStep,
    'payment-setup': PaymentSetupStep,
    'availability': AvailabilityStep,
    'completion-summary': CompletionSummaryStep,
};

// Re-export steps for convenience ONLY if circular dep is handled, but better not to.
// We strictly separate them.
