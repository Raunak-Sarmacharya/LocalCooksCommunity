/**
 * User Service
 * 
 * Business logic layer for user operations.
 * Handles validation, business rules, and orchestrates repository calls.
 */

import { UserRepository } from './user.repository';
import type { CreateUserDTO, UpdateUserDTO, UserDTO, CompleteUserProfileDTO } from './user.types';
import { DomainError, UserErrorCodes } from '../../shared/errors/domain-error';
import { validateUserInput } from '../../shared/validators/input-validator';
import { applications } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db';

/**
 * Service for user business logic
 */
export class UserService {
  constructor(private userRepo: UserRepository) { }

  /**
   * Get complete user profile (Firebase + Neon data combined)
   */
  async getCompleteProfile(userId: number): Promise<CompleteUserProfileDTO> {
    try {
      const user = await this.userRepo.findById(userId);

      if (!user) {
        throw new DomainError(
          UserErrorCodes.USER_NOT_FOUND,
          'User not found',
          404
        );
      }

      const [chefApp] = await db
        .select({ fullName: applications.fullName })
        .from(applications)
        .where(eq(applications.userId, userId))
        .orderBy(desc(applications.createdAt))
        .limit(1);

      const fullName = chefApp?.fullName || user.username;

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        isVerified: user.isVerified,
        has_seen_welcome: user.has_seen_welcome,
        isChef: user.isChef,
        isManager: user.isManager,
        isPortalUser: user.isPortalUser,

        firebaseUser: {
          uid: user.firebaseUid || '',
          email: user.username,
          emailVerified: user.isVerified,
        },

        fullName,
        displayName: fullName,
        stripeConnectAccountId: user.stripeConnectAccountId,
        stripeConnectOnboardingStatus: user.stripeConnectOnboardingStatus,

        managerOnboardingCompleted: user.managerOnboardingCompleted,
        managerOnboardingSkipped: user.managerOnboardingSkipped,
        managerOnboardingStepsCompleted: user.managerOnboardingStepsCompleted,
      };
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[UserService] Error getting complete profile:', error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to get user profile',
        500
      );
    }
  }

  /**
   * Create new user with validation
   */
  async createUser(dto: CreateUserDTO): Promise<UserDTO> {
    try {
      const validatedData = await validateUserInput(dto);

      const usernameExists = await this.userRepo.usernameExists(validatedData.username);
      if (usernameExists) {
        throw new DomainError(
          UserErrorCodes.USERNAME_TAKEN,
          'Username already exists',
          409
        );
      }

      if (validatedData.firebaseUid) {
        const firebaseUidExists = await this.userRepo.firebaseUidExists(validatedData.firebaseUid);
        if (firebaseUidExists) {
          throw new DomainError(
            UserErrorCodes.USERNAME_TAKEN,
            'Firebase UID already linked to another account',
            409
          );
        }
      }

      const user = await this.userRepo.create(validatedData);
      return user;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      console.error('[UserService] Error creating user:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to create user',
        500
      );
    }
  }

  /**
   * Update user with validation
   */
  async updateUser(dto: UpdateUserDTO): Promise<UserDTO> {
    try {
      const existingUser = await this.userRepo.findById(dto.id);

      if (!existingUser) {
        throw new DomainError(
          UserErrorCodes.USER_NOT_FOUND,
          'User not found',
          404
        );
      }

      if (dto.username) {
        const usernameExists = await this.userRepo.usernameExists(dto.username, dto.id);
        if (usernameExists) {
          throw new DomainError(
            UserErrorCodes.USERNAME_TAKEN,
            'Username already exists',
            409
          );
        }
      }

      const updated = await this.userRepo.update(dto.id, dto);

      if (!updated) {
        throw new DomainError(
          UserErrorCodes.USER_NOT_FOUND,
          'Failed to update user',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      console.error('[UserService] Error updating user:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to update user',
        500
      );
    }
  }

  /**
   * Update Firebase UID for existing user
   */
  async updateFirebaseUid(userId: number, firebaseUid: string): Promise<UserDTO> {
    try {
      const existingUser = await this.userRepo.findById(userId);

      if (!existingUser) {
        throw new DomainError(
          UserErrorCodes.USER_NOT_FOUND,
          'User not found',
          404
        );
      }

      if (existingUser.firebaseUid) {
        throw new DomainError(
          UserErrorCodes.VALIDATION_ERROR,
          'User already has Firebase UID',
          400
        );
      }

      const updated = await this.userRepo.updateFirebaseUid(userId, firebaseUid);

      if (!updated) {
        throw new DomainError(
          UserErrorCodes.USER_NOT_FOUND,
          'Failed to update Firebase UID',
          500
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[UserService] Error updating Firebase UID:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to update Firebase UID',
        500
      );
    }
  }

  /**
   * Mark user as having seen welcome
   */
  async markWelcomeSeen(userId: number): Promise<void> {
    try {
      await this.userRepo.setHasSeenWelcome(userId);
    } catch (error: any) {
      console.error('[UserService] Error marking welcome seen:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to update user',
        500
      );
    }
  }

  /**
   * Update user verification status
   */
  async verifyUser(userId: number, isVerified: boolean): Promise<void> {
    try {
      await this.userRepo.setVerified(userId, isVerified);
    } catch (error: any) {
      console.error('[UserService] Error updating user verification:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to update user verification',
        500
      );
    }
  }

  /**
   * Update manager onboarding status
   */
  async updateManagerOnboarding(
    userId: number,
    completed: boolean,
    skipped: boolean,
    steps?: Record<string, boolean>
  ): Promise<void> {
    try {
      const existingUser = await this.userRepo.findById(userId);

      if (!existingUser) {
        throw new DomainError(
          UserErrorCodes.USER_NOT_FOUND,
          'User not found',
          404
        );
      }

      await this.userRepo.updateManagerOnboarding(userId, completed, skipped, steps);
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[UserService] Error updating manager onboarding:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to update onboarding',
        500
      );
    }
  }

  /**
   * Get all managers
   */
  async getAllManagers(): Promise<UserDTO[]> {
    try {
      return await this.userRepo.findAllManagers();
    } catch (error: any) {
      console.error('[UserService] Error getting all managers:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to get managers',
        500
      );
    }
  }

  /**
   * Get all chefs
   */
  async getAllChefs(): Promise<UserDTO[]> {
    try {
      return await this.userRepo.findAllChefs();
    } catch (error: any) {
      console.error('[UserService] Error getting all chefs:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to get chefs',
        500
      );
    }
  }

  /**
   * Find user by Firebase UID
   */
  async findByFirebaseUid(firebaseUid: string): Promise<UserDTO | null> {
    try {
      return await this.userRepo.findByFirebaseUid(firebaseUid);
    } catch (error: any) {
      console.error('[UserService] Error finding user by Firebase UID:', error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to find user',
        500
      );
    }
  }

  /**
   * Reset password for user identified by Firebase UID
   */
  async resetPassword(firebaseUid: string, newPassword: string): Promise<void> {
    try {
      // Import bcrypt dynamically or assume it's available (better to dynamic import or require if not top-level)
      // Since this is a service, standard import at top is better, but to avoid changing top of file I'll use require here matching previous style
      // or better: refactor to proper import if I can.
      // But I can't easily see top of file to add import without reading again.
      // I'll use require for now to be safe with partial replacement.
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      await this.userRepo.updatePasswordByFirebaseUid(firebaseUid, hashedPassword);
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[UserService] Error resetting password:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to reset password',
        500
      );
    }
  }

  /**
   * Check if username exists
   */
  async checkUsernameExists(username: string): Promise<boolean> {
    try {
      return await this.userRepo.usernameExists(username);
    } catch (error: any) {
      console.error('[UserService] Error checking username existence:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to check username',
        500
      );
    }
  }
}
