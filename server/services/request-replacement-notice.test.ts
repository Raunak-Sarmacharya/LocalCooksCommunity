import { describe, expect, it } from 'vitest';
import { requestReplacementNotice, type ReplacementNotice } from './request-replacement-notice';
import { ensureServerI18n, tLocale } from '../i18n';

const base: ReplacementNotice = { variant: 'changed', oldRef: 'KB-OLD111', newRef: 'KB-NEW222', holdCents: 12200, deadlineAt: '2099-01-01T15:00:00Z',
  old: { date: '2099-01-02', startTime: '10:00', endTime: '11:00' }, next: { date: '2099-01-02', startTime: '10:00', endTime: '12:00' } };
const names = { chefName: 'Sam Taylor', kitchenName: 'Fixture Kitchen', timezone: 'America/St_Johns' };
const variants: ReplacementNotice['variant'][] = ['changed', 'updated', 'two_bookings', 'ended', 'releasing'];

describe('request replacement notices', () => {
  it.each(['en-CA', 'fr-CA', 'uk'])('pending/support success copy keeps its locale text and the kitchen name (%s)', async locale => {
    await ensureServerI18n();
    for (const key of ['crSuccessPending', 'crSuccessSupport']) {
      const copy = tLocale(locale, key, { ns: 'booking', kitchen: 'Harbour Kitchen' });
      expect(copy).toContain('Harbour Kitchen');
      expect(copy).not.toMatch(/\?|\{\w+\}|^crSuccess/);
      if (locale === 'fr-CA') expect(copy).toContain('été');
      if (locale === 'uk') expect(copy).toMatch(/[\u0400-\u04ff]/);
    }
  });
  it.each(['en-CA', 'fr-CA', 'uk'])('every variant is fully worded with no leftover keys or placeholders (%s)', async locale => {
    for (const variant of variants) {
      const notice = await requestReplacementNotice(locale, { ...base, variant }, names);
      expect(notice.title, variant).not.toMatch(/^(rp|cr)[A-Z]|\{\w+\}/);
      expect(notice.message, variant).not.toMatch(/^(rp|cr)[A-Z]|\{\w+\}|undefined|NaN/);
      expect(notice.message, variant).not.toMatch(/pi_|cs_|stripe/i);
    }
  });

  it('kitchen: one notice names the chef, the new time, the old time and the answer-by time', async () => {
    const notice = await requestReplacementNotice('en-CA', base, names);
    expect(notice.title).toBe('Sam Taylor changed their request');
    expect(notice.message).toContain('Now Fri, Jan 2, 10:00 a.m.–12:00 p.m. (was Fri, Jan 2, 10:00 a.m.–11:00 a.m.).');
    expect(notice.message).toMatch(/answer by Jan 1, 2099.*11:30 a\.m\.$/);
    expect(notice.message).not.toContain('..');
  });

  it('kitchen: a missing deadline drops the answer-by sentence instead of printing a blank', async () => {
    const notice = await requestReplacementNotice('en-CA', { ...base, deadlineAt: undefined }, names);
    expect(notice.message).not.toMatch(/answer by/i);
    expect(notice.message).toMatch(/\(was /);
  });

  it('chef: says the kitchen has until the deadline and that the earlier hold of the exact amount was released', async () => {
    const notice = await requestReplacementNotice('en-CA', { ...base, variant: 'updated' }, names);
    expect(notice.title).toBe('Request updated');
    expect(notice.message).toContain('Fixture Kitchen now has until Jan 1, 2099');
    expect(notice.message).toContain('Your earlier hold of $122.00 was released.');
    expect(notice.message).toContain('Banks can take a few days to show a released hold.');
    expect(notice.message).not.toMatch(/\bfree\b/i);
  });

  it('chef race: says the kitchen accepted the original first, that there are two bookings and that the new one can be withdrawn at no cost', async () => {
    const notice = await requestReplacementNotice('en-CA', { ...base, variant: 'two_bookings' }, names);
    expect(notice.title).toBe('You now have two bookings');
    expect(notice.message).toContain('Fixture Kitchen accepted your original request KB-OLD111 before your change was sent.');
    expect(notice.message).toContain('The new request KB-NEW222 can be withdrawn at no cost.');
    expect(notice.message).not.toMatch(/\bfree\b/i);
  });

  it('chef: an earlier request that had already ended says there was nothing to withdraw', async () => {
    const notice = await requestReplacementNotice('en-CA', { ...base, variant: 'ended' }, names);
    expect(notice.message).toContain('KB-OLD111 had already ended, so there was nothing to withdraw.');
    expect((await requestReplacementNotice('en-CA', { ...base, variant: 'ended', deadlineAt: undefined }, names)).message).not.toMatch(/until/);
  });

  it('chef: a hold that is still being released says so and tells them not to pay again', async () => {
    const notice = await requestReplacementNotice('en-CA', { ...base, variant: 'releasing' }, names);
    expect(notice.title).toBe('We’re releasing your earlier hold');
    expect(notice.message).toMatch(/don’t pay again/);
  });
});
