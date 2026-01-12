import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract initials from a user's display name or email
 * @param displayName - User's full display name (e.g., "John Doe")
 * @param email - User's email address (fallback if no displayName)
 * @param username - User's username (fallback if no displayName or email)
 * @returns String of 1-2 uppercase initials (e.g., "JD" or "J")
 */
export function getUserInitials(
  displayName?: string | null,
  email?: string | null,
  username?: string | null
): string {
  // Try displayName first
  if (displayName && displayName.trim()) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      // Two or more words: use first letter of first and last word
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    } else if (parts.length === 1) {
      // Single word: use first two letters
      const word = parts[0];
      return word.length >= 2 ? word.substring(0, 2).toUpperCase() : word[0].toUpperCase();
    }
  }

  // Fallback to email
  if (email && email.trim()) {
    const emailPart = email.split('@')[0];
    if (emailPart.length >= 2) {
      return emailPart.substring(0, 2).toUpperCase();
    }
    return emailPart[0].toUpperCase();
  }

  // Fallback to username
  if (username && username.trim() && !username.includes('@')) {
    if (username.length >= 2) {
      return username.substring(0, 2).toUpperCase();
    }
    return username[0].toUpperCase();
  }

  // Default fallback
  return "U";
}
