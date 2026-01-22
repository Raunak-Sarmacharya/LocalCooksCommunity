/**
 * Application Service
 * 
 * Business logic layer for application operations.
 * Handles validation, business rules, and orchestrates repository calls.
 */

import { ApplicationRepository } from './application.repository';
import type { CreateApplicationDTO, UpdateApplicationDTO, VerifyDocumentsDTO, ApplicationDTO, ApplicationWithUserDTO } from './application.types';
import { DomainError, ApplicationErrorCodes } from '../../shared/errors/domain-error';
import { validateApplicationInput } from '../../shared/validators/input-validator';

/**
 * Service for application business logic
 */
export class ApplicationService {
  constructor(private appRepo: ApplicationRepository) { }

  /**
   * Submit new application with validation
   */
  async submitApplication(dto: CreateApplicationDTO): Promise<ApplicationDTO> {
    try {
      const validatedData = await validateApplicationInput(dto);

      const hasPending = await this.appRepo.hasPendingApplication(validatedData.userId);
      if (hasPending) {
        throw new DomainError(
          ApplicationErrorCodes.VALIDATION_ERROR,
          'User already has a pending application',
          409
        );
      }

      const application = await this.appRepo.create(validatedData);
      return application;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      console.error('[ApplicationService] Error submitting application:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to submit application',
        500
      );
    }
  }

  /**
   * Update application with validation
   */
  async updateApplication(dto: UpdateApplicationDTO): Promise<ApplicationDTO> {
    try {
      const existingApplication = await this.appRepo.findById(dto.id);

      if (!existingApplication) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Application not found',
          404
        );
      }

      if (existingApplication.status !== 'inReview') {
        throw new DomainError(
          ApplicationErrorCodes.VALIDATION_ERROR,
          'Cannot update application that is already processed',
          400
        );
      }

      const updated = await this.appRepo.update(dto.id, dto);

      if (!updated) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Failed to update application',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      console.error('[ApplicationService] Error updating application:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to update application',
        500
      );
    }
  }

  /**
   * Approve application
   */
  async approveApplication(id: number, reviewedBy: number): Promise<ApplicationDTO> {
    try {
      const existingApplication = await this.appRepo.findById(id);

      if (!existingApplication) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Application not found',
          404
        );
      }

      if (existingApplication.status !== 'inReview') {
        throw new DomainError(
          ApplicationErrorCodes.VALIDATION_ERROR,
          'Cannot approve application that is already processed',
          400
        );
      }

      const updated = await this.appRepo.updateStatus(id, 'approved');

      if (!updated) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Failed to approve application',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[ApplicationService] Error approving application:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to approve application',
        500
      );
    }
  }

  /**
   * Reject application
   */
  async rejectApplication(id: number, feedback?: string): Promise<ApplicationDTO> {
    try {
      const existingApplication = await this.appRepo.findById(id);

      if (!existingApplication) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Application not found',
          404
        );
      }

      if (existingApplication.status !== 'inReview') {
        throw new DomainError(
          ApplicationErrorCodes.VALIDATION_ERROR,
          'Cannot reject application that is already processed',
          400
        );
      }

      const updated = await this.appRepo.update(id, { id, feedback: feedback || '' });

      if (!updated) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Failed to reject application',
          404
        );
      }

      await this.appRepo.updateStatus(id, 'rejected');


      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[ApplicationService] Error rejecting application:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to reject application',
        500
      );
    }
  }

  /**
   * Update application status (Admin)
   */
  async updateStatus(id: number, status: 'inReview' | 'approved' | 'rejected' | 'cancelled'): Promise<ApplicationDTO> {
    try {
      const existingApplication = await this.appRepo.findById(id);

      if (!existingApplication) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Application not found',
          404
        );
      }

      const updated = await this.appRepo.updateStatus(id, status);

      if (!updated) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Failed to update application status',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[ApplicationService] Error updating application status:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to update application status',
        500
      );
    }
  }

  /**
   * Verify application documents
   */
  async verifyDocuments(dto: VerifyDocumentsDTO): Promise<ApplicationDTO> {
    try {
      const existingApplication = await this.appRepo.findById(dto.id);

      if (!existingApplication) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Application not found',
          404
        );
      }

      if (existingApplication.status !== 'inReview') {
        throw new DomainError(
          ApplicationErrorCodes.VALIDATION_ERROR,
          'Cannot verify documents for application that is already processed',
          400
        );
      }

      const updated = await this.appRepo.verifyDocuments(dto);

      if (!updated) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Failed to verify documents',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[ApplicationService] Error verifying documents:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to verify documents',
        500
      );
    }
  }

  /**
   * Get application by ID
   */
  async getApplicationById(id: number): Promise<ApplicationDTO> {
    try {
      const application = await this.appRepo.findById(id);

      if (!application) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Application not found',
          404
        );
      }

      return application;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[ApplicationService] Error getting application by ID:', error);
      throw new DomainError(
        ApplicationErrorCodes.APPLICATION_NOT_FOUND,
        'Failed to get application',
        500
      );
    }
  }

  /**
   * Get all applications (Admin)
   */
  async getAllApplications(): Promise<ApplicationDTO[]> {
    try {
      return await this.appRepo.findAll();
    } catch (error: any) {
      console.error('[ApplicationService] Error getting all applications:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to get all applications',
        500
      );
    }
  }

  /**
   * Cancel application (User)
   */
  async cancelApplication(id: number, userId: number): Promise<ApplicationDTO> {
    try {
      const existingApplication = await this.appRepo.findById(id);

      if (!existingApplication) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Application not found',
          404
        );
      }

      if (existingApplication.userId !== userId) {
        throw new DomainError(
          ApplicationErrorCodes.VALIDATION_ERROR,
          'Access denied. You can only cancel your own applications.',
          403
        );
      }

      const updated = await this.appRepo.updateStatus(id, 'cancelled');

      if (!updated) {
        throw new DomainError(
          ApplicationErrorCodes.APPLICATION_NOT_FOUND,
          'Failed to cancel application',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) throw error;
      console.error('[ApplicationService] Error cancelling application:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to cancel application',
        500
      );
    }
  }

  /**
   * Get applications by user ID
   */
  async getApplicationsByUserId(userId: number): Promise<ApplicationDTO[]> {
    try {
      const application = await this.appRepo.findByUserId(userId);
      return application ? [application] : [];
    } catch (error: any) {
      console.error('[ApplicationService] Error getting applications by user ID:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to get applications',
        500
      );
    }
  }

  /**
   * Get applications by status
   */
  async getApplicationsByStatus(status: 'inReview' | 'approved' | 'rejected' | 'cancelled'): Promise<ApplicationDTO[]> {
    try {
      return await this.appRepo.findByStatus(status);
    } catch (error: any) {
      console.error('[ApplicationService] Error getting applications by status:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to get applications',
        500
      );
    }
  }

  /**
   * Get all pending applications
   */
  async getAllPending(): Promise<ApplicationDTO[]> {
    try {
      return await this.appRepo.findAllPending();
    } catch (error: any) {
      console.error('[ApplicationService] Error getting all pending applications:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to get pending applications',
        500
      );
    }
  }

  /**
   * Get all approved applications
   */
  async getAllApproved(): Promise<ApplicationDTO[]> {
    try {
      return await this.appRepo.findAllApproved();
    } catch (error: any) {
      console.error('[ApplicationService] Error getting all approved applications:', error);
      throw new DomainError(
        ApplicationErrorCodes.VALIDATION_ERROR,
        'Failed to get approved applications',
        500
      );
    }
  }
}
