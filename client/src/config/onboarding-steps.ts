import { OnboardingStep } from "@onboardjs/core";

// Extend the base type to include our custom metadata
export interface ExtendedOnboardingStep extends Omit<OnboardingStep, 'metadata'> {
    metadata?: {
        label: string;
        isOptional: boolean;
        canSkip: boolean;
    };
}

export const steps: any[] = [
    {
        id: 'welcome',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Welcome',
            isOptional: false,
            canSkip: false
        },
        payload: {
            componentKey: 'welcome',
            title: 'Welcome',
            description: 'Learn about the setup process',
        },
        nextStep: 'location'
    },
    {
        id: 'location',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Business',
            isOptional: false,
            canSkip: false
        },
        payload: {
            componentKey: 'location',
            title: 'Business Details',
            description: 'Set up your business information',
        },
        nextStep: 'create-kitchen'
    },
    {
        id: 'create-kitchen',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            // Short for the stepper; the page heading below carries the full name.
            // The Business step sets the same pair ('Business' / 'Business Details').
            label: 'Kitchen listing',
            isOptional: false,
            canSkip: false
        },
        payload: {
            componentKey: 'create-kitchen',
            title: 'Your kitchen listing',
            description: 'The kitchen chefs will book — and equipment or storage, if you have any to offer.',
        },
        nextStep: 'availability'
    },
    {
        id: 'availability',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Availability',
            isOptional: false,
            canSkip: true
        },
        payload: {
            componentKey: 'availability',
            title: 'Set Availability',
            description: 'Define when your kitchen is open',
        },
        nextStep: 'application-requirements'
    },
    {
        id: 'application-requirements',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Requirements',
            isOptional: false,  // REQUIRED - managers must configure chef application requirements
            canSkip: false
        },
        payload: {
            componentKey: 'application-requirements',
            title: 'Application Requirements',
            description: 'Configure chef application fields',
        },
        nextStep: 'payment-setup'
    },
    /*
     * 'equipment-listings' and 'storage-listings' were steps here. Both were optional and
     * both only ever asked for data that hangs off a KITCHEN, so they are now parts 2 and 3
     * of 'create-kitchen' — see LocationStep for the same three-part shape on the Business
     * step. The wizard is seven steps instead of nine, and a manager meets equipment and
     * storage at the moment they are thinking about the kitchen they describe, rather than
     * four steps later.
     *
     * Nothing that decides "is onboarding done" ever read them: `requiredStepOrder` and
     * `TASK_STEP_IDS` in ManagerOnboardingContext, the setup banner's missing/improvement
     * lists, and the getting-started checklist all excluded them already.
     */
    {
        id: 'payment-setup',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Payments',
            isOptional: false, // Mandatory for payouts
            canSkip: true // Can be skipped initially but required for launch
        },
        payload: {
            componentKey: 'payment-setup',
            title: 'Payment Setup',
            description: 'Connect Stripe to receive payments',
        },
        nextStep: 'completion-summary'
    },
    {
        id: 'completion-summary',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Summary',
            isOptional: false,
            canSkip: false
        },
        payload: {
            componentKey: 'completion-summary',
            title: 'Setup Complete',
            description: 'What happens next?',
        },
        nextStep: null
    },
];
