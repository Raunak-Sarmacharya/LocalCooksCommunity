/**
 * Unit tests for KitchenService
 * Tests business logic without hitting real database
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { KitchenService } from './kitchen.service'
import { KitchenRepository } from './kitchen.repository'
import { DomainError, KitchenErrorCodes } from '../../shared/errors/domain-error'
import { mockKitchen, resetAllMocks } from '../../__tests__/test-utils'

// Mock the repository
const mockRepository = {
    findById: vi.fn(),
    findByLocationId: vi.fn(),
    findActiveByLocationId: vi.fn(),
    findAllActive: vi.fn(),
    findAll: vi.fn(),
    findAllWithLocation: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    nameExistsForLocation: vi.fn(),
    updateImage: vi.fn(),
    updateGallery: vi.fn(),
} as unknown as KitchenRepository

// Mock validation
vi.mock('../../shared/validators/input-validator', () => ({
    validateKitchenInput: vi.fn((data) => Promise.resolve(data)),
    validateUpdateKitchenInput: vi.fn((data) => Promise.resolve(data)),
}))

describe('KitchenService', () => {
    let service: KitchenService

    beforeEach(() => {
        resetAllMocks()
        service = new KitchenService(mockRepository)
    })

    describe('createKitchen', () => {
        it('should create kitchen when data is valid and name is unique', async () => {
            const dto = {
                name: 'New Kitchen',
                locationId: 1,
                hourlyRate: 50,
            }
            vi.mocked(mockRepository.nameExistsForLocation).mockResolvedValue(false)
            vi.mocked(mockRepository.create).mockResolvedValue({ ...mockKitchen, ...dto } as any)

            const result = await service.createKitchen(dto as any)

            expect(result.name).toBe('New Kitchen')
            expect(mockRepository.create).toHaveBeenCalled()
        })

        it('should throw DomainError if name already exists at location', async () => {
            const dto = {
                name: 'Existing Kitchen',
                locationId: 1,
            }
            vi.mocked(mockRepository.nameExistsForLocation).mockResolvedValue(true)

            await expect(service.createKitchen(dto as any)).rejects.toThrow(DomainError)
            await expect(service.createKitchen(dto as any)).rejects.toMatchObject({
                code: KitchenErrorCodes.INVALID_PRICING,
                message: 'Kitchen with this name already exists for this location'
            })
        })
    })

    describe('getKitchenById', () => {
        it('should return kitchen if found', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(mockKitchen as any)

            const result = await service.getKitchenById(1)

            expect(result).toEqual(mockKitchen)
        })

        it('should throw 404 DomainError if not found', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(null)

            await expect(service.getKitchenById(999)).rejects.toThrow(DomainError)
            await expect(service.getKitchenById(999)).rejects.toMatchObject({
                statusCode: 404,
                code: KitchenErrorCodes.KITCHEN_NOT_FOUND
            })
        })
    })

    describe('activateKitchen', () => {
        it('should activate an inactive kitchen', async () => {
            const inactiveKitchen = { ...mockKitchen, id: 1, isActive: false }
            vi.mocked(mockRepository.findById).mockResolvedValue(inactiveKitchen as any)
            vi.mocked(mockRepository.activate).mockResolvedValue({ ...inactiveKitchen, isActive: true } as any)

            const result = await service.activateKitchen(1)

            expect(result.isActive).toBe(true)
            expect(mockRepository.activate).toHaveBeenCalledWith(1)
        })

        it('should throw error if already active', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue({ ...mockKitchen, isActive: true } as any)

            await expect(service.activateKitchen(1)).rejects.toThrow('Kitchen is already active')
        })
    })

    describe('deactivateKitchen', () => {
        it('should deactivate an active kitchen', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue({ ...mockKitchen, isActive: true } as any)
            vi.mocked(mockRepository.deactivate).mockResolvedValue({ ...mockKitchen, isActive: false } as any)

            const result = await service.deactivateKitchen(1)

            expect(result.isActive).toBe(false)
            expect(mockRepository.deactivate).toHaveBeenCalledWith(1)
        })
    })
})
