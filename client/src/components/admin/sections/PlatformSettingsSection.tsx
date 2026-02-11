import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  AlertCircle,
  Clock,
  DollarSign,
  RefreshCw,
  Save,
  TrendingUp,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

export function PlatformSettingsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingCancellation, setIsSavingCancellation] = useState(false);
  const [autoAcceptHours, setAutoAcceptHours] = useState('24');
  const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(true);

  const [feeConfig, setFeeConfig] = useState({
    stripePercentageFee: '2.9',
    stripeFlatFeeCents: '30',
    platformCommissionRate: '0',
    minimumApplicationFeeCents: '0',
    useStripePlatformPricing: false,
  });

  const { data: currentConfig, isLoading, error, refetch } = useQuery<{
    success: boolean;
    config: {
      stripePercentageFee: number;
      stripePercentageFeeDisplay: string;
      stripeFlatFeeCents: number;
      stripeFlatFeeDisplay: string;
      platformCommissionRate: number;
      platformCommissionRateDisplay: string;
      minimumApplicationFeeCents: number;
      minimumApplicationFeeDisplay: string;
      useStripePlatformPricing: boolean;
    };
  }>({
    queryKey: ['/api/admin/fees/config'],
    queryFn: async () => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch('/api/admin/fees/config', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch fee configuration');
      }
      return response.json();
    },
  });

  // ── Cancellation config query ──────────────────────────────────────────
  const { data: cancellationConfig, isLoading: cancellationLoading } = useQuery<{
    success: boolean;
    config: { autoAcceptHours: number; updatedAt: string | null };
  }>({
    queryKey: ['/api/admin/cancellation-config'],
    queryFn: async () => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error('Firebase user not available');
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch('/api/admin/cancellation-config', {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to fetch cancellation config');
      return response.json();
    },
  });

  useEffect(() => {
    if (cancellationConfig?.config) {
      const hours = cancellationConfig.config.autoAcceptHours;
      setAutoAcceptHours(hours > 0 ? hours.toString() : '24');
      setAutoAcceptEnabled(hours > 0);
    }
  }, [cancellationConfig]);

  useEffect(() => {
    if (currentConfig?.config) {
      setFeeConfig({
        stripePercentageFee: (currentConfig.config.stripePercentageFee * 100).toFixed(1),
        stripeFlatFeeCents: currentConfig.config.stripeFlatFeeCents.toString(),
        platformCommissionRate: (currentConfig.config.platformCommissionRate * 100).toFixed(1),
        minimumApplicationFeeCents: currentConfig.config.minimumApplicationFeeCents.toString(),
        useStripePlatformPricing: currentConfig.config.useStripePlatformPricing,
      });
    }
  }, [currentConfig]);

  const updateMutation = useMutation({
    mutationFn: async (config: {
      stripePercentageFee?: number;
      stripeFlatFeeCents?: number;
      platformCommissionRate?: number;
      minimumApplicationFeeCents?: number;
      useStripePlatformPricing?: boolean;
    }) => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch('/api/admin/fees/config', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update fee configuration');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/fees/config'] });
      toast({
        title: "Success",
        description: "Fee configuration updated successfully",
      });
      setIsSaving(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to update fee configuration",
        variant: "destructive",
      });
      setIsSaving(false);
    },
  });

  const cancellationMutation = useMutation({
    mutationFn: async (hours: number) => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error('Firebase user not available');
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch('/api/admin/cancellation-config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAcceptHours: hours }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update cancellation config');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/cancellation-config'] });
      toast({ title: 'Success', description: data.message });
      setIsSavingCancellation(false);
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setIsSavingCancellation(false);
    },
  });

  const handleSaveCancellationConfig = () => {
    setIsSavingCancellation(true);
    const hours = autoAcceptEnabled ? parseInt(autoAcceptHours, 10) : 0;
    if (autoAcceptEnabled && (isNaN(hours) || hours < 1 || hours > 720)) {
      toast({ title: 'Validation Error', description: 'Hours must be between 1 and 720 (30 days)', variant: 'destructive' });
      setIsSavingCancellation(false);
      return;
    }
    cancellationMutation.mutate(hours);
  };

  const handleSave = () => {
    setIsSaving(true);
    updateMutation.mutate({
      stripePercentageFee: parseFloat(feeConfig.stripePercentageFee) / 100,
      stripeFlatFeeCents: parseInt(feeConfig.stripeFlatFeeCents, 10),
      platformCommissionRate: parseFloat(feeConfig.platformCommissionRate) / 100,
      minimumApplicationFeeCents: parseInt(feeConfig.minimumApplicationFeeCents, 10),
      useStripePlatformPricing: feeConfig.useStripePlatformPricing,
    });
  };

  const handleReset = () => {
    if (currentConfig?.config) {
      setFeeConfig({
        stripePercentageFee: (currentConfig.config.stripePercentageFee * 100).toFixed(1),
        stripeFlatFeeCents: currentConfig.config.stripeFlatFeeCents.toString(),
        platformCommissionRate: (currentConfig.config.platformCommissionRate * 100).toFixed(1),
        minimumApplicationFeeCents: currentConfig.config.minimumApplicationFeeCents.toString(),
        useStripePlatformPricing: currentConfig.config.useStripePlatformPricing,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load fee configuration. Please refresh the page.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Stripe Processing Fees Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
              <DollarSign className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <CardTitle>Stripe Processing Fees</CardTitle>
              <CardDescription>
                These fees match Stripe&apos;s Canada pricing (2.9% + $0.30 CAD). Adjust only if your Stripe account has custom pricing.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Stripe Percentage Fee</Label>
              <NumericInput
                suffix="%"
                allowDecimals
                value={feeConfig.stripePercentageFee}
                onValueChange={(val) => setFeeConfig({ ...feeConfig, stripePercentageFee: val })}
                className="max-w-32"
              />
              <p className="text-xs text-muted-foreground">Standard: 2.9%</p>
            </div>

            <div className="space-y-2">
              <Label>Stripe Flat Fee (cents)</Label>
              <NumericInput
                suffix="¢"
                value={feeConfig.stripeFlatFeeCents}
                onValueChange={(val) => setFeeConfig({ ...feeConfig, stripeFlatFeeCents: val })}
                className="max-w-32"
              />
              <p className="text-xs text-muted-foreground">Standard: 30&#162; ($0.30)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform Commission Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <CardTitle>Platform Commission</CardTitle>
              <CardDescription>
                Your platform&apos;s commission on each booking. Set to 0% for break-even mode (only cover Stripe fees).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Platform Commission Rate</Label>
              <NumericInput
                suffix="%"
                allowDecimals
                value={feeConfig.platformCommissionRate}
                onValueChange={(val) => setFeeConfig({ ...feeConfig, platformCommissionRate: val })}
                className="max-w-32"
              />
              <p className="text-xs text-muted-foreground">Current: {feeConfig.platformCommissionRate}% (0% = break-even)</p>
            </div>

            <div className="space-y-2">
              <Label>Minimum Application Fee (cents)</Label>
              <NumericInput
                suffix="¢"
                value={feeConfig.minimumApplicationFeeCents}
                onValueChange={(val) => setFeeConfig({ ...feeConfig, minimumApplicationFeeCents: val })}
                className="max-w-32"
              />
              <p className="text-xs text-muted-foreground">Set to 0 for no minimum</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Configuration Summary */}
      {currentConfig?.config && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Current Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Stripe %</p>
                <p className="font-bold">{currentConfig.config.stripePercentageFeeDisplay}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Stripe Flat</p>
                <p className="font-bold">{currentConfig.config.stripeFlatFeeDisplay}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Platform %</p>
                <p className="font-bold">{currentConfig.config.platformCommissionRateDisplay}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Min Fee</p>
                <p className="font-bold">{currentConfig.config.minimumApplicationFeeDisplay}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
        <Button
          onClick={handleReset}
          disabled={isSaving}
          variant="outline"
        >
          Reset
        </Button>
        <Button
          onClick={() => refetch()}
          disabled={isSaving}
          variant="outline"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Cancellation Policy Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle>Cancellation Request Policy</CardTitle>
              <CardDescription>
                When a chef requests cancellation of a confirmed booking, the kitchen manager has a review window to accept or decline.
                If they don&apos;t respond within this window, the request is auto-accepted.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-Accept Enabled</Label>
              <p className="text-xs text-muted-foreground">
                {autoAcceptEnabled
                  ? 'Cancellation requests auto-accept after the review window expires'
                  : 'Managers must manually respond to every cancellation request'}
              </p>
            </div>
            <Switch
              checked={autoAcceptEnabled}
              onCheckedChange={setAutoAcceptEnabled}
            />
          </div>

          {autoAcceptEnabled && (
            <div className="space-y-2">
              <Label>Review Window</Label>
              <NumericInput
                suffix="hours"
                value={autoAcceptHours}
                onValueChange={setAutoAcceptHours}
                className="max-w-32"
              />
              <p className="text-xs text-muted-foreground">
                {parseInt(autoAcceptHours) >= 24
                  ? `≈ ${(parseInt(autoAcceptHours) / 24).toFixed(1)} days`
                  : `${autoAcceptHours} hour${parseInt(autoAcceptHours) !== 1 ? 's' : ''}`}
                {' '}· Max: 720 hours (30 days)
              </p>
            </div>
          )}

          {cancellationConfig?.config && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="text-muted-foreground">
                <strong>Current:</strong>{' '}
                {cancellationConfig.config.autoAcceptHours === 0
                  ? 'Auto-accept disabled — manual review only'
                  : `Auto-accept after ${cancellationConfig.config.autoAcceptHours} hour${cancellationConfig.config.autoAcceptHours !== 1 ? 's' : ''}`}
              </p>
            </div>
          )}

          <Button
            onClick={handleSaveCancellationConfig}
            disabled={isSavingCancellation || cancellationLoading}
            size="sm"
          >
            {isSavingCancellation ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" />Save Cancellation Policy</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>How Fees Work</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
            <li><strong>Stripe Fee:</strong> Covers Stripe&apos;s processing cost (2.9% + $0.30 for Canada)</li>
            <li><strong>Platform Commission:</strong> Your profit margin (set to 0% for break-even)</li>
            <li><strong>Application Fee:</strong> Stripe Fee + Platform Commission (sent to your Stripe account)</li>
            <li><strong>Manager Receives:</strong> Booking Amount - Application Fee</li>
            <li>Changes apply to all new bookings immediately</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
