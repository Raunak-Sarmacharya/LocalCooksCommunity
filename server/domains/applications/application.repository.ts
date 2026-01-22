/**
 * Application Repository
 * 
 * Data access layer for applications table.
 * Handles all database operations, no business logic.
 */

import { db } from '../../db';
import { applications } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { CreateApplicationDTO, UpdateApplicationDTO, VerifyDocumentsDTO, ApplicationDTO, ApplicationWithUserDTO } from './application.types';
import { ApplicationErrorCodes, DomainError } from '../../shared/errors/domain-error';

/**
 * Repository for application data access
 */
export class ApplicationRepository {
  /**
   * Find application by ID
   */
  async findById(id: number): Promise<ApplicationDTO | null> {
    try {
      const [application] = await db
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .limit(1);

      return (application || null) as ApplicationDTO | null;
    } catch (error: any) {
      console.error(`[ApplicationRepository] Error finding application by ID ${id}:`, error);
      throw new DomainError(
        ApplicationErrorCodes.APPLICATION_NOT_FOUND,
        'Failed to find application',
        500
      );
    }
  }

  /**
   * Find application by user ID
   */
  async findByUserId(userId: number): Promise<ApplicationDTO | null> {
    try {
      const [application] = await db
        .select()
        .from(applications)
        .where(eq(applications.userId, userId))
        .orderBy(desc(applications.createdAt))
        .limit(1);

      return (application || null) as ApplicationDTO | null;
    } catch (error: any) {
      console.error(`[ApplicationRepository] Error finding application by user ID ${userId}:`, error);
      throw new DomainError(
        ApplicationErrorCodes.APPLICATION_NOT_FOUND,
        'Failed to find application',
        500
      );
    }
  }

  /**
   * Find applications by status
   */
  async findByStatus(status: 'inReview' | 'approved' | 'rejected' | 'cancelled'): Promise<ApplicationDTO[]> {
    try {
      const results = await db
        .select()
        .from(applications)
        .where(eq(applications.status, status))
        .orderBy(desc(applications.createdAt));

      return results as ApplicationDTO[];
    } catch (error: any) {
      console.error(`[ApplicationRepository] Error finding applications by status ${status}:`, error);
      throw new DomainError(
        ApplicationErrorCodes.APPLICATION_NOT_FOUND,
        'Failed to find applications',
        500
      );
    }
  }

  /**
   * Create new application
   */
  async create(dto: CreateApplicationDTO): Promise<ApplicationDTO> {
    try {
      const [application] = await db
        .insert(applications)
        .values({
          userId: dto.userId,
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          foodSafetyLicense: dto.foodSafetyLicense,
          foodEstablishmentCert: dto.foodEstablishmentCert,
          kitchenPreference: dto.kitchenPreference,
          foodSafetyLicenseUrl: dto.foodSafetyLicenseUrl || null,
          foodEstablishmentCertUrl: dto.foodEstablishmentCertUrl || null,
          feedback: dto.feedback || null,
        })
        .returning();

      return application as ApplicationDTO;
    } catch (error: any) {
      console.error('[ApplicationRepository] Error creating application:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to create application',
        500
      );
    }
  }

  /**
   * Update existing application
   */
  async update(id: number, dto: UpdateApplicationDTO): Promise<ApplicationDTO | null> {
    try {
      const [application] = await db
        .update(applications)
        .set({
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          foodSafetyLicense: dto.foodSafetyLicense,
          foodEstablishmentCert: dto.foodEstablishmentCert,
          kitchenPreference: dto.kitchenPreference,
          feedback: dto.feedback,
        })
        .where(eq(applications.id, id))
        .returning();

      return (application || null) as ApplicationDTO | null;
    } catch (error: any) {
      console.error(`[ApplicationRepository] Error updating application ${id}:`, error);
      throw new DomainError(
        ApplicationErrorCodes.APPLICATION_NOT_FOUND,
        'Failed to update application',
        500
      );
    }
  }

  /**
   * Update application status
   */
  async updateStatus(id: number, status: 'inReview' | 'approved' | 'rejected' | 'cancelled'): Promise<ApplicationDTO | null> {
    try {
      const [application] = await db
        .update(applications)
        .set({ status })
        .where(eq(applications.id, id))
        .returning();

      return (application || null) as ApplicationDTO | null;
    } catch (error: any) {
      console.error(`[ApplicationRepository] Error updating status for application ${id}:`, error);
      throw new DomainError(
        ApplicationErrorCodes.APPLICATION_NOT_FOUND,
        'Failed to update application status',
        500
      );
    }
  }

  /**
   * Update document verification status
   */
  async verifyDocuments(dto: VerifyDocumentsDTO): Promise<ApplicationDTO | null> {
    try {
      const [application] = await db
        .update(applications)
        .set({
          foodSafetyLicenseStatus: dto.foodSafetyLicenseStatus,
          foodEstablishmentCertStatus: dto.foodEstablishmentCertStatus,
          documentsAdminFeedback: dto.documentsAdminFeedback || null,
          documentsReviewedBy: dto.documentsReviewedBy,
          documentsReviewedAt: new Date(),
        })
        .where(eq(applications.id, dto.id))
        .returning();

      return (application || null) as ApplicationDTO | null;
    } catch (error: any) {
      console.error(`[ApplicationRepository] Error verifying documents for application ${dto.id}:`, error);
      throw new DomainError(
        ApplicationErrorCodes.APPLICATION_NOT_FOUND,
        'Failed to verify documents',
        500
      );
    }
  }

  /**
   * Find all applications
   */
  async findAll(): Promise<ApplicationDTO[]> {
    try {
      const results = await db
        .select()
        .from(applications)
        .orderBy(desc(applications.createdAt));

      return results as ApplicationDTO[];
    } catch (error: any) {
      console.error('[ApplicationRepository] Error finding all applications:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to find all applications',
        500
      );
    }
  }

  /**
   * Find all pending applications
   */
  async findAllPending(): Promise<ApplicationDTO[]> {
    try {
      const results = await db
        .select()
        .from(applications)
        .where(eq(applications.status, 'inReview'))
        .orderBy(desc(applications.createdAt));

      return results as ApplicationDTO[];
    } catch (error: any) {
      console.error('[ApplicationRepository] Error finding all pending applications:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to find pending applications',
        500
      );
    }
  }

  /**
   * Find all approved applications
   */
  async findAllApproved(): Promise<ApplicationDTO[]> {
    try {
      const results = await db
        .select()
        .from(applications)
        .where(eq(applications.status, 'approved'))
        .orderBy(desc(applications.createdAt));

      return results as ApplicationDTO[];
    } catch (error: any) {
      console.error('[ApplicationRepository] Error finding all approved applications:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to find approved applications',
        500
      );
    }
  }

  /**
   * Check if user has pending application
   */
  async hasPendingApplication(userId: number): Promise<boolean> {
    try {
      const result = await db
        .select({ id: applications.id })
        .from(applications)
        .where(
          and(
            eq(applications.userId, userId),
            eq(applications.status, 'inReview')
          )
        )
        .limit(1);

      return result.length > 0;
    } catch (error: any) {
      console.error(`[ApplicationRepository] Error checking pending application for user ${userId}:`, error);
      return false;
    }
  }
}
