import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileText, ShieldCheck, Utensils } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function KitchenRequirementsPage() {
    const [match, params] = useRoute("/kitchen-requirements/:locationId");
    const [, setLocation] = useLocation();
    const locationId = params?.locationId;

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

    const isLoading = isLoadingLocation || isLoadingReqs;

    if (isLoading) {
        return (
            <div className="container mx-auto py-10 px-4 max-w-4xl">
                <Skeleton className="h-10 w-3/4 mb-6" />
                <div className="grid gap-6 md:grid-cols-2">
                    <Skeleton className="h-64 w-full" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        );
    }

    if (!requirements) {
        return (
            <div className="container mx-auto py-10 px-4 text-center">
                <h2 className="text-2xl font-bold mb-4">Requirements Not Found</h2>
                <Button onClick={() => setLocation("/dashboard")}>Back to Dashboard</Button>
            </div>
        );
    }

    // Helper to compile lists
    const getStep1Items = () => {
        const items = [
            "Personal Information",
            (requirements.requireBusinessName || requirements.requireBusinessType) && "Business Information",
            requirements.requireFoodHandlerCert && "Food Handler Certificate",
            requirements.tier1_years_experience_required && "Professional Experience",
            ...(Array.isArray(requirements.tier1_custom_fields)
                ? requirements.tier1_custom_fields
                    .filter((f: any) => f.required)
                    .map((f: any) => f.label)
                : [])
        ].filter(Boolean);
        return items;
    };

    const getStep2Items = () => {
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
                    .filter((f: any) => f.required)
                    .map((f: any) => f.label)
                : [])
        ].filter(Boolean);
        return items;
    };

    return (
        <div className="container mx-auto py-10 px-4 max-w-4xl">
            <Button
                variant="ghost"
                className="mb-6 pl-0 hover:pl-2 transition-all"
                onClick={() => window.history.back()}
            >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
            </Button>

            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight mb-2">Kitchen Requirements</h1>
                <p className="text-muted-foreground text-lg">
                    Required documents and certificates for <span className="font-semibold text-foreground">{locationData?.location?.name || 'this location'}</span>
                </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
                {/* Step 1 Card */}
                <Card className="border-l-4 border-l-primary/50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <FileText className="h-24 w-24" />
                    </div>
                    <CardHeader>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">1</div>
                            <CardTitle className="text-xl">Application Requirements</CardTitle>
                        </div>
                        <CardDescription>
                            Basic information needed to submit your initial application.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3">
                            {getStep1Items().length > 0 ? (
                                getStep1Items().map((item: any, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm">
                                        <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                                        <span className="leading-snug">{item}</span>
                                    </li>
                                ))
                            ) : (
                                <li className="text-sm text-muted-foreground italic">No specific documents required for Step 1.</li>
                            )}
                        </ul>
                    </CardContent>
                </Card>

                {/* Step 2 Card */}
                <Card className="border-l-4 border-l-orange-500/50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <ShieldCheck className="h-24 w-24" />
                    </div>
                    <CardHeader>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-8 w-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm">2</div>
                            <CardTitle className="text-xl">Kitchen Coordination</CardTitle>
                        </div>
                        <CardDescription>
                            Documents required before you can start booking shifts.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3">
                            {getStep2Items().length > 0 ? (
                                getStep2Items().map((item: any, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm">
                                        <CheckCircle2 className="h-5 w-5 text-orange-600 mt-0.5 shrink-0" />
                                        <span className="leading-snug">{item}</span>
                                    </li>
                                ))
                            ) : (
                                <li className="text-sm text-muted-foreground italic">No specific documents required for Step 2.</li>
                            )}
                        </ul>
                    </CardContent>
                </Card>
            </div>

            <div className="mt-12 p-6 bg-muted/30 rounded-lg border border-border/50 text-center">
                <Utensils className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Ready to apply?</h3>
                <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
                    Ensure you have these documents ready to speed up your verification process.
                </p>
                <Button size="lg" onClick={() => setLocation(`/apply-kitchen/${locationId}`)}>
                    Start Application
                </Button>
            </div>
        </div>
    );
}
