/**
 * Domain Error Types
 * 
 * Centralized error handling for domain layer.
 * Follows industry-standard error handling patterns.
 */

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const UserErrorCodes = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  USERNAME_TOO_SHORT: 'USERNAME_TOO_SHORT',
  USERNAME_TOO_LONG: 'USERNAME_TOO_LONG',
  EMAIL_INVALID: 'EMAIL_INVALID',
  PASSWORD_INVALID: 'PASSWORD_INVALID',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export const BookingErrorCodes = {
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  KITCHEN_NOT_AVAILABLE: 'KITCHEN_NOT_AVAILABLE',
  INVALID_STATUS: 'INVALID_STATUS',
  CONFLICT: 'CONFLICT',
} as const;

export const ApplicationErrorCodes = {
  APPLICATION_NOT_FOUND: 'APPLICATION_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  ALREADY_APPROVED: 'ALREADY_APPROVED',
  ALREADY_REJECTED: 'ALREADY_REJECTED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export const LocationErrorCodes = {
  LOCATION_NOT_FOUND: 'LOCATION_NOT_FOUND',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  NO_MANAGER_ASSIGNED: 'NO_MANAGER_ASSIGNED',
} as const;

export const KitchenErrorCodes = {
  KITCHEN_NOT_FOUND: 'KITCHEN_NOT_FOUND',
  LOCATION_NOT_FOUND: 'LOCATION_NOT_FOUND',
  INVALID_PRICING: 'INVALID_PRICING',
} as const;
