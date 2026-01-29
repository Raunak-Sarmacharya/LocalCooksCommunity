import { OnboardingStep } from '@onboardjs/core';

// Extend the base type to include our custom metadata
export interface ChefOnboardingStep extends Omit<OnboardingStep, 'metadata'> {
    metadata?: {
        label: string;
        path?: 'localcooks' | 'kitchen' | 'both'; // Which path this step belongs to
    };
}

// Chef onboarding steps with dual-path support
export const chefOnboardingSteps: ChefOnboardingStep[] = [
    {
        id: 'welcome',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Welcome',
            path: 'both'
        },
        payload: {
            componentKey: 'chef-welcome',
            title: 'Welcome to Local Cooks',
            description: 'Get started with your chef journey',
        },
        nextStep: 'path-selection'
    },
    {
        id: 'path-selection',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Choose Path',
            path: 'both'
        },
        payload: {
            componentKey: 'chef-path-selection',
            title: 'What would you like to do?',
            description: 'Select one or both options',
        },
        // nextStep is dynamically determined based on selected paths
        nextStep: 'localcooks-application'
    },
    // LocalCooks Seller Path Steps
    {
        id: 'localcooks-application',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Application',
            path: 'localcooks'
        },
        payload: {
            componentKey: 'chef-localcooks-application',
            title: 'Start Selling on Local Cooks',
            description: 'Submit your application to become a Local Cooks chef',
        },
        nextStep: 'food-safety-training'
    },
    {
        id: 'food-safety-training',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Training',
            path: 'localcooks'
        },
        payload: {
            componentKey: 'chef-training',
            title: 'Food Safety Training',
            description: 'Learn about food safety best practices',
        },
        // nextStep is dynamically determined: goes to kitchen-discovery if kitchen path selected, else summary
        nextStep: 'summary'
    },
    // Kitchen Access Path Step (combined browse + apply)
    {
        id: 'browse-kitchens',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Browse Kitchens',
            path: 'kitchen'
        },
        payload: {
            componentKey: 'chef-browse-kitchens',
            title: 'Browse & Apply to Kitchens',
            description: 'Find commercial kitchens and submit applications',
        },
        nextStep: 'summary'
    },
    // Summary before completion
    {
        id: 'summary',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Summary',
            path: 'both'
        },
        payload: {
            componentKey: 'chef-summary',
            title: 'Onboarding Summary',
            description: 'Review your progress',
        },
        nextStep: 'completion'
    },
    // Completion
    {
        id: 'completion',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Complete',
            path: 'both'
        },
        payload: {
            componentKey: 'chef-completion',
            title: 'Onboarding Complete!',
            description: 'You\'re ready to start your journey',
        },
        nextStep: null
    },
];

// Helper to get steps for a specific path
export const getStepsForPath = (selectedPaths: ('localcooks' | 'kitchen')[]): ChefOnboardingStep[] => {
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
    LOCALCOOKS_APPLICATION: 'localcooks-application',
    FOOD_SAFETY_TRAINING: 'food-safety-training',
    BROWSE_KITCHENS: 'browse-kitchens',
    SUMMARY: 'summary',
    COMPLETION: 'completion',
} as const;
