import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock, Check, X, Package, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface PendingExtension {
  id: number;
  storageBookingId: number;
  newEndDate: string;
  extensionDays: number;
  extensionBasePriceCents: number;
  extensionTotalPriceCents: number;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  currentEndDate: string;
  storageName: string;
  storageType: string;
  kitchenName: string;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return (
        <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-300">
          <Clock className="h-3 w-3 mr-1" />
          Awaiting Payment
        </Badge>
      );
    case 'paid':
      return (
        <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
          <Clock className="h-3 w-3 mr-1" />
          Awaiting Manager Approval
        </Badge>
      );
    case 'approved':
    case 'completed':
      return (
        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
          <Check className="h-3 w-3 mr-1" />
          Approved
        </Badge>
      );
    case 'rejected':
      return (
        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">
          <X className="h-3 w-3 mr-1" />
          Rejected - Refund Pending
        </Badge>
      );
    case 'refunded':
      return (
        <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
          <Check className="h-3 w-3 mr-1" />
          Refunded
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          {status}
        </Badge>
      );
  }
}

export function PendingStorageExtensions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: extensions, isLoading } = useQuery({
    queryKey: ['/api/chef/storage-extensions/pending'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/storage-extensions/pending', { headers });
      if (!response.ok) {
        throw new Error('Failed to fetch pending extensions');
      }
      return response.json() as Promise<PendingExtension[]>;
    },
  });

  // Sync mutation for when webhook doesn't fire
  const syncMutation = useMutation({
    mutationFn: async (extensionId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/storage-extensions/${extensionId}/sync`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to sync');
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate all related queries to ensure UI updates properly
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-extensions/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chef/bookings'] });
      
      if (data.status === 'paid') {
        toast({
          title: "Status Updated",
          description: "Your extension is now awaiting manager approval.",
        });
      } else if (data.status === 'expired') {
        toast({
          title: "Session Expired",
          description: "The payment session has expired. Please try again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Status Checked",
          description: data.message || "No changes needed.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter to show only active extensions (pending, paid, rejected, or refunded)
  const activeExtensions = extensions?.filter(ext => 
    ext.status === 'pending' || ext.status === 'paid' || ext.status === 'rejected' || ext.status === 'refunded'
  ) || [];

  if (isLoading) {
    return null; // Don't show loading state, just hide
  }

  if (activeExtensions.length === 0) {
    return null; // Don't show if no pending extensions
  }

  return (
    <Card className="mb-6 border-amber-200 bg-amber-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="h-5 w-5 text-amber-600" />
          Storage Extension Requests
        </CardTitle>
        <CardDescription>
          Your pending storage booking extension requests
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeExtensions.map((extension) => (
          <div
            key={extension.id}
            className={`rounded-lg p-4 border ${
              extension.status === 'rejected' 
                ? 'bg-red-50 border-red-200' 
                : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {getStatusBadge(extension.status)}
                  <span className="text-sm text-gray-500">
                    Requested {format(new Date(extension.createdAt), "MMM d, yyyy")}
                  </span>
                </div>

                <h4 className="font-semibold">
                  {extension.storageName}
                  <span className="text-gray-500 font-normal text-sm ml-2">
                    at {extension.kitchenName}
                  </span>
                </h4>

                <div className="flex items-center gap-3 text-sm">
                  <div className="bg-gray-100 rounded px-2 py-1">
                    <span className="text-gray-600">Current: </span>
                    <span className="font-medium">{format(new Date(extension.currentEndDate), "MMM d")}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                  <div className="bg-green-100 rounded px-2 py-1">
                    <span className="text-green-700">New: </span>
                    <span className="font-medium text-green-800">{format(new Date(extension.newEndDate), "MMM d, yyyy")}</span>
                  </div>
                </div>

                <div className="text-sm text-gray-600">
                  <strong>{extension.extensionDays}</strong> day{extension.extensionDays > 1 ? 's' : ''} •{' '}
                  <strong>${(extension.extensionTotalPriceCents / 100).toFixed(2)}</strong> paid
                </div>

                {/* Show sync button for pending extensions that may have completed payment */}
                {extension.status === 'pending' && (
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncMutation.mutate(extension.id)}
                      disabled={syncMutation.isPending}
                      className="text-xs"
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                      {syncMutation.isPending ? 'Checking...' : 'Check Payment Status'}
                    </Button>
                    <p className="text-xs text-gray-500 mt-1">
                      Already paid? Click to sync your payment status.
                    </p>
                  </div>
                )}

                {extension.status === 'rejected' && (
                  <div className="flex items-start gap-2 mt-2 p-2 bg-red-100 rounded text-sm text-red-800">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Rejected by manager</p>
                      {extension.rejectionReason && <p>{extension.rejectionReason}</p>}
                      <p className="text-red-600 mt-1">A refund will be processed to your payment method.</p>
                    </div>
                  </div>
                )}

                {extension.status === 'refunded' && (
                  <div className="flex items-start gap-2 mt-2 p-2 bg-blue-100 rounded text-sm text-blue-800">
                    <Check className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Refund Completed</p>
                      {extension.rejectionReason && <p className="text-gray-600">Reason: {extension.rejectionReason}</p>}
                      <p className="text-blue-600 mt-1">The refund has been processed to your payment method.</p>
                    </div>
                  </div>
                )}

                {extension.status === 'paid' && (
                  <p className="text-sm text-amber-700 mt-1">
                    The kitchen manager will review your request shortly.
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
