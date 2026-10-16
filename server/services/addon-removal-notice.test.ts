import { describe, expect, it } from 'vitest';
import { addonRemovalNotice } from './addon-removal-notice';
import { adminBookingNotice, ADMIN_BOOKING_KINDS } from './admin-booking-notice';

const base = { itemName: 'Commercial Oven', kitchenName: 'PHASE0 Main Kitchen', chefName: 'Sam Chef', reference: 'KB-OVEN1', date: 'Nov 10, 2026, 9:00 a.m.' };

describe('chef removes an add-on: the notice each side reads', () => {
  it('chef: the kitchen, the date and the refund on its way', async () => {
    const notice = await addonRemovalNotice('chef', 'en-CA', { ...base, state: 'removed', refundCents: 2055 });
    expect(notice.title).toBe('Commercial Oven removed from your booking');
    expect(notice.message).toBe('Your $20.55 refund for PHASE0 Main Kitchen on Nov 10, 2026, 9:00 a.m. is on its way. Banks usually show it within 5–10 business days.');
  });
  it('chef: an included add-on says it wasn’t charged, with no refund wording', async () => {
    const notice = await addonRemovalNotice('chef', 'en-CA', { ...base, state: 'removed', free: true });
    expect(notice.message).toBe('It wasn’t charged. Your booking at PHASE0 Main Kitchen on Nov 10, 2026, 9:00 a.m. stays as it was.'); expect(notice.message).not.toMatch(/refund|$0/i);
  });
  it('chef: after the deadline it isn’t refundable (never "no refund" or "free")', async () => {
    const notice = await addonRemovalNotice('chef', 'en-CA', { ...base, state: 'removed', afterDeadline: true, refundCents: 0 });
    expect(notice.title).toBe('Commercial Oven removed'); expect(notice.message).toContain('Under the cancellation policy it isn’t refundable.');
    expect(notice.message).not.toMatch(/no refund|free/i);
  });
  it('chef: processing, fee pending and sent each say so', async () => {
    expect((await addonRemovalNotice('chef', 'en-CA', { ...base, state: 'processing', refundCents: 2055 })).message).toContain('Your $20.55 refund for PHASE0 Main Kitchen on Nov 10, 2026, 9:00 a.m. is being processed — we’ll confirm when it’s sent.');
    expect((await addonRemovalNotice('chef', 'en-CA', { ...base, state: 'fee_pending' })).message).toContain('We’re confirming the card fee before sending your exact refund for PHASE0 Main Kitchen on Nov 10, 2026, 9:00 a.m.');
    const sent = await addonRemovalNotice('chef', 'en-CA', { ...base, state: 'sent', refundCents: 2055 });
    expect(sent.title).toBe('Your Commercial Oven refund was sent'); expect(sent.message).toContain('$20.55');
  });
  it('kitchen: who removed what, from which booking and when, and how the payout changes', async () => {
    const change = await addonRemovalNotice('manager', 'en-CA', { ...base, state: 'removed', refundCents: 2055, kitchenRefundCents: 1933 });
    expect(change.title).toBe('Sam Chef removed Commercial Oven');
    expect(change.message).toBe('Sam Chef removed the Commercial Oven from KB-OVEN1 (Nov 10, 2026, 9:00 a.m.). Your payout changes by −$19.33.');
    expect((await addonRemovalNotice('manager', 'en-CA', { ...base, state: 'removed', free: true })).message).toContain('Your payout doesn’t change.');
    expect((await addonRemovalNotice('manager', 'en-CA', { ...base, state: 'removed', afterDeadline: true, refundCents: 0 })).message).toContain('Your payout doesn’t change.');
    expect((await addonRemovalNotice('manager', 'en-CA', { ...base, state: 'processing', refundCents: 2055, kitchenRefundCents: 1933 })).message).toContain('Their refund is being processed.');
    expect((await addonRemovalNotice('chef', 'en-CA', { ...base, state: 'removed', afterDeadline: true, refundCents: 1028, kitchenRefundCents: 967 })).message).toContain('$10.28 refund');
    expect((await addonRemovalNotice('manager', 'en-CA', { ...base, state: 'removed', afterDeadline: true, refundCents: 1028, kitchenRefundCents: 967 })).message).toContain('$9.67');
    expect((await addonRemovalNotice('manager', 'en-CA', { ...base, state: 'removed', refundCents: 2055, kitchenRefundCents: 1933, kitchenDebtCents: 1933 })).message).toContain('Your kitchen owes Local Cooks $19.33');
    expect((await addonRemovalNotice('manager', 'en-CA', { ...base, state: 'removed', refundCents: 2055, kitchenRefundCents: 1933, reason: 'Menu changed' })).message).toContain('Note from Sam Chef: “Menu changed”');
  });
  it.each(['en-CA', 'fr-CA', 'uk'])('has no raw keys, placeholders or internal ids in any state (%s)', async locale => {
    for (const role of ['chef', 'manager'] as const) for (const input of [
      { state: 'removed' as const, refundCents: 2055, kitchenRefundCents: 1933 }, { state: 'removed' as const, free: true }, { state: 'removed' as const, afterDeadline: true, refundCents: 0 },
      { state: 'processing' as const, refundCents: 2055, kitchenRefundCents: 1933 }, { state: 'fee_pending' as const }, { state: 'sent' as const, refundCents: 2055 },
      { state: 'removed' as const, refundCents: 2055, kitchenRefundCents: 1933, kitchenDebtCents: 1933, reason: 'Menu changed' }]) {
      const notice = await addonRemovalNotice(role, locale, { ...base, ...input });
      for (const text of [notice.title, notice.message]) { expect(text).not.toMatch(/^arn|\{\w+\}|#\d+|undefined/); expect(text.length).toBeGreaterThan(8); }
    }
  });
  it('Local Cooks gets a factual summary with who, what and the money', () => {
    expect(ADMIN_BOOKING_KINDS.has('addon_removed')).toBe(true);
    const facts = { chef: 'Sam Chef', kitchen: 'PHASE0 Main Kitchen', reference: 'KB-OVEN1', when: 'Nov 10, 2026, 9:00 a.m.', message: 'ignored' };
    const paid = adminBookingNotice('addon_removed', { ...facts, addon: { state: 'removed', itemName: 'Commercial Oven', refundCents: 2055, kitchenRefundCents: 1933, feeCents: 67 } })!;
    expect(paid.title).toBe('Add-on removed · KB-OVEN1');
    expect(paid.message).toBe('Sam Chef removed Commercial Oven at PHASE0 Main Kitchen · Nov 10, 2026, 9:00 a.m. · KB-OVEN1. Refunded $20.55. Kitchen payout −$19.33. Card fee kept: $0.67.');
    expect(adminBookingNotice('addon_removed', { ...facts, addon: { itemName: 'Mixer', free: true } })!.message).toContain('It wasn’t charged.');
    expect(adminBookingNotice('addon_removed', { ...facts, addon: { itemName: 'Mixer', afterDeadline: true, refundCents: 0 } })!.message).toContain('Not refundable');
    expect(adminBookingNotice('addon_removed', { ...facts, addon: { itemName: 'Mixer', afterDeadline: true, refundCents: 1028, kitchenRefundCents: 967 } })!.message).toMatch(/Refunded \$10\.28.*\$9\.67/);
    expect(adminBookingNotice('addon_removed', { ...facts, addon: { state: 'fee_pending', itemName: 'Mixer' } })!.message).toContain('waiting for the actual processing fee');
    expect(adminBookingNotice('addon_removed', { ...facts, addon: { state: 'processing', itemName: 'Mixer', refundCents: 500, kitchenRefundCents: 400, kitchenDebtCents: 400 } })!.message)
      .toMatch(/Processing refund.*The kitchen owes Local Cooks \$4\.00/);
  });
});
