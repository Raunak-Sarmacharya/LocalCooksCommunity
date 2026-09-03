import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import React, { useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
    CheckCircle2,
    Circle,
    Clock,
    ArrowRight,
    Building,
    ChefHat,
    CalendarClock,
    ClipboardList,
    FileCheck,
    CreditCard,
    Package,
    Wrench,
    PartyPopper,
    AlertCircle,
    Shield,
    Rocket,
    Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";

interface SetupItem {
    id: string;
    icon: React.ElementType;
    label: string;
    status: 'complete' | 'pending' | 'incomplete' | 'skipped';
    isRequired: boolean;
    description: string;
    stepId: string;
}

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
            icon: Building,
            label: mt("onboardingBusinessDetails"),
            status: selectedLocation ? 'complete' : 'incomplete',
            isRequired: true,
            description: selectedLocation?.name || mt("onboardingAddBusinessInfo"),
            stepId: 'location'
        });

        // 2. Kitchen Space
        items.push({
            id: "kitchen",
            icon: ChefHat,
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
            icon: CalendarClock,
            label: mt("onboardingAvailability"),
            status: hasAvailability ? 'complete' : 'incomplete',
            isRequired: true,
            description: hasAvailability ? mt("onboardingScheduleConfigured") : mt("onboardingSetOperatingHours"),
            stepId: 'availability'
        });

        // 4. Application Requirements
        items.push({
            id: "requirements",
            icon: ClipboardList,
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
            icon: FileCheck,
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
            icon: CreditCard,
            label: mt("onboardingPayments"),
            status: isStripeOnboardingComplete ? 'complete' : 'incomplete',
            isRequired: true,
            description: isStripeOnboardingComplete ? mt("onboardingStripeConnected") : mt("onboardingConnectStripe"),
            stepId: 'payment-setup'
        });

        // 7. Equipment (Optional)
        const hasEquipment = equipmentForm?.listings?.length > 0;
        items.push({
            id: "equipment",
            icon: Wrench,
            label: mt("onboardingEquipment"),
            status: hasEquipment ? 'complete' : 'skipped',
            isRequired: false,
            description: hasEquipment ? mt("onboardingListingsCount", { count: equipmentForm.listings.length }) : mt("optional"),
            stepId: 'equipment-listings'
        });

        // 8. Storage (Optional)
        const hasStorage = storageForm?.listings?.length > 0;
        items.push({
            id: "storage",
            icon: Package,
            label: mt("onboardingStorage"),
            status: hasStorage ? 'complete' : 'skipped',
            isRequired: false,
            description: hasStorage ? mt("onboardingListingsCount", { count: storageForm.listings.length }) : mt("optional"),
            stepId: 'storage-listings'
        });

        return items;
    }, [selectedLocation, kitchens, hasAvailability, hasRequirements, isStripeOnboardingComplete, storageForm, equipmentForm]);

    // Calculate readiness - License pending counts as "done" for onboarding completion
    const requiredItems = setupItems.filter(item => item.isRequired);
    
    // For onboarding completion: license pending OR approved counts as done
    const completedOrPendingRequired = requiredItems.filter(item => 
        item.status === 'complete' || item.status === 'pending'
    );
    
    // For accepting bookings: only fully complete items count
    const fullyCompletedRequired = requiredItems.filter(item => item.status === 'complete');
    
    // License status helpers
    const licenseItem = setupItems.find(item => item.id === 'license');
    const isLicensePending = licenseItem?.status === 'pending';
    const isLicenseApproved = licenseItem?.status === 'complete';
    
    // Onboarding is complete when all steps done (license can be pending)
    const isOnboardingComplete = completedOrPendingRequired.length === requiredItems.length;
    
    // Ready for bookings when ALL items are fully complete (license must be approved)
    const isFullyReady = fullyCompletedRequired.length === requiredItems.length;
    
    // Progress shows completion percentage (pending counts toward progress)
    const readinessPercentage = Math.round((completedOrPendingRequired.length / requiredItems.length) * 100);
    
    // Items that still need action (not complete AND not pending)
    const incompleteRequired = requiredItems.filter(item => item.status === 'incomplete');

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
            {/* Hero Section */}
            <div className="text-center mb-8">
                <div className={cn(
                    "inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4",
                    isFullyReady
                        ? "bg-emerald-100 dark:bg-emerald-900/30"
                        : isOnboardingComplete && isLicensePending
                            ? "bg-amber-100 dark:bg-amber-900/30"
                            : "bg-slate-100 dark:bg-slate-800"
                )}>
                    {isFullyReady ? (
                        <PartyPopper className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                    ) : isOnboardingComplete && isLicensePending ? (
                        <Shield className="w-7 h-7 text-amber-600 dark:text-amber-400" />
                    ) : (
                        <ClipboardList className="w-7 h-7 text-slate-500 dark:text-slate-400" />
                    )}
                </div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 tracking-tight mb-1">
                    {isFullyReady 
                        ? mt("youreAllSet")
                        : isOnboardingComplete && isLicensePending
                            ? mt("setupCompleteTitle")
                            : mt("almostThereShort")
                    }
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    {isFullyReady
                        ? mt("kitchenReadyForBookings")
                        : isOnboardingComplete && isLicensePending
                            ? mt("licenseUnderReviewBookWhenApproved")
                            : mt("completeMoreSteps", { count: incompleteRequired.length })
                    }
                </p>
            </div>

            {/* Progress Indicator */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{mt("setupProgress")}</span>
                    <span className={cn(
                        "text-xs font-medium",
                        isFullyReady ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"
                    )}>
                        {mt("requiredStepsProgress", {
                            completed: completedOrPendingRequired.length,
                            total: requiredItems.length,
                        })}
                    </span>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className={cn(
                            "h-full transition-all duration-500 ease-out rounded-full",
                            isFullyReady
                                ? "bg-emerald-500"
                                : "bg-gradient-to-r from-amber-400 to-amber-500"
                        )}
                        style={{ width: `${readinessPercentage}%` }}
                    />
                </div>
            </div>

            {/* License Under Review Banner - Shows when onboarding complete but license pending */}
            {isOnboardingComplete && isLicensePending && (
                <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-amber-50 via-orange-50/50 to-amber-50 dark:from-amber-950/30 dark:via-amber-900/20 dark:to-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
                    <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{mt("licenseUnderReview")}</p>
                            <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-0.5">{mt("yourKitchenLicenseIsBeingVerifiedThisTypicallyTakes12Busines")}</p>
                        </div>
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/60 dark:bg-amber-950/40 ring-1 ring-amber-200/60 dark:ring-amber-800/40">
                            <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{mt("pending")}</span>
                        </div>
                    </div>
                    
                    {/* Progress steps */}
                    <div className="mt-4 pt-3 border-t border-amber-200/40 dark:border-amber-800/30">
                        <div className="flex items-center gap-4 text-xs">
                            <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                <span className="text-slate-600 dark:text-slate-400">{mt("setupDone")}</span>
                            </div>
                            <ArrowRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                            <div className="flex items-center gap-1.5">
                                <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                                <span className="text-amber-700 dark:text-amber-300 font-medium">{mt("licenseReview")}</span>
                            </div>
                            <ArrowRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                            <div className="flex items-center gap-1.5 opacity-50">
                                <Rocket className="w-3.5 h-3.5 text-slate-400" />
                                <span className="text-slate-400">{mt("acceptBookings")}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Alert for incomplete required items - Only when onboarding NOT complete */}
            {!isOnboardingComplete && incompleteRequired.length > 0 && (
                <div className="mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/40">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{mt("completeRequiredSteps")}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{mt("finishTheHighlightedStepsBelowToCompleteYourSetup")}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Setup Checklist - Notion-style */}
            <div className="space-y-1 mb-10">
                {setupItems.map((item) => (
                    <SetupItemRow
                        key={item.id}
                        item={item}
                        onAction={() => goToStep(item.stepId)}
                    />
                ))}
            </div>

            {/* CTA Section */}
            <div className="flex flex-col items-center gap-4">
                <Button
                    size="lg"
                    onClick={handleClose}
                    disabled={isCompletingOnboarding}
                    className={cn(
                        "h-12 px-8 text-base font-medium shadow-sm hover:shadow-md transition-all duration-200",
                        isFullyReady && "bg-success text-success-foreground hover:bg-success/90",
                        isOnboardingComplete && isLicensePending && ""
                    )}
                >
                    {isCompletingOnboarding ? (
                        <>
                            <Loader2 className="mr-2 w-4 h-4 animate-spin" />{mt("completing")}</>
                    ) : (
                        <>
                            {isFullyReady || isOnboardingComplete
                                ? mt("goToDashboard")
                                : mt("continueToDashboard")}
                            <ArrowRight className="ml-2 w-4 h-4" />
                        </>
                    )}
                </Button>
                {isOnboardingComplete && isLicensePending && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center max-w-xs font-medium">{mt("weLlNotifyYouOnceYourLicenseIsApproved")}</p>
                )}
                {!isOnboardingComplete && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-xs">{mt("youCanCompleteTheRemainingStepsAnytimeFromYourDashboardSetti")}</p>
                )}
            </div>
        </div>
    );
}

interface SetupItemRowProps {
    item: SetupItem;
    onAction: () => void;
}

function SetupItemRow({ item, onAction }: SetupItemRowProps) {
    const Icon = item.icon;
    const isActionable = item.status === 'incomplete' || item.status === 'pending';
    const isOptionalSkipped = !item.isRequired && item.status === 'skipped';

    return (
        <div
            className={cn(
                "group flex items-center gap-3 p-3 rounded-lg transition-all duration-200",
                isActionable && "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50",
                !isActionable && !isOptionalSkipped && "opacity-90"
            )}
            onClick={isActionable ? onAction : undefined}
        >
            {/* Status Indicator */}
            <div className="shrink-0">
                {item.status === 'complete' ? (
                    <div className="w-8 h-8 rounded-md bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                ) : item.status === 'pending' ? (
                    <div className="w-8 h-8 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                ) : item.status === 'incomplete' ? (
                    <div className={cn(
                        "w-8 h-8 rounded-md flex items-center justify-center",
                        item.isRequired
                            ? "bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200 dark:ring-red-800/50"
                            : "bg-slate-100 dark:bg-slate-800"
                    )}>
                        <Circle className={cn(
                            "w-4 h-4",
                            item.isRequired
                                ? "text-red-400 dark:text-red-500"
                                : "text-slate-400 dark:text-slate-500"
                        )} />
                    </div>
                ) : (
                    <div className="w-8 h-8 rounded-md bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className={cn(
                        "text-sm font-medium",
                        item.status === 'complete' && "text-slate-700 dark:text-slate-300",
                        item.status === 'pending' && "text-amber-700 dark:text-amber-300",
                        item.status === 'incomplete' && item.isRequired && "text-slate-900 dark:text-slate-100",
                        item.status === 'incomplete' && !item.isRequired && "text-slate-500 dark:text-slate-400",
                        isOptionalSkipped && "text-slate-400 dark:text-slate-500"
                    )}>
                        {item.label}
                    </span>
                    {item.isRequired && item.status !== 'complete' && item.status !== 'pending' && (
                        <span className="text-[10px] font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">{mt("required")}</span>
                    )}
                    {item.status === 'pending' && (
                        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">{mt("pending")}</span>
                    )}
                    {!item.isRequired && item.status !== 'complete' && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{mt("optional")}</span>
                    )}
                </div>
                <p className={cn(
                    "text-xs",
                    isOptionalSkipped ? "text-slate-300 dark:text-slate-600" : "text-slate-500 dark:text-slate-400"
                )}>
                    {item.description}
                </p>
            </div>

            {/* Action */}
            {isActionable && (
                <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-xs font-medium text-primary">
                        {item.status === 'pending' ? mt("view") : mt("complete")}
                    </span>
                </div>
            )}
        </div>
    );
}
