import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
vi.mock('../db', () => ({ db: { execute: vi.fn() } }));
import { assertBookingMoneyWritable } from './booking-money-guard';
describe('booking money freeze lookup', () => {
  it.each([{ bookingId: 4 }, { paymentIntentId: 'pi_one' }, { paymentTransactionId: 9 }, { transferId: 'tr_one' }])('refuses open flags for %j', async target => {
    const connection = { execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
    await expect(assertBookingMoneyWritable(target, connection as any)).rejects.toThrow('paused');
    const query = new PgDialect().sqlToQuery(connection.execute.mock.calls[0][0]);
    expect(query.sql).toContain('f.resolved_at IS NULL'); expect(query.sql).toContain('f.storage_booking_id'); expect(query.sql).not.toContain('s.kitchen_booking_id'); expect(query.sql).toContain('e.kitchen_booking_id');
    expect(query.params).toContain(Object.values(target)[0]);
  });
  it('permits writers after flags are resolved, and fails closed on lookup errors', async () => {
    await expect(assertBookingMoneyWritable({ bookingId: 1 }, { execute: vi.fn().mockResolvedValue({ rows: [] }) } as any)).resolves.toBeUndefined();
    await expect(assertBookingMoneyWritable({ bookingId: 1 }, { execute: vi.fn().mockRejectedValue(Error('flag storage unavailable')) } as any)).rejects.toThrow('unavailable');
  });
  it('blocks an executing automatic recovery action but lets a later support key retry a recorded recovery', async () => {
    const connection = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    await assertBookingMoneyWritable({ bookingId: 1, operationKey: 'support-retry-new' }, connection as any);
    const query = new PgDialect().sqlToQuery(connection.execute.mock.calls[0][0]);
    expect(query.sql).toMatch(/retry_refund.*mark_refunded/);
    expect(query.sql).toContain("a.status = 'executing'");
    expect(query.params).toContain('support-retry-new');
  });
});
