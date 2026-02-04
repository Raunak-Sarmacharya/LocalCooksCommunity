/**
 * Pending Storage Checkouts Component
 * 
 * Manager view for reviewing and approving/denying storage checkout requests.
 * Part of the hybrid verification system:
 * 1. Chef initiates checkout with photos
 * 2. Manager reviews photos and verifies (this component)
 * 3. Manager approves or denies with reason
 * 4. Prevents unwarranted overstay penalties
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Package, 
  User, 
  Calendar,
  Image,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

interface PendingCheckout {
  storageBookingId: number;
  storageListingId: number;
  storageName: string;
  storageType: string;
  kitchenId: number;
  kitchenName: string;
  locationId: number;
  locationName: string;
  chefId: number | null;
  chefEmail: string | null;
  chefName: string | null;
  startDate: string;
  endDate: string;
  totalPrice: string;
  checkoutStatus: string;
  checkoutRequestedAt: string | null;
  checkoutNotes: string | null;
  checkoutPhotoUrls: string[];
  daysUntilEnd: number;
  isOverdue: boolean;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return { 'Content-Type': 'application/json' };
}

export function PendingStorageCheckouts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedCheckout, setSelectedCheckout] = useState<PendingCheckout | null>(null);
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [denialReason, setDenialReason] = useState("");
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);

  // Fetch pending checkouts
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/manager/storage-checkouts/pending'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/storage-checkouts/pending', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch pending checkouts');
      return response.json();
    },
  });

  const pendingCheckouts: PendingCheckout[] = data?.pendingCheckouts || [];

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (storageBookingId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-bookings/${storageBookingId}/approve-checkout`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve checkout');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Checkout approved",
        description: "The storage booking has been completed. The chef has been notified.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/pending'] });
      setSelectedCheckout(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Approval failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Deny mutation
  const denyMutation = useMutation({
    mutationFn: async ({ storageBookingId, denialReason }: { storageBookingId: number; denialReason: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-bookings/${storageBookingId}/deny-checkout`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ denialReason }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to deny checkout');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Checkout denied",
        description: "The chef has been notified to address the issues.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/pending'] });
      setDenyDialogOpen(false);
      setDenialReason("");
      setSelectedCheckout(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Denial failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleApprove = (checkout: PendingCheckout) => {
    approveMutation.mutate(checkout.storageBookingId);
  };

  const handleDenyClick = (checkout: PendingCheckout) => {
    setSelectedCheckout(checkout);
    setDenyDialogOpen(true);
  };

  const handleDenySubmit = () => {
    if (!selectedCheckout || !denialReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for denying the checkout",
        variant: "destructive",
      });
      return;
    }
    denyMutation.mutate({
      storageBookingId: selectedCheckout.storageBookingId,
      denialReason: denialReason.trim(),
    });
  };

  const openPhotoViewer = (checkout: PendingCheckout, index: number) => {
    setSelectedCheckout(checkout);
    setSelectedPhotoIndex(index);
    setPhotoViewerOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8 text-destructive">
          <AlertTriangle className="h-5 w-5 mr-2" />
          Failed to load pending checkouts
        </CardContent>
      </Card>
    );
  }

  if (pendingCheckouts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Pending Storage Checkouts
          </CardTitle>
          <CardDescription>
            Review and approve chef checkout requests
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No pending checkout requests</p>
            <p className="text-sm mt-1">Checkout requests from chefs will appear here</p>
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
            <CheckCircle className="h-5 w-5 text-green-600" />
            Pending Storage Checkouts
            <Badge variant="secondary" className="ml-2">
              {pendingCheckouts.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Review and approve chef checkout requests. Verify the storage unit is empty before approving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendingCheckouts.map((checkout) => (
            <Collapsible
              key={checkout.storageBookingId}
              open={expandedId === checkout.storageBookingId}
              onOpenChange={(open) => setExpandedId(open ? checkout.storageBookingId : null)}
            >
              <div className={cn(
                "border rounded-lg p-4",
                checkout.isOverdue && "border-amber-300 bg-amber-50"
              )}>
                {/* Header Row */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{checkout.storageName}</span>
                      <Badge variant="outline" className="text-xs">
                        {checkout.storageType}
                      </Badge>
                      {checkout.isOverdue && (
                        <Badge variant="destructive" className="text-xs">
                          Overdue
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {checkout.chefEmail || 'Unknown Chef'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        End: {format(new Date(checkout.endDate), 'MMM d, yyyy')}
                      </span>
                      {checkout.checkoutRequestedAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Requested {formatDistanceToNow(new Date(checkout.checkoutRequestedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm">
                        {expandedId === checkout.storageBookingId ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </div>

                {/* Photo Thumbnails */}
                {checkout.checkoutPhotoUrls.length > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <Image className="h-4 w-4 text-muted-foreground" />
                    <div className="flex gap-1">
                      {checkout.checkoutPhotoUrls.slice(0, 4).map((url, index) => (
                        <button
                          key={index}
                          onClick={() => openPhotoViewer(checkout, index)}
                          className="relative w-10 h-10 rounded overflow-hidden border hover:border-primary transition-colors"
                        >
                          <img
                            src={url}
                            alt={`Photo ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                      {checkout.checkoutPhotoUrls.length > 4 && (
                        <button
                          onClick={() => openPhotoViewer(checkout, 4)}
                          className="w-10 h-10 rounded border bg-muted flex items-center justify-center text-xs text-muted-foreground hover:border-primary transition-colors"
                        >
                          +{checkout.checkoutPhotoUrls.length - 4}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Expanded Content */}
                <CollapsibleContent className="mt-4 pt-4 border-t">
                  <div className="space-y-4">
                    {/* Chef Notes */}
                    {checkout.checkoutNotes && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Chef Notes</Label>
                        <p className="text-sm mt-1 bg-muted/50 rounded p-2">
                          {checkout.checkoutNotes}
                        </p>
                      </div>
                    )}

                    {/* All Photos */}
                    {checkout.checkoutPhotoUrls.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Checkout Photos</Label>
                        <div className="grid grid-cols-4 gap-2 mt-2">
                          {checkout.checkoutPhotoUrls.map((url, index) => (
                            <button
                              key={index}
                              onClick={() => openPhotoViewer(checkout, index)}
                              className="relative aspect-square rounded-lg overflow-hidden border hover:border-primary transition-colors"
                            >
                              <img
                                src={url}
                                alt={`Photo ${index + 1}`}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
                                <ExternalLink className="h-4 w-4 text-white opacity-0 hover:opacity-100" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Booking Details */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">Kitchen</Label>
                        <p>{checkout.kitchenName}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Location</Label>
                        <p>{checkout.locationName}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Booking Period</Label>
                        <p>
                          {format(new Date(checkout.startDate), 'MMM d')} - {format(new Date(checkout.endDate), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Total Price</Label>
                        <p>${(parseInt(checkout.totalPrice) / 100).toFixed(2)}</p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => handleDenyClick(checkout)}
                        disabled={denyMutation.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Deny
                      </Button>
                      <Button
                        onClick={() => handleApprove(checkout)}
                        disabled={approveMutation.isPending}
                      >
                        {approveMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-2" />
                        )}
                        Approve Checkout
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </CardContent>
      </Card>

      {/* Deny Dialog */}
      <Dialog open={denyDialogOpen} onOpenChange={setDenyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Checkout Request</DialogTitle>
            <DialogDescription>
              Please provide a reason for denying this checkout. The chef will be notified and can submit a new request after addressing the issues.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="denial-reason">Reason for Denial *</Label>
            <Textarea
              id="denial-reason"
              placeholder="e.g., Storage unit still contains items, needs cleaning..."
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              rows={3}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDenySubmit}
              disabled={denyMutation.isPending || !denialReason.trim()}
            >
              {denyMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Deny Checkout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Viewer Dialog */}
      <Dialog open={photoViewerOpen} onOpenChange={setPhotoViewerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Checkout Photos</DialogTitle>
          </DialogHeader>
          {selectedCheckout && selectedCheckout.checkoutPhotoUrls.length > 0 && (
            <div className="space-y-4">
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                <img
                  src={selectedCheckout.checkoutPhotoUrls[selectedPhotoIndex]}
                  alt={`Photo ${selectedPhotoIndex + 1}`}
                  className="w-full h-full object-contain"
                />
              </div>
              {selectedCheckout.checkoutPhotoUrls.length > 1 && (
                <div className="flex justify-center gap-2">
                  {selectedCheckout.checkoutPhotoUrls.map((url, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedPhotoIndex(index)}
                      className={cn(
                        "w-12 h-12 rounded overflow-hidden border-2 transition-colors",
                        index === selectedPhotoIndex ? "border-primary" : "border-transparent"
                      )}
                    >
                      <img
                        src={url}
                        alt={`Thumbnail ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
