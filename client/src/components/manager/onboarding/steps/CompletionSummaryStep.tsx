import React, { useMemo } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Sparkles, ExternalLink, Clock, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useManagerOnboarding } from "../ManagerOnboardingContext";

interface SetupItem {
    id: string;
    label: string;
    status: 'complete' | 'pending' | 'incomplete' | 'optional_skipped';
    isRequired: boolean;
    description?: string;
    actionLabel?: string;
    actionHref?: string;
    stepId?: string; // [NEW] For goToStep navigation
}

export default function CompletionSummaryStep() {
    const {
        selectedLocation,
        kitchens,
        setIsOpen,
        isStripeOnboardingComplete,
        hasAvailability,
        hasRequirements, // [NEW] For requirements tracking
        storageForm,
        equipmentForm,
        goToStep,
    } = useManagerOnboarding();

    // Calculate status for each item
    const setupItems: SetupItem[] = useMemo(() => {
        const items: SetupItem[] = [];

        // 1. Location
        items.push({
            id: "location",
            label: "Location Details",
            status: selectedLocation ? 'complete' : 'incomplete',
            isRequired: true,
            description: selectedLocation?.name || "Address and contact info",
            stepId: 'location'
        });

        // 2. Kitchen
        items.push({
            id: "kitchen",
            label: "Kitchen Space",
            status: kitchens.length > 0 ? 'complete' : 'incomplete',
            isRequired: true,
            description: kitchens.length > 0
                ? `${kitchens.length} kitchen${kitchens.length > 1 ? 's' : ''} added`
                : "Define your kitchen spaces",
            stepId: 'create-kitchen'
        });

        // 3. Requirements (Chef application settings)
        items.push({
            id: "requirements",
            label: "Application Requirements",
            status: hasRequirements ? 'complete' : 'incomplete',
            isRequired: true,
            description: hasRequirements
                ? "Chef application fields configured"
                : "Configure chef application fields",
            stepId: 'application-requirements'
        });

        // 4. License
        // Logic: Complete if approved. Pending if uploaded but not approved. Incomplete if not uploaded.
        // If status is empty/null but url exists -> Pending
        const licenseStatus = selectedLocation?.kitchenLicenseStatus;
        const hasLicenseUrl = !!selectedLocation?.kitchenLicenseUrl;

        let licenseItemStatus: SetupItem['status'] = 'incomplete';
        if (licenseStatus === 'approved') licenseItemStatus = 'complete';
        // Only pending if URL exists. If status is pending but no URL, it's incomplete (invalid state).
        else if (hasLicenseUrl && (licenseStatus === 'pending' || !licenseStatus)) licenseItemStatus = 'pending';

        items.push({
            id: "license",
            label: "Kitchen License",
            status: licenseItemStatus,
            isRequired: true,
            description: licenseItemStatus === 'complete'
                ? "Approved"
                : licenseItemStatus === 'pending'
                    ? "Uploaded - Pending Approval"
                    : "Required for activation",
            stepId: 'location' // License is uploaded on Location step
        });

        // 4. Availability
        items.push({
            id: "availability",
            label: "Availability Schedule",
            status: hasAvailability ? 'complete' : 'incomplete',
            isRequired: true,
            description: hasAvailability ? "Operating hours set" : "Set when you are open",
            stepId: 'availability'
        });

        // 5. Payment
        items.push({
            id: "payment",
            label: "Payment Setup",
            status: isStripeOnboardingComplete ? 'complete' : 'incomplete',
            isRequired: true,
            description: isStripeOnboardingComplete ? "Connected to Stripe" : "Required for payouts",
            actionLabel: !isStripeOnboardingComplete ? "Setup Payments" : undefined,
            actionHref: "/manager/settings?tab=stripe",
            stepId: 'payment-setup'
        });

        // 6. Storage (Optional)
        const hasStorage = storageForm?.listings?.length > 0;
        items.push({
            id: "storage",
            label: "Storage Listings",
            status: hasStorage ? 'complete' : 'optional_skipped',
            isRequired: false,
            description: hasStorage ? `${storageForm.listings.length} listings` : "Optional add-on"
        });

        // 7. Equipment (Optional)
        const hasEquipment = equipmentForm?.listings?.length > 0;
        items.push({
            id: "equipment",
            label: "Equipment Listings",
            status: hasEquipment ? 'complete' : 'optional_skipped',
            isRequired: false,
            description: hasEquipment ? `${equipmentForm.listings.length} listings` : "Optional add-on"
        });

        return items;
    }, [selectedLocation, kitchens, hasAvailability, isStripeOnboardingComplete, storageForm, equipmentForm]);

    // Calculate Readiness (Only Required Items count towards "Blocking")
    const requiredItems = setupItems.filter(item => item.isRequired);
    // For Readiness, we count 'complete' as good. 
    // Is 'pending' (license) "ready"? User says "until I'm approved I won't be able to take bookings".
    // So Pending is NOT ready.
    const completedRequiredItems = requiredItems.filter(item => item.status === 'complete');
    const readinessPercentage = Math.round((completedRequiredItems.length / requiredItems.length) * 100);
    const isFullyReady = completedRequiredItems.length === requiredItems.length;

    const blockingItems = requiredItems.filter(item => item.status !== 'complete');

    const handleClose = () => {
        setIsOpen(false);
    };

    return (
        <div className="space-y-6 animate-in fade-in zoom-in duration-300 max-w-2xl mx-auto pb-10">
            {/* Header */}
            <div className="text-center space-y-2">
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${isFullyReady ? 'bg-green-100' : 'bg-amber-100'}`}>
                    {isFullyReady ? (
                        <Sparkles className="w-8 h-8 text-green-600" />
                    ) : (
                        <Clock className="w-8 h-8 text-amber-600" />
                    )}
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Onboarding Summary</h2>
                <p className="text-muted-foreground">
                    {isFullyReady
                        ? "You are all set! Your kitchen is ready for business."
                        : "Review your setup status below."}
                </p>
            </div>

            {/* Readiness Card */}
            <Card className={isFullyReady ? "border-green-200 bg-green-50/30" : ""}>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Profile Readiness</CardTitle>
                        <Badge variant={isFullyReady ? "default" : "secondary"} className={isFullyReady ? "bg-green-600 hover:bg-green-700" : ""}>
                            {readinessPercentage}% Ready
                        </Badge>
                    </div>
                    <CardDescription>
                        {isFullyReady
                            ? "Your kitchen is live!"
                            : `${blockingItems.length} required steps remaining to accept bookings`
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Progress value={readinessPercentage} className={`h-2 ${isFullyReady ? "[&>div]:bg-green-600" : ""}`} />
                </CardContent>
            </Card>

            {/* Blocking Alerts */}
            {blockingItems.length > 0 && (
                <Alert variant={blockingItems.some(i => i.status === 'pending') ? "default" : "destructive"}>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Attention Needed</AlertTitle>
                    <AlertDescription>
                        <ul className="list-disc list-inside mt-2 space-y-1">
                            {blockingItems.map(item => (
                                <li key={item.id}>
                                    <span className="font-medium">{item.label}</span>:
                                    {item.status === 'pending' ? " Waiting for approval" : " Incomplete"}
                                </li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            {/* Detailed Checklist */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Detailed Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-0 divide-y">
                    {setupItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                            <div className="flex items-center gap-4">
                                {/* Status Icon */}
                                <div className="shrink-0">
                                    {item.status === 'complete' && (
                                        <CheckCircle2 className="w-6 h-6 text-green-600" />
                                    )}
                                    {item.status === 'pending' && (
                                        <Clock className="w-6 h-6 text-amber-500" />
                                    )}
                                    {item.status === 'incomplete' && (
                                        <XCircle className="w-6 h-6 text-destructive" />
                                    )}
                                    {item.status === 'optional_skipped' && (
                                        <div className="w-6 h-6 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center">
                                            <div className="w-2 h-2 rounded-full bg-gray-300" />
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className={item.status === 'optional_skipped' ? "text-muted-foreground" : "font-medium"}>
                                            {item.label}
                                        </span>
                                        {item.isRequired && item.status !== 'complete' && item.status !== 'pending' && (
                                            <Badge variant="destructive" className="text-[10px] px-1.5 h-5">Required</Badge>
                                        )}
                                        {item.status === 'pending' && (
                                            <Badge variant="secondary" className="text-[10px] px-1.5 h-5 bg-amber-100 text-amber-800 hover:bg-amber-200">Pending</Badge>
                                        )}
                                        {!item.isRequired && (
                                            <Badge variant="outline" className="text-[10px] px-1.5 h-5 text-muted-foreground border-muted-foreground/30">Optional</Badge>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted-foreground">{item.description}</p>
                                </div>
                            </div>

                            {/* Action */}
                            {item.actionHref && item.status !== 'complete' && (
                                <Button variant="outline" size="sm" asChild>
                                    <a href={item.actionHref} target="_blank" rel="noopener noreferrer">
                                        {item.actionLabel} <ExternalLink className="w-3 h-3 ml-1" />
                                    </a>
                                </Button>
                            )}
                            {/* [NEW] Complete Now button for incomplete items with stepId */}
                            {item.status === 'incomplete' && item.stepId && !item.actionHref && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => goToStep(item.stepId!)}
                                    className="text-primary border-primary hover:bg-primary/5"
                                >
                                    Complete Now
                                </Button>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Footer Action */}
            <div className="flex justify-center pt-4">
                <Button size="lg" onClick={handleClose} className="px-8">
                    Go to Dashboard
                </Button>
            </div>
        </div>
    );
}
