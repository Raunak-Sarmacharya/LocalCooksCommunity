/**
 * Admin Escalated Penalties Dashboard
 * 
 * Shows all escalated overstay penalties and damage claims across all locations
 * that require manual admin collection action.
 */

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
  AlertTriangle,
  RefreshCw,
  DollarSign,
  Package,
  FileWarning,
  CheckCircle,
  Mail,
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

export default function EscalatedPenalties() {
  const { data, isLoading, error, refetch } = useQuery<{
    overstays: EscalatedOverstay[];
    damageClaims: EscalatedClaim[];
    summary: EscalatedSummary;
  }>({
    queryKey: ["/api/admin/escalated-penalties"],
    queryFn: () => adminFetch("/api/admin/escalated-penalties"),
    refetchInterval: 60000,
  });

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

  const overstays = data?.overstays || [];
  const claims = data?.damageClaims || [];
  const summary = data?.summary || { totalEscalatedOverstays: 0, totalEscalatedClaims: 0, totalEscalatedAmountCents: 0 };
  const totalEscalated = summary.totalEscalatedOverstays + summary.totalEscalatedClaims;

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
                        {o.chefEmail ? (
                          <div className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs">{o.chefEmail}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unknown</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive" className="text-xs">{o.daysOverdue} days</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-sm">
                        {formatCurrency(o.finalPenaltyCents || o.calculatedPenaltyCents)}
                      </TableCell>
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
                          {c.chefEmail ? (
                            <div className="flex items-center gap-1">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs">{c.chefEmail}</span>
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
