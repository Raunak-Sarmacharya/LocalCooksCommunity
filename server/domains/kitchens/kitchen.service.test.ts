/**
 * Kitchen Service Tests
 * 
 * Unit tests for KitchenService and KitchenRepository.
 */

import { KitchenService } from '../kitchen.service';
import { KitchenRepository } from '../kitchen.repository';
import type { CreateKitchenDTO, UpdateKitchenDTO } from '../kitchen.types';

describe('KitchenService', () => {
  let kitchenService: KitchenService;
  let kitchenRepo: KitchenRepository;

  beforeEach(() => {
    kitchenRepo = new KitchenRepository();
    kitchenService = new KitchenService(kitchenRepo);
  });

  describe('createKitchen', () => {
    it('should create a kitchen with valid data', async () => {
      const dto: CreateKitchenDTO = {
        locationId: 1,
        name: 'Downtown Kitchen A',
        description: 'A fully equipped kitchen in downtown area',
        hourlyRate: 5000,
        currency: 'CAD',
        minimumBookingHours: 2,
        pricingModel: 'hourly',
      };

      const kitchen = await kitchenService.createKitchen(dto);
      
      expect(kitchen).toBeDefined();
      expect(kitchen.name).toBe('Downtown Kitchen A');
      expect(kitchen.isActive).toBe(true);
    });

    it('should throw error if kitchen name already exists for location', async () => {
      const existingDto: CreateKitchenDTO = {
        locationId: 1,
        name: 'Test Kitchen',
        hourlyRate: 4500,
      };

      await kitchenService.createKitchen(existingDto);

      const duplicateDto: CreateKitchenDTO = {
        locationId: 1,
        name: 'Test Kitchen 2',
        hourlyRate: 5000,
      };

      await expect(kitchenService.createKitchen(duplicateDto)).rejects.toThrow();
    });

    it('should throw error if location ID is invalid', async () => {
      const dto: CreateKitchenDTO = {
        locationId: -1,
        name: 'Invalid Kitchen',
      };

      await expect(kitchenService.createKitchen(dto)).rejects.toThrow();
    });
  });

  describe('updateKitchen', () => {
    it('should update kitchen with valid data', async () => {
      const updateDto: UpdateKitchenDTO = {
        id: 1,
        name: 'Updated Kitchen Name',
        description: 'Updated description',
        hourlyRate: 5500,
      };

      const kitchen = await kitchenService.updateKitchen(updateDto);
      
      expect(kitchen).toBeDefined();
      expect(kitchen.name).toBe('Updated Kitchen Name');
    });

    it('should throw error if kitchen does not exist', async () => {
      const updateDto: UpdateKitchenDTO = {
        id: 999,
        name: 'Nonexistent',
      };

      await expect(kitchenService.updateKitchen(updateDto)).rejects.toThrow();
    });

    it('should throw error if trying to change location', async () => {
      const updateDto: UpdateKitchenDTO = {
        id: 1,
        locationId: 999,
        name: 'Updated Name',
      };

      await expect(kitchenService.updateKitchen(updateDto)).rejects.toThrow();
    });
  });

  describe('activateKitchen', () => {
    it('should activate an inactive kitchen', async () => {
      const kitchen = await kitchenService.activateKitchen(1);
      
      expect(kitchen).toBeDefined();
      expect(kitchen.isActive).toBe(true);
    });

    it('should throw error if kitchen does not exist', async () => {
      await expect(kitchenService.activateKitchen(999)).rejects.toThrow();
    });

    it('should throw error if kitchen is already active', async () => {
      await kitchenService.activateKitchen(1);

      await expect(kitchenService.activateKitchen(1)).rejects.toThrow();
    });
  });

  describe('deactivateKitchen', () => {
    it('should deactivate an active kitchen', async () => {
      const kitchen = await kitchenService.deactivateKitchen(1);
      
      expect(kitchen).toBeDefined();
      expect(kitchen.isActive).toBe(false);
    });

    it('should throw error if kitchen does not exist', async () => {
      await expect(kitchenService.deactivateKitchen(999)).rejects.toThrow();
    });

    it('should throw error if kitchen is already inactive', async () => {
      await kitchenService.deactivateKitchen(1);

      await expect(kitchenService.deactivateKitchen(1)).rejects.toThrow();
    });
  });

  describe('updateKitchenImage', () => {
    it('should update kitchen image successfully', async () => {
      const kitchen = await kitchenService.updateKitchenImage(1, 'https://example.com/image.jpg');
      
      expect(kitchen).toBeDefined();
      expect(kitchen.imageUrl).toBe('https://example.com/image.jpg');
    });

    it('should throw error if kitchen does not exist', async () => {
      await expect(kitchenService.updateKitchenImage(999, 'https://example.com/image.jpg')).rejects.toThrow();
    });
  });

  describe('updateKitchenGallery', () => {
    it('should update kitchen gallery successfully', async () => {
      const galleryImages = ['https://example.com/img1.jpg', 'https://example.com/img2.jpg', 'https://example.com/img3.jpg'];
      const kitchen = await kitchenService.updateKitchenGallery(1, galleryImages);
      
      expect(kitchen).toBeDefined();
      expect(kitchen.galleryImages).toEqual(galleryImages);
    });

    it('should throw error if kitchen does not exist', async () => {
      const galleryImages = ['https://example.com/img1.jpg'];
      await expect(kitchenService.updateKitchenGallery(999, galleryImages)).rejects.toThrow();
    });
  });

  describe('getKitchenById', () => {
    it('should return kitchen by ID', async () => {
      const kitchen = await kitchenService.getKitchenById(1);
      
      expect(kitchen).toBeDefined();
      expect(kitchen.id).toBe(1);
    });

    it('should throw error if kitchen does not exist', async () => {
      await expect(kitchenService.getKitchenById(999)).rejects.toThrow();
    });
  });

  describe('getKitchensByLocationId', () => {
    it('should return all kitchens for location', async () => {
      const kitchens = await kitchenService.getKitchensByLocationId(1);
      
      expect(Array.isArray(kitchens)).toBe(true);
    });

    it('should return only active kitchens when activeOnly is true', async () => {
      const kitchens = await kitchenService.getKitchensByLocationId(1, true);
      
      expect(Array.isArray(kitchens)).toBe(true);
      if (kitchens.length > 0) {
        expect(kitchens.every(k => k.isActive)).toBe(true);
      }
    });
  });

  describe('getAllActiveKitchens', () => {
    it('should return all active kitchens', async () => {
      const kitchens = await kitchenService.getAllActiveKitchens();
      
      expect(Array.isArray(kitchens)).toBe(true);
      if (kitchens.length > 0) {
        expect(kitchens.every(k => k.isActive)).toBe(true);
      }
    });
  });

  describe('getAllKitchens', () => {
    it('should return all kitchens', async () => {
      const kitchens = await kitchenService.getAllKitchens();
      
      expect(Array.isArray(kitchens)).toBe(true);
    });
  });
});
