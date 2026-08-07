import React, { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { MapPin } from "lucide-react";

interface AnalyticsData {
  heatmap: { lat: number; lng: number }[];
  topAreas: { area: string; count: number }[];
}

interface AnalyticsDashboardProps {
  sellerId: string | number;
}

export function AnalyticsDashboard({ sellerId }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(`/api/analytics/seller/${sellerId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch analytics data");
        }
        const result = await response.json();
        setData(result);
      } catch (error) {
        toast({
          title: "Error",
          description: "Could not load analytics data. Please try again later.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    }

    if (sellerId) {
      fetchData();
    }
  }, [sellerId, toast]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[250px] w-full rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const totalOrders = data.topAreas.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="animate-in fade-in duration-500 mb-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Geographical Analytics
          </CardTitle>
          <CardDescription>Top delivery neighborhoods by order volume percentage</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            {data.topAreas.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No location data available for this shop
              </div>
            ) : (
              data.topAreas.map((area, i) => {
                const percentage = totalOrders > 0 ? (area.count / totalOrders) * 100 : 0;
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{area.area}</span>
                      <span className="text-muted-foreground font-medium">{percentage.toFixed(1)}% ({area.count})</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
