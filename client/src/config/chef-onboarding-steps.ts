import { OnboardingStep } from '@onboardjs/core';

export interface ChefOnboardingGuidance {
    title: string;
    description: string;
    href?: string;
    external?: boolean;
}

export interface ChefOnboardingStep extends Omit<OnboardingStep, 'metadata' | 'payload'> {
    metadata?: {
        label: string;
        path?: 'localcooks' | 'kitchen' | 'both';
        sidebarDescription: string;
        canSkip?: boolean;
        ctaLabel?: string;
        skipLabel?: string;
    };
    payload: {
        componentKey: string;
        title: string;
        description: string;
        guidance?: ChefOnboardingGuidance[];
    };
}

export const chefOnboardingSteps: ChefOnboardingStep[] = [
    {
        id: 'welcome',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Welcome',
            path: 'both',
            sidebarDescription: 'See how chef setup works and what you will need.',
            ctaLabel: 'Get started',
        },
        payload: {
            componentKey: 'chef-welcome',
            title: 'Welcome to LocalCooks',
            description: 'This short setup gets you ready to sell food, book commercial kitchens, or both.',
        },
        nextStep: 'path-selection'
    },
    {
        id: 'path-selection',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Choose path',
            path: 'both',
            sidebarDescription: 'Pick selling food, booking kitchens, or both — you can change this later.',
            ctaLabel: 'Save and continue',
        },
        payload: {
            componentKey: 'chef-path-selection',
            title: 'What would you like to do?',
            description: 'Select one or both. We will only show the steps that match your choice.',
        },
        nextStep: 'localcooks-application'
    },
    {
        id: 'localcooks-application',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Application',
            path: 'localcooks',
            sidebarDescription: 'Share your details, kitchen setting, and food safety documents.',
            canSkip: true,
            ctaLabel: 'Start your application',
            skipLabel: 'Continue for now',
        },
        payload: {
            componentKey: 'chef-localcooks-application',
            title: 'Start selling on LocalCooks',
            description: 'Submit a short application so we can review your profile and certifications. Most reviews take 24–48 hours.',
            guidance: [
                {
                    title: 'What you will fill in',
                    description: 'Personal details, kitchen setting, and food safety documents in three short screens.',
                },
                {
                    title: 'Official food handler cert',
                    description: 'SkillsPass NL offers a free recognized food handler certificate if you need one.',
                    href: 'https://skillspassnl.bluedrop.io/storefront/online-registration/10863',
                    external: true,
                },
                {
                    title: 'After you submit',
                    description: 'We email you when status changes. You can keep setting up while we review.',
                },
            ],
        },
        nextStep: 'food-safety-training'
    },
    {
        id: 'food-safety-training',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Training',
            path: 'localcooks',
            sidebarDescription: 'Watch food safety videos and learn how official certification works.',
            canSkip: true,
            ctaLabel: 'Start training',
            skipLabel: 'Continue for now',
        },
        payload: {
            componentKey: 'chef-training',
            title: 'Food safety training (optional)',
            description: 'Learn handling basics in short videos. This is separate from an official food handler certificate.',
            guidance: [
                {
                    title: 'LocalCooks videos',
                    description: '14 basics videos and 8 hygiene how-tos. Finish them to unlock a completion certificate.',
                },
                {
                    title: 'Official certification',
                    description: 'Kitchens may still require a government-recognized food handler certificate.',
                    href: 'https://skillspassnl.bluedrop.io/storefront/online-registration/10863',
                    external: true,
                },
                {
                    title: 'Watch at your pace',
                    description: 'Start now or come back from Overview in your dashboard anytime.',
                },
            ],
        },
        nextStep: 'summary'
    },
    {
        id: 'browse-kitchens',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Kitchens',
            path: 'kitchen',
            sidebarDescription: 'Find a commercial kitchen, apply for access, then book prep time.',
            canSkip: true,
            ctaLabel: 'Browse kitchens',
            skipLabel: 'Continue for now',
        },
        payload: {
            componentKey: 'chef-browse-kitchens',
            title: 'Find a commercial kitchen',
            description: 'Browse kitchens near you, apply for access, and book time once the kitchen approves you.',
            guidance: [
                {
                    title: 'How access works',
                    description: 'Browse listings, submit an application, then book slots after approval.',
                },
                {
                    title: 'What to compare',
                    description: 'Look at hourly rates, equipment, storage, and location before you apply.',
                },
                {
                    title: 'Need help choosing?',
                    description: 'Chat with support if you are unsure which kitchen fits your menu.',
                },
            ],
        },
        nextStep: 'summary'
    },
    {
        id: 'summary',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Review',
            path: 'both',
            sidebarDescription: 'Check what is done and what you can finish later from your dashboard.',
            ctaLabel: 'Finish setup',
        },
        payload: {
            componentKey: 'chef-summary',
            title: 'You are ready to go',
            description: 'Setup is complete. Anything left can be finished anytime from your dashboard.',
        },
        nextStep: 'completion'
    },
    {
        id: 'completion',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Complete',
            path: 'both',
            sidebarDescription: 'Open your dashboard and start cooking.',
            ctaLabel: 'Go to dashboard',
        },
        payload: {
            componentKey: 'chef-completion',
            title: 'You are all set',
            description: 'Your chef account is ready. Here is what happens next.',
        },
        nextStep: null
    },
];

export const getStepsForPath = (selectedPaths: ('localcooks' | 'kitchen')[]): ChefOnboardingStep[] => {
    return chefOnboardingSteps.filter(step => {
        if (step.metadata?.path === 'both') return true;
        if (!step.metadata?.path) return true;
        return selectedPaths.includes(step.metadata.path);
    });
};

export const CHEF_STEP_IDS = {
    WELCOME: 'welcome',
    PATH_SELECTION: 'path-selection',
    LOCALCOOKS_APPLICATION: 'localcooks-application',
    FOOD_SAFETY_TRAINING: 'food-safety-training',
    BROWSE_KITCHENS: 'browse-kitchens',
    SUMMARY: 'summary',
    COMPLETION: 'completion',
} as const;

export function isChefUser(user?: {
    role?: string | null;
    isChef?: boolean;
} | null): boolean {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'manager') return false;
    return user.role === 'chef' || user.isChef === true;
}

/** True when this chef still needs the existing OnboardJS /chef-setup flow. */
export function needsChefOnboarding(user?: {
    role?: string | null;
    isChef?: boolean;
    chefOnboardingCompleted?: boolean;
} | null): boolean {
    return isChefUser(user) && !user?.chefOnboardingCompleted;
}

export function chefOnboardingStartedStorageKey(uid: string): string {
    return `chef_onboarding_started_${uid}`;
}

export function markChefOnboardingStarted(uid?: string | null): void {
    if (!uid || typeof window === 'undefined') return;
    localStorage.setItem(chefOnboardingStartedStorageKey(uid), 'true');
}

export function clearChefOnboardingStarted(uid?: string | null): void {
    if (!uid || typeof window === 'undefined') return;
    localStorage.removeItem(chefOnboardingStartedStorageKey(uid));
}

export function hasChefOnboardingStarted(uid?: string | null): boolean {
    if (!uid || typeof window === 'undefined') return false;
    return localStorage.getItem(chefOnboardingStartedStorageKey(uid)) === 'true';
}

/** Landing path for chefs after auth/terms/welcome. Incomplete chefs start in OnboardJS; they can leave to the dashboard and resume via the continue-setup banner. */
export function getChefPostAuthPath(user?: {
    role?: string | null;
    isChef?: boolean;
    chefOnboardingCompleted?: boolean;
} | null): string {
    if (needsChefOnboarding(user)) {
        return '/chef-setup';
    }
    return '/dashboard';
}
