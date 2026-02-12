import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, X, Package, Clock, AlertCircle, CheckCircle, Calendar, ChefHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <Package className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Storage Extension Requests</CardTitle>
              <CardDescription className="text-xs">
                Review and approve storage booking extension requests
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!pendingExtensions || pendingExtensions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <Package className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Storage Extension Requests</CardTitle>
              <CardDescription className="text-xs">
                Review and approve storage booking extension requests
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No pending extension requests</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-amber-200 bg-amber-50/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center">
                <Package className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Storage Extension Requests
                </CardTitle>
                <CardDescription className="text-xs">
                  Review and approve storage booking extension requests
                </CardDescription>
              </div>
            </div>
            <Badge variant="warning">
              {pendingExtensions.length} pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingExtensions.map((extension) => (
            <div
              key={extension.id}
              className="flex items-center justify-between gap-4 rounded-lg border bg-white p-3.5 shadow-sm"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="h-8 w-8 rounded-md bg-purple-50 flex items-center justify-center shrink-0">
                  <Package className="h-4 w-4 text-purple-600" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium truncate">
                    {extension.storageName}
                    <span className="text-muted-foreground font-normal ml-1">({extension.storageType})</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ChefHat className="h-3 w-3" />
                      {extension.chefEmail}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(extension.currentEndDate), "MMM d")} → {format(new Date(extension.newEndDate), "MMM d, yyyy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="warning" className="text-[10px]">
                      <Clock className="h-2.5 w-2.5 mr-0.5" />
                      {extension.extensionDays} day{extension.extensionDays > 1 ? 's' : ''} · ${(extension.extensionTotalPriceCents / 100).toFixed(2)} {extension.status === 'authorized' ? 'held' : 'paid'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-destructive border-destructive/30 hover:bg-destructive/5"
                  onClick={() => handleRejectClick(extension)}
                  disabled={rejectMutation.isPending}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => handleApprove(extension)}
                  disabled={approveMutation.isPending}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Reject Sheet */}
      <Sheet open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Reject Extension Request
            </SheetTitle>
            <SheetDescription>
              {selectedExtension?.status === 'authorized'
              ? "Are you sure you want to reject this extension request? The payment hold will be released — the chef will not be charged."
              : "Are you sure you want to reject this extension request? The chef will be refunded."}
            </SheetDescription>
          </SheetHeader>

          {selectedExtension && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-3 space-y-1.5 text-sm">
                <div className="font-medium">{selectedExtension.storageName} ({selectedExtension.storageType})</div>
                <div className="text-muted-foreground text-xs">
                  {selectedExtension.chefEmail} · {selectedExtension.extensionDays} days · ${(selectedExtension.extensionTotalPriceCents / 100).toFixed(2)} {selectedExtension.status === 'authorized' ? 'held' : 'paid'}
                </div>
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

          <SheetFooter className="mt-6">
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
              {rejectMutation.isPending ? "Rejecting..." : selectedExtension?.status === 'authorized' ? "Reject & Release Hold" : "Reject & Refund"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
