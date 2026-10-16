import { describe, expect, it } from 'vitest';
import { InvitationError, invitationNoticeCopy, invitationStatusAt, offeredInvitationSubtotal } from './kitchen-invitations';

describe('kitchen invitation pricing', () => {
  it('applies a fixed discount to the kitchen subtotal', () => {
    expect(offeredInvitationSubtotal(12_500, { type: 'amount', value: 2_500 })).toBe(10_000);
  });

  it('rounds percentage discounts to integer cents', () => {
    expect(offeredInvitationSubtotal(10_001, { type: 'percent', value: 15 })).toBe(8_501);
  });

  it('allows an invitation without a discount', () => {
    expect(offeredInvitationSubtotal(4_000)).toBe(4_000);
  });

  it.each([
    { type: 'amount' as const, value: 9_901 },
    { type: 'percent' as const, value: 100 },
  ])('enforces the $1 offered-subtotal floor for $discount.type', discount => {
    expect(() => offeredInvitationSubtotal(10_000, discount)).toThrow(InvitationError);
  });

  it('rejects invalid percentages', () => {
    expect(() => offeredInvitationSubtotal(10_000, { type: 'percent', value: 101 })).toThrow('between 0 and 100');
  });
});

describe('kitchen invitation expiry-on-read', () => {
  const expiry = new Date('2026-10-16T12:00:00Z');

  it('keeps a sent invitation active before its expiry', () => {
    expect(invitationStatusAt('sent', expiry, new Date('2026-10-16T11:59:59Z'))).toBe('sent');
  });

  it('derives expiry at the exact boundary without a worker', () => {
    expect(invitationStatusAt('sent', expiry, expiry)).toBe('expired');
  });

  it('does not rewrite terminal states after their expiry timestamp', () => {
    expect(invitationStatusAt('withdrawn', expiry, new Date('2026-10-17T00:00:00Z'))).toBe('withdrawn');
  });
});

describe('kitchen invitation per-reader notices', () => {
  const invitation = {
    kind: 'sent', kitchen: 'Harbour Kitchen', customer: 'Olena',
    date: '2026-11-03', startTime: '09:00', endTime: '11:00',
    offeredSubtotalCents: 10_000, totalCents: 11_850,
    expiresAt: new Date('2026-11-01T12:00:00Z'), timezone: 'America/St_Johns',
  };

  it.each(['en-CA', 'fr-CA', 'uk'])('localizes chef copy in %s with kitchen, date and amounts', async locale => {
    const copy = await invitationNoticeCopy({ ...invitation, reader: 'chef', locale });
    expect(`${copy.title} ${copy.message}`).toContain('Harbour Kitchen');
    expect(copy.message).toContain('100');
    expect(copy.message).toContain('118');
    expect(`${copy.title} ${copy.message}`).not.toMatch(/\b(?:Chef|admin)\b/i);
  });

  it('shows the customer name only in the kitchen reader copy', async () => {
    const chef = await invitationNoticeCopy({ ...invitation, reader: 'chef', locale: 'en-CA' });
    const manager = await invitationNoticeCopy({ ...invitation, reader: 'manager', locale: 'en-CA' });
    expect(`${chef.title} ${chef.message}`).not.toContain('Olena');
    expect(`${manager.title} ${manager.message}`).toContain('Olena');
  });
});
