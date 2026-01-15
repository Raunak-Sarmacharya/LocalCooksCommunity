import { z } from 'zod';

/**
 * Phone number validation and formatting utilities
 * Supports North American numbers (US and Canada) - both use country code +1
 */

/**
 * Normalizes a phone number to E.164 format (+1NXXNXXXXXX)
 * Accepts various input formats and converts to standard format
 */
export const normalizePhoneNumber = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  
  // Trim whitespace
  const trimmed = phone.trim();
  if (!trimmed) return null;
  
  // Remove all non-digit characters except +
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  
  // If it already starts with +, validate and return
  if (cleaned.startsWith('+')) {
    // E.164 format: + followed by 1-15 digits
    const digitsAfterPlus = cleaned.substring(1);
    if (digitsAfterPlus.length >= 1 && digitsAfterPlus.length <= 15 && /^\d+$/.test(digitsAfterPlus)) {
      // If it's a North American number (+1...), ensure it's exactly 12 characters
      if (digitsAfterPlus.startsWith('1') && digitsAfterPlus.length === 11) {
        return cleaned; // Already in correct format: +1NXXNXXXXXX
      }
      // If it's a North American number without +1, add it
      if (digitsAfterPlus.length === 10) {
        return `+1${digitsAfterPlus}`;
      }
      // For international numbers, return as is (but we'll validate North American only)
      // For now, only accept North American numbers
      return null;
    }
    return null;
  }
  
  // Remove all non-digit characters
  const digitsOnly = cleaned.replace(/\D/g, '');
  
  // If it starts with 1 and has 11 digits, it's already in North American format
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }
  
  // If it has 10 digits, assume North American number (US/Canada) and add +1
  if (digitsOnly.length === 10) {
    // More lenient validation - just check that we have 10 digits
    // Area code and exchange code validation will happen in isValidNorthAmericanPhone
    return `+1${digitsOnly}`;
  }
  
  return null;
};

/**
 * Validates if a phone number is in valid North American format
 * Can accept either a raw phone string or an already-normalized string
 */
export const isValidNorthAmericanPhone = (phone: string | null | undefined): boolean => {
  if (!phone) return false;
  
  // If already normalized (starts with +1), validate directly
  let normalized: string | null;
  if (phone.startsWith('+1') && phone.length === 12) {
    normalized = phone;
  } else {
    normalized = normalizePhoneNumber(phone);
  }
  
  if (!normalized) return false;
  
  // Must start with +1 and have exactly 12 characters total (+1 + 10 digits)
  if (!normalized.startsWith('+1') || normalized.length !== 12) {
    return false;
  }
  
  // Extract the 10-digit number after +1
  const digits = normalized.substring(2);
  
  // Must have exactly 10 digits
  if (digits.length !== 10 || !/^\d{10}$/.test(digits)) {
    return false;
  }
  
  // Validate area code (first 3 digits) - first digit must be 2-9
  const areaCodeFirstDigit = parseInt(digits[0]);
  if (areaCodeFirstDigit < 2 || areaCodeFirstDigit > 9) return false;
  
  // Validate exchange code (4th digit, which is digits[3]) - must be 2-9
  const exchangeCodeFirstDigit = parseInt(digits[3]);
  if (exchangeCodeFirstDigit < 2 || exchangeCodeFirstDigit > 9) return false;
  
  return true;
};

/**
 * Formats a phone number for display (e.g., +14161234567 -> (416) 123-4567)
 */
export const formatPhoneForDisplay = (phone: string | null | undefined): string => {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return phone || '';
  
  // For North American numbers, format nicely
  if (normalized.startsWith('+1') && normalized.length === 12) {
    const digits = normalized.substring(2);
    return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
  }
  
  // For other international numbers, return as is
  return normalized;
};

/**
 * Zod schema for phone number validation
 * Validates North American phone numbers (US and Canada)
 */
export const phoneNumberSchema = z.string()
  .min(1, "Phone number is required")
  .refine(
    (val) => {
      // Allow various input formats
      const normalized = normalizePhoneNumber(val);
      return normalized !== null && isValidNorthAmericanPhone(normalized);
    },
    {
      message: "Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
    }
  )
  .transform((val) => {
    // Always normalize to E.164 format before storing
    const normalized = normalizePhoneNumber(val);
    return normalized || val; // Fallback to original if normalization fails
  });

/**
 * Optional phone number schema (for fields where phone is not required)
 */
export const optionalPhoneNumberSchema = z.string()
  .optional()
  .refine(
    (val) => {
      if (!val || val.trim() === '') return true; // Empty is valid for optional
      const normalized = normalizePhoneNumber(val);
      return normalized !== null && isValidNorthAmericanPhone(normalized);
    },
    {
      message: "Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
    }
  )
  .transform((val) => {
    if (!val || val.trim() === '') return null;
    const normalized = normalizePhoneNumber(val);
    return normalized || val;
  });

/**
 * Validates and normalizes a phone number, returning the normalized version or null
 */
export const validateAndNormalizePhone = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  return normalizePhoneNumber(phone);
};

