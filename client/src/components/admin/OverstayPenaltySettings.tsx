/**
 * Admin Overstay Penalty & Storage Checkout Settings Component
 * 
 * Configures platform-wide defaults for:
 * - Overstay penalty grace period, rate, max days, escalation threshold
 * - Storage checkout review window and extended claim window
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertTriangle,
  Save,
  RefreshCw,
  Clock,
  DollarSign,
  Shield,
  RotateCcw,
  Package,
  Timer,
  Zap,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface OverstaySettings {
  gracePeriodDays: number;
  penaltyRatePercent: number;
  maxPenaltyDays: number;
}

interface CheckoutSettings {
  reviewWindowHours: number;
  extendedClaimWindowHours: number;
}

interface OverstayFormData {
  gracePeriodDays: string;
  penaltyRatePercent: string;
  maxPenaltyDays: string;
}

interface CheckoutFormData {
  reviewWindowHours: string;
  extendedClaimWindowHours: string;
}

// ============================================================================
// Helper: authenticated fetch
// ============================================================================

async function adminFetch(url: string, options: RequestInit = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Not authenticated");
  const token = await currentUser.getIdToken();
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ============================================================================
// Main Component
// ============================================================================

export default function OverstayPenaltySettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Overstay settings ──────────────────────────────────────────────────
  const {
    data: overstayData,
    isLoading: overstayLoading,
    error: overstayError,
  } = useQuery({
    queryKey: ["/api/admin/overstay-settings"],
    queryFn: () => adminFetch("/api/admin/overstay-settings"),
  });

  const getOverstayInitial = useCallback((): OverstayFormData => {
    if (overstayData?.settings) {
      const s = overstayData.settings as OverstaySettings;
      return {
        gracePeriodDays: String(s.gracePeriodDays),
        penaltyRatePercent: String(s.penaltyRatePercent),
        maxPenaltyDays: String(s.maxPenaltyDays),
      };
    }
    return { gracePeriodDays: "3", penaltyRatePercent: "10", maxPenaltyDays: "30" };
  }, [overstayData]);

  const [overstayForm, setOverstayForm] = useState<OverstayFormData>({
    gracePeriodDays: "3",
    penaltyRatePercent: "10",
    maxPenaltyDays: "30",
  });
  const [overstayInitialized, setOverstayInitialized] = useState(false);

  // Sync form when data first arrives
  if (overstayData?.settings && !overstayInitialized) {
    setOverstayForm(getOverstayInitial());
    setOverstayInitialized(true);
  }

  const overstayMutation = useMutation({
    mutationFn: (payload: Partial<OverstaySettings>) =>
      adminFetch("/api/admin/overstay-settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overstay-settings"] });
      toast({ title: "Saved", description: "Overstay penalty settings updated." });
      setOverstayInitialized(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleOverstaySave = () => {
    overstayMutation.mutate({
      gracePeriodDays: parseInt(overstayForm.gracePeriodDays),
      penaltyRatePercent: parseFloat(overstayForm.penaltyRatePercent),
      maxPenaltyDays: parseInt(overstayForm.maxPenaltyDays),
    });
  };

  const handleOverstayReset = () => {
    if (overstayData?.settings) {
      const s = overstayData.settings as OverstaySettings;
      setOverstayForm({
        gracePeriodDays: String(s.gracePeriodDays),
        penaltyRatePercent: String(s.penaltyRatePercent),
        maxPenaltyDays: String(s.maxPenaltyDays),
      });
    }
  };

  // ── Checkout settings ──────────────────────────────────────────────────
  const [checkoutForm, setCheckoutForm] = useState<CheckoutFormData>({
    reviewWindowHours: "2",
    extendedClaimWindowHours: "48",
  });
  const [checkoutInitialized, setCheckoutInitialized] = useState(false);

  const {
    data: checkoutData,
    isLoading: checkoutLoading,
    error: checkoutError,
  } = useQuery({
    queryKey: ["/api/admin/storage-checkout-settings"],
    queryFn: () => adminFetch("/api/admin/storage-checkout-settings"),
  });

  // Sync form when data first arrives
  if (checkoutData?.settings && !checkoutInitialized) {
    const s = checkoutData.settings as CheckoutSettings;
    setCheckoutForm({
      reviewWindowHours: String(s.reviewWindowHours),
      extendedClaimWindowHours: String(s.extendedClaimWindowHours),
    });
    setCheckoutInitialized(true);
  }

  const checkoutMutation = useMutation({
    mutationFn: (payload: Partial<CheckoutSettings>) =>
      adminFetch("/api/admin/storage-checkout-settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/storage-checkout-settings"] });
      toast({ title: "Saved", description: "Checkout review settings updated." });
      setCheckoutInitialized(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCheckoutSave = () => {
    checkoutMutation.mutate({
      reviewWindowHours: parseInt(checkoutForm.reviewWindowHours),
      extendedClaimWindowHours: parseInt(checkoutForm.extendedClaimWindowHours),
    });
  };

  const handleCheckoutReset = () => {
    if (checkoutData?.settings) {
      const s = checkoutData.settings as CheckoutSettings;
      setCheckoutForm({
        reviewWindowHours: String(s.reviewWindowHours),
        extendedClaimWindowHours: String(s.extendedClaimWindowHours),
      });
    }
  };

  // ── Loading / error states ─────────────────────────────────────────────
  if (overstayLoading || checkoutLoading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (overstayError || checkoutError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load settings. Please refresh the page.
        </AlertDescription>
      </Alert>
    );
  }

  const overstayDefaults = overstayData?.defaults as OverstaySettings | undefined;
  const checkoutDefaults = checkoutData?.defaults as CheckoutSettings | undefined;

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Section Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center flex-shrink-0">
          <Package className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
            Storage & Overstay Settings
          </h3>
          <p className="text-xs sm:text-sm text-gray-500">
            Configure platform-wide defaults for overstay penalties and storage checkout review windows.
            Location and listing-level overrides still take priority.
          </p>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* Overstay Penalty Defaults */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <Card className="border-2 border-gray-200">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-red-100 to-red-50 rounded-lg flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Overstay Penalty Defaults</CardTitle>
              <CardDescription>
                Platform-wide defaults applied when locations/listings don&apos;t have custom values
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Grace Period */}
            <div className="space-y-2">
              <Label htmlFor="gracePeriodDays" className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Grace Period (days)
              </Label>
              <NumericInput
                id="gracePeriodDays"
                suffix="days"
                value={overstayForm.gracePeriodDays}
                onValueChange={(val) => setOverstayForm({ ...overstayForm, gracePeriodDays: val })}
                className="max-w-40"
              />
              <p className="text-xs text-muted-foreground">
                Days after booking end before penalties start.{" "}
                {overstayDefaults && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    Default: {overstayDefaults.gracePeriodDays}
                  </Badge>
                )}
              </p>
            </div>

            {/* Penalty Rate */}
            <div className="space-y-2">
              <Label htmlFor="penaltyRate" className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                Daily Penalty Rate (%)
              </Label>
              <NumericInput
                id="penaltyRate"
                suffix="%"
                allowDecimals
                value={overstayForm.penaltyRatePercent}
                onValueChange={(val) => setOverstayForm({ ...overstayForm, penaltyRatePercent: val })}
                className="max-w-40"
              />
              <p className="text-xs text-muted-foreground">
                Percentage of the daily storage rate charged per overdue day.{" "}
                {overstayDefaults && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    Default: {overstayDefaults.penaltyRatePercent}%
                  </Badge>
                )}
              </p>
            </div>

            {/* Max Penalty Days */}
            <div className="space-y-2">
              <Label htmlFor="maxPenaltyDays" className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Max Penalty Days
              </Label>
              <NumericInput
                id="maxPenaltyDays"
                suffix="days"
                value={overstayForm.maxPenaltyDays}
                onValueChange={(val) => setOverstayForm({ ...overstayForm, maxPenaltyDays: val })}
                className="max-w-40"
              />
              <p className="text-xs text-muted-foreground">
                Maximum days penalties can accumulate before capping.{" "}
                {overstayDefaults && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    Default: {overstayDefaults.maxPenaltyDays}
                  </Badge>
                )}
              </p>
            </div>

            {/* Escalation Info */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                Auto-Escalation
              </Label>
              <p className="text-xs text-muted-foreground">
                When auto-charge fails, the penalty is immediately escalated and a self-serve payment link is sent to the chef. No retry system.
              </p>
            </div>
          </div>

          {/* Current config summary */}
          {overstayData?.settings && (
            <>
              <Separator />
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <h5 className="font-semibold text-orange-900 text-sm mb-2">Current Configuration</h5>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-orange-600">Grace Period</p>
                    <p className="font-bold text-orange-900">
                      {(overstayData.settings as OverstaySettings).gracePeriodDays} days
                    </p>
                  </div>
                  <div>
                    <p className="text-orange-600">Penalty Rate</p>
                    <p className="font-bold text-orange-900">
                      {(overstayData.settings as OverstaySettings).penaltyRatePercent}%
                    </p>
                  </div>
                  <div>
                    <p className="text-orange-600">Max Days</p>
                    <p className="font-bold text-orange-900">
                      {(overstayData.settings as OverstaySettings).maxPenaltyDays}
                    </p>
                  </div>
                  <div>
                    <p className="text-orange-600">Escalation</p>
                    <p className="font-bold text-orange-900">
                      Immediate
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleOverstaySave} disabled={overstayMutation.isPending}>
              {overstayMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Overstay Settings
            </Button>
            <Button variant="outline" onClick={handleOverstayReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* Storage Checkout Review Window */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <Card className="border-2 border-gray-200">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-100 to-blue-50 rounded-lg flex items-center justify-center">
              <Shield className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Checkout Review Window</CardTitle>
              <CardDescription>
                How long managers have to review storage after a chef checks out before auto-clear
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Review Window */}
            <div className="space-y-2">
              <Label htmlFor="reviewWindowHours" className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Review Window (hours)
              </Label>
              <NumericInput
                id="reviewWindowHours"
                suffix="hours"
                value={checkoutForm.reviewWindowHours}
                onValueChange={(val) => setCheckoutForm({ ...checkoutForm, reviewWindowHours: val })}
                className="max-w-40"
              />
              <p className="text-xs text-muted-foreground">
                Hours after checkout before the storage is auto-cleared.{" "}
                {checkoutDefaults && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    Default: {checkoutDefaults.reviewWindowHours}h
                  </Badge>
                )}
              </p>
            </div>

            {/* Extended Claim Window */}
            <div className="space-y-2">
              <Label htmlFor="extendedClaimWindowHours" className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Extended Claim Window (hours)
              </Label>
              <NumericInput
                id="extendedClaimWindowHours"
                suffix="hours"
                value={checkoutForm.extendedClaimWindowHours}
                onValueChange={(val) => setCheckoutForm({ ...checkoutForm, extendedClaimWindowHours: val })}
                className="max-w-40"
              />
              <p className="text-xs text-muted-foreground">
                Extended window for filing damage claims after auto-clear (up to 7 days).{" "}
                {checkoutDefaults && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    Default: {checkoutDefaults.extendedClaimWindowHours}h
                  </Badge>
                )}
              </p>
            </div>
          </div>

          {/* Current config summary */}
          {checkoutData?.settings && (
            <>
              <Separator />
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <h5 className="font-semibold text-blue-900 text-sm mb-2">Current Configuration</h5>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-blue-600">Review Window</p>
                    <p className="font-bold text-blue-900">
                      {(checkoutData.settings as CheckoutSettings).reviewWindowHours} hours
                    </p>
                  </div>
                  <div>
                    <p className="text-blue-600">Extended Claim Window</p>
                    <p className="font-bold text-blue-900">
                      {(checkoutData.settings as CheckoutSettings).extendedClaimWindowHours} hours
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleCheckoutSave} disabled={checkoutMutation.isPending}>
              {checkoutMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Checkout Settings
            </Button>
            <Button variant="outline" onClick={handleCheckoutReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
