import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ResponsiveTable from "@/components/ui/responsive-table";
import {
  AlertCircle,
  BarChart3,
  DollarSign,
  Eye,
  Loader2,
  TrendingUp,
  Users,
} from "lucide-react";

interface ManagerRevenuesSectionProps {
  getFirebaseToken: () => Promise<string>;
}

export function ManagerRevenuesSection({ getFirebaseToken }: ManagerRevenuesSectionProps) {
  const [dateRange, setDateRange] = useState<'week' | 'month' | 'all'>('month');
  const [selectedManager, setSelectedManager] = useState<number | 'all'>('all');

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

  const { data: managersRevenue, isLoading, error } = useQuery({
    queryKey: ['/api/admin/revenue/all-managers', dateRangeParams.startDate, dateRangeParams.endDate],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
      });

      const response = await fetch(`/api/admin/revenue/all-managers?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch managers revenue');
      }
      return response.json();
    },
  });

  const { data: managerDetails } = useQuery({
    queryKey: ['/api/admin/revenue/manager', selectedManager, dateRangeParams.startDate, dateRangeParams.endDate],
    queryFn: async () => {
      if (selectedManager === 'all') return null;
      const token = await getFirebaseToken();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
      });

      const response = await fetch(`/api/admin/revenue/manager/${selectedManager}?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch manager revenue details');
      }
      return response.json();
    },
    enabled: selectedManager !== 'all',
  });

  const formatCurrency = (amount: number) => {
    // Server already converts cents to dollars, so no division needed
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Manager Revenues</h3>
          <p className="text-sm text-muted-foreground">View revenue metrics for all managers</p>
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
            <p className="text-destructive font-medium">Error loading revenue data</p>
            <p className="text-sm text-muted-foreground mt-2">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </CardContent>
        </Card>
      ) : managersRevenue && managersRevenue.managers ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Managers</p>
                    <p className="text-2xl font-bold mt-1">{managersRevenue.managers.length}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-bold mt-1">
                      {formatCurrency(
                        managersRevenue.managers.reduce((sum: number, m: any) => sum + (m.totalRevenue || 0), 0)
                      )}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                    <DollarSign className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Platform Fees</p>
                    <p className="text-2xl font-bold mt-1">
                      {formatCurrency(
                        managersRevenue.managers.reduce((sum: number, m: any) => sum + (m.platformFee || 0), 0)
                      )}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
                    <TrendingUp className="h-5 w-5 text-violet-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Managers Table */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <ResponsiveTable
                columns={[
                  {
                    key: 'manager',
                    label: 'Manager',
                    render: (_: any, row: any) => (
                      <div>
                        <p className="font-medium text-sm">{row.managerName || `Manager #${row.managerId}`}</p>
                        <p className="text-xs text-muted-foreground">{row.managerEmail}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'totalRevenue',
                    label: 'Total Revenue',
                    className: 'text-right',
                    render: (_: any, row: any) => (
                      <span className="font-medium text-sm">{formatCurrency(row.totalRevenue || 0)}</span>
                    ),
                  },
                  {
                    key: 'platformFee',
                    label: 'Platform Fee',
                    className: 'text-right',
                    render: (_: any, row: any) => (
                      <span className="text-muted-foreground text-sm">{formatCurrency(row.platformFee || 0)}</span>
                    ),
                  },
                  {
                    key: 'managerRevenue',
                    label: 'Manager Earnings',
                    className: 'text-right',
                    render: (_: any, row: any) => (
                      <span className="font-semibold text-emerald-600 text-sm">{formatCurrency(row.managerRevenue || 0)}</span>
                    ),
                  },
                  {
                    key: 'bookingCount',
                    label: 'Bookings',
                    className: 'text-center',
                    render: (_: any, row: any) => (
                      <span className="text-muted-foreground text-sm">{row.bookingCount || 0}</span>
                    ),
                  },
                  {
                    key: 'actions',
                    label: 'Actions',
                    className: 'text-center',
                    render: (_: any, row: any) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedManager(selectedManager === row.managerId ? 'all' : row.managerId)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        {selectedManager === row.managerId ? 'Hide' : 'View'}
                      </Button>
                    ),
                  },
                ]}
                data={managersRevenue.managers.map((m: any) => ({ ...m, id: m.managerId }))}
                keyField="managerId"
                mobileBreakpoint="md"
              />
            </CardContent>
          </Card>

          {/* Manager Details */}
          {selectedManager !== 'all' && managerDetails && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Location Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {managerDetails.locations && managerDetails.locations.length > 0 ? (
                    managerDetails.locations.map((loc: any) => (
                      <div key={loc.locationId} className="p-4 rounded-lg bg-muted border">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{loc.locationName}</p>
                            <p className="text-sm text-muted-foreground">{loc.bookingCount} bookings</p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatCurrency(loc.totalRevenue || 0)}</p>
                            <p className="text-sm text-emerald-600">Earnings: {formatCurrency(loc.managerRevenue || 0)}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-center py-4">No location data available</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No revenue data available</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
