import { OnboardingStep } from "@onboardjs/core";

// Extend the base type to include our custom metadata
export interface ExtendedOnboardingStep extends Omit<OnboardingStep, 'metadata'> {
    metadata?: {
        label: string;
        isOptional: boolean;
        canSkip: boolean;
        /**
         * Whether this step is WORK — something the manager has to do.
         *
         * Defaults to true. The two screens that are not work set it to false, and the rail and the
         * progress fraction count work and nothing else. See the note on `welcome` below.
         */
        isTask?: boolean;
    };
}

export const steps: any[] = [
    {
        /*
         * NOT a rail row, and NOT counted in the progress fraction — see `isTask`.
         *
         * The manager has to do five things to go live. Welcome and Summary are the entry and the
         * exit of the flow: screens you pass through, not work you complete. Listing them beside the
         * real work made the rail read "n of 7 required" for a job that is five tasks, and a row
         * called "Welcome" with a tick against it is not a thing anybody did.
         *
         * `type` stays CUSTOM_COMPONENT, and that is load-bearing. The OnboardJS docs are explicit
         * (docs.onboardjs.com/steps/typed-steps): INFORMATION is the DEFAULT type and its payload is
         * `{ title, mainText, ctaButtonText }`, while CUSTOM_COMPONENT is the type that renders a
         * component from `payload.componentKey` — which is exactly what this step and
         * `completion-summary` do. Typing them INFORMATION/CONFIRMATION said "not a task" with the
         * wrong lever, and `CONFIRMATION` is not a documented step type at all. `isTask` is the lever
         * for "not a task"; `type` describes how the screen is RENDERED.
         *
         * Neither screen is removed from the flow. They still frame the journey; they just stop
         * pretending to be tasks.
         *
         * This step is REACHABLE and stays that way — it is the wizard's entry screen, with a real
         * "Maybe later". Do not confuse it with the standalone welcome SCREEN shown before the terms
         * gate (`manager-welcome-screen.tsx`); they are different screens with different jobs, and
         * the wizard's `welcome` must not be marked complete just because the screen was dismissed.
         */
        id: 'welcome',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Welcome',
            isOptional: false,
            canSkip: false,
            isTask: false
        },
        payload: {
            componentKey: 'welcome',
            title: 'Welcome',
            description: 'Learn about the setup process',
        },
        nextStep: 'location'
    },
    {
        /*
         * "Business & licence", not "Business".
         *
         * The step collects three things: the business details, the contact information, and the
         * commercial kitchen licence that an admin reviews before the manager goes live. Calling it
         * "Business" hid the third — and it is the one that GATES going live, so a manager scanning
         * the rail had no way to tell where the licence was collected. The dashboard's own checklist
         * already names it separately ("Upload your license"), so the two disagreed.
         *
         * Same short-label / long-title split the availability step uses: the rail only fits about
         * two words, the step title carries the full name.
         */
        id: 'location',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Business & licence',
            isOptional: false,
            canSkip: false
        },
        payload: {
            componentKey: 'location',
            title: 'Business details & licence',
            description: 'Your business details, contact information and kitchen licence',
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
            /*
             * Two halves now, so the label names both: part 1 is the week, part 2 is the booking
             * policies and the terms document (which moved here from the Business step). The short
             * form is for the stepper, which only fits about two words per step; `title` carries
             * the full name. Keep "Booking Policies" — that is what the dashboard page is called,
             * so the manager meets the same words in both places.
             */
            label: 'Availability & policies',
            isOptional: false,
            canSkip: true
        },
        payload: {
            componentKey: 'availability',
            title: 'Availability & Booking Policies',
            description: 'Set when your kitchen is open, how bookings work, and your terms',
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
        /*
         * The closing screen, and not a rail row either — same reasoning as `welcome`.
         *
         * It cannot meaningfully be "completed": it completes when every task above it does, so a
         * tick against it restated the whole list and a unit of progress for it was a unit nobody
         * earned.
         *
         * `type` is CUSTOM_COMPONENT for the same reason as `welcome`: it renders a component from
         * `payload.componentKey`, and `CONFIRMATION` is not one of the types the library documents
         * (INFORMATION / SINGLE_CHOICE / MULTI_CHOICE / CUSTOM_COMPONENT).
         */
        id: 'completion-summary',
        type: 'CUSTOM_COMPONENT',
        metadata: {
            label: 'Summary',
            isOptional: false,
            canSkip: false,
            isTask: false
        },
        payload: {
            componentKey: 'completion-summary',
            title: 'Setup Complete',
            description: 'What happens next?',
        },
        nextStep: null
    },
];
