import { useMemo } from "react";
import { differenceInDays } from "date-fns";

interface StorageListing {
  id: number;
  name: string;
  basePrice: number; // Daily rate in dollars
  minimumBookingDuration: number; // Minimum days required
  photos?: string[];
}

interface SelectedStorage {
  storageListingId: number;
  startDate: Date;
  endDate: Date;
}

interface StoragePricingItem {
  listing: StorageListing;
  startDate: Date;
  endDate: Date;
  days: number;
  basePrice: number;
  serviceFee: number;
  total: number;
}

interface StoragePricing {
  items: StoragePricingItem[];
  subtotal: number;
  serviceFee: number;
  total: number;
}

/**
 * Hook to calculate storage pricing based on selected storage with date ranges
 * 
 * @param selectedStorage - Array of selected storage items with date ranges
 * @param storageListings - All available storage listings
 * @returns Calculated pricing breakdown
 */
export function useStoragePricing(
  selectedStorage: SelectedStorage[],
  storageListings: StorageListing[]
): StoragePricing {
  return useMemo(() => {
    if (!selectedStorage || selectedStorage.length === 0) {
      return {
        items: [],
        subtotal: 0,
        serviceFee: 0,
        total: 0,
      };
    }

    const items: StoragePricingItem[] = selectedStorage
      .map((selection) => {
        const listing = storageListings.find((s) => s.id === selection.storageListingId);
        if (!listing) return null;

        // Calculate number of days
        const days = Math.ceil(
          differenceInDays(selection.endDate, selection.startDate)
        );
        
        // Enforce minimum booking duration
        const minDays = listing.minimumBookingDuration || 1;
        const effectiveDays = Math.max(days, minDays);
        
        // Calculate pricing
        const basePrice = listing.basePrice * effectiveDays;
        const serviceFee = basePrice * 0.05; // 5% service fee
        const total = basePrice + serviceFee;

        return {
          listing,
          startDate: selection.startDate,
          endDate: selection.endDate,
          days: effectiveDays,
          basePrice,
          serviceFee,
          total,
        };
      })
      .filter((item): item is StoragePricingItem => item !== null);

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.basePrice, 0);
    const totalServiceFee = items.reduce((sum, item) => sum + item.serviceFee, 0);
    const total = subtotal + totalServiceFee;

    return {
      items,
      subtotal,
      serviceFee: totalServiceFee,
      total,
    };
  }, [selectedStorage, storageListings]);
}

