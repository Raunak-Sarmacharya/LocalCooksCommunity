import { OnboardingStep } from '@onboardjs/core';

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
    },
    {
        id: 'location',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Location',
            isOptional: false,
            canSkip: false
        },
        payload: {
            componentKey: 'location',
            title: 'Location & Contact',
            description: 'Set up your location details',
        },
    },
    {
        id: 'create-kitchen',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Kitchen Space',
            isOptional: false,
            canSkip: false
        },
        payload: {
            componentKey: 'create-kitchen',
            title: 'Create Kitchen',
            description: 'Set up your first kitchen space',
        },
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
    },
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
    },
    {
        id: 'storage-listings',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Storage',
            isOptional: true,
            canSkip: true
        },
        payload: {
            componentKey: 'storage-listings',
            title: 'Storage Listings',
            description: 'Add storage options',
        },
    },
    {
        id: 'equipment-listings',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Equipment',
            isOptional: true,
            canSkip: true
        },
        payload: {
            componentKey: 'equipment-listings',
            title: 'Equipment Listings',
            description: 'Add equipment options',
        },
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
            description: 'Review your setup and next steps',
        },
        nextStep: null
    },
];
