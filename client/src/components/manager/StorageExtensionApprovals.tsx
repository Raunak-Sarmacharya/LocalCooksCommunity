import { StorageIcon as Package } from "@/components/ui/inventory-icons";
import { useState } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, X, Clock, AlertCircle, CheckCircle, Calendar } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDialogContent } from "@/components/ui/app-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

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
  const { data: pendingExtensions, isLoading, isError, refetch } = useQuery({
    queryKey: ['/api/manager/storage-extensions/pending'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/storage-extensions/pending', { headers });
      if (!response.ok) {
        throw new Error(mt("failedToFetchPendingExtensions"));
      }
      return response.json() as Promise<PendingStorageExtension[]>;
    },
    refetchInterval: 30_000,
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
      toast({ title: mt("extensionApproved"),
        description: mt("theStorageBookingHasBeenExtendedSuccessfully"),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-extensions/pending'] });
    },
    onError: (error: Error) => {
      toast({ title: mt("approvalFailed"),
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
      toast({ title: mt("extensionRejected"),
        description: mt("theExtensionRequestHasBeenRejectedARefundWillBeProcessed"),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-extensions/pending'] });
      setRejectDialogOpen(false);
      setSelectedExtension(null);
      setRejectionReason("");
    },
    onError: (error: Error) => {
      toast({ title: mt("rejectionFailed"),
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
              <CardTitle className="text-base">{mt("storageExtensionRequests")}</CardTitle>
              <CardDescription className="text-xs">{mt("reviewAndApproveStorageBookingExtensionRequests")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 py-2" role="status" aria-label="Loading storage extension requests">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return <Card className="border-destructive/40"><CardContent className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm text-destructive">{mt("failedToFetchPendingExtensions")}</p>
      <Button variant="outline" size="sm" onClick={() => void refetch()}>{mt("retry")}</Button>
    </CardContent></Card>;
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
              <CardTitle className="text-base">{mt("storageExtensionRequests")}</CardTitle>
              <CardDescription className="text-xs">{mt("reviewAndApproveStorageBookingExtensionRequests")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">{mt("noPendingExtensionRequests")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-amber-200 bg-amber-50/30">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <div className="h-8 w-8 shrink-0 rounded-full bg-amber-100 flex items-center justify-center">
                <Package className="h-4 w-4 text-amber-600" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base">{mt("storageExtensionRequests")}</CardTitle>
                <CardDescription className="text-xs">{mt("reviewAndApproveStorageBookingExtensionRequests")}</CardDescription>
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
              className="flex min-w-0 flex-col gap-4 rounded-lg border bg-white p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="h-8 w-8 rounded-md bg-purple-50 flex items-center justify-center shrink-0">
                  <Package className="h-4 w-4 text-purple-600" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm font-medium">
                    {extension.storageName}
                    <span className="ml-1 font-normal text-muted-foreground">({extension.storageType})</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex min-w-0 items-start gap-1 break-all">
                      <Calendar className="mt-0.5 h-3 w-3 shrink-0" />
                      {extension.chefEmail}
                    </span>
                    <span className="flex items-start gap-1">
                      <Calendar className="mt-0.5 h-3 w-3 shrink-0" />
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

              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-destructive border-destructive/30 hover:bg-destructive/5"
                  onClick={() => handleRejectClick(extension)}
                  disabled={rejectMutation.isPending}
                >
                  <X className="h-3.5 w-3.5 mr-1" />{mt("reject")}</Button>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => handleApprove(extension)}
                  disabled={approveMutation.isPending}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />{mt("approve")}</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AppDialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />{mt("rejectExtensionRequest")}</DialogTitle>
            <DialogDescription>
              {selectedExtension?.status === 'authorized'
              ? mt("rejectExtensionHoldReleased")
              : mt("rejectExtensionChefRefunded")}
            </DialogDescription>
          </DialogHeader>

          {selectedExtension && (
            <div className="space-y-4">
              <div className="bg-muted rounded-lg p-3 space-y-1.5 text-sm">
                <div className="font-medium">{selectedExtension.storageName} ({selectedExtension.storageType})</div>
                <div className="text-muted-foreground text-xs">
                  {selectedExtension.chefEmail} · {selectedExtension.extensionDays} days · ${(selectedExtension.extensionTotalPriceCents / 100).toFixed(2)} {selectedExtension.status === 'authorized' ? 'held' : 'paid'}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">{mt("reasonForRejectionOptional")}</Label>
                <Textarea
                  id="reason"
                  placeholder={mt("eGStorageSpaceIsAlreadyReservedForAnotherChef")}
                  value={rejectionReason}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectionReason(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button
              variant="ghost"
              onClick={() => {
                setRejectDialogOpen(false);
                setSelectedExtension(null);
                setRejectionReason("");
              }}
            >{mt("cancel")}</Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting..." : selectedExtension?.status === 'authorized' ? "Reject & Release Hold" : "Reject & Refund"}
            </Button>
          </DialogFooter>
        </AppDialogContent>
      </Dialog>
    </>
  );
}
