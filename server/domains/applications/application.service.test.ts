/**
 * Unit tests for ApplicationService
 * Tests business logic for application submission and processing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApplicationService } from './application.service'
import { ApplicationRepository } from './application.repository'
import { DomainError, ApplicationErrorCodes } from '../../shared/errors/domain-error'
import { resetAllMocks } from '../../__tests__/test-utils'

// Mock the repository
const mockRepository = {
    findById: vi.fn(),
    findByUserId: vi.fn(),
    findByStatus: vi.fn(),
    findAll: vi.fn(),
    findAllPending: vi.fn(),
    findAllApproved: vi.fn(),
    hasPendingApplication: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    verifyDocuments: vi.fn(),
} as unknown as ApplicationRepository

// Mock validation
vi.mock('../../shared/validators/input-validator', () => ({
    validateApplicationInput: vi.fn((data) => Promise.resolve(data)),
}))

const mockApp = {
    id: 1,
    userId: 10,
    status: 'inReview',
    createdAt: new Date()
}

describe('ApplicationService', () => {
    let service: ApplicationService

    beforeEach(() => {
        resetAllMocks()
        service = new ApplicationService(mockRepository)
    })

    describe('submitApplication', () => {
        it('should submit application if user has no pending ones', async () => {
            const dto = { userId: 10, kitchenId: 1 }
            vi.mocked(mockRepository.hasPendingApplication).mockResolvedValue(false)
            vi.mocked(mockRepository.create).mockResolvedValue({ ...mockApp, ...dto } as any)

            const result = await service.submitApplication(dto as any)

            expect(result.userId).toBe(10)
            expect(mockRepository.create).toHaveBeenCalled()
        })

        it('should throw 409 if pending application exists', async () => {
            vi.mocked(mockRepository.hasPendingApplication).mockResolvedValue(true)

            await expect(service.submitApplication({ userId: 10 } as any)).rejects.toMatchObject({
                statusCode: 409,
                code: ApplicationErrorCodes.VALIDATION_ERROR
            })
        })
    })

    describe('approveApplication', () => {
        it('should approve a pending application', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(mockApp as any)
            vi.mocked(mockRepository.updateStatus).mockResolvedValue({ ...mockApp, status: 'approved' } as any)

            const result = await service.approveApplication(1, 99) // 99 = admin id

            expect(result.status).toBe('approved')
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(1, 'approved')
        })

        it('should throw 400 if application already processed', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue({ ...mockApp, status: 'approved' } as any)

            await expect(service.approveApplication(1, 99)).rejects.toMatchObject({
                statusCode: 400,
                code: ApplicationErrorCodes.VALIDATION_ERROR
            })
        })
    })

    describe('cancelApplication', () => {
        it('should allow user to cancel their own application', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(mockApp as any)
            vi.mocked(mockRepository.updateStatus).mockResolvedValue({ ...mockApp, status: 'cancelled' } as any)

            const result = await service.cancelApplication(1, 10) // 10 = user id

            expect(result.status).toBe('cancelled')
        })

        it('should throw 403 if user cancels someone else\'s application', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(mockApp as any)

            await expect(service.cancelApplication(1, 11)).rejects.toMatchObject({
                statusCode: 403,
                code: ApplicationErrorCodes.VALIDATION_ERROR
            })
        })
    })
})
