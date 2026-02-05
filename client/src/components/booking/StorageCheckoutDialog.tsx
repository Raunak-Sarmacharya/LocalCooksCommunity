/**
 * Storage Checkout Dialog
 * 
 * Chef-initiated checkout for storage bookings with photo documentation.
 * Part of the hybrid verification system:
 * 1. Chef initiates checkout (this component)
 * 2. Chef uploads photos of empty storage
 * 3. Manager verifies and approves
 * 4. Prevents unwarranted overstay penalties
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, X, Camera, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

interface StorageCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageBooking: {
    id: number;
    storageName?: string;
    storageType?: string;
    endDate: string;
    checkoutStatus?: string;
    checkoutDenialReason?: string;
  };
  onSuccess?: () => void;
}

export function StorageCheckoutDialog({
  open,
  onOpenChange,
  storageBooking,
  onSuccess,
}: StorageCheckoutDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024, // 4.5MB (Vercel limit)
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    onSuccess: (response) => {
      setUploadedPhotos(prev => [...prev, response.url]);
      toast({
        title: "Photo uploaded",
        description: "Photo added to checkout request",
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    },
  });

  const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (uploadedPhotos.length >= 10) {
        toast({
          title: "Maximum photos reached",
          description: "You can upload up to 10 photos",
          variant: "destructive",
        });
        return;
      }
      uploadFile(file, "checkout-photos");
      e.target.value = ''; // Reset input
    }
  }, [uploadFile, uploadedPhotos.length, toast]);

  const handleRemovePhoto = (photoUrl: string) => {
    setUploadedPhotos(prev => prev.filter(url => url !== photoUrl));
  };

  const handleSubmitCheckout = async () => {
    if (uploadedPhotos.length === 0) {
      toast({
        title: "Photos required",
        description: "Please upload at least one photo of the empty storage unit",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Not authenticated");
      }

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/chef/storage-bookings/${storageBooking.id}/request-checkout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          checkoutNotes: checkoutNotes.trim() || undefined,
          checkoutPhotoUrls: uploadedPhotos,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit checkout request');
      }

      toast({
        title: "Checkout request submitted",
        description: "The manager will verify and approve your checkout. You'll be notified once approved.",
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-bookings'] });
      
      // Reset form
      setCheckoutNotes("");
      setUploadedPhotos([]);
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Checkout request failed",
        description: error instanceof Error ? error.message : "Failed to submit checkout request",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const wasDenied = storageBooking.checkoutStatus === 'active' && storageBooking.checkoutDenialReason;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Request Storage Checkout
          </SheetTitle>
          <SheetDescription>
            Submit a checkout request for your storage booking. The manager will verify the storage unit is empty before approving.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Storage Info */}
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-sm font-medium">{storageBooking.storageName || 'Storage Unit'}</div>
            <div className="text-xs text-muted-foreground mt-1">
              End Date: {new Date(storageBooking.endDate).toLocaleDateString()}
            </div>
            {storageBooking.storageType && (
              <Badge variant="outline" className="mt-2 text-xs">
                {storageBooking.storageType}
              </Badge>
            )}
          </div>

          {/* Previous Denial Warning */}
          {wasDenied && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-amber-800">Previous checkout was denied</div>
                  <div className="text-xs text-amber-700 mt-1">
                    Reason: {storageBooking.checkoutDenialReason}
                  </div>
                  <div className="text-xs text-amber-600 mt-1">
                    Please address the issues and submit a new request.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Photo Upload Section */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Photos of Empty Storage *
            </Label>
            <p className="text-xs text-muted-foreground">
              Upload photos showing the storage unit is empty and clean. This helps the manager verify your checkout quickly.
            </p>

            {/* Uploaded Photos Grid */}
            {uploadedPhotos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {uploadedPhotos.map((photoUrl, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={getR2ProxyUrl(photoUrl)}
                      alt={`Checkout photo ${index + 1}`}
                      className="w-full h-20 object-cover rounded-lg border"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(photoUrl)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload Button */}
            <div
              className={cn(
                "border-2 border-dashed border-border rounded-lg p-4 hover:border-primary/50 transition-colors",
                isUploading && "opacity-50 cursor-not-allowed"
              )}
            >
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handlePhotoUpload}
                className="hidden"
                id="checkout-photo-upload"
                disabled={isUploading || uploadedPhotos.length >= 10}
              />
              <label
                htmlFor="checkout-photo-upload"
                className="flex flex-col items-center justify-center cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-6 w-6 text-primary animate-spin mb-1" />
                    <span className="text-xs text-muted-foreground">Uploading... {Math.round(uploadProgress)}%</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">
                      {uploadedPhotos.length === 0 
                        ? "Click to upload photos" 
                        : `${uploadedPhotos.length}/10 photos uploaded`}
                    </span>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Notes Section */}
          <div className="space-y-2">
            <Label htmlFor="checkout-notes">Notes (optional)</Label>
            <Textarea
              id="checkout-notes"
              placeholder="Any additional notes for the manager..."
              value={checkoutNotes}
              onChange={(e) => setCheckoutNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-blue-600 mt-0.5" />
              <div className="text-xs text-blue-700">
                <strong>What happens next?</strong>
                <ul className="mt-1 space-y-1 list-disc list-inside">
                  <li>The manager will review your photos</li>
                  <li>They may inspect the storage unit</li>
                  <li>Once approved, your booking will be completed</li>
                  <li>No overstay penalties while checkout is pending</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmitCheckout} 
            disabled={isSubmitting || uploadedPhotos.length === 0}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Submit Checkout Request
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
