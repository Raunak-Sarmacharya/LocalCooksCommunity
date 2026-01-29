/**
 * Test utilities for server-side unit tests
 * Provides mock database connections and fixtures
 */

import { vi } from 'vitest'

/**
 * Creates a mock Drizzle database instance for testing
 * Use this to avoid hitting real database during unit tests
 */
export function createMockDb() {
    return {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        execute: vi.fn(),
        then: vi.fn((cb: any) => cb([])), // For promise chaining
    }
}

/**
 * Mock kitchen fixture for testing
 */
export const mockKitchen = {
    id: 1,
    locationId: 100,
    name: 'Test Kitchen',
    description: 'A test kitchen',
    hourlyRate: 5000, // $50.00 in cents
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
}

/**
 * Mock user fixture for testing
 */
export const mockUser = {
    id: 1,
    username: 'testuser@example.com',
    firebaseUid: 'firebase-uid-123',
    role: 'chef',
    isManager: false,
    isChef: true,
    isVerified: true,
    createdAt: new Date('2024-01-01'),
}

/**
 * Mock location fixture for testing
 */
export const mockLocation = {
    id: 100,
    name: 'Test Location',
    address: '123 Test St',
    managerId: 2,
    createdAt: new Date('2024-01-01'),
}

/**
 * Helper to reset all mocks between tests
 */
export function resetAllMocks() {
    vi.clearAllMocks()
    vi.resetAllMocks()
}
