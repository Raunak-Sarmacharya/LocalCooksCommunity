import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle,
  BarChart3,
  DollarSign,
  Loader2,
  TrendingUp,
  Users,
} from "lucide-react";

interface PlatformOverviewSectionProps {
  getFirebaseToken: () => Promise<string>;
}

export function PlatformOverviewSection({ getFirebaseToken }: PlatformOverviewSectionProps) {
  const [dateRange, setDateRange] = useState<'week' | 'month' | 'all'>('month');

  const dateRangeParams = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    let startDate: Date;

    switch (dateRange) {
      case 'week':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      default:
        startDate = new Date(0);
    }

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
    };
  }, [dateRange]);

  const { data: platformOverview, isLoading, error } = useQuery({
    queryKey: ['/api/admin/revenue/platform-overview', dateRangeParams.startDate, dateRangeParams.endDate],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
      });

      const response = await fetch(`/api/admin/revenue/platform-overview?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch platform overview');
      }
      return response.json();
    },
  });

  const formatCurrency = (amountInCents: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountInCents / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Platform Revenue Overview</h3>
          <p className="text-sm text-muted-foreground">Platform-wide revenue statistics</p>
        </div>
        <Select value={dateRange} onValueChange={(value) => setDateRange(value as 'week' | 'month' | 'all')}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-destructive/30 mx-auto mb-3" />
            <p className="text-destructive font-medium">Error loading platform data</p>
            <p className="text-sm text-muted-foreground mt-2">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </CardContent>
        </Card>
      ) : platformOverview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Platform Revenue</p>
                  <p className="text-2xl font-bold mt-1">
                    {formatCurrency(platformOverview.totalPlatformRevenue || 0)}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Platform Fees</p>
                  <p className="text-2xl font-bold mt-1">
                    {formatCurrency(platformOverview.totalPlatformFees || 0)}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
                  <TrendingUp className="h-5 w-5 text-violet-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Bookings</p>
                  <p className="text-2xl font-bold mt-1">
                    {platformOverview.totalBookings || 0}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                  <BarChart3 className="h-5 w-5 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Managers</p>
                  <p className="text-2xl font-bold mt-1">
                    {platformOverview.activeManagers || 0}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No platform data available</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
