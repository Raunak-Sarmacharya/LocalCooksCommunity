/**
 * Application Service Tests
 * 
 * Unit tests for ApplicationService and ApplicationRepository.
 */

import { ApplicationService } from '../application.service';
import { ApplicationRepository } from '../application.repository';
import type { CreateApplicationDTO, UpdateApplicationDTO, VerifyDocumentsDTO } from '../application.types';

describe('ApplicationService', () => {
  let applicationService: ApplicationService;
  let applicationRepo: ApplicationRepository;

  beforeEach(() => {
    applicationRepo = new ApplicationRepository();
    applicationService = new ApplicationService(applicationRepo);
  });

  describe('submitApplication', () => {
    it('should create an application with valid data', async () => {
      const dto: CreateApplicationDTO = {
        userId: 1,
        fullName: 'John Doe',
        email: 'john@example.com',
        phone: '1234567890',
        foodSafetyLicense: 'yes',
        foodEstablishmentCert: 'yes',
        kitchenPreference: 'commercial',
        foodSafetyLicenseUrl: 'https://example.com/license.pdf',
        foodEstablishmentCertUrl: 'https://example.com/cert.pdf',
      };

      const application = await applicationService.submitApplication(dto);
      
      expect(application).toBeDefined();
      expect(application.fullName).toBe('John Doe');
      expect(application.status).toBe('inReview');
    });

    it('should throw error if email is invalid', async () => {
      const dto: CreateApplicationDTO = {
        userId: 1,
        fullName: 'John Doe',
        email: 'invalid-email',
        phone: '1234567890',
        foodSafetyLicense: 'yes',
        foodEstablishmentCert: 'yes',
        kitchenPreference: 'commercial',
      };

      await expect(applicationService.submitApplication(dto)).rejects.toThrow();
    });

    it('should throw error if user already has pending application', async () => {
      const existingDto: CreateApplicationDTO = {
        userId: 1,
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '0987654321',
        foodSafetyLicense: 'no',
        foodEstablishmentCert: 'notSure',
        kitchenPreference: 'home',
      };

      await applicationService.submitApplication(existingDto);

      const duplicateDto: CreateApplicationDTO = {
        userId: 1,
        fullName: 'Jane Doe Updated',
        email: 'jane-updated@example.com',
        phone: '0987654321',
        foodSafetyLicense: 'yes',
        foodEstablishmentCert: 'yes',
        kitchenPreference: 'commercial',
      };

      await expect(applicationService.submitApplication(duplicateDto)).rejects.toThrow();
    });
  });

  describe('updateApplication', () => {
    it('should update application with valid data', async () => {
      const updateDto: UpdateApplicationDTO = {
        id: 1,
        fullName: 'John Smith',
        email: 'john.smith@example.com',
        phone: '1234567890',
        foodSafetyLicense: 'yes',
        foodEstablishmentCert: 'yes',
        kitchenPreference: 'home',
      };

      const application = await applicationService.updateApplication(updateDto);
      
      expect(application).toBeDefined();
      expect(application.fullName).toBe('John Smith');
    });

    it('should throw error if application does not exist', async () => {
      const updateDto: UpdateApplicationDTO = {
        id: 999,
        fullName: 'Nonexistent',
        email: 'nonexistent@example.com',
        phone: '1234567890',
      };

      await expect(applicationService.updateApplication(updateDto)).rejects.toThrow();
    });

    it('should throw error if application is already processed', async () => {
      const updateDto: UpdateApplicationDTO = {
        id: 1,
        fullName: 'John Doe',
      };

      await expect(applicationService.updateApplication(updateDto)).rejects.toThrow();
    });
  });

  describe('approveApplication', () => {
    it('should approve an application', async () => {
      const application = await applicationService.approveApplication(1, 2);
      
      expect(application).toBeDefined();
      expect(application.status).toBe('approved');
    });

    it('should throw error if application does not exist', async () => {
      await expect(applicationService.approveApplication(999, 2)).rejects.toThrow();
    });
  });

  describe('rejectApplication', () => {
    it('should reject an application with feedback', async () => {
      const application = await applicationService.rejectApplication(1, 'Missing information');
      
      expect(application).toBeDefined();
      expect(application.status).toBe('rejected');
      expect(application.feedback).toBe('Missing information');
    });

    it('should throw error if application does not exist', async () => {
      await expect(applicationService.rejectApplication(999)).rejects.toThrow();
    });
  });

  describe('verifyDocuments', () => {
    it('should verify documents successfully', async () => {
      const dto: VerifyDocumentsDTO = {
        id: 1,
        foodSafetyLicenseStatus: 'approved',
        foodEstablishmentCertStatus: 'approved',
        documentsReviewedBy: 2,
      };

      const application = await applicationService.verifyDocuments(dto);
      
      expect(application).toBeDefined();
      expect(application.foodSafetyLicenseStatus).toBe('approved');
      expect(application.foodEstablishmentCertStatus).toBe('approved');
    });

    it('should throw error if application does not exist', async () => {
      const dto: VerifyDocumentsDTO = {
        id: 999,
        foodSafetyLicenseStatus: 'approved',
        foodEstablishmentCertStatus: 'approved',
        documentsReviewedBy: 2,
      };

      await expect(applicationService.verifyDocuments(dto)).rejects.toThrow();
    });
  });

  describe('getApplicationById', () => {
    it('should return application by ID', async () => {
      const application = await applicationService.getApplicationById(1);
      
      expect(application).toBeDefined();
      expect(application.id).toBe(1);
    });

    it('should throw error if application does not exist', async () => {
      await expect(applicationService.getApplicationById(999)).rejects.toThrow();
    });
  });

  describe('getApplicationsByUserId', () => {
    it('should return applications for user', async () => {
      const applications = await applicationService.getApplicationsByUserId(1);
      
      expect(Array.isArray(applications)).toBe(true);
    });
  });

  describe('getApplicationsByStatus', () => {
    it('should return applications by status', async () => {
      const applications = await applicationService.getApplicationsByStatus('inReview');
      
      expect(Array.isArray(applications)).toBe(true);
    });
  });

  describe('getAllPending', () => {
    it('should return all pending applications', async () => {
      const applications = await applicationService.getAllPending();
      
      expect(Array.isArray(applications)).toBe(true);
    });
  });

  describe('getAllApproved', () => {
    it('should return all approved applications', async () => {
      const applications = await applicationService.getAllApproved();
      
      expect(Array.isArray(applications)).toBe(true);
    });
  });
});
