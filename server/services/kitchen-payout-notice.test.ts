import { describe, expect, it } from 'vitest';
import { ensureServerI18n } from '../i18n';
import { kitchenPayoutNotice, managerNoCheckinNotice, managerRunningLateNotice } from './kitchen-payout-notice';

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

describe('arrival package manager notices', () => {
  const end = new Date('2026-10-14T17:00:00Z'), start = new Date('2026-10-14T13:00:00Z');
  it('says the chef is running late, names the end time and offers Message', async () => {
    const notice = await managerRunningLateNotice('en-CA', { chef: 'Maya Chen', minutes: 15, end, timezone: 'America/Toronto' });
    expect(notice.title).toBe('Maya Chen is running late');
    expect(notice.message).toMatch(/^Maya Chen is running about 15 minutes late\. Their booking still ends at 1:00 p\.m\. Eastern Time\.$/);
    expect(notice.actionLabel).toBe('Message Maya Chen');
    expect((await managerRunningLateNotice('en-CA', { chef: 'Maya Chen', minutes: 60, end, timezone: 'UTC', note: 'Traffic' })).message).toContain('about an hour late');
  });
  it('says the chef has not checked in with the booked start', async () => {
    await ensureServerI18n();
    const notice = managerNoCheckinNotice('en-CA', { chef: 'Maya Chen', kitchen: 'Harbour', start, timezone: 'America/Toronto' });
    expect(notice.message).toBe('Maya Chen hasn’t checked in yet. Their booking started at 9:00 a.m. Eastern Time.');
    expect(notice.title).toBe('Maya Chen hasn’t checked in yet · Harbour');
    expect(notice.actionLabel).toBe('Message Maya Chen');
  });
  it('is translated and never shows a raw key', async () => {
    await ensureServerI18n();
    for (const locale of ['fr-CA', 'uk']) {
      const late = await managerRunningLateNotice(locale, { chef: 'Maya', minutes: 30, end, timezone: 'UTC', note: 'x' });
      const none = managerNoCheckinNotice(locale, { chef: null, kitchen: 'Harbour', start, timezone: 'UTC' });
      for (const text of [late.title, late.message, late.actionLabel, none.title, none.message, none.actionLabel]) expect(text).not.toMatch(/manager[A-Z]|\{\{|\{chef\}/);
      expect(late.message).toContain('30');
    }
  });
});
