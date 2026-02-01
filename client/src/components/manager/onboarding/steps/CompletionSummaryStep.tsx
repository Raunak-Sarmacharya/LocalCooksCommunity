import React, { useMemo } from "react";
import { useLocation } from "wouter";
import { 
    CheckCircle2, 
    Circle, 
    Clock, 
    Sparkles, 
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
    AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

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
    const {
        selectedLocation,
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
            label: "Business Details",
            status: selectedLocation ? 'complete' : 'incomplete',
            isRequired: true,
            description: selectedLocation?.name || "Add your business information",
            stepId: 'location'
        });

        // 2. Kitchen Space
        items.push({
            id: "kitchen",
            icon: ChefHat,
            label: "Kitchen Space",
            status: kitchens.length > 0 ? 'complete' : 'incomplete',
            isRequired: true,
            description: kitchens.length > 0
                ? `${kitchens.length} kitchen${kitchens.length > 1 ? 's' : ''} configured`
                : "Set up your kitchen spaces",
            stepId: 'create-kitchen'
        });

        // 3. Availability
        items.push({
            id: "availability",
            icon: CalendarClock,
            label: "Availability",
            status: hasAvailability ? 'complete' : 'incomplete',
            isRequired: true,
            description: hasAvailability ? "Schedule configured" : "Set your operating hours",
            stepId: 'availability'
        });

        // 4. Application Requirements
        items.push({
            id: "requirements",
            icon: ClipboardList,
            label: "Chef Requirements",
            status: hasRequirements ? 'complete' : 'incomplete',
            isRequired: true,
            description: hasRequirements ? "Application fields set" : "Configure application fields",
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
            label: "Kitchen License",
            status: licenseItemStatus,
            isRequired: true,
            description: licenseItemStatus === 'complete' 
                ? "Verified" 
                : licenseItemStatus === 'pending' 
                    ? "Awaiting verification" 
                    : "Upload your license",
            stepId: 'location'
        });

        // 6. Payment Setup
        items.push({
            id: "payment",
            icon: CreditCard,
            label: "Payments",
            status: isStripeOnboardingComplete ? 'complete' : 'incomplete',
            isRequired: true,
            description: isStripeOnboardingComplete ? "Stripe connected" : "Connect to receive payouts",
            stepId: 'payment-setup'
        });

        // 7. Equipment (Optional)
        const hasEquipment = equipmentForm?.listings?.length > 0;
        items.push({
            id: "equipment",
            icon: Wrench,
            label: "Equipment",
            status: hasEquipment ? 'complete' : 'skipped',
            isRequired: false,
            description: hasEquipment ? `${equipmentForm.listings.length} listings` : "Optional",
            stepId: 'equipment-listings'
        });

        // 8. Storage (Optional)
        const hasStorage = storageForm?.listings?.length > 0;
        items.push({
            id: "storage",
            icon: Package,
            label: "Storage",
            status: hasStorage ? 'complete' : 'skipped',
            isRequired: false,
            description: hasStorage ? `${storageForm.listings.length} listings` : "Optional",
            stepId: 'storage-listings'
        });

        return items;
    }, [selectedLocation, kitchens, hasAvailability, hasRequirements, isStripeOnboardingComplete, storageForm, equipmentForm]);

    // Calculate readiness
    const requiredItems = setupItems.filter(item => item.isRequired);
    const completedRequired = requiredItems.filter(item => item.status === 'complete');
    const readinessPercentage = Math.round((completedRequired.length / requiredItems.length) * 100);
    const isFullyReady = completedRequired.length === requiredItems.length;
    const incompleteRequired = requiredItems.filter(item => item.status === 'incomplete' || item.status === 'pending');

    const handleClose = () => {
        setIsOpen(false);
        setLocation('/manager/dashboard');
    };

    return (
        <div className="animate-in fade-in duration-500">
            {/* Hero Section */}
            <div className="text-center mb-8">
                <div className={cn(
                    "inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4",
                    isFullyReady 
                        ? "bg-emerald-100 dark:bg-emerald-900/30" 
                        : "bg-amber-100 dark:bg-amber-900/30"
                )}>
                    {isFullyReady ? (
                        <PartyPopper className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                        <Sparkles className="w-7 h-7 text-amber-600 dark:text-amber-400" />
                    )}
                </div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 tracking-tight mb-1">
                    {isFullyReady ? "You're all set!" : "Almost there"}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    {isFullyReady 
                        ? "Your kitchen is ready to accept bookings."
                        : `Complete ${incompleteRequired.length} more step${incompleteRequired.length > 1 ? 's' : ''} to start accepting bookings.`
                    }
                </p>
            </div>

            {/* Progress Indicator */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Setup Progress</span>
                    <span className={cn(
                        "text-xs font-medium",
                        isFullyReady ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"
                    )}>
                        {completedRequired.length}/{requiredItems.length} required
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

            {/* Alert for incomplete required items */}
            {!isFullyReady && incompleteRequired.length > 0 && (
                <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                Required to accept bookings
                            </p>
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                Complete the highlighted steps below to start receiving chef bookings.
                            </p>
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
                    className={cn(
                        "h-12 px-8 text-base font-medium",
                        isFullyReady 
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : "bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 text-white",
                        "shadow-sm hover:shadow-md transition-all duration-200"
                    )}
                >
                    {isFullyReady ? "Go to Dashboard" : "Continue to Dashboard"}
                    <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
                {!isFullyReady && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-xs">
                        You can complete the remaining steps anytime from your dashboard settings.
                    </p>
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
                        <span className="text-[10px] font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">
                            Required
                        </span>
                    )}
                    {item.status === 'pending' && (
                        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">
                            Pending
                        </span>
                    )}
                    {!item.isRequired && item.status !== 'complete' && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            Optional
                        </span>
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
                        {item.status === 'pending' ? 'View' : 'Complete'}
                    </span>
                </div>
            )}
        </div>
    );
}
