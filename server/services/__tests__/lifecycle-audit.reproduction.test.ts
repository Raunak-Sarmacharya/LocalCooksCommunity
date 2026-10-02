// Regression tests exercise the real claim service with a mocked database.
// Mocked database only; no live records, emails, or payments.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ rows: [] as any[][], inserts: [] as any[], updates: [] as any[] }));
vi.mock('../../db', () => ({ db: {
  transaction: async (operation: any) => operation({ execute: async () => undefined,
    select: (fields: any) => ({ from: () => ({ where: async () => fields.count ? [{ count: 0 }]
      : [{ evidenceType: 'photo_before' }, { evidenceType: 'photo_after' }, { evidenceType: 'receipt' }] }) }),
    update: () => ({ set: (value: any) => { audit.updates.push(value);
      return { where: () => ({ returning: async () => [{ id: 90 }] }) }; } }),
    insert: () => ({ values: (value: any) => { audit.inserts.push(value); return { returning: async () => [{ id: 90, ...value }] }; } }),
  }),
  select: () => {
    const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
      limit: async () => audit.rows.shift() ?? [],
      then: (resolve: any) => resolve(audit.rows.shift() ?? []) };
    return chain;
  },
  insert: () => ({ values: (value: any) => {
    audit.inserts.push(value);
    return { returning: async () => [{ id: 90, ...value }] };
  } }),
  update: () => ({ set: (value: any) => {
    audit.updates.push(value);
    return { where: () => ({ returning: async () => [{ id: 90 }] }) };
  } }),
} }));
vi.mock('../../reference-code', () => ({ generateReferenceCode: async () => 'AUDIT-ONLY' }));
vi.mock('../../email', () => ({ sendEmail: vi.fn(), getSubdomainUrl: () => 'https://example.invalid' }));
vi.mock('../damage-claim-limits-service', () => ({
  validateClaimAmount: async (amount: number) => ({ valid: Number.isSafeInteger(amount) && amount >= 1000 && amount <= 500000,
    error: 'Invalid claim amount', limits: { minClaimAmountCents: 1000, maxClaimAmountCents: 500000 } }),
  canFileClaimForBooking: async () => ({ allowed: true }),
  getDamageClaimLimits: async () => ({ chefResponseDeadlineHours: 24, claimSubmissionDeadlineDays: 14, maxClaimsPerBooking: 3 }),
}));

import { createDamageClaim, submitClaim, updateDraftClaim, adminDecision } from '../damage-claim-service';
const input = { bookingType: 'kitchen' as const, kitchenBookingId: 10, managerId: 999,
  claimTitle: 'Audit claim', claimDescription: 'Audit description '.repeat(5),
  damageDate: '2020-01-01', claimedAmountCents: 1000 };
function booking() {
  audit.rows.push([{ managerId: 999, status: 'confirmed', bookingDate: new Date(), startTime: '09:00', endTime: '17:00', timezone: 'America/St_Johns' }]);
  audit.rows.push([{ chefId: 8, kitchenId: 40, status: 'confirmed', bookingDate: new Date('2020-01-01') }],
    [{ locationId: 3, managerId: 1 }]);
}

describe('local lifecycle claim regressions', () => {
  beforeEach(() => { audit.rows.length = 0; audit.inserts.length = 0; audit.updates.length = 0; });

  it('rejects a manager who does not own the booking location before inserting', async () => {
    audit.rows.push([{ managerId: 1, status: 'confirmed' }]);
    const result = await createDamageClaim(input);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unauthorized/);
    expect(audit.inserts).toHaveLength(0);
  });

  it('rejects an old booking after the configured filing deadline', async () => {
    audit.rows.push([{ managerId: 999, status: 'completed', bookingDate: new Date('2020-01-01'), startTime: '09:00', endTime: '17:00' }]);
    expect((await createDamageClaim(input)).error).toMatch(/deadline has passed/);
    expect(audit.inserts).toHaveLength(0);
  });

  it('rejects immediate submission without evidence', async () => {
    const result = await createDamageClaim({ ...input, submitImmediately: true });
    expect(result.success).toBe(false);
    expect(audit.inserts).toHaveLength(0);
  });

  it('resets the response deadline on submission, rather than using draft creation time', async () => {
    audit.rows.push([{ id: 90, managerId: 999, chefId: 8, status: 'draft', bookingType: 'kitchen',
      kitchenBookingId: 10, claimedAmountCents: 1000, chefResponseDeadline: new Date('2020-01-02') }],
      [{ managerId: 999, status: 'confirmed', bookingDate: new Date(), startTime: '09:00', endTime: '17:00' }],
      [{ evidenceType: 'photo_before' }, { evidenceType: 'photo_after' }, { evidenceType: 'receipt' }]);
    expect((await submitClaim(90, 999)).success).toBe(true);
    expect(audit.updates[0]).toMatchObject({ status: 'submitted' });
    expect(audit.updates[0].chefResponseDeadline.getTime() - audit.updates[0].submittedAt.getTime()).toBe(86400000);
  });

  it('rejects draft amounts outside platform limits', async () => {
    audit.rows.push([{ id: 90, managerId: 999, status: 'draft' }]);
    expect((await updateDraftClaim(90, 999, { claimedAmountCents: -1 })).success).toBe(false);
    expect(audit.updates).toHaveLength(0);
  });

  it('creates an authorized, in-window claim as a draft', async () => {
    booking();
    expect((await createDamageClaim(input)).success).toBe(true);
    expect(audit.inserts[0]).toMatchObject({ status: 'draft', managerId: 999 });
    expect(audit.inserts[0]).not.toHaveProperty('submittedAt');
  });

  it.each([1001, 0, -1, 1.5, NaN, Infinity])('rejects invalid partial award %s before writing', async (amount) => {
    audit.rows.push([{ id: 90, status: 'under_review', claimedAmountCents: 1000 }]);
    expect((await adminDecision(90, 2, { decision: 'partially_approve', approvedAmountCents: amount,
      decisionReason: 'Evidence supports a partial award' })).success).toBe(false);
    expect(audit.updates).toHaveLength(0);
  });

  it('rechecks the filing deadline when an old draft is submitted', async () => {
    audit.rows.push([{ id: 90, managerId: 999, status: 'draft', bookingType: 'kitchen',
      kitchenBookingId: 10, claimedAmountCents: 1000 }],
      [{ managerId: 999, status: 'completed', bookingDate: new Date('2020-01-01'), startTime: '09:00', endTime: '17:00' }]);
    expect((await submitClaim(90, 999)).error).toMatch(/deadline has passed/);
    expect(audit.updates).toHaveLength(0);
  });
});
