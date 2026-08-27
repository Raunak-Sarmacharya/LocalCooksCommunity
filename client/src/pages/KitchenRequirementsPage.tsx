import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Utensils, Building2, ArrowRight, Calendar } from "lucide-react";
import { KitchenNextStepsDescription } from "@/components/common/KitchenNextStepsDescription";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { ChefPageHeader } from "@/components/chef/ui";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import ScheduleViewingWidget from "@/components/chef/ScheduleViewingWidget";
import { SmartImage } from "@/components/ui/smart-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function KitchenRequirementsPage() {
    const { t: tAuth } = useTranslation("auth");
    const { t } = useTranslation("kitchen");
    const [locationPath, setLocation] = useLocation();
    const locationIdMatch = locationPath.match(/\/kitchen-requirements\/(\d+)/);
    const locationId = locationIdMatch ? locationIdMatch[1] : undefined;
    const { user, loading: authLoading } = useFirebaseAuth();
    const { openAuthModal } = useAuthModal();
    const [activeView, setActiveView] = useState("discover-kitchens");
    const [showTourModal, setShowTourModal] = useState(false);
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
            if (!response.ok) throw new Error('Failed to fetch location');
            return response.json();
        },
        enabled: !!locationId,
    });

    // Fetch requirements
    const { data: requirements, isLoading: isLoadingReqs } = useQuery({
        queryKey: [`/api/public/locations/${locationId}/requirements`],
        queryFn: async () => {
            const response = await fetch(`/api/public/locations/${locationId}/requirements`);
            if (!response.ok) throw new Error('Failed to fetch requirements');
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
            if (!response.ok) throw new Error('Failed to fetch kitchens');
            return response.json();
        },
    });

    // Find the kitchen for this location
    const kitchen = kitchenData?.find((k: { locationId: number }) => k.locationId === Number(locationId));

    // For authenticated chefs, check if they already have an application (Step 1 done)
    const { application: existingApplication, hasApplication } = useChefKitchenApplicationForLocation(
        user && locationId ? Number(locationId) : null
    );

    // Step 1 is "done" when the chef has a non-rejected/non-cancelled application
    const isStep1Done = hasApplication &&
        existingApplication &&
        existingApplication.status !== 'rejected' &&
        existingApplication.status !== 'cancelled';

    // Determine the current tier for label purposes
    const chefCurrentTier = (existingApplication as any)?.current_tier ?? 1;
    // Step 2 is actionable when Step 1 is approved (status approved, still on tier 1 => needs step 2)
    const isReadyForStep2 = isStep1Done &&
        existingApplication?.status === 'approved' &&
        chefCurrentTier < 3;

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
            requirements.requireFoodHandlerCert && t("foodHandlerCertificate", "Food Handler Certificate"),
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
            requirements.tier2_food_establishment_cert_required && t("foodEstablishmentCertificate", "Food Establishment Certificate"),
            (requirements.tier2_insurance_document_required || requirements.tier2_insurance_minimum_amount > 0) &&
            t("insuranceDocument", "Insurance Document") + (requirements.tier2_insurance_minimum_amount > 0 ? t("minAmount", { defaultValue: " (min ${amount})", amount: requirements.tier2_insurance_minimum_amount }) : ''),
            requirements.tier2_kitchen_experience_required && t("kitchenExperienceDescription", "Kitchen Experience Description"),
            ...(Array.isArray(requirements.tier2_custom_fields)
                ? requirements.tier2_custom_fields
                    .filter((f: { required?: boolean }) => f.required)
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
            {hasBookingIntent && (
                <div className="flex items-start sm:items-center gap-4 p-4 bg-muted/40 border border-border/50 rounded-lg">
                    <div className="p-2 bg-background rounded-md shadow-sm border border-border/40 shrink-0">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none text-foreground">
                            Booking dates saved: {formatDateRange()}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            Complete your application below to secure your kitchen time.
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
                    <ChefPageHeader
                        title={locationData?.location?.name || kitchen?.name || t('kitchenRequirements', 'Kitchen Requirements')}
                        description={
                            (locationData?.location?.address || kitchen?.address)
                                ? `${locationData?.location?.address || kitchen?.address}`
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
                                    <CardTitle className="text-lg">{t("applicationRequirements", "Application Requirements")}</CardTitle>
                                    {isStep1Done && (
                                        <Badge variant="success" className="text-xs font-medium">
                                            {t("completed", "Completed")}
                                        </Badge>
                                    )}
                                </div>
                                <CardDescription className="text-xs">
                                    {isStep1Done ? t("step1ApplicationSubmitted", "Your Step 1 application was submitted") : t("initialApplicationDocuments", "Initial application documents")}
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
                                <li className="text-sm text-muted-foreground italic">{t("noDocsRequiredStep1", "No specific documents required for Step 1.")}</li>
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
                                <li className="text-sm text-muted-foreground italic">{t("noDocsRequiredStep2", "No specific documents required for Step 2.")}</li>
                            )}
                        </ul>
                    </CardContent>
                </Card>
            </div>

            {/* Schedule Viewing Widget as Modal */}
            {user && !isStep1Done && (
                <ScheduleViewingWidget 
                    locationId={Number(locationId)} 
                    locationName={locationData?.location?.name || kitchen?.name}
                    targetedKitchenId={kitchen?.id} 
                    targetedKitchenName={kitchen?.name}
                    mode="modal"
                    open={showTourModal}
                    onClose={() => setShowTourModal(false)}
                />
            )}

            {/* CTA Section */}
            <Card className="shadow-none border-border/50">
                <CardContent className="p-8 text-center">
                    <div className="w-14 h-14 rounded-lg border flex items-center justify-center mx-auto mb-4">
                        {isReadyForStep2
                            ? <ArrowRight className="h-7 w-7 text-muted-foreground" />
                            : <Utensils className="h-7 w-7 text-muted-foreground" />
                        }
                    </div>
                    {isReadyForStep2 ? (
                        <>
                            <h3 className="text-xl font-semibold mb-2">{t("step1CompleteTimeForStep2", "Step 1 Complete — Time for Step 2!")}</h3>
                            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                                {t("initialApplicationApprovedSubmitStep2", "Your initial application was approved. Submit your Step 2 documents to unlock full kitchen access.")}
                            </p>
                            <div className="flex gap-4 justify-center">
                                <Button 
                                    size="lg" 
                                    onClick={() => setLocation(`/apply-kitchen/${locationId}`)}
                                >
                                    <ArrowRight className="mr-2 h-4 w-4" />
                                    {t("continueToStep2", "Continue to Step 2")}
                                </Button>
                            </div>
                        </>
                    ) : isStep1Done ? (
                        <>
                            <h3 className="text-xl font-semibold mb-2">{t("applicationUnderReview", "Application Under Review")}</h3>
                            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                                {t("step1ApplicationUnderReview", "Your Step 1 application is being reviewed by the platform Admins. You'll be notified once a decision is made.")}
                            </p>
                            <Button 
                                size="lg" 
                                onClick={() => setLocation(`/apply-kitchen/${locationId}`)}
                            >
                                {t("viewApplicationBtn", "View application")}
                            </Button>
                        </>
                    ) : (
                        <>
                            <h3 className="text-xl font-semibold mb-2">{t("readyToApplyForLocation", { defaultValue: "Ready to apply for {location}?", location: locationData?.location?.name || kitchen?.name || t('kitchenWord', 'this kitchen') })}</h3>
                            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                                {t("ensureDocumentsReady", "Ensure you have these documents ready to speed up your verification process. The initial application takes about 5 minutes.")}
                            </p>
                            <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch sm:items-stretch">
                                {user && (
                                    <Button 
                                        size="lg" 
                                        className="h-11 min-h-[44px] w-full sm:w-auto"
                                        onClick={() => setShowTourModal(true)}
                                    >
                                        <Calendar />
                                        {t("applyFlowScheduleTourButton", "Schedule tour")}
                                    </Button>
                                )}
                                <Button 
                                    size="lg" 
                                    onClick={() => {
                                        if (user) {
                                            setLocation(`/apply-kitchen/${locationId}`);
                                        } else {
                                            openAuthModal({
                                                title: tAuth("authModalApplyTitle", "Almost there!"),
                                                description: <KitchenNextStepsDescription type="apply" />,
                                            });
                                        }
                                    }}
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

    // If user is authenticated, wrap in ChefDashboardLayout
    if (user) {
        return (
            <ChefDashboardLayout
                activeView={activeView}
                onViewChange={(view) => {
                    setActiveView(view);
                    // REPLACE so back button doesn't bounce through this requirements page.
                    setLocation(chefDashboardHref(view), { replace: true });
                }}
                breadcrumbs={[
                    { label: t("shellDashboard", "Dashboard"), onClick: () => setLocation('/dashboard') },
                    { label: t("shellDiscoverKitchens", "Discover Kitchens"), onClick: () => setLocation('/dashboard?view=discover-kitchens') },
                    { label: locationData?.location?.name || t('kitchenWord', 'Kitchen') },
                ]}
            >
                {getContent()}
            </ChefDashboardLayout>
        );
    }

    // For unauthenticated users, use public layout
    return (
        <div className="min-h-screen flex flex-col bg-gray-50">
            <Header />
            <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
                <div className="container mx-auto px-4 max-w-4xl">
                    {getContent()}
                </div>
            </main>
            <Footer />
        </div>
    );
}
