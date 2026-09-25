import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Utensils, Building2, ArrowRight, Calendar, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import Header from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { ChefPageHeader } from "@/components/chef/ui";
import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { hasStep2BeenSubmitted } from "@/components/chef/applications/status";
import { SmartImage } from "@/components/ui/smart-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { tt } from "@/i18n/common-ns";
import { kt } from "@/i18n/kitchen-ns";

export default function KitchenRequirementsPage() {
    const { t } = useTranslation("kitchen");
    const [locationPath, setLocation] = useLocation();
    const locationIdMatch = locationPath.match(/\/kitchen-requirements\/(\d+)/);
    const locationId = locationIdMatch ? locationIdMatch[1] : undefined;
    const { user, loading: authLoading } = useFirebaseAuth();
    const [activeView, setActiveView] = useState("discover-kitchens");
    const [hasBookingIntent, setHasBookingIntent] = useState(false);
    const [intentDateRange, setIntentDateRange] = useState<{from: string, to?: string} | null>(null);

    // Scroll to top on mount and check intent
    useEffect(() => {
        window.scrollTo(0, 0);
        
        let bestIntent = null;
        let specificIntent = null;
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && key.startsWith('kitchen_dates_')) {
                    const val = sessionStorage.getItem(key);
                    if (val) {
                        const parsed = JSON.parse(val);
                        if (parsed.from) {
                            if (key !== 'kitchen_dates_generic') {
                                specificIntent = parsed;
                            } else {
                                bestIntent = parsed;
                            }
                        }
                    }
                }
            }
        } catch(e) {}
        
        const parsedIntent = specificIntent || bestIntent;
        if (parsedIntent) {
            setHasBookingIntent(true);
            setIntentDateRange(parsedIntent);
        }
    }, []);

    const formatDateRange = () => {
        if (!intentDateRange?.from) return '';
        const fromDate = new Date(intentDateRange.from);
        if (isNaN(fromDate.getTime())) return '';
        
        // Revert forcing UTC to fix local time offsets
        const formatter = new Intl.DateTimeFormat('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
        
        const fromStr = formatter.format(fromDate);
        
        if (intentDateRange.to && intentDateRange.to !== intentDateRange.from) {
            const toDate = new Date(intentDateRange.to);
            if (!isNaN(toDate.getTime())) {
                return `${fromStr} - ${formatter.format(toDate)}`;
            }
        }
        return fromStr;
    };

    // Fetch location details (for name)
    const { data: locationData, isLoading: isLoadingLocation } = useQuery({
        queryKey: [`/api/public/locations/${locationId}/details`],
        queryFn: async () => {
            const response = await fetch(`/api/public/locations/${locationId}/details`);
            if (!response.ok) throw new Error(kt("failedToFetchLocation"));
            return response.json();
        },
        enabled: !!locationId,
    });

    // Fetch requirements
    const { data: requirements, isLoading: isLoadingReqs } = useQuery({
        queryKey: [`/api/public/locations/${locationId}/requirements`],
        queryFn: async () => {
            const response = await fetch(`/api/public/locations/${locationId}/requirements`);
            if (!response.ok) throw new Error(tt("failedToFetchRequirements"));
            return response.json();
        },
        enabled: !!locationId,
    });

    const isLoading = isLoadingLocation || isLoadingReqs || authLoading;

    // Fetch kitchen details for richer display
    const { data: kitchenData } = useQuery({
        queryKey: [`/api/public/kitchens`],
        queryFn: async () => {
            const response = await fetch(`/api/public/kitchens`);
            if (!response.ok) throw new Error(tt("failedToFetchKitchens"));
            return response.json();
        },
    });

    // Find the kitchen for this location
    const kitchen = kitchenData?.find((k: { locationId: number }) => k.locationId === Number(locationId));

    // For authenticated chefs, check if they already have an application (Step 1 done)
    const { application: existingApplication, hasApplication, isLoading: applicationLoading } = useChefKitchenApplicationForLocation(
        user && locationId ? Number(locationId) : null
    );


    /**
     * The manager has taken this location's kitchen off the listing.
     *
     * Read from the APPLICATION, which the server annotates with `locationListed` — not derived here
     * from the published kitchen list. That list is a second fetch that can fail, and re-deriving the
     * same fact on each surface is what let the chef dashboard go on offering Book for a delisted
     * kitchen. One source, carried on the thing every surface already has.
     *
     * `=== false` and never falsiness: `undefined` means the server did not say (an older payload, or
     * a read that failed), and that must behave exactly as it did before this field existed.
     *
     * The chef can still finish Step 2, and that is deliberate: the application is per LOCATION and
     * does not read the listing, so blocking it would strand every in-flight chef the moment a manager
     * paused for two weeks, and on relist they would all have to be re-prompted. The approval is a
     * durable relationship with the kitchen; the delisting is the manager's temporary state.
     *
     * What must not happen is finishing and THEN discovering the wall. Nothing on this page mentioned
     * the listing at all, so the state is stated up front instead.
     */
    const kitchenNotListed = (existingApplication as { locationListed?: boolean } | null | undefined)
        ?.locationListed === false;

    // Step 1 is "done" when the chef has a non-rejected/non-cancelled application
    const isStep1Done = hasApplication &&
        existingApplication &&
        existingApplication.status !== 'rejected' &&
        existingApplication.status !== 'cancelled';

    // Determine the current tier for label purposes
    const chefCurrentTier = (existingApplication as any)?.current_tier ?? 1;
    // Step 2 is actionable when Step 1 is approved and Step 2 docs aren't submitted yet
    const isReadyForStep2 =
        isStep1Done &&
        existingApplication?.status === "approved" &&
        chefCurrentTier < 3 &&
        !hasStep2BeenSubmitted(existingApplication);

    // Loading state with proper layout
    const loadingContent = (
        <div className="space-y-6">
            <Skeleton className="h-10 w-3/4" />
            <div className="grid gap-6 md:grid-cols-2">
                <Skeleton className="h-64 w-full rounded-xl" />
                <Skeleton className="h-64 w-full rounded-xl" />
            </div>
        </div>
    );

    // Not found state
    const notFoundContent = (
        <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-bold mb-2">{t("requirementsNotFound", "Requirements Not Found")}</h2>
            <p className="text-muted-foreground mb-6">{t("couldNotFindRequirements", "We couldn't find the requirements for this kitchen.")}</p>
            <Button onClick={() => setLocation("/dashboard?view=discover-kitchens")}>{t("backToDiscoverKitchens", "Back to Discover Kitchens")}</Button>
        </div>
    );

    // Helper to compile lists
    const getStep1Items = () => {
        if (!requirements) return [];
        const items = [
            t("personalInformation", "Personal Information"),
            (requirements.requireBusinessName || requirements.requireBusinessType) && t("businessInformation", "Business Information"),
            // Food handler upload is collected in Step 2 after request-to-apply approval
            requirements.tier1_years_experience_required && t("professionalExperience", "Professional Experience"),
            ...(Array.isArray(requirements.tier1_custom_fields)
                ? requirements.tier1_custom_fields
                    .filter((f: { required?: boolean }) => f.required)
                    .map((f: { label: string }) => f.label)
                : [])
        ].filter(Boolean);
        return items;
    };

    const getStep2Items = () => {
        if (!requirements) return [];
        const items = [
            requirements.requireFoodHandlerCert && t("foodSafetyLicense", "Food Safety Certificate") + " + " + t("foodSafetyLicenseExpiry", "Expiry Date"),
            requirements.tier2_food_establishment_cert_required && t("foodEstablishmentCertificate", "Food Establishment Certificate"),
            requirements.tier2_food_establishment_expiry_required && t("foodEstablishmentExpiry", "Food Establishment License Expiry"),
            (requirements.tier2_insurance_document_required || requirements.tier2_insurance_minimum_amount > 0) &&
            t("insuranceDocument", "Insurance Document") + (requirements.tier2_insurance_minimum_amount > 0 ? t("minAmount", { defaultValue: " (min ${amount})", amount: requirements.tier2_insurance_minimum_amount }) : ''),
            requirements.tier2_kitchen_experience_required && t("kitchenExperienceDescription", "Kitchen Experience Description"),
            ...(Array.isArray(requirements.tier2_custom_fields)
                ? requirements.tier2_custom_fields
                    .filter((f: { required?: boolean }) => f.required !== false)
                    .map((f: { label: string }) => f.label)
                : [])
        ].filter(Boolean);
        return items;
    };

    // Main content - the requirements display
    const mainContent = (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            {/*
              * Same shape as the booking-intent block below, and deliberately NEUTRAL: the tone lives
              * in the icon, never in a tinted panel, so this reads as part of the product rather than
              * as a framework alert (see components/ui/custom-alerts.tsx).
              *
              * Gated on `isStep1Done` because the copy addresses someone who HAS an application
              * ("finish YOUR application"). `kitchenNotListed` is equally true for a visitor with no
              * application at all, and telling them to finish one they never started is worse than
              * saying nothing.
              */}
            {kitchenNotListed && isStep1Done && (
                <div className="flex items-start sm:items-center gap-4 p-4 bg-muted/40 border border-border/50 rounded-lg">
                    <div className="p-2 bg-background rounded-md shadow-sm border border-border/40 shrink-0">
                        <Clock className="h-4 w-4 text-warning" />
                    </div>
                    <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none text-foreground">
                            {t("kitchenNotTakingBookings", "This kitchen is not taking bookings right now")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {t(
                              "kitchenNotTakingBookingsFinish",
                              "You can still finish your application. Booking opens again once the kitchen is listed."
                            )}
                        </p>
                    </div>
                </div>
            )}

            {hasBookingIntent && (
                <div className="flex items-start sm:items-center gap-4 p-4 bg-muted/40 border border-border/50 rounded-lg">
                    <div className="p-2 bg-background rounded-md shadow-sm border border-border/40 shrink-0">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none text-foreground">
                            {t("bookingDatesSaved", { range: formatDateRange(), defaultValue: `Booking dates saved: ${formatDateRange()}` })}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {t(
                              "completeApplicationSecureTime",
                              "Complete your application below to secure your kitchen time."
                            )}
                        </p>
                    </div>
                </div>
            )}

            {/* Header with Kitchen Info */}
            <div className="flex flex-col md:flex-row md:items-start gap-6">
                {kitchen?.imageUrl && (
                    <div className="w-full md:w-48 h-32 md:h-32 rounded-lg overflow-hidden flex-shrink-0 border">
                        <SmartImage 
                            src={kitchen.imageUrl} 
                            alt={kitchen.name || 'Kitchen'}
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}
                
                <div className="flex-1 space-y-3">
                    <Badge variant="outline" className="text-xs w-fit">
                        <Building2 className="h-3 w-3 mr-1" />
                        {t("kitchenApplication", "Kitchen Application")}
                    </Badge>
                    {/*
                     * `kitchen` first, then the LOCATION, and the location read is `locationData.name`.
                     *
                     * `/public/locations/:id/details` answers with a FLAT object —
                     * `res.json({ id, name, slug, address, … })` — so the nested
                     * `locationData.location.name` this used to read was ALWAYS undefined, and the first
                     * operand never resolved. Harmless while the kitchen is listed, because
                     * `kitchen.name` covered it; the moment the manager takes the listing down, `kitchen`
                     * is undefined too and this page lost its own subject — falling all the way through
                     * to the generic "Kitchen Requirements" with no address and no photo, which reads as
                     * the wrong page rather than as a kitchen that is simply not advertised right now.
                     *
                     * Kitchen-first on purpose: that is what this page has always rendered when the
                     * listing is up, so the reorder changes nothing that works today and only fills the
                     * hole a delisted kitchen leaves.
                     */}
                    <ChefPageHeader
                        title={kitchen?.name || locationData?.name || t('kitchenRequirements', 'Kitchen Requirements')}
                        description={
                            (kitchen?.address || locationData?.address)
                                ? `${kitchen?.address || locationData?.address}`
                                : undefined
                        }
                    />
                </div>
            </div>

            {/* Requirements Cards */}
            <div className="grid gap-6 md:grid-cols-2">
                {/* Step 1 Card — shows completed state if chef already submitted Step 1 */}
                <Card className={`shadow-none relative overflow-hidden ${
                    isStep1Done ? 'border-success/30' : 'border-border/50'
                }`}>
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-10 w-10 rounded-lg border flex items-center justify-center font-semibold text-sm text-muted-foreground">
                                {isStep1Done ? <CheckCircle2 className="h-5 w-5" /> : '1'}
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <CardTitle className="text-lg">{t("requestToApply", "Request to apply")}</CardTitle>
                                    {isStep1Done && (
                                        <Badge variant="success" className="text-xs font-medium">
                                            {t("completed", "Completed")}
                                        </Badge>
                                    )}
                                </div>
                                <CardDescription className="text-xs">
                                    {isStep1Done ? t("step1ApplicationSubmitted", "Your request to apply was submitted") : t("initialApplicationDocuments", "Initial application documents")}
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3">
                            {getStep1Items().length > 0 ? (
                                getStep1Items().map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm">
                                        <CheckCircle2 className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                                        <span className={`leading-snug ${
                                            isStep1Done ? 'text-foreground/50 line-through' : 'text-foreground/80'
                                        }`}>{item}</span>
                                    </li>
                                ))
                            ) : (
                                <li className="text-sm text-muted-foreground italic">{t("noDocsRequiredStep1", "No specific documents required for your request to apply.")}</li>
                            )}
                        </ul>
                    </CardContent>
                </Card>

                {/* Step 2 Card */}
                <Card className="shadow-none border-border/50 relative overflow-hidden">
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-10 w-10 rounded-lg border flex items-center justify-center font-semibold text-sm text-muted-foreground">
                                2
                            </div>
                            <div>
                                <CardTitle className="text-lg">{t("kitchenCoordination", "Kitchen Coordination")}</CardTitle>
                                <CardDescription className="text-xs">
                                    {t("requiredBeforeBookingShifts", "Required before booking shifts")}
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3">
                            {getStep2Items().length > 0 ? (
                                getStep2Items().map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm">
                                        <CheckCircle2 className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                                        <span className="leading-snug text-foreground/80">{item}</span>
                                    </li>
                                ))
                            ) : (
                                <li className="text-sm text-muted-foreground italic">{t("noDocsRequiredStep2", "No specific kitchen documents are required.")}</li>
                            )}
                        </ul>
                    </CardContent>
                </Card>
            </div>

            {/* CTA Section */}
            <Card className="shadow-none border-border/50">
                <CardContent className="p-8 text-center">
                    {isReadyForStep2 ? (
                        <>
                            <h3 className="text-xl font-semibold mb-2">{t("step1CompleteTimeForStep2", "Request to apply approved — next up: kitchen documents")}</h3>
                            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                                {t("initialApplicationApprovedSubmitStep2", "Your initial application was approved. Submit your Kitchen Coordination documents to unlock full kitchen access.")}
                            </p>
                            <div className="flex gap-4 justify-center">
                                <Button 
                                    size="lg" 
                                    data-testid="kitchen-requirements-submit-documents"
                                    onClick={() => setLocation(`/apply-kitchen/${locationId}`)}
                                >
                                    <ArrowRight className="mr-2 h-4 w-4" />
                                    {t("submitKitchenDocuments", "Submit kitchen documents")}
                                </Button>
                            </div>
                        </>
                    ) : isStep1Done ? (
                        <>
                            <h3 className="text-xl font-semibold mb-2">{t("applicationUnderReview", "Application Under Review")}</h3>
                            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                                {t("step1ApplicationUnderReview", "Your request to apply is being reviewed by Our Team. You’ll be notified once a decision is made.")}
                            </p>
                            <Button 
                                size="lg" 
                                onClick={() => setLocation(chefDashboardHref("applications"))}
                            >
                                {t("viewApplicationBtn", "View application")}
                            </Button>
                        </>
                    ) : (
                        <>
                            <h3 className="text-xl font-semibold mb-2">{t("readyToApplyForLocation", { defaultValue: "Ready to apply for {location}?", location: kitchen?.name || locationData?.name || t('kitchenWord', 'this kitchen') })}</h3>
                            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                                {t("ensureDocumentsReady", "Ensure you have these documents ready to speed up your verification process. The initial application takes about 5 minutes.")}
                            </p>
                            <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch sm:items-stretch">
                                {!applicationLoading && !hasApplication && (
                                    <Button 
                                        size="lg" 
                                        className="h-11 min-h-[44px] w-full sm:w-auto"
                                        onClick={() => setLocation(`/request-tour/${locationId}?kitchenId=${kitchen.id}`)}
                                    >
                                        <Calendar />
                                        {t("applyFlowScheduleTourButton", "Request tour")}
                                    </Button>
                                )}
                                <Button 
                                    size="lg" 
                                    data-testid="kitchen-requirements-start-apply"
                                    onClick={() => setLocation(`/apply-kitchen/${locationId}${kitchen?.id ? `?kitchenId=${kitchen.id}` : ""}`)}
                                    className="h-11 min-h-[44px] w-full sm:w-auto"
                                >
                                    {t("startApplication", "Start Application")}
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </motion.div>
    );

    // Determine what content to show
    const getContent = () => {
        if (isLoading) return loadingContent;
        if (!requirements) return notFoundContent;
        return mainContent;
    };

    const reqOnViewChange = (view: string) => {
        setActiveView(view);
        setLocation(chefDashboardHref(view), { replace: true });
    };

    const reqBreadcrumbs = useMemo(
        () => [
            {
                label: t("shellDiscoverKitchens", "Discover Kitchens"),
                onClick: () => setLocation("/dashboard?view=discover-kitchens"),
                navId: "discover-kitchens" as const,
            },
            // No `kitchen` fallback here on purpose: a breadcrumb names WHERE you are, and its parent
            // is already "Discover Kitchens". This read the same nested path the heading did, so it was
            // always undefined — every chef, listed or not, saw the generic "Kitchen".
            { label: locationData?.name || t("kitchenWord", "Kitchen") },
        ],
        [t, setLocation, locationData?.name]
    );

    const inShell = useChefShellChrome({
        activeView,
        onViewChange: reqOnViewChange,
        breadcrumbs: reqBreadcrumbs,
    });

    // If user is authenticated, use persistent chef shell (or layout fallback)
    if (user) {
        if (inShell) return getContent();
        return (
            <ChefDashboardLayout
                activeView={activeView}
                onViewChange={reqOnViewChange}
                breadcrumbs={reqBreadcrumbs}
            >
                {getContent()}
            </ChefDashboardLayout>
        );
    }

    // For unauthenticated    // For unauthenticated users, use public layout
    return (
        <div className="min-h-screen flex flex-col bg-gray-50">
            <Header />
            <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
                <div className="container mx-auto px-4 max-w-4xl">
                    {getContent()}
                </div>
            </main>
        </div>
    );
}
