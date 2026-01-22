/**
 * User Repository
 * 
 * Data access layer for users table.
 * Handles all database operations, no business logic.
 */

import { db } from '../../db';
import { users } from '@shared/schema';
import { eq, or, and, sql } from 'drizzle-orm';
import type { CreateUserDTO, UpdateUserDTO, UserDTO, CompleteUserProfileDTO } from './user.types';
import { UserErrorCodes, DomainError } from '../../shared/errors/domain-error';

/**
 * Repository for user data access
 */
export class UserRepository {
  /**
   * Find user by ID
   */
  async findById(id: number): Promise<UserDTO | null> {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      
      return (user || null) as UserDTO | null;
    } catch (error: any) {
      console.error(`[UserRepository] Error finding user by ID ${id}:`, error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to find user',
        500
      );
    }
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<UserDTO | null> {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      
      return (user || null) as UserDTO | null;
    } catch (error: any) {
      console.error(`[UserRepository] Error finding user by username ${username}:`, error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to find user',
        500
      );
    }
  }

  /**
   * Find user by Firebase UID
   */
  async findByFirebaseUid(firebaseUid: string): Promise<UserDTO | null> {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.firebaseUid, firebaseUid))
        .limit(1);
      
      return (user || null) as UserDTO | null;
    } catch (error: any) {
      console.error(`[UserRepository] Error finding user by Firebase UID ${firebaseUid}:`, error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to find user',
        500
      );
    }
  }

  /**
   * Find user by email (for portal users)
   */
  async findByEmail(email: string): Promise<UserDTO | null> {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, email))
        .limit(1);
      
      return (user || null) as UserDTO | null;
    } catch (error: any) {
      console.error(`[UserRepository] Error finding user by email ${email}:`, error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to find user',
        500
      );
    }
  }

  /**
   * Create new user
   */
  async create(dto: CreateUserDTO): Promise<UserDTO> {
    try {
      const [user] = await db
        .insert(users)
        .values({
          username: dto.username,
          password: dto.password,
          role: dto.role || 'chef',
          firebaseUid: dto.firebaseUid || null,
          isVerified: dto.isVerified !== undefined ? dto.isVerified : false,
          has_seen_welcome: dto.has_seen_welcome !== undefined ? dto.has_seen_welcome : false,
          isChef: false,
          isManager: false,
          isPortalUser: false,
        })
        .returning();
      
      return user as UserDTO;
    } catch (error: any) {
      console.error('[UserRepository] Error creating user:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to create user',
        500
      );
    }
  }

  /**
   * Update existing user
   */
  async update(id: number, dto: UpdateUserDTO): Promise<UserDTO | null> {
    try {
      const [user] = await db
        .update(users)
        .set({
          username: dto.username,
          role: dto.role,
          isVerified: dto.isVerified,
          has_seen_welcome: dto.has_seen_welcome,
          isChef: dto.isChef,
          isManager: dto.isManager,
          stripeConnectAccountId: dto.stripeConnectAccountId,
          stripeConnectOnboardingStatus: dto.stripeConnectOnboardingStatus,
          managerOnboardingCompleted: dto.managerOnboardingCompleted,
          managerOnboardingSkipped: dto.managerOnboardingSkipped,
          managerOnboardingStepsCompleted: dto.managerOnboardingStepsCompleted,
        })
        .where(eq(users.id, id))
        .returning();
      
      return (user || null) as UserDTO | null;
    } catch (error: any) {
      console.error(`[UserRepository] Error updating user ${id}:`, error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to update user',
        500
      );
    }
  }

  /**
   * Update Firebase UID for existing user
   */
  async updateFirebaseUid(id: number, firebaseUid: string): Promise<UserDTO | null> {
    try {
      const [user] = await db
        .update(users)
        .set({ firebaseUid })
        .where(eq(users.id, id))
        .returning();
      
      return (user || null) as UserDTO | null;
    } catch (error: any) {
      console.error(`[UserRepository] Error updating Firebase UID for user ${id}:`, error);
      throw new DomainError(
        UserErrorCodes.USER_NOT_FOUND,
        'Failed to update Firebase UID',
        500
      );
    }
  }

  /**
   * Update user welcome status
   */
  async setHasSeenWelcome(userId: number): Promise<void> {
    try {
      await db
        .update(users)
        .set({ has_seen_welcome: true })
        .where(eq(users.id, userId));
    } catch (error: any) {
      console.error(`[UserRepository] Error setting has_seen_welcome for user ${userId}:`, error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to update user',
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
      const updates: any = {
        managerOnboardingCompleted: completed,
        managerOnboardingSkipped: skipped,
      };

      if (steps) {
        updates.managerOnboardingStepsCompleted = steps;
      }

      await db
        .update(users)
        .set(updates)
        .where(eq(users.id, userId));
    } catch (error: any) {
      console.error(`[UserRepository] Error updating manager onboarding for user ${userId}:`, error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to update onboarding',
        500
      );
    }
  }

  /**
   * Find all managers
   */
  async findAllManagers(): Promise<UserDTO[]> {
    try {
      const managers = await db
        .select()
        .from(users)
        .where(eq(users.role, 'manager'));
      
      return managers as UserDTO[];
    } catch (error: any) {
      console.error('[UserRepository] Error finding all managers:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to find managers',
        500
      );
    }
  }

  /**
   * Find all chefs
   */
  async findAllChefs(): Promise<UserDTO[]> {
    try {
      const chefs = await db
        .select()
        .from(users)
        .where(eq(users.isChef, true));
      
      return chefs as UserDTO[];
    } catch (error: any) {
      console.error('[UserRepository] Error finding all chefs:', error);
      throw new DomainError(
        UserErrorCodes.VALIDATION_ERROR,
        'Failed to find chefs',
        500
      );
    }
  }

  /**
   * Check if username exists
   */
  async usernameExists(username: string, excludeId?: number): Promise<boolean> {
    try {
      const result = await db
        .select({ id: users.id })
        .from(users)
        .where(excludeId 
          ? and(eq(users.username, username), sql`${users.id} != ${excludeId}`)
          : eq(users.username, username)
        )
        .limit(1);
      
      return result.length > 0;
    } catch (error: any) {
      console.error(`[UserRepository] Error checking username existence ${username}:`, error);
      return false;
    }
  }

  /**
   * Check if Firebase UID exists
   */
  async firebaseUidExists(firebaseUid: string, excludeId?: number): Promise<boolean> {
    try {
      const result = await db
        .select({ id: users.id })
        .from(users)
        .where(excludeId 
          ? and(eq(users.firebaseUid, firebaseUid), sql`${users.id} != ${excludeId}`)
          : eq(users.firebaseUid, firebaseUid)
        )
        .limit(1);
      
      return result.length > 0;
    } catch (error: any) {
      console.error(`[UserRepository] Error checking Firebase UID existence ${firebaseUid}:`, error);
      return false;
    }
  }
}
