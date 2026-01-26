import { vi } from 'vitest';

// Set dummy DATABASE_URL to avoid initialization errors in server/db.ts
process.env.DATABASE_URL = 'postgres://dummy:dummy@localhost:5432/dummy';

// Mock the db module globally for all server tests
vi.mock('./server/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    orderBy: vi.fn(() => ({
                        limit: vi.fn(() => Promise.resolve([]))
                    }))
                }))
            }))
        })),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([]))
            }))
        })),
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => ({
                    returning: vi.fn(() => Promise.resolve([]))
                }))
            }))
        })),
        delete: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([]))
        })),
        transaction: vi.fn((cb) => cb({
            select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
            update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
            delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
        }))
    }
}));
