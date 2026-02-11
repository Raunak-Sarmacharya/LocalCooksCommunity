/**
 * Admin Escalated Penalties Dashboard
 * 
 * Shows all escalated overstay penalties and damage claims across all locations
 * that require manual admin collection action.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertTriangle,
  RefreshCw,
  DollarSign,
  Package,
  FileWarning,
  CheckCircle,
} from "lucide-react";
import { format } from "date-fns";

// ============================================================================
// Types
// ============================================================================

interface EscalatedOverstay {
  id: number;
  storageBookingId: number;
  status: string;
  daysOverdue: number;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  chargeFailureReason: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  storageName: string;
  kitchenName: string;
  locationName: string;
  chefEmail: string | null;
  chefName: string | null;
  kitchenTaxRatePercent?: number;
}

interface EscalatedClaim {
  id: number;
  claimTitle: string;
  status: string;
  claimedAmountCents: number;
  finalAmountCents: number | null;
  chargeFailureReason: string | null;
  bookingType: string;
  createdAt: string;
  locationName: string;
  chefEmail: string | null;
  chefName: string | null;
}

interface EscalatedSummary {
  totalEscalatedOverstays: number;
  totalEscalatedClaims: number;
  totalEscalatedAmountCents: number;
}

// ============================================================================
// Helper
// ============================================================================

async function adminFetch(url: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Not authenticated");
  const token = await currentUser.getIdToken();
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)} CAD`;
}

// ============================================================================
// Main Component
// ============================================================================

function getOverstayStatusBadge(status: string) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    detected: { variant: "default", label: "Detected" },
    escalated: { variant: "destructive", label: "Escalated" },
    charged: { variant: "secondary", label: "Charged" },
    resolved: { variant: "outline", label: "Resolved" },
    waived: { variant: "outline", label: "Waived" },
  };
  const c = config[status] || { variant: "outline" as const, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function getClaimStatusBadge(status: string) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    escalated: { variant: "destructive", label: "Escalated" },
    charge_succeeded: { variant: "secondary", label: "Charged" },
    charge_failed: { variant: "destructive", label: "Charge Failed" },
    resolved: { variant: "outline", label: "Resolved" },
  };
  const c = config[status] || { variant: "outline" as const, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function EscalatedPenalties() {
  const [activeTab, setActiveTab] = useState<string>("escalated");

  const { data, isLoading, error, refetch } = useQuery<{
    overstays: EscalatedOverstay[];
    damageClaims: EscalatedClaim[];
    summary: EscalatedSummary & { totalOverstays?: number; totalClaims?: number };
  }>({
    queryKey: ["/api/admin/escalated-penalties", "all"],
    queryFn: () => adminFetch("/api/admin/escalated-penalties?all=true"),
    refetchInterval: 60000,
  });

  const allOverstays = useMemo(() => data?.overstays || [], [data?.overstays]);
  const allClaims = useMemo(() => data?.damageClaims || [], [data?.damageClaims]);
  const summary = data?.summary || { totalEscalatedOverstays: 0, totalEscalatedClaims: 0, totalEscalatedAmountCents: 0 };
  const totalEscalated = summary.totalEscalatedOverstays + summary.totalEscalatedClaims;

  const overstays = useMemo(() => {
    if (activeTab === 'all') return allOverstays;
    return allOverstays.filter(o => o.status === activeTab);
  }, [allOverstays, activeTab]);

  const claims = useMemo(() => {
    if (activeTab === 'all') return allClaims;
    return allClaims.filter(c => c.status === activeTab);
  }, [allClaims, activeTab]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allOverstays.length + allClaims.length };
    allOverstays.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
    allClaims.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return counts;
  }, [allOverstays, allClaims]);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load escalated penalties. Please refresh.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
              Escalated Penalties
            </h3>
            <p className="text-xs sm:text-sm text-gray-500">
              Penalties and claims that failed auto-charge and require manual collection
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Status Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="escalated">
            Escalated {tabCounts['escalated'] ? `(${tabCounts['escalated']})` : ''}
          </TabsTrigger>
          <TabsTrigger value="charged">
            Charged {tabCounts['charged'] ? `(${tabCounts['charged']})` : ''}
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved {tabCounts['resolved'] ? `(${tabCounts['resolved']})` : ''}
          </TabsTrigger>
          <TabsTrigger value="all">
            All ({tabCounts['all'] || 0})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <Package className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalEscalatedOverstays}</p>
                <p className="text-xs text-muted-foreground">Overstay Penalties</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <FileWarning className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalEscalatedClaims}</p>
                <p className="text-xs text-muted-foreground">Damage Claims</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(summary.totalEscalatedAmountCents)}</p>
                <p className="text-xs text-muted-foreground">Total Outstanding</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All Clear */}
      {totalEscalated === 0 && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h4 className="text-lg font-semibold text-green-800">All Clear</h4>
            <p className="text-sm text-green-600">No escalated penalties or claims requiring manual collection.</p>
          </CardContent>
        </Card>
      )}

      {/* Escalated Overstay Penalties */}
      {overstays.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-red-600" />
              <div>
                <CardTitle className="text-base">Escalated Overstay Penalties ({overstays.length})</CardTitle>
                <CardDescription>Storage overstay penalties that failed auto-charge</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Storage / Kitchen</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Chef</TableHead>
                    <TableHead>Days Overdue</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Failure Reason</TableHead>
                    <TableHead>Detected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overstays.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.id}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{o.storageName}</p>
                          <p className="text-xs text-muted-foreground">{o.kitchenName}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{o.locationName}</TableCell>
                      <TableCell>
                        {(o.chefName || o.chefEmail) ? (
                          <div>
                            <span className="text-sm font-medium">{o.chefName || o.chefEmail}</span>
                            {o.chefName && o.chefEmail && (
                              <p className="text-xs text-muted-foreground">{o.chefEmail}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unknown</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive" className="text-xs">{o.daysOverdue} days</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(() => {
                          const base = o.finalPenaltyCents || o.calculatedPenaltyCents;
                          const taxRate = parseFloat(String(o.kitchenTaxRatePercent || 0));
                          const total = taxRate > 0 ? Math.round(base * (1 + taxRate / 100)) : base;
                          return (
                            <div>
                              <div className="font-semibold">{formatCurrency(total)}</div>
                              {taxRate > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  {formatCurrency(base)} + {taxRate}% tax
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>{getOverstayStatusBadge(o.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {o.chargeFailureReason || "Unknown"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(o.detectedAt), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Escalated Damage Claims */}
      {claims.length > 0 && (
        <>
          {overstays.length > 0 && <Separator />}
          <Card className="border-amber-200">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-amber-600" />
                <div>
                  <CardTitle className="text-base">Escalated Damage Claims ({claims.length})</CardTitle>
                  <CardDescription>Damage claims that failed auto-charge</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Claim</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Chef</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Failure Reason</TableHead>
                      <TableHead>Filed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.id}</TableCell>
                        <TableCell className="font-medium text-sm max-w-[200px] truncate">
                          {c.claimTitle}
                        </TableCell>
                        <TableCell className="text-sm">{c.locationName}</TableCell>
                        <TableCell>
                          {(c.chefName || c.chefEmail) ? (
                            <div>
                              <span className="text-sm font-medium">{c.chefName || c.chefEmail}</span>
                              {c.chefName && c.chefEmail && (
                                <p className="text-xs text-muted-foreground">{c.chefEmail}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Unknown</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">{c.bookingType}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-sm">
                          {formatCurrency(c.finalAmountCents || c.claimedAmountCents)}
                        </TableCell>
                        <TableCell>{getClaimStatusBadge(c.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {c.chargeFailureReason || "Unknown"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(c.createdAt), "MMM d, yyyy")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
