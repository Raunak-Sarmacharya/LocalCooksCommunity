/**
 * Location Service Tests
 * 
 * Unit tests for LocationService and LocationRepository.
 */

import { LocationService } from '../location.service';
import { LocationRepository } from '../location.repository';
import type { CreateLocationDTO, UpdateLocationDTO, VerifyKitchenLicenseDTO } from '../location.types';

describe('LocationService', () => {
  let locationService: LocationService;
  let locationRepo: LocationRepository;

  beforeEach(() => {
    locationRepo = new LocationRepository();
    locationService = new LocationService(locationRepo);
  });

  describe('createLocation', () => {
    it('should create a location with valid data', async () => {
      const dto: CreateLocationDTO = {
        managerId: 1,
        name: 'Downtown Kitchen',
        address: '123 Main Street, Downtown',
        notificationEmail: 'manager@example.com',
        notificationPhone: '1234567890',
        cancellationPolicyHours: 24,
        defaultDailyBookingLimit: 2,
        minimumBookingWindowHours: 1,
      };

      const location = await locationService.createLocation(dto);
      
      expect(location).toBeDefined();
      expect(location.name).toBe('Downtown Kitchen');
      expect(location.managerId).toBe(1);
    });

    it('should throw error if manager has too many locations', async () => {
      const dto: CreateLocationDTO = {
        managerId: 1,
        name: 'Test Kitchen',
        address: '123 Test St',
      };

      for (let i = 0; i < 10; i++) {
        await locationService.createLocation({
          ...dto,
          name: `Kitchen ${i}`,
        });
      }

      const anotherDto: CreateLocationDTO = {
        managerId: 1,
        name: 'Kitchen 11',
        address: '123 Test St',
      };

      await expect(locationService.createLocation(anotherDto)).rejects.toThrow();
    });
  });

  describe('updateLocation', () => {
    it('should update location with valid data', async () => {
      const updateDto: UpdateLocationDTO = {
        id: 1,
        name: 'Updated Kitchen Name',
        address: '456 Updated Ave',
      };

      const location = await locationService.updateLocation(updateDto);
      
      expect(location).toBeDefined();
      expect(location.name).toBe('Updated Kitchen Name');
    });

    it('should throw error if location does not exist', async () => {
      const updateDto: UpdateLocationDTO = {
        id: 999,
        name: 'Nonexistent',
      };

      await expect(locationService.updateLocation(updateDto)).rejects.toThrow();
    });

    it('should throw error if trying to change manager', async () => {
      const updateDto: UpdateLocationDTO = {
        id: 1,
        managerId: 999,
        name: 'Updated Name',
      };

      await expect(locationService.updateLocation(updateDto)).rejects.toThrow();
    });
  });

  describe('verifyKitchenLicense', () => {
    it('should verify kitchen license successfully', async () => {
      const dto: VerifyKitchenLicenseDTO = {
        locationId: 1,
        kitchenLicenseStatus: 'approved',
        kitchenLicenseApprovedBy: 2,
        kitchenLicenseExpiry: new Date('2025-12-31'),
      };

      const location = await locationService.verifyKitchenLicense(dto);
      
      expect(location).toBeDefined();
      expect(location.kitchenLicenseStatus).toBe('approved');
    });

    it('should throw error if expiry date missing when approving', async () => {
      const dto: VerifyKitchenLicenseDTO = {
        locationId: 1,
        kitchenLicenseStatus: 'approved',
        kitchenLicenseApprovedBy: 2,
      };

      await expect(locationService.verifyKitchenLicense(dto)).rejects.toThrow();
    });

    it('should throw error if approvedBy missing when approving', async () => {
      const dto: VerifyKitchenLicenseDTO = {
        locationId: 1,
        kitchenLicenseStatus: 'approved',
        kitchenLicenseExpiry: new Date('2025-12-31'),
      };

      await expect(locationService.verifyKitchenLicense(dto)).rejects.toThrow();
    });
  });

  describe('getLocationById', () => {
    it('should return location by ID', async () => {
      const location = await locationService.getLocationById(1);
      
      expect(location).toBeDefined();
      expect(location.id).toBe(1);
    });

    it('should throw error if location does not exist', async () => {
      await expect(locationService.getLocationById(999)).rejects.toThrow();
    });
  });

  describe('getLocationsByManagerId', () => {
    it('should return locations for manager', async () => {
      const locations = await locationService.getLocationsByManagerId(1);
      
      expect(Array.isArray(locations)).toBe(true);
    });
  });

  describe('getAllLocations', () => {
    it('should return all locations', async () => {
      const locations = await locationService.getAllLocations();
      
      expect(Array.isArray(locations)).toBe(true);
    });
  });

  describe('updateKitchenLicenseUrl', () => {
    it('should update kitchen license URL successfully', async () => {
      const location = await locationService.updateKitchenLicenseUrl(1, 'https://example.com/license.pdf');
      
      expect(location).toBeDefined();
      expect(location.kitchenLicenseUrl).toBe('https://example.com/license.pdf');
    });

    it('should throw error if location does not exist', async () => {
      await expect(locationService.updateKitchenLicenseUrl(999, 'https://example.com/license.pdf')).rejects.toThrow();
    });
  });
});
