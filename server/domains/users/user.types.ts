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
  password?: string;
  role?: 'admin' | 'chef' | 'manager';
  isChef?: boolean;
  isManager?: boolean;
  isPortalUser?: boolean;
  isVerified?: boolean;
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
  isVerified: boolean;
  has_seen_welcome: boolean;
  isChef: boolean;
  isManager: boolean;
  isPortalUser: boolean;
  applicationType: string | null;
  managerOnboardingCompleted: boolean;
  managerOnboardingSkipped: boolean;
  managerOnboardingStepsCompleted: Record<string, boolean>;
  managerProfileData: Record<string, any>;
  stripeConnectAccountId?: string;
  stripeConnectOnboardingStatus: string;
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

  // Display name from applications
  fullName?: string;
  displayName?: string;
}
