import React from "react";
import { CheckCircle2, XCircle, AlertTriangle, Sparkles, ExternalLink } from "lucide-react";
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
    isComplete: boolean;
    isRequired: boolean;
    description?: string;
    actionLabel?: string;
    actionHref?: string;
}

export default function CompletionSummaryStep() {
    const {
        completedSteps,
        selectedLocation,
        kitchens,
        setIsOpen,
    } = useManagerOnboarding();

    // Define all setup items with their completion status
    const setupItems: SetupItem[] = [
        {
            id: "location",
            label: "Location Created",
            isComplete: !!selectedLocation,
            isRequired: true,
            description: selectedLocation?.name || "Location details configured"
        },
        {
            id: "kitchen",
            label: "Kitchen Space",
            isComplete: kitchens.length > 0,
            isRequired: true,
            description: kitchens.length > 0
                ? `${kitchens.length} kitchen${kitchens.length > 1 ? 's' : ''} configured`
                : "No kitchen created yet"
        },
        {
            id: "license",
            label: "Kitchen License",
            isComplete: !!selectedLocation?.kitchenLicenseUrl,
            isRequired: false,
            description: selectedLocation?.kitchenLicenseStatus === "approved"
                ? "Approved"
                : selectedLocation?.kitchenLicenseUrl
                    ? `Status: ${selectedLocation?.kitchenLicenseStatus || "Pending"}`
                    : "Not uploaded"
        },
        {
            id: "availability",
            label: "Availability Set",
            isComplete: !!completedSteps["availability"],
            isRequired: true,
            description: "Kitchen operating hours configured"
        },
        {
            id: "payment",
            label: "Payment Setup (Stripe)",
            isComplete: !!completedSteps["payment-setup"],
            isRequired: true,
            description: "Required to receive payouts",
            actionLabel: "Set up payments",
            actionHref: "/manager/settings?tab=stripe"
        },
        {
            id: "storage",
            label: "Storage Listings",
            isComplete: !!completedSteps["storage-listings"],
            isRequired: false,
            description: "Optional storage options for chefs"
        },
        {
            id: "equipment",
            label: "Equipment Listings",
            isComplete: !!completedSteps["equipment-listings"],
            isRequired: false,
            description: "Optional equipment rentals"
        },
    ];

    // Calculate progress
    const requiredItems = setupItems.filter(item => item.isRequired);
    const completedRequiredItems = requiredItems.filter(item => item.isComplete);
    const progressPercentage = Math.round((completedRequiredItems.length / requiredItems.length) * 100);

    const isReadyForBookings = completedRequiredItems.length === requiredItems.length;
    const pendingRequiredItems = requiredItems.filter(item => !item.isComplete);

    const handleClose = () => {
        setIsOpen(false);
    };

    return (
        <div className="space-y-6 animate-in fade-in zoom-in duration-300 max-w-2xl mx-auto">
            {/* Header */}
            <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                    <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Setup Complete!</h2>
                <p className="text-muted-foreground">
                    Here's a summary of your kitchen setup progress
                </p>
            </div>

            {/* Progress Card */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Booking Readiness</CardTitle>
                        <Badge variant={isReadyForBookings ? "default" : "secondary"}>
                            {progressPercentage}% Complete
                        </Badge>
                    </div>
                    <CardDescription>
                        {isReadyForBookings
                            ? "Your kitchen is ready to accept bookings!"
                            : `Complete ${pendingRequiredItems.length} more required item${pendingRequiredItems.length > 1 ? 's' : ''} to start accepting bookings`
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Progress value={progressPercentage} className="h-2" />
                </CardContent>
            </Card>

            {/* Alert for pending required items */}
            {!isReadyForBookings && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Action Required</AlertTitle>
                    <AlertDescription>
                        Complete the following to start accepting bookings:
                        <ul className="list-disc list-inside mt-2 space-y-1">
                            {pendingRequiredItems.map(item => (
                                <li key={item.id}>{item.label}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            {/* Setup Items List */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Setup Checklist</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                    {setupItems.map((item, index) => (
                        <React.Fragment key={item.id}>
                            <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50 transition-colors">
                                <div className="flex items-center gap-3">
                                    {item.isComplete ? (
                                        <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                                    ) : item.isRequired ? (
                                        <XCircle className="w-5 h-5 text-destructive shrink-0" />
                                    ) : (
                                        <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                                    )}
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className={`font-medium ${item.isComplete ? "text-foreground" : "text-muted-foreground"}`}>
                                                {item.label}
                                            </span>
                                            {item.isRequired && !item.isComplete && (
                                                <Badge variant="destructive" className="text-xs px-1.5 py-0">Required</Badge>
                                            )}
                                            {!item.isRequired && (
                                                <Badge variant="outline" className="text-xs px-1.5 py-0">Optional</Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground">{item.description}</p>
                                    </div>
                                </div>
                                {!item.isComplete && item.actionHref && (
                                    <Button variant="outline" size="sm" asChild>
                                        <a href={item.actionHref}>
                                            {item.actionLabel} <ExternalLink className="w-3 h-3 ml-1" />
                                        </a>
                                    </Button>
                                )}
                            </div>
                            {index < setupItems.length - 1 && <Separator />}
                        </React.Fragment>
                    ))}
                </CardContent>
            </Card>

            {/* Next Steps */}
            <Card className="bg-primary/5 border-primary/20">
                <CardHeader>
                    <CardTitle className="text-lg">What's Next?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <ul className="space-y-2 text-sm">
                        {isReadyForBookings ? (
                            <>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                    <span>Your kitchen is <strong>live</strong> and visible to chefs</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                    <span>You'll receive notifications when chefs request bookings</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                    <span>Manage bookings from your dashboard</span>
                                </li>
                            </>
                        ) : (
                            <>
                                <li className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                                    <span>Complete required items above to go live</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                                    <span>You can access this wizard anytime from the Help menu</span>
                                </li>
                            </>
                        )}
                    </ul>
                </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex justify-center gap-4 pt-4">
                <Button size="lg" onClick={handleClose}>
                    Go to Dashboard
                </Button>
            </div>
        </div>
    );
}
