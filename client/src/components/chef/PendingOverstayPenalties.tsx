/**
 * PendingOverstayPenalties Component
 * 
 * Displays pending overstay penalties for chefs and allows them to pay via Stripe.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CreditCard, Package, Calendar, Building2, FileDown } from "lucide-react";
import { format } from "date-fns";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";

interface PendingPenalty {
  overstayId: number;
  storageBookingId: number;
  status: string;
  daysOverdue: number;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  detectedAt: string;
  penaltyApprovedAt: string;
  storageName: string;
  storageType: string;
  kitchenName: string;
  bookingEndDate: string;
  penaltyAmountCents: number;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error('Error getting Firebase token:', error);
  }
  return {
    'Content-Type': 'application/json',
  };
}

const formatCurrency = (cents: number) => {
  return `$${(cents / 100).toFixed(2)} CAD`;
};

export function PendingOverstayPenalties() {
  // Fetch pending penalties
  const { data: penalties = [], isLoading, error } = useQuery<PendingPenalty[]>({
    queryKey: ['/api/chef/overstay-penalties'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/overstay-penalties', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch penalties');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Pay penalty mutation
  const payMutation = useMutation({
    mutationFn: async (overstayId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/chef/overstay-penalties/${overstayId}/pay`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create payment session');
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to initiate payment');
    },
  });

  // Don't render anything if no penalties
  if (!isLoading && penalties.length === 0) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className="border-orange-200 bg-orange-50/50">
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return null; // Silently fail - don't show error to user
  }

  return (
    <Card className="border-orange-300 bg-gradient-to-r from-orange-50 to-red-50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-600" />
          <CardTitle className="text-lg text-orange-800">Outstanding Overstay Penalties</CardTitle>
        </div>
        <CardDescription className="text-orange-700">
          You have {penalties.length} pending penalty{penalties.length !== 1 ? 'ies' : 'y'} that require payment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {penalties.map((penalty) => (
          <div
            key={penalty.overstayId}
            className="bg-white rounded-lg border border-orange-200 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-purple-600" />
                  <span className="font-medium">{penalty.storageName}</span>
                  <Badge variant="outline" className="capitalize text-xs">
                    {penalty.storageType}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{penalty.kitchenName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Ended {format(new Date(penalty.bookingEndDate), "MMM d, yyyy")}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="text-xs">
                    {penalty.daysOverdue} day{penalty.daysOverdue !== 1 ? 's' : ''} overdue
                  </Badge>
                </div>
              </div>

              <div className="text-right space-y-2">
                <div className="text-xl font-bold text-orange-700">
                  {formatCurrency(penalty.penaltyAmountCents)}
                </div>
                <Button
                  size="sm"
                  onClick={() => payMutation.mutate(penalty.overstayId)}
                  disabled={payMutation.isPending}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  <CreditCard className="h-4 w-4 mr-1" />
                  {payMutation.isPending ? 'Processing...' : 'Pay Now'}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground border-t pt-2">
              Approved on {format(new Date(penalty.penaltyApprovedAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
        ))}

        <p className="text-xs text-orange-700 text-center pt-2">
          Please pay your outstanding penalties to maintain good standing and continue using storage facilities.
        </p>
      </CardContent>
    </Card>
  );
}

export default PendingOverstayPenalties;
