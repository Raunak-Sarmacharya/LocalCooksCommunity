/**
 * Location Domain Types
 * 
 * Data Transfer Objects for clean separation between layers.
 */

/**
 * Location DTO for creating a new location
 */
export interface CreateLocationDTO {
  name: string;
  address: string;
  managerId: number;
  notificationEmail?: string;
  notificationPhone?: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
  logoUrl?: string;
  brandImageUrl?: string;
  timezone?: string;
}

/**
 * Location DTO for updating an existing location
 */
export interface UpdateLocationDTO {
  id: number;
  name?: string;
  address?: string;
  managerId?: number;
  notificationEmail?: string;
  notificationPhone?: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
  logoUrl?: string;
  brandImageUrl?: string;
  timezone?: string;
}

/**
 * Kitchen license verification DTO
 */
export interface VerifyKitchenLicenseDTO {
  locationId: number;
  kitchenLicenseStatus: 'pending' | 'approved' | 'rejected';
  kitchenLicenseFeedback?: string;
  kitchenLicenseApprovedBy: number;
  kitchenLicenseExpiry?: string;
}

/**
 * Location DTO for reading location data
 */
export interface LocationDTO {
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
}

/**
 * Location DTO with manager data included
 */
export interface LocationWithManagerDTO extends LocationDTO {
  manager?: {
    id: number;
    username: string;
    email?: string;
    role?: 'admin' | 'chef' | 'manager' | null;
    isVerified: boolean;
    isChef: boolean;
    isManager: boolean;
    stripeConnectAccountId?: string;
  };
}
