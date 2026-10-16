import { describe, expect, it } from 'vitest';
import { InvitationError, invitationNoticeCopy, invitationNoticeReaders, invitationStatusAt, offeredInvitationSubtotal } from './kitchen-invitations';

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
    date: '2026-11-03', startTime: '09:00', endTime: '11:00', totalCents: 11_850,
    expiresAt: new Date('2026-11-01T12:00:00Z'), timezone: 'America/St_Johns',
  };

  it.each(['en-CA', 'fr-CA', 'uk'])('localizes the chef invitation in %s with kitchen, time and total', async locale => {
    const copy = await invitationNoticeCopy({ ...invitation, reader: 'chef', locale });
    expect(`${copy.title} ${copy.message}`).toContain('Harbour Kitchen');
    expect(copy.message).toContain('118');
    expect(`${copy.title} ${copy.message}`).not.toMatch(/invN_|\{|\b(?:Chef|admin)\b/i);
  });

  it('reads like a sentence with a 12-hour time and the zone', async () => {
    const copy = await invitationNoticeCopy({ ...invitation, reader: 'chef', locale: 'en-CA' });
    expect(copy.title).toBe('Harbour Kitchen invited you to book');
    expect(copy.message).toMatch(/^Tue, Nov 3, 9:00\sa\.m\.–11:00\sa\.m\. Newfoundland Time\. Total \$118\.50\. Pay by /);
  });

  it("a decline reason is the chef's note; a support reason is Local Cooks' note", async () => {
    const declined = await invitationNoticeCopy({ ...invitation, kind: 'declined', reader: 'manager', locale: 'en-CA', reason: 'Booked elsewhere.' });
    expect(declined.title).toBe('Olena declined your invitation');
    expect(declined.message).toContain('Their note: “Booked elsewhere.”');
    const withdrawn = await invitationNoticeCopy({ ...invitation, kind: 'withdrawn', actorRole: 'admin', reader: 'chef', locale: 'en-CA', reason: 'Kitchen closed.' });
    expect(withdrawn.title).toBe('Local Cooks withdrew your invitation from Harbour Kitchen');
    expect(withdrawn.message).toContain('Local Cooks note: Kitchen closed.');
  });

  it('admins see a discounted offer with its listed price', async () => {
    const copy = await invitationNoticeCopy({ ...invitation, reader: 'admin', locale: 'en-CA', offeredSubtotalCents: 4000, listSubtotalCents: 5000 });
    expect(copy.title).toBe('Invitation sent · Harbour Kitchen → Olena');
    expect(copy.message).toContain('Kitchen time $40.00 (listed $50.00). Total $118.50.');
  });

  it('tells each side only what they did not just do; admins oversee offers going out', () => {
    expect(invitationNoticeReaders('sent', 'manager')).toEqual(['chef', 'admin']);
    // Paid but the time was taken: the checkout safety net already tells the chef and admins; only the kitchen hears it here.
    expect(invitationNoticeReaders('unavailable', 'system', { afterPayment: true })).toEqual(['manager']);
    expect(invitationNoticeReaders('unavailable', 'system', {})).toEqual(['chef', 'manager']);
    expect(invitationNoticeReaders('declined', 'chef')).toEqual(['manager']);
    expect(invitationNoticeReaders('withdrawn', 'manager')).toEqual(['chef']);
    expect(invitationNoticeReaders('withdrawn', 'admin')).toEqual(['chef', 'manager']);
    expect(invitationNoticeReaders('expired', 'system')).toEqual(['chef', 'manager']);
    expect(invitationNoticeReaders('accepted', 'manager')).toEqual([]);
    expect(invitationNoticeReaders('superseded', 'manager')).toEqual([]);
    expect(invitationNoticeReaders('payment_started', 'chef')).toEqual([]);
  });
});
