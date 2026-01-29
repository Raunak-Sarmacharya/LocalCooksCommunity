import { useState, useMemo } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AlertCircle, Check, Package, CalendarDays, ArrowRight, Clock } from "lucide-react";
import { format, differenceInDays, startOfToday, isBefore, addDays, addWeeks, addMonths } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/api";

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

export function StorageExtensionDialog({
  booking,
  open,
  onOpenChange,
  onSuccess: _onSuccess,
}: StorageExtensionDialogProps) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  // Memoize currentEndDate to prevent useMemo dependency changes on every render
  const currentEndDate = useMemo(() => new Date(booking.endDate), [booking.endDate]);
  const today = startOfToday();
  const minDate = currentEndDate > today ? currentEndDate : today;
  const minDays = booking.minimumBookingDuration || 1;

  // Quick extension options
  const quickOptions = useMemo(() => {
    const baseDate = minDate;
    return [
      { label: '1 Week', days: 7, date: addWeeks(baseDate, 1) },
      { label: '2 Weeks', days: 14, date: addWeeks(baseDate, 2) },
      { label: '1 Month', days: 30, date: addMonths(baseDate, 1) },
      { label: '3 Months', days: 90, date: addMonths(baseDate, 3) },
    ].filter(opt => opt.days >= minDays);
  }, [minDate, minDays]);

  // Fetch fee configuration from server (enterprise-grade - no hardcoded values)
  const { data: feeConfig } = useQuery({
    queryKey: ['/api/platform-settings/stripe-fees'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/platform-settings/stripe-fees');
        if (response.ok) {
          return response.json();
        }
      } catch (error) {
        console.error('Error fetching fee config:', error);
      }
      // Default fallback (same as server defaults)
      return {
        stripePercentageFee: 0.029,
        stripeFlatFeeCents: 30,
        platformCommissionRate: 0,
        stripePercentageDisplay: '2.9%',
        stripeFlatFeeDisplay: '$0.30',
      };
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Calculate extension details using server-provided fee configuration
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

    // Get fee configuration (with defaults)
    const stripePercentageFee = feeConfig?.stripePercentageFee ?? 0.029;
    const stripeFlatFeeCents = feeConfig?.stripeFlatFeeCents ?? 30;

    // Calculate base price (in cents)
    const basePricePerDayCents = booking.basePrice || 0;
    const extensionBasePriceCents = Math.round(basePricePerDayCents * extensionDays);
    
    // Calculate platform fee using same formula as server
    const platformFeeCents = Math.round(
      extensionBasePriceCents * stripePercentageFee + stripeFlatFeeCents
    );
    
    // Manager receives base price minus platform fee
    const managerReceivesCents = extensionBasePriceCents - platformFeeCents;
    
    // Total customer pays = base price (platform fee is deducted from manager's share)
    const extensionTotalPriceCents = extensionBasePriceCents;

    return {
      valid: true,
      extensionDays,
      extensionBasePriceCents,
      platformFeeCents,
      managerReceivesCents,
      extensionTotalPriceCents,
      feeDisplay: feeConfig?.stripePercentageDisplay && feeConfig?.stripeFlatFeeDisplay 
        ? `${feeConfig.stripePercentageDisplay} + ${feeConfig.stripeFlatFeeDisplay}`
        : '2.9% + $0.30',
    };
  }, [selectedDate, currentEndDate, booking.basePrice, booking.minimumBookingDuration, feeConfig]);

  // Create checkout session for storage extension payment
  const checkoutMutation = useMutation({
    mutationFn: async (newEndDate: Date) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/chef/storage-bookings/${booking.id}/extension-checkout`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          newEndDate: newEndDate.toISOString(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create checkout session');
      }

      return response.json();
    },
    onSuccess: (data) => {
      // Redirect to Stripe Checkout
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl;
      } else {
        toast({
          title: "Error",
          description: "Failed to get checkout URL",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Extension Failed",
        description: error.message || "Failed to create checkout session",
        variant: "destructive",
      });
    },
  });

  const handleExtend = () => {
    if (!selectedDate || !extensionDetails || !extensionDetails.valid) {
      return;
    }

    setIsProcessing(true);
    checkoutMutation.mutate(selectedDate, {
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-purple-600" />
            Extend Storage Booking
          </DialogTitle>
          <DialogDescription>
            {booking.storageName} at {booking.kitchenName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Current Booking Timeline */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Current End Date</p>
                <p className="text-lg font-bold text-gray-900">{format(currentEndDate, "MMM d, yyyy")}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-purple-400" />
              <div className="text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide">New End Date</p>
                {selectedDate ? (
                  <p className="text-lg font-bold text-purple-700">{format(selectedDate, "MMM d, yyyy")}</p>
                ) : (
                  <p className="text-lg font-medium text-gray-400">Select below</p>
                )}
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-purple-100 flex items-center justify-between text-sm">
              <span className="text-gray-600">Daily Rate:</span>
              <span className="font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded">
                ${((booking.basePrice || 0) / 100).toFixed(2)}/day
              </span>
            </div>
          </div>

          {/* Warning for expiring soon */}
          {differenceInDays(currentEndDate, today) <= 2 && differenceInDays(currentEndDate, today) >= 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <Clock className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold">Expiring {differenceInDays(currentEndDate, today) === 0 ? 'Today' : `in ${differenceInDays(currentEndDate, today)} day${differenceInDays(currentEndDate, today) !== 1 ? 's' : ''}`}</p>
                <p className="text-amber-700">Extend now to keep your storage.</p>
              </div>
            </div>
          )}

          {/* Quick Extension Options */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Quick Extend</Label>
            <div className="grid grid-cols-2 gap-2">
              {quickOptions.map((option) => {
                const isSelected = selectedDate?.getTime() === option.date.getTime();
                const price = ((booking.basePrice || 0) * option.days) / 100;
                return (
                  <button
                    key={option.label}
                    onClick={() => setSelectedDate(option.date)}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      isSelected
                        ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200'
                        : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className={`font-semibold ${isSelected ? 'text-purple-700' : 'text-gray-900'}`}>
                          {option.label}
                        </p>
                        <p className="text-xs text-gray-500">
                          Until {format(option.date, "MMM d")}
                        </p>
                      </div>
                      <p className={`font-bold ${isSelected ? 'text-purple-700' : 'text-gray-700'}`}>
                        ${price.toFixed(0)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Date Option */}
          <div className="space-y-3">
            <button
              onClick={() => setShowCalendar(!showCalendar)}
              className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
            >
              <CalendarDays className="h-4 w-4" />
              {showCalendar ? 'Hide calendar' : 'Choose custom date'}
            </button>
            
            {showCalendar && (
              <div className="flex justify-center border rounded-lg p-2 bg-white">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  disabled={(date) => isBefore(date, addDays(minDate, minDays - 1))}
                  defaultMonth={minDate}
                  className="rounded-md"
                />
              </div>
            )}
          </div>

          {/* Extension Summary */}
          {extensionDetails && extensionDetails.valid && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-800 font-semibold mb-3">
                <Check className="h-4 w-4" />
                Extension Summary
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-700">
                    {extensionDetails.extensionDays} day{(extensionDetails.extensionDays ?? 0) > 1 ? 's' : ''} × ${((booking.basePrice || 0) / 100).toFixed(2)}/day
                  </span>
                  <span className="font-medium">${((extensionDetails.extensionBasePriceCents ?? 0) / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-green-200 font-bold text-green-900 text-base">
                  <span>Total</span>
                  <span>${((extensionDetails.extensionTotalPriceCents ?? 0) / 100).toFixed(2)} CAD</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {extensionDetails && !extensionDetails.valid && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-red-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{extensionDetails.error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setSelectedDate(undefined);
              setShowCalendar(false);
            }}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExtend}
            disabled={!selectedDate || !extensionDetails || !extensionDetails.valid || isProcessing}
            className="bg-purple-600 hover:bg-purple-700 min-w-[160px]"
          >
            {isProcessing ? (
              "Processing..."
            ) : extensionDetails?.valid ? (
              `Pay $${((extensionDetails.extensionTotalPriceCents ?? 0) / 100).toFixed(2)} CAD`
            ) : (
              "Select Duration"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

