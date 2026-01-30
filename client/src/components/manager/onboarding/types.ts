
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
  notificationEmail?: string;
  notificationPhone?: string;
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
