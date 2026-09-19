import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Circle, Clock, ArrowRight, Loader2, Mail, MessageCircle } from "@/components/ui/manager-icons";
import { emailProviderFor } from "@/lib/email-provider";
import { EmailProviderBrandIcon } from "@/components/ui/email-provider-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";

interface SetupItem {
    id: string;
    label: string;
    status: 'complete' | 'pending' | 'incomplete' | 'skipped';
    isRequired: boolean;
    description: string;
    stepId: string;
}

/**
 * Summary step.
 *
 * Reads top to bottom as a status: one line saying where setup stands, then one
 * row per step with its state, then the single action. The sidebar already
 * carries progress, so there is no second progress bar here.
 */
export default function CompletionSummaryStep() {
    const [, setLocation] = useLocation();
    const queryClient = useQueryClient();
    const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
    const {
        selectedLocation,
        selectedLocationId,
        kitchens,
        setIsOpen,
        isStripeOnboardingComplete,
        hasAvailability,
        hasRequirements,
        storageForm,
        equipmentForm,
        goToStep,
    } = useManagerOnboarding();

    // Build setup items with status
    const setupItems: SetupItem[] = useMemo(() => {
        const items: SetupItem[] = [];

        // 1. Business Details
        items.push({
            id: "location",
            label: mt("onboardingBusinessDetails"),
            status: selectedLocation ? 'complete' : 'incomplete',
            isRequired: true,
            description: selectedLocation?.name || mt("onboardingAddBusinessInfo"),
            stepId: 'location'
        });

        // 2. Kitchen Space
        items.push({
            id: "kitchen",
            label: mt("onboardingKitchenSpace"),
            status: kitchens.length > 0 ? 'complete' : 'incomplete',
            isRequired: true,
            description: kitchens.length > 0
                ? mt("onboardingKitchensConfigured", { count: kitchens.length })
                : mt("onboardingSetupKitchenSpaces"),
            stepId: 'create-kitchen'
        });

        // 3. Availability
        items.push({
            id: "availability",
            label: mt("onboardingAvailability"),
            status: hasAvailability ? 'complete' : 'incomplete',
            isRequired: true,
            description: hasAvailability ? mt("onboardingScheduleConfigured") : mt("onboardingSetOperatingHours"),
            stepId: 'availability'
        });

        // 4. Application Requirements
        items.push({
            id: "requirements",
            label: mt("onboardingChefRequirements"),
            status: hasRequirements ? 'complete' : 'incomplete',
            isRequired: true,
            description: hasRequirements ? mt("onboardingApplicationFieldsSet") : mt("onboardingConfigureApplicationFields"),
            stepId: 'application-requirements'
        });

        // 5. Kitchen License
        const licenseStatus = selectedLocation?.kitchenLicenseStatus;
        const hasLicenseUrl = !!selectedLocation?.kitchenLicenseUrl;
        let licenseItemStatus: SetupItem['status'] = 'incomplete';
        if (licenseStatus === 'approved') licenseItemStatus = 'complete';
        else if (hasLicenseUrl && (licenseStatus === 'pending' || !licenseStatus)) licenseItemStatus = 'pending';

        items.push({
            id: "license",
            label: mt("onboardingKitchenLicense"),
            status: licenseItemStatus,
            isRequired: true,
            description: licenseItemStatus === 'complete'
                ? mt("onboardingLicenseVerified")
                : licenseItemStatus === 'pending'
                    ? mt("onboardingAwaitingVerification")
                    : mt("onboardingUploadLicense"),
            stepId: 'location'
        });

        // 6. Payment Setup
        items.push({
            id: "payment",
            label: mt("onboardingPayments"),
            status: isStripeOnboardingComplete ? 'complete' : 'incomplete',
            isRequired: true,
            description: isStripeOnboardingComplete ? mt("onboardingStripeConnected") : mt("onboardingConnectStripe"),
            stepId: 'payment-setup'
        });

        // 7. Equipment (Optional) — a PART of the kitchen listing step, not a step of
        // its own, so the row stays (it reports what was added) but its action lands
        // on the step that owns it.
        const hasEquipment = equipmentForm?.listings?.length > 0;
        items.push({
            id: "equipment",
            label: mt("onboardingEquipment"),
            status: hasEquipment ? 'complete' : 'skipped',
            isRequired: false,
            description: hasEquipment ? mt("onboardingListingsCount", { count: equipmentForm.listings.length }) : mt("optional"),
            stepId: 'create-kitchen'
        });

        // 8. Storage (Optional) — same.
        const hasStorage = storageForm?.listings?.length > 0;
        items.push({
            id: "storage",
            label: mt("onboardingStorage"),
            status: hasStorage ? 'complete' : 'skipped',
            isRequired: false,
            description: hasStorage ? mt("onboardingListingsCount", { count: storageForm.listings.length }) : mt("optional"),
            stepId: 'create-kitchen'
        });

        return items;
    }, [selectedLocation, kitchens, hasAvailability, hasRequirements, isStripeOnboardingComplete, storageForm, equipmentForm]);

    // Calculate readiness - License pending counts as "done" for onboarding completion
    const requiredItems = setupItems.filter(item => item.isRequired);

    // For onboarding completion: license pending OR approved counts as done
    const completedOrPendingRequired = requiredItems.filter(item =>
        item.status === 'complete' || item.status === 'pending'
    );

    // For Accepting Requests: only fully complete items count
    const fullyCompletedRequired = requiredItems.filter(item => item.status === 'complete');

    // License status helpers
    const licenseItem = setupItems.find(item => item.id === 'license');
    const isLicensePending = licenseItem?.status === 'pending';

    // Onboarding is complete when all steps done (license can be pending)
    const isOnboardingComplete = completedOrPendingRequired.length === requiredItems.length;

    // Ready for bookings when ALL items are fully complete (license must be approved)
    const isFullyReady = fullyCompletedRequired.length === requiredItems.length;

    // Items that still need action (not complete AND not pending)
    const incompleteRequired = requiredItems.filter(item => item.status === 'incomplete');

    /**
     * Where the approval email will land — the address they gave us, falling
     * back to the account email. Naming it is the point: "we'll email you" is
     * far less reassuring than "we'll email you at jane@kitchen.ca".
     */
    const contactEmail =
        (selectedLocation as any)?.contactEmail ||
        (selectedLocation as any)?.contact_email ||
        auth.currentUser?.email ||
        "";

    /** Null for domains we cannot identify — see `email-provider.ts`. */
    const emailProvider = emailProviderFor(contactEmail);

    // [ENTERPRISE FIX] Mark onboarding as complete when user clicks "Go to Dashboard"
    // This is ONLY called when isOnboardingComplete=true (all required steps done, license uploaded)
    // The API sets manager_onboarding_completed=true, enabling early-exit in useOnboardingStatus
    const handleClose = useCallback(async () => {
        // Only mark as complete if all required steps are done
        // License can be pending - that's checked separately via showLicenseReviewBanner
        if (isOnboardingComplete) {
            setIsCompletingOnboarding(true);
            try {
                const token = await auth.currentUser?.getIdToken();
                if (token) {
                    const response = await fetch('/api/manager/complete-onboarding', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ skipped: false })
                    });

                    if (response.ok) {
                        logger.info('[CompletionSummary] ✅ Onboarding marked as complete');
                        // Invalidate user profile cache so useOnboardingStatus sees the update
                        await queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
                    } else {
                        logger.error('[CompletionSummary] Failed to mark onboarding complete:', response.status);
                    }
                }
            } catch (error) {
                logger.error('[CompletionSummary] Error marking onboarding complete:', error);
            } finally {
                setIsCompletingOnboarding(false);
            }
        }

        setIsOpen(false);
        const locId = selectedLocationId || selectedLocation?.id;
        setLocation(locId ? `/manager/dashboard?locationId=${locId}` : '/manager/dashboard');
    }, [isOnboardingComplete, setIsOpen, setLocation, queryClient, selectedLocationId, selectedLocation]);

    return (
        <div className="animate-in fade-in duration-500">
            {/* Where setup stands */}
            <div className="max-w-lg">
                <p className="text-sm font-medium text-foreground">
                    {isFullyReady
                        ? mt("youreAllSet")
                        : isOnboardingComplete && isLicensePending
                            ? mt("setupCompleteTitle")
                            : mt("almostThereShort")
                    }
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {isFullyReady
                        ? mt("kitchenReadyForBookings")
                        : isOnboardingComplete && isLicensePending
                            ? mt("licenseUnderReviewBookWhenApproved")
                            : mt("completeMoreSteps", { count: incompleteRequired.length })
                    }
                </p>
            </div>

            {/*
              * When the work is done the checklist is the wrong shape. Every row
              * would read "complete", which tells the manager nothing about what
              * they are actually waiting for. Show the process instead: what is
              * finished, what is happening now, and what they get at the end.
              */}
            {isOnboardingComplete ? (
                <div className="mt-6 overflow-hidden rounded-xl border border-border">
                    <div className="border-b border-border bg-muted/40 px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{mt("whatHappensNext")}</p>
                    </div>
                    <ol className="divide-y divide-border">
                        {/*
                          * Three steps, not four: "you are live" is the outcome of
                          * the review, not a stage the manager does anything in, so
                          * listing it only made the wait look longer.
                          */}
                        {[
                            { key: 'submitted', label: mt("stepBusinessSubmitted"), state: 'done' },
                            { key: 'kitchen', label: mt("stepKitchenReady"), state: 'done' },
                            { key: 'review', label: mt("stepReviewingLicence"), state: 'current' },
                        ].map((step, index) => (
                            <li key={step.key} className="flex items-center gap-3 px-4 py-3">
                                <span
                                    className={cn(
                                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                                        // A finished step gets a solid tick and full-contrast
                                        // text. Muting it read as "not applicable" rather than
                                        // "done" — the opposite of what the row means.
                                        step.state === 'done'
                                            ? "border-foreground/25 bg-muted text-foreground"
                                            : step.state === 'current'
                                                ? "border-primary text-primary"
                                                : "border-border text-muted-foreground",
                                    )}
                                >
                                    {step.state === 'done'
                                        ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                                        : index + 1}
                                </span>
                                <span
                                    className={cn(
                                        "text-sm",
                                        step.state === 'todo'
                                            ? "text-muted-foreground"
                                            : "text-foreground",
                                        step.state === 'current' && "font-medium",
                                    )}
                                >
                                    {step.label}
                                </span>
                                {step.state === 'current' && (
                                    <span className="ml-auto shrink-0 text-[11px] font-medium text-primary">
                                        {mt("pending")}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ol>
                </div>
            ) : (
                <div className="mt-6 divide-y divide-border rounded-xl border border-border">
                    {setupItems.map((item) => (
                        <SetupItemRow
                            key={item.id}
                            item={item}
                            onAction={() => goToStep(item.stepId)}
                        />
                    ))}
                </div>
            )}

            {/*
               * The one thing they should expect. Naming the address, and saying
               * where to look if it does not arrive, prevents the two commonest
               * support tickets after a review: "did it send?" and "I never got
               * it" when it is sitting in spam.
               */}
            {isOnboardingComplete && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                        <Mail className="mt-px h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0">
                            <p className="text-sm text-foreground">
                                {contactEmail
                                    ? mt("weWillEmailYouAt", { email: contactEmail })
                                    : mt("weLlNotifyYouOnceYourLicenseIsApproved")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{mt("checkSpamFolder")}</p>
                        </div>
                    </div>

                    {/*
                      * Sits on the block's own row, right-aligned, rather than
                      * floating under the paragraph — inside the text it read as
                      * a stray control.
                      *
                      * The provider is detected from the address, so the label
                      * names the real service ("Open Gmail", "Open Outlook") and
                      * the link goes straight to that inbox. A business domain
                      * we cannot identify renders **no button at all**: guessing
                      * would land them on a login page for an account they do
                      * not have, which is worse than nothing.
                      */}
                    {emailProvider && (
                        <Button variant="outline" size="sm" asChild className="shrink-0">
                            <a
                                href={emailProvider.inboxUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5"
                            >
                                <EmailProviderBrandIcon brand={emailProvider.brand} />
                                <span>{mt("openEmailVerb")} {emailProvider.name}</span>
                            </a>
                        </Button>
                    )}
                </div>
            )}

            {/* Action */}
            <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex flex-col gap-2 order-2 sm:order-1">
                    {/*
                     * Support lives in the dashboard, so this leaves onboarding for
                     * it. The unsaved-changes guard covers the hop — by this point
                     * there is nothing left to lose anyway.
                     */}
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {mt("needHelpReachSupport")}
                        <button
                            type="button"
                            onClick={() => setLocation("/manager/dashboard?view=support")}
                            className="font-medium text-primary hover:underline"
                        >
                            {mt("navSupport")}
                        </button>
                    </p>
                    {!isOnboardingComplete && (
                        <p className="max-w-xs text-xs text-muted-foreground">
                            {mt("youCanCompleteTheRemainingStepsAnytimeFromYourDashboardSetti")}
                        </p>
                    )}
                </div>

                <Button
                    size="lg"
                    onClick={handleClose}
                    disabled={isCompletingOnboarding}
                    className="gap-2 shrink-0 w-full sm:w-auto order-1 sm:order-2"
                >
                    {isCompletingOnboarding ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />{mt("completing")}</>
                    ) : (
                        <>
                            {isFullyReady || isOnboardingComplete
                                ? mt("goToDashboard")
                                : mt("continueToDashboard")}
                            <ArrowRight className="w-4 h-4" />
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

interface SetupItemRowProps {
    item: SetupItem;
    onAction: () => void;
}

function SetupItemRow({ item, onAction }: SetupItemRowProps) {
    const isActionable = item.status === 'incomplete' || item.status === 'pending';
    const isOptionalSkipped = !item.isRequired && item.status === 'skipped';

    // One calm glyph per row — state, not decoration.
    const Glyph = item.status === 'complete' ? CheckCircle2 : item.status === 'pending' ? Clock : Circle;

    return (
        <div
            className={cn(
                "group flex items-center gap-3 px-4 py-3 transition-colors",
                isActionable && "cursor-pointer hover:bg-muted/50"
            )}
            onClick={isActionable ? onAction : undefined}
        >
            <Glyph
                className={cn(
                    "h-4 w-4 shrink-0",
                    item.status === 'complete'
                        ? "text-muted-foreground"
                        : item.status === 'pending'
                            ? "text-primary"
                            : item.isRequired
                                ? "text-destructive"
                                : "text-muted-foreground"
                )}
            />

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                        {item.label}
                    </span>
                    {item.isRequired && item.status === 'incomplete' && (
                        <span className="text-[11px] text-destructive">{mt("required")}</span>
                    )}
                    {item.status === 'pending' && (
                        <span className="text-[11px] text-primary">{mt("pending")}</span>
                    )}
                    {!item.isRequired && item.status !== 'complete' && (
                        <span className="text-[11px] text-muted-foreground">{mt("optional")}</span>
                    )}
                </div>
                <p className={cn(
                    "mt-0.5 text-xs",
                    isOptionalSkipped ? "text-muted-foreground/70" : "text-muted-foreground"
                )}>
                    {item.description}
                </p>
            </div>

            {isActionable && (
                <span className="shrink-0 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    {item.status === 'pending' ? mt("view") : mt("complete")}
                </span>
            )}
        </div>
    );
}
