import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, X, Package, Clock, AlertCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/api";

interface PendingStorageExtension {
  id: number;
  storageBookingId: number;
  newEndDate: string;
  extensionDays: number;
  extensionBasePriceCents: number;
  extensionTotalPriceCents: number;
  status: string;
  createdAt: string;
  currentEndDate: string;
  storageName: string;
  storageType: string;
  chefId: number;
  chefEmail: string;
  kitchenName: string;
  locationId: number;
}

export function StorageExtensionApprovals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [selectedExtension, setSelectedExtension] = useState<PendingStorageExtension | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Fetch pending storage extensions
  const { data: pendingExtensions, isLoading } = useQuery({
    queryKey: ['/api/manager/storage-extensions/pending'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/storage-extensions/pending', { headers });
      if (!response.ok) {
        throw new Error('Failed to fetch pending extensions');
      }
      return response.json() as Promise<PendingStorageExtension[]>;
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (extensionId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-extensions/${extensionId}/approve`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to approve extension');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Extension Approved",
        description: "The storage booking has been extended successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-extensions/pending'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Approval Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ extensionId, reason }: { extensionId: number; reason: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-extensions/${extensionId}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to reject extension');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Extension Rejected",
        description: "The extension request has been rejected. A refund will be processed.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-extensions/pending'] });
      setRejectDialogOpen(false);
      setSelectedExtension(null);
      setRejectionReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Rejection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleApprove = (extension: PendingStorageExtension) => {
    approveMutation.mutate(extension.id);
  };

  const handleRejectClick = (extension: PendingStorageExtension) => {
    setSelectedExtension(extension);
    setRejectDialogOpen(true);
  };

  const handleRejectConfirm = () => {
    if (selectedExtension) {
      rejectMutation.mutate({
        extensionId: selectedExtension.id,
        reason: rejectionReason,
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Storage Extension Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!pendingExtensions || pendingExtensions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Storage Extension Requests
          </CardTitle>
          <CardDescription>
            Review and approve storage booking extension requests
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No pending extension requests</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Storage Extension Requests
            <Badge variant="secondary" className="ml-2">
              {pendingExtensions.length} pending
            </Badge>
          </CardTitle>
          <CardDescription>
            Review and approve storage booking extension requests from chefs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendingExtensions.map((extension) => (
            <div
              key={extension.id}
              className="border rounded-lg p-4 bg-amber-50 border-amber-200"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
                      <Clock className="h-3 w-3 mr-1" />
                      Awaiting Approval
                    </Badge>
                    <span className="text-sm text-gray-500">
                      Requested {format(new Date(extension.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                  
                  <h4 className="font-semibold text-lg">
                    {extension.storageName}
                    <span className="text-gray-500 font-normal text-sm ml-2">
                      ({extension.storageType})
                    </span>
                  </h4>
                  
                  <div className="text-sm text-gray-600">
                    <p><strong>Chef:</strong> {extension.chefEmail}</p>
                    <p><strong>Kitchen:</strong> {extension.kitchenName}</p>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div className="bg-white rounded px-3 py-2 border">
                      <p className="text-xs text-gray-500">Current End Date</p>
                      <p className="font-medium">{format(new Date(extension.currentEndDate), "MMM d, yyyy")}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                    <div className="bg-green-50 rounded px-3 py-2 border border-green-200">
                      <p className="text-xs text-green-600">New End Date</p>
                      <p className="font-medium text-green-700">{format(new Date(extension.newEndDate), "MMM d, yyyy")}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-600">
                      <strong>{extension.extensionDays}</strong> day{extension.extensionDays > 1 ? 's' : ''} extension
                    </span>
                    <span className="text-gray-600">
                      <strong>${(extension.extensionTotalPriceCents / 100).toFixed(2)}</strong> paid
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => handleApprove(extension)}
                    disabled={approveMutation.isPending}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => handleRejectClick(extension)}
                    disabled={rejectMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Reject Extension Request
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to reject this extension request? The chef will be refunded.
            </DialogDescription>
          </DialogHeader>

          {selectedExtension && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p><strong>Storage:</strong> {selectedExtension.storageName}</p>
                <p><strong>Chef:</strong> {selectedExtension.chefEmail}</p>
                <p><strong>Extension:</strong> {selectedExtension.extensionDays} days</p>
                <p><strong>Amount to refund:</strong> ${(selectedExtension.extensionTotalPriceCents / 100).toFixed(2)}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Reason for rejection (optional)</Label>
                <Textarea
                  id="reason"
                  placeholder="e.g., Storage space is already reserved for another chef..."
                  value={rejectionReason}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectionReason(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectDialogOpen(false);
                setSelectedExtension(null);
                setRejectionReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject & Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
