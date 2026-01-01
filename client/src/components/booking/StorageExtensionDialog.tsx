import { useState, useMemo } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertCircle, Check, Package, Calendar as CalendarIcon } from "lucide-react";
import { format, differenceInDays, addDays, startOfToday, isBefore } from "date-fns";
import { DateRange } from "react-day-picker";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface StorageBooking {
  id: number;
  storageListingId: number;
  startDate: string;
  endDate: string;
  status: string;
  totalPrice: number;
  serviceFee: number;
  storageName: string;
  storageType: string;
  kitchenName: string;
  basePrice: number;
  minimumBookingDuration: number;
}

interface StorageExtensionDialogProps {
  booking: StorageBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
}

export function StorageExtensionDialog({
  booking,
  open,
  onOpenChange,
  onSuccess,
}: StorageExtensionDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [isProcessing, setIsProcessing] = useState(false);

  const currentEndDate = new Date(booking.endDate);
  const today = startOfToday();
  const minDate = currentEndDate > today ? currentEndDate : today;

  // Calculate extension details
  const extensionDetails = useMemo(() => {
    if (!selectedDate || selectedDate <= currentEndDate) {
      return null;
    }

    const extensionDays = differenceInDays(selectedDate, currentEndDate);
    const minDays = booking.minimumBookingDuration || 1;
    
    if (extensionDays < minDays) {
      return {
        valid: false,
        error: `Minimum extension is ${minDays} day${minDays > 1 ? 's' : ''}`,
      };
    }

    const basePricePerDay = booking.basePrice || 0;
    const extensionBasePrice = basePricePerDay * extensionDays;
    const extensionServiceFee = extensionBasePrice * 0.05; // 5% service fee
    const extensionTotalPrice = extensionBasePrice + extensionServiceFee;

    return {
      valid: true,
      extensionDays,
      extensionBasePrice,
      extensionServiceFee,
      extensionTotalPrice,
    };
  }, [selectedDate, currentEndDate, booking.basePrice, booking.minimumBookingDuration]);

  const extendMutation = useMutation({
    mutationFn: async (newEndDate: Date) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/chef/storage-bookings/${booking.id}/extend`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          newEndDate: newEndDate.toISOString(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to extend storage booking');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Storage Extended",
        description: data.message || "Storage booking extended successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chef/bookings'] });
      onOpenChange(false);
      setSelectedDate(undefined);
      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (error: any) => {
      toast({
        title: "Extension Failed",
        description: error.message || "Failed to extend storage booking",
        variant: "destructive",
      });
    },
  });

  const handleExtend = () => {
    if (!selectedDate || !extensionDetails || !extensionDetails.valid) {
      return;
    }

    setIsProcessing(true);
    extendMutation.mutate(selectedDate, {
      onSettled: () => {
        setIsProcessing(false);
      },
    });
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date && isBefore(date, minDate)) {
      toast({
        title: "Invalid Date",
        description: "Selected date must be after the current end date",
        variant: "destructive",
      });
      return;
    }
    setSelectedDate(date);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-purple-600" />
            Extend Storage Booking
          </DialogTitle>
          <DialogDescription>
            Extend your storage booking for {booking.storageName} at {booking.kitchenName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current Booking Info */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <h4 className="font-semibold text-sm text-gray-700">Current Booking</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-600">Start Date:</span>
                <span className="ml-2 font-medium">{format(new Date(booking.startDate), "PPP")}</span>
              </div>
              <div>
                <span className="text-gray-600">End Date:</span>
                <span className="ml-2 font-medium">{format(currentEndDate, "PPP")}</span>
              </div>
              <div>
                <span className="text-gray-600">Storage Type:</span>
                <span className="ml-2 font-medium capitalize">{booking.storageType}</span>
              </div>
              <div>
                <span className="text-gray-600">Daily Rate:</span>
                <span className="ml-2 font-medium">${booking.basePrice.toFixed(2)}/day</span>
              </div>
            </div>
          </div>

          {/* Date Selection */}
          <div className="space-y-3">
            <Label>Select New End Date</Label>
            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={handleDateSelect}
                disabled={(date) => isBefore(date, minDate)}
                defaultMonth={minDate}
                className="rounded-md border"
              />
            </div>
            {selectedDate && (
              <div className="text-sm text-gray-600 text-center">
                Selected: <span className="font-medium">{format(selectedDate, "PPP")}</span>
              </div>
            )}
          </div>

          {/* Extension Details */}
          {extensionDetails && (
            <div className={`rounded-lg p-4 ${
              extensionDetails.valid
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              {extensionDetails.valid ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-green-800 font-semibold">
                    <Check className="h-4 w-4" />
                    Extension Summary
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-700">Extension Period:</span>
                      <span className="font-medium">
                        {extensionDetails.extensionDays} day{extensionDetails.extensionDays > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">
                        {extensionDetails.extensionDays} day{extensionDetails.extensionDays > 1 ? 's' : ''} × ${booking.basePrice.toFixed(2)}/day:
                      </span>
                      <span className="font-medium">${extensionDetails.extensionBasePrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">Service Fee (5%):</span>
                      <span className="font-medium">${extensionDetails.extensionServiceFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-green-200 font-semibold text-green-900">
                      <span>Additional Cost:</span>
                      <span>${extensionDetails.extensionTotalPrice.toFixed(2)} CAD</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-800">
                  <AlertCircle className="h-4 w-4" />
                  <span>{extensionDetails.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Warning for expiring soon */}
          {differenceInDays(currentEndDate, today) <= 2 && differenceInDays(currentEndDate, today) >= 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold">Storage Expiring Soon</p>
                <p>Your storage expires in {differenceInDays(currentEndDate, today)} day{differenceInDays(currentEndDate, today) !== 1 ? 's' : ''}. Extend now to avoid interruption.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setSelectedDate(undefined);
            }}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExtend}
            disabled={!selectedDate || !extensionDetails || !extensionDetails.valid || isProcessing}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isProcessing ? "Processing..." : `Extend & Pay $${extensionDetails?.extensionTotalPrice.toFixed(2) || '0.00'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

