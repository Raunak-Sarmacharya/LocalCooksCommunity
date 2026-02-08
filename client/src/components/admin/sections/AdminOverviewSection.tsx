import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Shield,
  FileText,
  Building2,
  DollarSign,
  Users,
  ChefHat,
  AlertTriangle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import type { AdminSection } from "@/components/admin/layout/AdminSidebar";

interface AdminOverviewSectionProps {
  onNavigate: (section: AdminSection) => void;
  pendingReviewCount: number;
  pendingLicensesCount: number;
}

export function AdminOverviewSection({
  onNavigate,
  pendingReviewCount,
  pendingLicensesCount,
}: AdminOverviewSectionProps) {
  const getFirebaseToken = async (): Promise<string> => {
    const currentFirebaseUser = auth.currentUser;
    if (!currentFirebaseUser) throw new Error("Firebase user not available");
    return await currentFirebaseUser.getIdToken();
  };

  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ["/api/admin/revenue/all-managers", "overview"],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch(`/api/admin/revenue/all-managers`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      if (!response.ok) return null;
      return response.json();
    },
    staleTime: 60 * 1000,
  });

  const { data: applicationsData, isLoading: appsLoading } = useQuery({
    queryKey: ["/api/firebase/admin/applications", "overview-counts"],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch("/api/firebase/admin/applications", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      if (!response.ok) return null;
      return response.json();
    },
    staleTime: 60 * 1000,
  });

  const totalManagers = revenueData?.managers?.length || 0;
  const totalRevenue = revenueData?.managers?.reduce(
    (sum: number, m: { totalRevenue?: number }) => sum + (m.totalRevenue || 0),
    0
  ) || 0;
  const platformFees = revenueData?.managers?.reduce(
    (sum: number, m: { platformFee?: number }) => sum + (m.platformFee || 0),
    0
  ) || 0;
  const totalBookings = revenueData?.managers?.reduce(
    (sum: number, m: { bookingCount?: number }) => sum + (m.bookingCount || 0),
    0
  ) || 0;

  const totalApplications = Array.isArray(applicationsData) ? applicationsData.length : 0;
  const approvedApps = Array.isArray(applicationsData)
    ? applicationsData.filter((a: { status?: string }) => a.status === "approved").length
    : 0;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 2,
    }).format(amount);

  const isLoading = revenueLoading || appsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Overview</h1>
        <p className="text-muted-foreground">
          Platform summary and key metrics at a glance.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total Revenue
                    </p>
                    <p className="text-2xl font-bold mt-1">
                      {formatCurrency(totalRevenue)}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                    <DollarSign className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Platform Fees
                    </p>
                    <p className="text-2xl font-bold mt-1">
                      {formatCurrency(platformFees)}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
                    <DollarSign className="h-5 w-5 text-violet-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total Bookings
                    </p>
                    <p className="text-2xl font-bold mt-1">{totalBookings}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <Building2 className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Active Managers
                    </p>
                    <p className="text-2xl font-bold mt-1">{totalManagers}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                    <Users className="h-5 w-5 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Pending Applications */}
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate("applications")}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Chef Applications
                  </CardTitle>
                  {pendingReviewCount > 0 && (
                    <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                      {pendingReviewCount} pending
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  {totalApplications} total &middot; {approvedApps} approved
                </p>
                <Button variant="ghost" size="sm" className="px-0 text-primary">
                  Review Applications <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>

            {/* Kitchen Licenses */}
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate("kitchen-licenses")}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    Kitchen Licenses
                  </CardTitle>
                  {pendingLicensesCount > 0 && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      {pendingLicensesCount} pending
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Review and approve kitchen license submissions.
                </p>
                <Button variant="ghost" size="sm" className="px-0 text-primary">
                  View Licenses <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>

            {/* Revenue */}
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate("manager-revenues")}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  Manager Revenues
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  {formatCurrency(totalRevenue)} across {totalManagers} managers.
                </p>
                <Button variant="ghost" size="sm" className="px-0 text-primary">
                  View Revenue <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>

            {/* Kitchen Management */}
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate("kitchen-management")}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ChefHat className="h-4 w-4 text-purple-600" />
                  Kitchen Management
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Manage locations, kitchens, and managers.
                </p>
                <Button variant="ghost" size="sm" className="px-0 text-primary">
                  Manage Kitchens <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>

            {/* Damage Claims */}
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate("damage-claims")}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Damage Claims
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Review escalated damage claims from managers.
                </p>
                <Button variant="ghost" size="sm" className="px-0 text-primary">
                  View Claims <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>

            {/* Platform Settings */}
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate("platform-settings")}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-gray-600" />
                  Platform Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-3">
                  Configure fees, commissions, and platform behavior.
                </p>
                <Button variant="ghost" size="sm" className="px-0 text-primary">
                  Open Settings <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
