/**
 * Admin Damage Claim Settings Component
 * 
 * Allows admins to configure damage claim limits and deadlines.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Save,
  RefreshCw,
  Clock,
  DollarSign,
  Calendar,
  FileText,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

interface DamageClaimLimits {
  maxClaimAmountCents: number;
  minClaimAmountCents: number;
  maxClaimsPerBooking: number;
  chefResponseDeadlineHours: number;
  claimSubmissionDeadlineDays: number;
}

interface FormData {
  maxClaimAmount: string;
  minClaimAmount: string;
  maxClaimsPerBooking: string;
  chefResponseDeadlineHours: string;
  claimSubmissionDeadlineDays: string;
}

const defaultFormData: FormData = {
  maxClaimAmount: '',
  minClaimAmount: '',
  maxClaimsPerBooking: '',
  chefResponseDeadlineHours: '',
  claimSubmissionDeadlineDays: '',
};

export function DamageClaimSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [initialized, setInitialized] = useState(false);

  // Fetch current limits
  const { data: limitsData, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/admin/damage-claim-limits'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/admin/damage-claim-limits');
      return response.json();
    },
  });

  const limits: DamageClaimLimits = limitsData?.limits || {
    maxClaimAmountCents: 500000,
    minClaimAmountCents: 1000,
    maxClaimsPerBooking: 3,
    chefResponseDeadlineHours: 72,
    claimSubmissionDeadlineDays: 14,
  };

  // Initialize form when data loads (valid pattern for syncing form state with fetched data)
  useEffect(() => {
    if (limitsData?.limits && !initialized) {
      setFormData({
        maxClaimAmount: (limitsData.limits.maxClaimAmountCents / 100).toFixed(2),
        minClaimAmount: (limitsData.limits.minClaimAmountCents / 100).toFixed(2),
        maxClaimsPerBooking: String(limitsData.limits.maxClaimsPerBooking),
        chefResponseDeadlineHours: String(limitsData.limits.chefResponseDeadlineHours),
        claimSubmissionDeadlineDays: String(limitsData.limits.claimSubmissionDeadlineDays),
      });
      setInitialized(true);
    }
  }, [limitsData, initialized]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const payload: Partial<{
        maxClaimAmountCents: number;
        minClaimAmountCents: number;
        maxClaimsPerBooking: number;
        chefResponseDeadlineHours: number;
        claimSubmissionDeadlineDays: number;
      }> = {};

      if (formData.maxClaimAmount) {
        payload.maxClaimAmountCents = Math.round(parseFloat(formData.maxClaimAmount) * 100);
      }
      if (formData.minClaimAmount) {
        payload.minClaimAmountCents = Math.round(parseFloat(formData.minClaimAmount) * 100);
      }
      if (formData.maxClaimsPerBooking) {
        payload.maxClaimsPerBooking = parseInt(formData.maxClaimsPerBooking);
      }
      if (formData.chefResponseDeadlineHours) {
        payload.chefResponseDeadlineHours = parseInt(formData.chefResponseDeadlineHours);
      }
      if (formData.claimSubmissionDeadlineDays) {
        payload.claimSubmissionDeadlineDays = parseInt(formData.claimSubmissionDeadlineDays);
      }

      const response = await apiRequest('PUT', '/api/admin/damage-claim-limits', payload);
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Settings Updated", description: "Damage claim limits have been saved." });
      // Update form with the response data directly (don't rely on cache invalidation timing)
      if (data?.limits) {
        setFormData({
          maxClaimAmount: (data.limits.maxClaimAmountCents / 100).toFixed(2),
          minClaimAmount: (data.limits.minClaimAmountCents / 100).toFixed(2),
          maxClaimsPerBooking: String(data.limits.maxClaimsPerBooking),
          chefResponseDeadlineHours: String(data.limits.chefResponseDeadlineHours),
          claimSubmissionDeadlineDays: String(data.limits.claimSubmissionDeadlineDays),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/admin/damage-claim-limits'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Error loading settings: {(error as Error).message}</p>
          <Button onClick={() => refetch()} className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Damage Claim Settings</h2>
          <p className="text-muted-foreground">
            Configure platform-wide damage claim limits and deadlines
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Current Settings Alert */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Current Settings</AlertTitle>
        <AlertDescription className="text-sm space-y-1">
          <p>• <strong>Submission deadline:</strong> {limits.claimSubmissionDeadlineDays} days after booking</p>
          <p>• <strong>Chef response deadline:</strong> {limits.chefResponseDeadlineHours} hours</p>
          <p>• <strong>Claim amount range:</strong> ${(limits.minClaimAmountCents / 100).toFixed(2)} - ${(limits.maxClaimAmountCents / 100).toFixed(2)}</p>
          <p>• <strong>Max claims per booking:</strong> {limits.maxClaimsPerBooking}</p>
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Submission Deadline Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              Submission Deadline
            </CardTitle>
            <CardDescription>
              Days after booking ends that managers can file damage claims
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="claimSubmissionDeadlineDays">Days</Label>
              <Input
                id="claimSubmissionDeadlineDays"
                type="number"
                min="1"
                max="30"
                value={formData.claimSubmissionDeadlineDays}
                onChange={(e) => setFormData({ ...formData, claimSubmissionDeadlineDays: e.target.value })}
                placeholder={String(limits.claimSubmissionDeadlineDays)}
              />
              <p className="text-xs text-muted-foreground">
                This controls which bookings appear in the manager&apos;s dropdown when creating a claim.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Response Deadline Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-500" />
              Chef Response Deadline
            </CardTitle>
            <CardDescription>
              Hours chefs have to respond before claim auto-approves
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="chefResponseDeadlineHours">Hours</Label>
              <Input
                id="chefResponseDeadlineHours"
                type="number"
                min="24"
                max="168"
                value={formData.chefResponseDeadlineHours}
                onChange={(e) => setFormData({ ...formData, chefResponseDeadlineHours: e.target.value })}
                placeholder={String(limits.chefResponseDeadlineHours)}
              />
              <p className="text-xs text-muted-foreground">
                Recommended: 72 hours (3 days). Range: 24-168 hours.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Claim Amount Range Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-500" />
              Claim Amount Limits
            </CardTitle>
            <CardDescription>
              Minimum and maximum amounts for damage claims
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minClaimAmount">Minimum ($)</Label>
                <Input
                  id="minClaimAmount"
                  type="number"
                  step="0.01"
                  min="1"
                  value={formData.minClaimAmount}
                  onChange={(e) => setFormData({ ...formData, minClaimAmount: e.target.value })}
                  placeholder={(limits.minClaimAmountCents / 100).toFixed(2)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxClaimAmount">Maximum ($)</Label>
                <Input
                  id="maxClaimAmount"
                  type="number"
                  step="0.01"
                  min="100"
                  value={formData.maxClaimAmount}
                  onChange={(e) => setFormData({ ...formData, maxClaimAmount: e.target.value })}
                  placeholder={(limits.maxClaimAmountCents / 100).toFixed(2)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Max Claims Per Booking Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-500" />
              Claims Per Booking
            </CardTitle>
            <CardDescription>
              Maximum number of claims allowed per booking
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="maxClaimsPerBooking">Max Claims</Label>
              <Input
                id="maxClaimsPerBooking"
                type="number"
                min="1"
                max="10"
                value={formData.maxClaimsPerBooking}
                onChange={(e) => setFormData({ ...formData, maxClaimsPerBooking: e.target.value })}
                placeholder={String(limits.maxClaimsPerBooking)}
              />
              <p className="text-xs text-muted-foreground">
                Prevents managers from filing excessive claims on a single booking.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={() => updateMutation.mutate()} 
          disabled={updateMutation.isPending}
          size="lg"
        >
          {updateMutation.isPending ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default DamageClaimSettings;
