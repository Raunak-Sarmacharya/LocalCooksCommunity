/**
 * User Domain Types
 * 
 * Data Transfer Objects for clean separation between layers.
 * These are the data structures that cross service boundaries.
 */

import { User } from "@shared/schema";
export { User };

/**
 * User DTO for creating a new user
 */
export interface CreateUserDTO {
  username: string;
  password?: string; // Optional — Firebase Auth users don't have passwords in Neon
  role?: 'admin' | 'chef' | 'manager';
  firebaseUid?: string;
  phoneNumber?: string;
  email?: string;
  displayName?: string;
  isVerified?: boolean;
  has_seen_welcome?: boolean;
  // Security: isChef, isManager, isPortalUser, managerProfileData removed from CreateUserDTO
  // These privileged fields must only be set through proper service methods (updateUser),
  // never during registration. This prevents mass assignment attacks.
}

/**
 * User DTO for updating an existing user
 */
export interface UpdateUserDTO {
  id?: number;
  username?: string;
  firebaseUid?: string;
  phoneNumber?: string | null;
  password?: string;
  // True only once the account holder chose the password themselves. Flipped by
  // POST /api/user/sync-password; never settable from a client-supplied body.
  passwordSetByUser?: boolean;
  role?: 'admin' | 'chef' | 'manager';
  isChef?: boolean;
  isManager?: boolean;
  isPortalUser?: boolean;
  isVerified?: boolean;
  // Email verification loop — see migrations/0034_add_email_verification_flow.sql
  pendingEmail?: string | null;
  pendingEmailTokenHash?: string | null;
  pendingEmailExpiresAt?: Date | null;
  pendingEmailSentAt?: Date | null;
  emailVerifiedAt?: Date | null;
  has_seen_welcome?: boolean;
  welcomeEmailSentAt?: Date; // Track when welcome email was sent (idempotency)
  managerOnboardingCompleted?: boolean;
  managerOnboardingSkipped?: boolean;
  managerOnboardingStepsCompleted?: Record<string, boolean>;
  stripeConnectAccountId?: string;
  stripeConnectOnboardingStatus?: string;
  // Chef onboarding fields (informative onboarding - no restrictions)
  chefOnboardingCompleted?: boolean;
  chefOnboardingPaths?: string[];
  // PHP shop linkage
  phpShopId?: number | null;
  phpShopStripeAccountId?: string | null;
  phpShopLinkedAt?: Date | null;
  termsAccepted?: boolean;
  termsAcceptedAt?: Date | null;
  termsVersion?: string | null;
  preferredLocale?: string | null;
}

/**
 * User DTO for reading user data
 */
export interface UserDTO {
  id: number;
  username: string;
  password?: string;
  role?: 'admin' | 'chef' | 'manager' | null;
  googleId: string | null;
  facebookId: string | null;
  firebaseUid: string | null;
  phoneNumber: string | null;
  isVerified: boolean;
  pendingEmail: string | null;
  pendingEmailSentAt: Date | null;
  pendingEmailExpiresAt: Date | null;
  emailVerifiedAt: Date | null;
  has_seen_welcome: boolean;
  isChef: boolean;
  isManager: boolean;
  isPortalUser: boolean;
  applicationType: string | null;
  managerOnboardingCompleted: boolean;
  managerOnboardingSkipped: boolean;
  managerOnboardingStepsCompleted: Record<string, boolean>;
  managerProfileData: Record<string, unknown>;
  stripeConnectAccountId?: string;
  stripeConnectOnboardingStatus: string;
  // PHP shop linkage
  phpShopId: number | null;
  phpShopStripeAccountId: string | null;
  phpShopLinkedAt: Date | null;
  // Terms acceptance
  termsAccepted: boolean;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  preferredLocale: string | null;
}

/**
 * Complete user profile DTO (combines Firebase user + Neon user data)
 */
export interface CompleteUserProfileDTO {
  id: number;
  username: string;
  role?: 'admin' | 'chef' | 'manager' | null;
  isVerified: boolean;
  has_seen_welcome: boolean;
  isChef: boolean;
  isManager: boolean;
  isPortalUser: boolean;

  // Firebase user data
  firebaseUser: {
    uid: string;
    email?: string;
    emailVerified?: boolean;
  };

  // Stripe Connect data
  stripeConnectAccountId?: string;
  stripeConnectOnboardingStatus?: string;

  // Manager onboarding data
  managerOnboardingCompleted?: boolean;
  managerOnboardingSkipped?: boolean;
  managerOnboardingStepsCompleted?: Record<string, boolean>;

  // Terms acceptance data
  termsAccepted?: boolean;
  termsAcceptedAt?: Date | null;
  termsVersion?: string | null;

  // Display name from applications
  fullName?: string;
  displayName?: string;
}
