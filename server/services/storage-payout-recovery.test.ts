import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const h = vi.hoisted(() => ({ where: null as any }));
vi.mock('../db', () => ({ db: { select: () => {
  const chain: any = { from: () => chain, where: (value: any) => { h.where = value; return chain; }, orderBy: () => chain, limit: async () => [] };
  return chain;
} } }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: vi.fn(), projectBookingCloseouts: vi.fn() }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
import { recoverCaptureTransfers } from './kitchen-payout-service';
describe('legacy capture transfer recovery excludes storage', () => {
  it('selects only kitchen/bundle with at-capture or NULL timing', async () => {
    expect(await recoverCaptureTransfers(3)).toEqual({ processed: 0, recovered: 0, blocked: 0 });
    const query = new PgDialect().sqlToQuery(h.where);
    expect(query.sql).toContain('"payment_transactions"."booking_type" in');
    expect(query.params).toEqual(expect.arrayContaining(['kitchen', 'bundle', 'at_capture']));
    expect(query.params).not.toContain('storage'); expect(query.params).not.toContain('storage_term');
  });
});
