
import { ReactNode } from "react";

export interface OnboardingStep {
  id: number;
  title: string;
  description: string;
  icon: ReactNode;
}

export interface Location {
  id: number;
  name: string;
  address: string;
  /**
   * Booking policies, printed as values on the Availability step's review.
   *
   * All three are NOT NULL columns with defaults on `locations` (`shared/schema.ts`), but they are
   * declared optional here because the review guards each with `!= null` — a location object can
   * reach the step before those fields have been read.
   */
  cancellationPolicyHours?: number;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
  notificationEmail?: string;
  notificationPhone?: string;
  contactEmail?: string;
  contactPhone?: string;
  preferredContactMethod?: "email" | "phone" | "both";
  logoUrl?: string;
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseApprovedBy?: number;
  kitchenLicenseApprovedAt?: string;
  kitchenLicenseFeedback?: string;
  kitchenLicenseExpiry?: string;
  kitchenTermsUrl?: string;
  kitchenTermsUploadedAt?: string;
}

export interface Kitchen {
  id: number;
  locationId: number;
  name: string;
  description?: string;
  // Add other kitchen properties as needed
}

export interface StorageListing {
  id: number;
  name: string;
  storageType: 'dry' | 'cold' | 'freezer';
  description?: string;
  basePrice?: string | number;
  minimumBookingDuration?: number;
  isActive?: boolean;
}

export interface EquipmentListing {
  id: number;
  name: string;
  category?: 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty';
  equipmentType?: string; // Legacy/alternate name
  description?: string;
  condition?: 'excellent' | 'good' | 'fair' | 'needs_repair';
  availabilityType?: 'included' | 'rental';
  sessionRate?: string | number;
  isActive?: boolean;
}
