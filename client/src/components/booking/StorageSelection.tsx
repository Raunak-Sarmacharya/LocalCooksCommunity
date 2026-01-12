import { useState, useMemo } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Package, X, Calendar as CalendarIcon, AlertCircle, Check, Info } from "lucide-react";
import { DateRange, SelectRangeEventHandler } from "react-day-picker";
import { format, differenceInDays, isBefore, startOfToday } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StorageListing {
  id: number;
  name: string;
  storageType: 'dry' | 'cold' | 'freezer';
  description?: string;
  basePrice: number; // Daily rate in dollars
  minimumBookingDuration: number; // Minimum days required
  climateControl?: boolean;
  isActive?: boolean;
  photos?: string[];
}

interface SelectedStorage {
  storageListingId: number;
  startDate: Date;
  endDate: Date;
}

interface StorageSelectionProps {
  storageListings: StorageListing[];
  selectedStorage: SelectedStorage[];
  onSelectionChange: (selections: SelectedStorage[]) => void;
  kitchenBookingDate?: Date; // Suggested start date
}

export function StorageSelection({
  storageListings,
  selectedStorage,
  onSelectionChange,
  kitchenBookingDate,
}: StorageSelectionProps) {
  const [openDialogId, setOpenDialogId] = useState<number | null>(null);
  const [dateRanges, setDateRanges] = useState<Record<number, DateRange | undefined>>({});
  const [validationErrors, setValidationErrors] = useState<Record<number, string>>({});

  // Fetch service fee rate (public endpoint - no auth required)
  const { data: serviceFeeRateData } = useQuery({
    queryKey: ['/api/platform-settings/service-fee-rate'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/platform-settings/service-fee-rate');
        if (response.ok) {
          return response.json();
        }
      } catch (error) {
        console.error('Error fetching service fee rate:', error);
      }
      // Default to 5% if unable to fetch
      return { rate: 0.05, percentage: '5.00' };
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const serviceFeeRate = serviceFeeRateData?.rate ?? 0.05; // Default to 5% if not available
  const serviceFeePercentage = serviceFeeRateData?.percentage ?? '5.00';

  // Filter to only active storage listings
  const activeStorageListings = useMemo(() => {
    return storageListings.filter(listing => listing.isActive !== false);
  }, [storageListings]);

  // Calculate price preview for a date range
  const calculatePrice = (listing: StorageListing, range: DateRange | undefined): {
    days: number;
    basePrice: number;
    serviceFee: number;
    total: number;
  } | null => {
    if (!range?.from || !range?.to) return null;

    const days = Math.ceil(differenceInDays(range.to, range.from));
    const minDays = listing.minimumBookingDuration || 1;
    const effectiveDays = Math.max(days, minDays);
    const basePrice = listing.basePrice * effectiveDays;
    const serviceFee = basePrice * serviceFeeRate; // Dynamic service fee
    const total = basePrice + serviceFee;

    return { days: effectiveDays, basePrice, serviceFee, total };
  };

  // Validate date range
  const validateDateRange = (listing: StorageListing, range: DateRange | undefined): string | null => {
    if (!range?.from) return null; // No start date selected yet

    const today = startOfToday();
    if (isBefore(range.from, today)) {
      return "Start date cannot be in the past";
    }

    if (!range.to) return null; // End date not selected yet

    if (isBefore(range.to, range.from)) {
      return "End date must be after start date";
    }

    const days = Math.ceil(differenceInDays(range.to, range.from));
    const minDays = listing.minimumBookingDuration || 1;

    if (days < minDays) {
      return `Minimum booking duration is ${minDays} day${minDays > 1 ? 's' : ''}`;
    }

    return null;
  };

  // Handle date range selection for a storage listing
  const handleDateRangeSelect = (listingId: number): SelectRangeEventHandler => {
    return (range: DateRange | undefined, selectedDay: Date | undefined) => {
      const listing = activeStorageListings.find(l => l.id === listingId);
      if (!listing) return;

      // If a complete range already exists and user clicks a new date, start a new range
      const currentRange = dateRanges[listingId];
      let newRange: DateRange | undefined = range;
      
      if (currentRange?.from && currentRange?.to && selectedDay) {
        // User is starting a new range - reset to just the selected day
        newRange = { from: selectedDay, to: undefined };
      }

      setDateRanges(prev => ({ ...prev, [listingId]: newRange }));
      
      const error = validateDateRange(listing, newRange);
      setValidationErrors(prev => ({ ...prev, [listingId]: error || '' }));

      // If range is complete and valid, add to selected storage
      if (newRange?.from && newRange?.to && !error) {
        const existingIndex = selectedStorage.findIndex(s => s.storageListingId === listingId);
        const newSelection: SelectedStorage = {
          storageListingId: listingId,
          startDate: newRange.from,
          endDate: newRange.to,
        };

        if (existingIndex >= 0) {
          // Update existing selection
          const updated = [...selectedStorage];
          updated[existingIndex] = newSelection;
          onSelectionChange(updated);
        } else {
          // Add new selection
          onSelectionChange([...selectedStorage, newSelection]);
        }
      } else if (!newRange?.from || !newRange?.to) {
        // Remove selection if range is incomplete
        const updated = selectedStorage.filter(s => s.storageListingId !== listingId);
        onSelectionChange(updated);
      }
    };
  };

  // Remove storage selection
  const handleRemoveStorage = (listingId: number) => {
    const updated = selectedStorage.filter(s => s.storageListingId !== listingId);
    onSelectionChange(updated);
    setDateRanges(prev => {
      const newRanges = { ...prev };
      delete newRanges[listingId];
      return newRanges;
    });
    setValidationErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[listingId];
      return newErrors;
    });
  };

  // Get suggested start date (kitchen booking date or today)
  const getSuggestedStartDate = (): Date => {
    if (kitchenBookingDate) {
      return kitchenBookingDate;
    }
    return new Date();
  };

  // Get minimum date for calendar (today)
  const minDate = startOfToday();

  if (activeStorageListings.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-500">
        <Package className="h-8 w-8 mx-auto mb-2 text-gray-400" />
        <p>No storage space available for this kitchen</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Package className="h-5 w-5 text-purple-600" />
        <h4 className="font-medium text-gray-800">Storage Space Available</h4>
        <Badge variant="outline" className="text-xs">
          Book separately with custom dates
        </Badge>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-800">
            <strong>Storage is booked independently</strong> from kitchen time. 
            You can book storage for as long as you need, starting from the minimum rental period.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {activeStorageListings.map((storage) => {
          const isSelected = selectedStorage.some(s => s.storageListingId === storage.id);
          const currentRange = dateRanges[storage.id] || 
            (isSelected ? {
              from: selectedStorage.find(s => s.storageListingId === storage.id)?.startDate,
              to: selectedStorage.find(s => s.storageListingId === storage.id)?.endDate,
            } : undefined);
          const pricePreview = calculatePrice(storage, currentRange);
          const error = validationErrors[storage.id];
          const minDays = storage.minimumBookingDuration || 1;

          return (
            <Card key={storage.id} className={isSelected ? "border-purple-500 border-2" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  {/* Storage Image */}
                  {storage.photos && storage.photos.length > 0 && (
                    <div className="flex-shrink-0">
                      <img
                        src={storage.photos[0]}
                        alt={storage.name}
                        className="w-24 h-24 object-cover rounded-lg border border-gray-200"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      {storage.name}
                      {isSelected && (
                        <Badge className="bg-green-100 text-green-700 border-green-300">
                          <Check className="h-3 w-3 mr-1" />
                          Selected
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={
                            storage.storageType === 'freezer'
                              ? 'bg-blue-100 text-blue-700 border-blue-300'
                              : storage.storageType === 'cold'
                              ? 'bg-cyan-100 text-cyan-700 border-cyan-300'
                              : 'bg-gray-100 text-gray-700 border-gray-300'
                          }
                        >
                          {storage.storageType === 'freezer'
                            ? '❄️ Freezer'
                            : storage.storageType === 'cold'
                            ? '🧊 Cold'
                            : '📦 Dry'}
                        </Badge>
                        {storage.climateControl && (
                          <span className="text-xs text-gray-500">Climate controlled</span>
                        )}
                      </div>
                    </CardDescription>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="font-semibold text-purple-700">
                      ${storage.basePrice.toFixed(2)}/day
                    </p>
                    <p className="text-xs text-gray-500">Min: {minDays} day{minDays > 1 ? 's' : ''}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {storage.description && (
                  <p className="text-sm text-gray-600">{storage.description}</p>
                )}

                {!isSelected ? (
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Initialize range state when opening dialog
                        if (!dateRanges[storage.id]) {
                          setDateRanges(prev => ({
                            ...prev,
                            [storage.id]: undefined
                          }));
                        }
                        setOpenDialogId(storage.id);
                      }}
                      className="w-full"
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      Select Dates
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium text-green-900">
                            Selected: {currentRange?.from && format(currentRange.from, "MMM d, yyyy")} - {currentRange?.to && format(currentRange.to, "MMM d, yyyy")}
                          </p>
                          {pricePreview && (
                            <p className="text-xs text-green-700 mt-1">
                              {pricePreview.days} day{pricePreview.days > 1 ? 's' : ''} × ${storage.basePrice.toFixed(2)}/day
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStorage(storage.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {pricePreview && (
                        <div className="mt-2 pt-2 border-t border-green-200">
                          <div className="flex justify-between text-sm">
                            <span className="text-green-700">Price ({pricePreview.days} day{pricePreview.days > 1 ? 's' : ''}):</span>
                            <span className="font-medium text-green-900">${pricePreview.basePrice.toFixed(2)}</span>
                          </div>
                          <div className="text-xs text-green-600 mt-1">
                            Service fee will be calculated on the combined booking total
                          </div>
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Ensure range state is initialized when reopening dialog
                        if (!dateRanges[storage.id]) {
                          const existing = selectedStorage.find(s => s.storageListingId === storage.id);
                          if (existing) {
                            setDateRanges(prev => ({
                              ...prev,
                              [storage.id]: {
                                from: existing.startDate,
                                to: existing.endDate,
                              }
                            }));
                          }
                        }
                        setOpenDialogId(storage.id);
                      }}
                      className="w-full"
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      Change Dates
                    </Button>
                  </div>
                )}

                {/* Date Range Picker Dialog */}
                <Dialog open={openDialogId === storage.id} onOpenChange={(open) => !open && setOpenDialogId(null)}>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Select Storage Dates: {storage.name}</DialogTitle>
                      <DialogDescription>
                        Choose your start and end dates. Minimum booking: {minDays} day{minDays > 1 ? 's' : ''}.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Date Range</Label>
                        <div className="mt-2 flex justify-center">
                          <Calendar
                            mode="range"
                            selected={currentRange}
                            onSelect={handleDateRangeSelect(storage.id)}
                            numberOfMonths={2}
                            defaultMonth={getSuggestedStartDate()}
                            disabled={(date) => isBefore(date, minDate)}
                            className="rounded-md border"
                          />
                        </div>
                        {currentRange?.from && !currentRange?.to && (
                          <p className="text-xs text-gray-500 mt-2 text-center">
                            Select an end date (minimum {minDays} day{minDays > 1 ? 's' : ''} from start)
                          </p>
                        )}
                        {error && (
                          <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
                            <AlertCircle className="h-4 w-4" />
                            <span>{error}</span>
                          </div>
                        )}
                        {currentRange?.from && currentRange?.to && !error && (
                          <div className="mt-2 flex items-center gap-2 text-sm text-green-600">
                            <Check className="h-4 w-4" />
                            <span>
                              {format(currentRange.from, "MMM d, yyyy")} - {format(currentRange.to, "MMM d, yyyy")}
                              {" "}({Math.ceil(differenceInDays(currentRange.to, currentRange.from))} days)
                            </span>
                          </div>
                        )}
                      </div>
                      {pricePreview && !error && (
                        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                          <h5 className="font-medium text-sm">Price Breakdown</h5>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">
                                {pricePreview.days} day{pricePreview.days > 1 ? 's' : ''} × ${storage.basePrice.toFixed(2)}/day
                              </span>
                              <span className="font-medium">${pricePreview.basePrice.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Service Fee ({serviceFeePercentage}%)</span>
                              <span className="font-medium">${pricePreview.serviceFee.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-gray-200 font-semibold">
                              <span>Total</span>
                              <span>${pricePreview.total.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setOpenDialogId(null);
                          if (!isSelected) {
                            setDateRanges(prev => {
                              const newRanges = { ...prev };
                              delete newRanges[storage.id];
                              return newRanges;
                            });
                          }
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          if (currentRange?.from && currentRange?.to && !error) {
                            setOpenDialogId(null);
                          }
                        }}
                        disabled={!currentRange?.from || !currentRange?.to || !!error}
                      >
                        {isSelected ? "Update Dates" : "Select Storage"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selectedStorage.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Package className="h-4 w-4" />
            <span>
              {selectedStorage.length} storage space{selectedStorage.length > 1 ? 's' : ''} selected
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

