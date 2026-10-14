import { describe, expect, it } from 'vitest';
import { kitchenPayoutNotice } from './kitchen-payout-notice';

const input = { reference: 'KB-A7K9MX', amountCents: 2732, chef: 'Maya Chen', date: new Date('2026-10-14T00:00:00Z'), timezone: 'UTC' };
describe('kitchen payout notices (manager only, people language)', () => {
  it('says the manager has been paid, when it reaches the bank, and links the payout statement', async () => {
    const notice = await kitchenPayoutNotice('payout_released', 'en-CA', input);
    expect(notice.title).toBe('You’ve been paid $27.32 · KB-A7K9MX');
    expect(notice.message).toBe('You’ve been paid $27.32 for Maya Chen’s booking on October 14, 2026. It’s on its way to your bank.');
    expect(notice.actionLabel).toBe('View payout statement');
  });
  it('explains a hold without blame and promises a follow-up', async () => {
    const notice = await kitchenPayoutNotice('payout_on_hold', 'en-CA', input);
    expect(notice.title).toBe('Your payout is on hold');
    expect(notice.message).toBe('Your payout for KB-A7K9MX is on hold while Local Cooks reviews the reported issue. We’ll let you know when it’s released.');
  });
  it('is translated for French and Ukrainian managers and never shows a raw key', async () => {
    for (const locale of ['fr-CA', 'uk']) {
      const released = await kitchenPayoutNotice('payout_released', locale, { ...input, chef: null });
      expect(released.message).not.toMatch(/payout[A-Z]|\{|Maya/);
      expect(released.message).toContain('27,32');
      expect((await kitchenPayoutNotice('payout_on_hold', locale, input)).message).toContain('KB-A7K9MX');
    }
  });
});
