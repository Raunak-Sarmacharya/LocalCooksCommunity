/**
 * Unit tests for UserService
 * Tests business logic and profile aggregation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UserService } from './user.service'
import { UserRepository } from './user.repository'
import { DomainError, UserErrorCodes } from '../../shared/errors/domain-error'
import { mockUser, resetAllMocks } from '../../__tests__/test-utils'

// Mock the repository
const mockRepository = {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    findByFirebaseUid: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    usernameExists: vi.fn(),
} as unknown as UserRepository

// Mock Drizzle db for aggregations
vi.mock('../../db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    orderBy: vi.fn(() => ({
                        limit: vi.fn(() => Promise.resolve([]))
                    }))
                }))
            }))
        }))
    }
}))

// Mock validation
vi.mock('../../shared/validators/input-validator', () => ({
    validateUserInput: vi.fn((data) => Promise.resolve(data)),
    validateUpdateUserInput: vi.fn((data) => Promise.resolve(data)),
}))

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
    hash: vi.fn(() => Promise.resolve('hashed-password')),
    compare: vi.fn(() => Promise.resolve(true)),
}))

describe('UserService', () => {
    let service: UserService

    beforeEach(() => {
        resetAllMocks()
        service = new UserService(mockRepository)
    })

    describe('createUser', () => {
        it('should create user when username is unique', async () => {
            const dto = {
                username: 'newuser@example.com',
                password: 'password123',
                role: 'chef'
            }
            vi.mocked(mockRepository.usernameExists).mockResolvedValue(false)
            vi.mocked(mockRepository.create).mockResolvedValue({ ...mockUser, ...dto } as any)

            const result = await service.createUser(dto as any)

            expect(result.username).toBe('newuser@example.com')
            expect(mockRepository.create).toHaveBeenCalled()
        })

        it('should throw 409 if username taken', async () => {
            vi.mocked(mockRepository.usernameExists).mockResolvedValue(true)

            await expect(service.createUser({ username: 'taken' } as any)).rejects.toMatchObject({
                statusCode: 409,
                code: UserErrorCodes.USERNAME_TAKEN
            })
        })
    })

    describe('getCompleteProfile', () => {
        it('should aggregate data from repository and applications table', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(mockUser as any)

            const result = await service.getCompleteProfile(1)

            expect(result.id).toBe(1)
            expect(result.firebaseUser.uid).toBe(mockUser.firebaseUid)
            expect(mockRepository.findById).toHaveBeenCalledWith(1)
        })

        it('should throw 404 if user not found', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(null)

            await expect(service.getCompleteProfile(999)).rejects.toMatchObject({
                statusCode: 404,
                code: UserErrorCodes.USER_NOT_FOUND
            })
        })
    })

    describe('updateUserFirebaseUid', () => {
        it('should allow linking UID if none exists', async () => {
            const userWithoutUid = { ...mockUser, firebaseUid: null }
            vi.mocked(mockRepository.findById).mockResolvedValue(userWithoutUid as any)
            vi.mocked(mockRepository.update).mockResolvedValue({ ...mockUser } as any)

            const result = await service.updateUserFirebaseUid(1, 'new-uid')

            expect(result?.firebaseUid).toBe(mockUser.firebaseUid)
        })

        it('should throw 400 if UID already linked', async () => {
            vi.mocked(mockRepository.findById).mockResolvedValue(mockUser as any)

            await expect(service.updateUserFirebaseUid(1, 'new-uid')).rejects.toMatchObject({
                statusCode: 400,
                code: UserErrorCodes.VALIDATION_ERROR
            })
        })
    })
})
