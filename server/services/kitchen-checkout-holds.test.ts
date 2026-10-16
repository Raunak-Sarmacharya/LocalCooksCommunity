import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const release = vi.fn();
vi.mock('../db', () => ({
  db: {},
  pool: { connect: vi.fn(async () => ({ query, release })) },
}));

import { fulfillKitchenCheckout, sameOperatingSlots, withKitchenDayLock } from './kitchen-checkout-holds';

describe('kitchen day lock on a pooled database', () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({});
    release.mockReset();
  });

  it('holds transaction-scoped advisory locks throughout the work', async () => {
    const result = await withKitchenDayLock(3, '2026-12-04', async () => {
      expect(query.mock.calls.map(call => call[0])).toEqual([
        'BEGIN', 'SELECT pg_advisory_xact_lock($1, 0)', 'SELECT pg_advisory_xact_lock($1, $2)',
      ]);
      return 'done';
    });
    expect(result).toBe('done');
    expect(query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN', 'SELECT pg_advisory_xact_lock($1, 0)', 'SELECT pg_advisory_xact_lock($1, $2)', 'COMMIT',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the pooled connection when work fails', async () => {
    await expect(withKitchenDayLock(3, '2026-12-04', async () => {
      throw new Error('booking failed');
    })).rejects.toThrow('booking failed');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
  it('finds a booking committed by a competing fulfillment before checking a consumed hold', async () => {
    const create = vi.fn(), existing = { id: 42 };
    expect(await fulfillKitchenCheckout('consumed-hold', 'cs_same', 3, '2026-12-04', [], '10:00', create, async () => existing)).toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });
});

it('matches persisted JSONB slots regardless of object key order', () => {
  expect(sameOperatingSlots([{ endTime: '01:00', startTime: '00:00' }],
    [{ startTime: '00:00', endTime: '01:00' }])).toBe(true);
});
