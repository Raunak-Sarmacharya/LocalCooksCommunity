import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar, MapPin, Eye, Building } from "lucide-react";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";

export default function ChefViewingsList({ onExploreKitchens }: { onExploreKitchens?: () => void }) {
    const { user } = useFirebaseAuth();

    const { data: viewings, isLoading } = useQuery({
        queryKey: ["/api/viewings", "chef", user?.uid],
        queryFn: async () => {
            if (!user) return [];
            
            try {
                const token = await auth.currentUser?.getIdToken();
                const res = await fetch("/api/viewings/chef", {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                if (!res.ok) throw new Error("Failed to fetch viewings");
                return res.json();
            } catch (error) {
                console.error(error);
                return [];
            }
        },
        enabled: !!user?.uid,
    });

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!viewings || viewings.length === 0) {
        return (
            <Card className="border-dashed shadow-none">
                <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                    <Eye className="mb-4 h-6 w-6 text-muted-foreground" />
                    <h3 className="text-lg font-medium">No viewings scheduled</h3>
                    <p className="text-muted-foreground mt-1 max-w-sm">
                        You haven't scheduled any kitchen tours yet. Explore kitchens and book a tour!
                    </p>
                    {onExploreKitchens && (
                        <Button className="mt-4" onClick={onExploreKitchens}>
                            Explore kitchens
                        </Button>
                    )}
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {viewings.map((item: any) => {
                const viewing = item.viewing || item;
                const locName = item.locationName || viewing.location?.name;
                const locAddress = item.locationAddress || viewing.location?.address;
                const kitName = item.kitchenName || viewing.kitchen?.name;
                
                return (
                <Card key={viewing.id} className="shadow-none">
                    <CardHeader className="pb-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Building className="h-5 w-5 text-muted-foreground" />
                                    {locName || "Kitchen Location"}
                                </CardTitle>
                                {locAddress && (
                                    <CardDescription className="flex items-center mt-1">
                                        <MapPin className="h-3.5 w-3.5 mr-1" />
                                        {locAddress}
                                    </CardDescription>
                                )}
                            </div>
                            <Badge variant={viewing.status === "completed" ? "success" : viewing.status === "cancelled" || viewing.status === "no_show" ? "destructive" : "outline"}>
                                {(viewing.status || "").replace("_", " ").toUpperCase()}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-4 text-sm">
                                <div className="flex items-center text-muted-foreground">
                                    <Calendar className="h-4 w-4 mr-2" />
                                    <span className="text-sm font-medium">
                                        {new Date(viewing.scheduledAt).toLocaleString('en-US', {
                                            timeZone: DEFAULT_TIMEZONE,
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                            hour12: true
                                        })}
                                    </span>
                                </div>
                                {kitName && (
                                    <div className="text-muted-foreground">
                                        Target: <span className="font-medium text-foreground">{kitName}</span>
                                    </div>
                                )}
                            </div>
                            
                            {(viewing.managerNotes || viewing.cancellationReason) && (
                                <div className="mt-2 bg-muted/50 rounded-md p-3 text-sm">
                                    {viewing.cancellationReason && (
                                        <div className="mb-2 last:mb-0">
                                            <span className="font-medium text-destructive block mb-1">Cancellation Reason:</span>
                                            <span className="text-muted-foreground">{viewing.cancellationReason}</span>
                                        </div>
                                    )}
                                    {viewing.managerNotes && (
                                        <div className="mb-2 last:mb-0">
                                            <span className="font-medium text-foreground block mb-1">Message from {item.managerName || 'Manager'}:</span>
                                            <span className="text-muted-foreground">{viewing.managerNotes}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )})}
        </div>
    );
}
