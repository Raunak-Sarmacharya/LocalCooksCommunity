import { OnboardingStep } from '@onboardjs/core';

// Extend the base type to include our custom metadata
export interface ChefOnboardingStep extends Omit<OnboardingStep, 'metadata'> {
    metadata?: {
        label: string;
        isOptional: boolean;
        canSkip: boolean;
        path?: 'seller' | 'kitchen' | 'both'; // Which path this step belongs to
    };
}

// Chef onboarding steps with dual-path support
export const chefOnboardingSteps: ChefOnboardingStep[] = [
    {
        id: 'welcome',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Welcome',
            isOptional: false,
            canSkip: false,
            path: 'both'
        },
        payload: {
            componentKey: 'chef-welcome',
            title: 'Welcome to LocalCooks',
            description: 'Choose your path to get started',
        },
        nextStep: 'path-selection'
    },
    {
        id: 'path-selection',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Choose Path',
            isOptional: false,
            canSkip: false,
            path: 'both'
        },
        payload: {
            componentKey: 'chef-path-selection',
            title: 'What would you like to do?',
            description: 'Select one or both options',
        },
        nextStep: 'profile-setup' // Dynamic based on selection
    },
    {
        id: 'profile-setup',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Profile',
            isOptional: false,
            canSkip: false,
            path: 'both'
        },
        payload: {
            componentKey: 'chef-profile',
            title: 'Complete Your Profile',
            description: 'Tell us about yourself',
        },
        nextStep: 'seller-application' // or 'kitchen-discovery' based on path
    },
    // Seller Path Steps
    {
        id: 'seller-application',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Seller Application',
            isOptional: false,
            canSkip: false,
            path: 'seller'
        },
        payload: {
            componentKey: 'chef-seller-application',
            title: 'Apply to Sell on LocalCooks',
            description: 'Submit your seller application',
        },
        nextStep: 'food-safety-training'
    },
    {
        id: 'food-safety-training',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Training',
            isOptional: false,
            canSkip: true,
            path: 'seller'
        },
        payload: {
            componentKey: 'chef-training',
            title: 'Food Safety Training',
            description: 'Complete required training modules',
        },
        nextStep: 'document-verification'
    },
    {
        id: 'document-verification',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Documents',
            isOptional: false,
            canSkip: false,
            path: 'seller'
        },
        payload: {
            componentKey: 'chef-documents',
            title: 'Document Verification',
            description: 'Upload required certifications',
        },
        nextStep: 'kitchen-discovery' // If also doing kitchen path, else completion
    },
    // Kitchen Access Path Steps
    {
        id: 'kitchen-discovery',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Find Kitchens',
            isOptional: false,
            canSkip: false,
            path: 'kitchen'
        },
        payload: {
            componentKey: 'chef-kitchen-discovery',
            title: 'Discover Commercial Kitchens',
            description: 'Browse available kitchen spaces',
        },
        nextStep: 'kitchen-application'
    },
    {
        id: 'kitchen-application',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Apply to Kitchen',
            isOptional: false,
            canSkip: true,
            path: 'kitchen'
        },
        payload: {
            componentKey: 'chef-kitchen-application',
            title: 'Apply for Kitchen Access',
            description: 'Submit application to your chosen kitchen',
        },
        nextStep: 'completion'
    },
    // Completion
    {
        id: 'completion',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Complete',
            isOptional: false,
            canSkip: false,
            path: 'both'
        },
        payload: {
            componentKey: 'chef-completion',
            title: 'Setup Complete!',
            description: 'You\'re ready to start your journey',
        },
        nextStep: null
    },
];

// Helper to get steps for a specific path
export const getStepsForPath = (selectedPaths: ('seller' | 'kitchen')[]): ChefOnboardingStep[] => {
    return chefOnboardingSteps.filter(step => {
        if (step.metadata?.path === 'both') return true;
        if (!step.metadata?.path) return true;
        return selectedPaths.includes(step.metadata.path);
    });
};

// Step IDs for easy reference
export const CHEF_STEP_IDS = {
    WELCOME: 'welcome',
    PATH_SELECTION: 'path-selection',
    PROFILE_SETUP: 'profile-setup',
    SELLER_APPLICATION: 'seller-application',
    FOOD_SAFETY_TRAINING: 'food-safety-training',
    DOCUMENT_VERIFICATION: 'document-verification',
    KITCHEN_DISCOVERY: 'kitchen-discovery',
    KITCHEN_APPLICATION: 'kitchen-application',
    COMPLETION: 'completion',
} as const;
