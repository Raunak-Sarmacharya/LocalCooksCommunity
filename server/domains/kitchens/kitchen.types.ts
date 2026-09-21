/**
 * Kitchen Domain Types
 * 
 * Data Transfer Objects for clean separation between layers.
 */

export type PricingModel = 'hourly' | 'daily' | 'weekly' | 'monthly-flat' | 'per-cubic-foot';

/**
 * The manager's publish state for a kitchen.
 *
 * A deliberate subset of the `listing_status` enum the schema shares with storage and equipment
 * listings: `pending` / `approved` / `rejected` belong to that admin-review flow, and `inactive`
 * would duplicate `isActive`. A kitchen only needs "not published yet" and "published".
 */
export type ListingStatus = 'draft' | 'active';

export type StorageType = 'dry' | 'cold' | 'freezer';

export type StoragePricingModel = 'monthly-flat' | 'per-cubic-foot' | 'hourly' | 'daily';

export type EquipmentCategory = 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty';

export type EquipmentCondition = 'excellent' | 'good' | 'fair' | 'needs-repair';

export type EquipmentPricingModel = 'hourly' | 'daily' | 'weekly' | 'monthly';

export type EquipmentAvailabilityType = 'included' | 'rental';

/**
 * Kitchen DTO for creating a new kitchen
 */
export interface CreateKitchenDTO {
  locationId: number;
  name: string;
  description?: string;
  imageUrl?: string;
  galleryImages?: string[];
  amenities?: string[];
  isActive?: boolean;
  hourlyRate?: number;
  dailyRate?: number;
  currency?: string;
  minimumBookingHours?: number;
  pricingModel?: PricingModel;
  taxRatePercent?: number | null;
  smartLockAvailable?: boolean;
}

/**
 * Kitchen DTO for updating an existing kitchen
 */
export interface UpdateKitchenDTO {
  id: number;
  locationId?: number;
  name?: string;
  description?: string;
  imageUrl?: string;
  galleryImages?: string[];
  amenities?: string[];
  isActive?: boolean;
  hourlyRate?: number | null;
  dailyRate?: number | null;
  currency?: string;
  minimumBookingHours?: number;
  pricingModel?: PricingModel;
  taxRatePercent?: number | null;
  /** Admin-controlled capability gate. When false, managers cannot configure smart locks. */
  smartLockAvailable?: boolean;
  smartLockEnabled?: boolean;
  smartLockConfig?: Record<string, unknown> | null;
}

/**
 * Kitchen DTO for reading kitchen data
 */
export interface KitchenDTO {
  id: number;
  locationId: number;
  name: string;
  description?: string;
  imageUrl: string | null;
  galleryImages: string[];
  amenities: string[];
  isActive: boolean;
  /**
   * The manager's publish state, per kitchen. `draft` until they publish it.
   *
   * Separate from `isActive`, which is the admin's Hide/Show override — a kitchen reaches chefs only
   * when both allow it. See `findAllActive` for the filter and
   * `server/services/kitchen-listing-readiness-service.ts` for the gate.
   */
  listingStatus: ListingStatus;
  hourlyRate: number | null;
  dailyRate: number | null;
  currency: string;
  minimumBookingHours: number;
  pricingModel: PricingModel;
  taxRatePercent: number | null;
  /** Admin-controlled capability gate. When false, managers cannot configure smart locks. */
  smartLockAvailable: boolean;
  smartLockEnabled: boolean;
  smartLockConfig: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Kitchen DTO with location data included
 */
export interface KitchenWithLocationDTO extends KitchenDTO {
  location?: {
    id: number;
    name: string;
    address: string;
    managerId: number;
    notificationEmail: string | null;
    notificationPhone: string | null;
    cancellationPolicyHours: number;
    cancellationPolicyMessage: string;
    defaultDailyBookingLimit: number;
    minimumBookingWindowHours: number;
    logoUrl: string | null;
    brandImageUrl: string | null;
    timezone: string;
    kitchenLicenseStatus: string;
    kitchenLicenseUrl: string | null;
    kitchenLicenseApprovedBy: number | null;
    kitchenLicenseApprovedAt: Date | null;
    kitchenLicenseFeedback: string | null;
    kitchenLicenseExpiry: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * Kitchen Date Override DTOs
 */
export interface CreateKitchenOverrideDTO {
  kitchenId: number;
  specificDate: string | Date;
  startTime?: string | null;
  endTime?: string | null;
  isAvailable?: boolean;
  reason?: string | null;
}

export interface UpdateKitchenOverrideDTO {
  id: number;
  startTime?: string | null;
  endTime?: string | null;
  isAvailable?: boolean;
  reason?: string | null;
}

export interface KitchenOverrideDTO {
  id: number;
  kitchenId: number;
  specificDate: Date;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  reason: string | null;
}
