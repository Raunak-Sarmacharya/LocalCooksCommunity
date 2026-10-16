import { vi } from 'vitest';

// Set dummy DATABASE_URL to avoid initialization errors in server/db.ts
process.env.DATABASE_URL = 'postgres://dummy:dummy@localhost:5432/dummy';

const createQueryBuilder = () => {
    const builder: Record<string, any> = {};
    const chain = () => builder;

    for (const method of [
        'from',
        'where',
        'orderBy',
        'limit',
        'offset',
        'groupBy',
        'having',
        'innerJoin',
        'leftJoin',
        'rightJoin',
        'fullJoin',
        'values',
        'set',
        'returning',
        'onConflictDoNothing',
        'onConflictDoUpdate',
        'for',
    ]) {
        builder[method] = vi.fn(chain);
    }

    builder.execute = vi.fn(() => Promise.resolve([]));
    // Drizzle builders are awaitable before an explicit execute() call.
    builder.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve([]).then(resolve, reject);

    return builder;
};

const createDbMock = () => {
    const db = {
        select: vi.fn(() => createQueryBuilder()),
        selectDistinct: vi.fn(() => createQueryBuilder()),
        insert: vi.fn(() => createQueryBuilder()),
        update: vi.fn(() => createQueryBuilder()),
        delete: vi.fn(() => createQueryBuilder()),
        execute: vi.fn(() => Promise.resolve([])),
        transaction: vi.fn(),
    };

    db.transaction.mockImplementation((callback: (tx: typeof db) => unknown) =>
        Promise.resolve(callback(db)));

    return db;
};

// Mock the db module globally for all server tests
vi.mock('./server/db', () => ({
    db: createDbMock(),
}));
