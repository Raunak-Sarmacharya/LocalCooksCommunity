import { describe, expect, it, vi } from 'vitest';
const select = vi.hoisted(() => vi.fn(() => { throw new Error('Automatic classification must not query records'); }));
vi.mock('../db', () => ({ db: { select } }));
import { detectKitchenNoShows } from './kitchen-checkout-service';
import { detectKitchenVisitNoShows } from './kitchen-visit-lifecycle';
describe('retired automatic absence classifiers', () => {
  it('never queries, writes, notifies or completes bookings at any age', async () => {
    expect(await detectKitchenNoShows()).toEqual({ processed: 0, marked: 0, errors: 0 });
    expect(await detectKitchenVisitNoShows()).toBe(0);
    expect(await detectKitchenVisitNoShows(123)).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });
});
