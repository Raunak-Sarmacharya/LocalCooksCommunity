import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, ShieldCheck, Utensils, Building2, MapPin } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useFirebaseAuth } from "@/hooks/use-auth";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { motion } from "framer-motion";

export default function KitchenRequirementsPage() {
    const [, params] = useRoute("/kitchen-requirements/:locationId");
    const [, setLocation] = useLocation();
    const locationId = params?.locationId;
    const { user, loading: authLoading } = useFirebaseAuth();
    const [activeView, setActiveView] = useState("discover-kitchens");

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
            <h2 className="text-2xl font-bold mb-2">Requirements Not Found</h2>
            <p className="text-muted-foreground mb-6">We couldn&apos;t find the requirements for this kitchen.</p>
            <Button onClick={() => setLocation("/dashboard?view=discover-kitchens")}>Back to Discover Kitchens</Button>
        </div>
    );

    // Helper to compile lists
    const getStep1Items = () => {
        if (!requirements) return [];
        const items = [
            "Personal Information",
            (requirements.requireBusinessName || requirements.requireBusinessType) && "Business Information",
            requirements.requireFoodHandlerCert && "Food Handler Certificate",
            requirements.tier1_years_experience_required && "Professional Experience",
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
            requirements.tier2_food_establishment_cert_required && "Food Establishment Certificate",
            requirements.tier2_allergen_plan_required && "Allergen Management Plan",
            requirements.tier2_supplier_list_required && "Supplier List",
            requirements.tier2_quality_control_required && "Quality Control Plan",
            requirements.tier2_traceability_system_required && "Traceability System",
            (requirements.tier2_insurance_document_required || requirements.tier2_insurance_minimum_amount > 0) &&
            `Insurance Document${requirements.tier2_insurance_minimum_amount > 0 ? ` (min $${requirements.tier2_insurance_minimum_amount})` : ''}`,
            requirements.tier2_kitchen_experience_required && "Kitchen Experience Description",
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
            {/* Header with Kitchen Info */}
            <div className="flex flex-col md:flex-row md:items-start gap-6">
                {/* Kitchen Image */}
                {kitchen?.imageUrl && (
                    <div className="w-full md:w-48 h-32 md:h-32 rounded-xl overflow-hidden flex-shrink-0 shadow-lg">
                        <img 
                            src={kitchen.imageUrl} 
                            alt={kitchen.name || 'Kitchen'}
                            className="w-full h-full object-cover"
                        />
                    </div>
                )}
                
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary" className="text-xs">
                            <Building2 className="h-3 w-3 mr-1" />
                            Kitchen Application
                        </Badge>
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">
                        {locationData?.location?.name || kitchen?.name || 'Kitchen Requirements'}
                    </h1>
                    {(locationData?.location?.address || kitchen?.address) && (
                        <p className="text-muted-foreground flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            {locationData?.location?.address || kitchen?.address}
                        </p>
                    )}
                </div>
            </div>

            {/* Requirements Cards */}
            <div className="grid gap-6 md:grid-cols-2">
                {/* Step 1 Card */}
                <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-primary/5 relative overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <FileText className="h-24 w-24" />
                    </div>
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold shadow-sm">
                                1
                            </div>
                            <div>
                                <CardTitle className="text-lg">Application Requirements</CardTitle>
                                <CardDescription className="text-xs">
                                    Initial application documents
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3">
                            {getStep1Items().length > 0 ? (
                                getStep1Items().map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm">
                                        <div className="h-5 w-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                        </div>
                                        <span className="leading-snug text-foreground/80">{item}</span>
                                    </li>
                                ))
                            ) : (
                                <li className="text-sm text-muted-foreground italic">No specific documents required for Step 1.</li>
                            )}
                        </ul>
                    </CardContent>
                </Card>

                {/* Step 2 Card */}
                <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-orange-500/5 relative overflow-hidden hover:shadow-xl transition-shadow">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <ShieldCheck className="h-24 w-24" />
                    </div>
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-10 w-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold shadow-sm">
                                2
                            </div>
                            <div>
                                <CardTitle className="text-lg">Kitchen Coordination</CardTitle>
                                <CardDescription className="text-xs">
                                    Required before booking shifts
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3">
                            {getStep2Items().length > 0 ? (
                                getStep2Items().map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm">
                                        <div className="h-5 w-5 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <CheckCircle2 className="h-3.5 w-3.5 text-orange-600" />
                                        </div>
                                        <span className="leading-snug text-foreground/80">{item}</span>
                                    </li>
                                ))
                            ) : (
                                <li className="text-sm text-muted-foreground italic">No specific documents required for Step 2.</li>
                            )}
                        </ul>
                    </CardContent>
                </Card>
            </div>

            {/* CTA Section */}
            <Card className="border-0 shadow-lg bg-gradient-to-r from-primary/5 via-primary/10 to-blue-500/5 overflow-hidden">
                <CardContent className="p-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <Utensils className="h-7 w-7 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Ready to apply?</h3>
                    <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                        Ensure you have these documents ready to speed up your verification process.
                    </p>
                    <Button 
                        size="lg" 
                        onClick={() => setLocation(`/apply-kitchen/${locationId}`)}
                        className="shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all"
                    >
                        Start Application
                    </Button>
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
                    if (view === 'overview') setLocation('/dashboard');
                    else if (view === 'discover-kitchens') setLocation('/dashboard?view=discover-kitchens');
                    else if (view === 'kitchen-applications') setLocation('/dashboard?view=kitchen-applications');
                    else if (view === 'bookings') setLocation('/dashboard?view=bookings');
                    else if (view === 'applications') setLocation('/dashboard?view=applications');
                    else if (view === 'messages') setLocation('/dashboard?view=messages');
                    else if (view === 'training') setLocation('/dashboard?view=training');
                }}
                breadcrumbs={[
                    { label: "Dashboard", onClick: () => setLocation('/dashboard') },
                    { label: "Discover Kitchens", onClick: () => setLocation('/dashboard?view=discover-kitchens') },
                    { label: locationData?.location?.name || 'Kitchen' },
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
