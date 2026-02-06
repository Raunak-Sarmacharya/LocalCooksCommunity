import { useMemo } from "react";
import { differenceInDays, differenceInHours } from "date-fns";

interface StorageListing {
  id: number;
  name: string;
  basePrice: number; // Base price in cents (interpretation depends on pricingModel)
  pricingModel?: 'monthly-flat' | 'per-cubic-foot' | 'hourly' | 'daily';
  minimumBookingDuration: number; // Minimum duration required
  bookingDurationUnit?: 'hourly' | 'daily' | 'monthly';
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
  hours: number; // Always set (0 for non-hourly pricing models)
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
 * Note: Platform fees are handled via Stripe Connect (application_fee_amount) and are
 * invisible to the chef. Only base price + tax is charged at checkout.
 * The serviceFee field is kept at 0 for backward compatibility with consuming components.
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

    const items = selectedStorage
      .map((selection) => {
        const listing = storageListings.find((s) => s.id === selection.storageListingId);
        if (!listing) return null;

        // Get pricing model (default to 'daily' for backwards compatibility)
        const pricingModel = listing.pricingModel || 'daily';
        
        let basePrice = 0;
        let effectiveDays = 0;
        let effectiveHours = 0;
        
        if (pricingModel === 'monthly-flat') {
          // Flat rate - no multiplication by duration
          basePrice = listing.basePrice;
          effectiveDays = Math.ceil(
            differenceInDays(selection.endDate, selection.startDate)
          );
        } else if (pricingModel === 'hourly') {
          // Calculate by hours
          const hours = Math.ceil(
            differenceInHours(selection.endDate, selection.startDate)
          );
          const minHours = listing.minimumBookingDuration || 1;
          effectiveHours = Math.max(hours, minHours);
          basePrice = listing.basePrice * effectiveHours;
          effectiveDays = Math.ceil(effectiveHours / 24); // For display purposes
        } else {
          // Default: 'daily' or any other model - calculate by days
          const days = Math.ceil(
            differenceInDays(selection.endDate, selection.startDate)
          );
          const minDays = listing.minimumBookingDuration || 1;
          effectiveDays = Math.max(days, minDays);
          basePrice = listing.basePrice * effectiveDays;
        }
        
        const serviceFee = 0; // Platform fees handled via Stripe Connect (invisible to chef)
        const total = basePrice;

        return {
          listing,
          startDate: selection.startDate,
          endDate: selection.endDate,
          days: effectiveDays,
          hours: effectiveHours,
          basePrice,
          serviceFee,
          total,
        };
      })
      .filter((item): item is StoragePricingItem => item !== null);

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + item.basePrice, 0);

    return {
      items,
      subtotal,
      serviceFee: 0, // Platform fees handled via Stripe Connect (invisible to chef)
      total: subtotal,
    };
  }, [selectedStorage, storageListings]);
}

