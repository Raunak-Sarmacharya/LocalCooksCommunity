import { describe, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
import { ensureServerI18n } from '../i18n';
import { sessionExtensionAudiences, sessionExtensionCopy } from './session-extension-notice';

const facts = { chef: 'Maya Chen', kitchen: 'Harbour Kitchen', reference: 'KB-10', end: '4:30 p.m. Newfoundland Time', originalEnd: '3:30 p.m. Newfoundland Time',
  expires: '3:45 p.m. Newfoundland Time', amount: '$28.75', payout: '$27.32', duration: '1 more hour', billed: '30 minutes', stayed: '40 minutes', early: '30 minutes', note: null, payBy: 'Oct 29' };

describe('session-extension notices', () => {
  it('routes each event to the right people', () => {
    expect(sessionExtensionAudiences('requested', 'request')).toEqual([['manager', 'sxRequested']]);
    expect(sessionExtensionAudiences('declined', 'request')).toEqual([['chef', 'sxDeclinedChef']]);
    expect(sessionExtensionAudiences('confirmed', 'offer').map(([who]) => who)).toEqual(['chef', 'manager']);
    expect(sessionExtensionAudiences('granted', 'early_start')).toEqual([['chef', 'sxGrantedStartChef']]);
    expect(sessionExtensionAudiences('disputed', 'extra_time').map(([who]) => who)).toEqual(['chef', 'manager', 'admins']);
    expect(sessionExtensionAudiences('escalated', 'extra_time').map(([who]) => who)).toEqual(['chef', 'manager', 'admins']);
  });
  it('names people and uses kitchen-local 12-hour times', async () => {
    await ensureServerI18n();
    expect(sessionExtensionCopy('sxRequested', 'en-CA', facts)).toMatchObject({ title: 'Maya Chen asked for 1 more hour' });
    expect(sessionExtensionCopy('sxRequested', 'en-CA', facts).message).toMatch(/^Maya Chen asked for 1 more hour at Harbour Kitchen \(until 4:30 p\.m\. Newfoundland Time\) · you’d get \$27\.32\./);
    expect(sessionExtensionCopy('sxDeclinedChef', 'en-CA', facts).message).toBe('Harbour Kitchen couldn’t extend this time. Your card wasn’t charged. Your booking still ends at 3:30 p.m. Newfoundland Time.');
    expect(sessionExtensionCopy('sxExtraTimeChef', 'en-CA', { ...facts, note: 'Fryer cleanup' }).message)
      .toMatch(/^You stayed 40 minutes past your booking at Harbour Kitchen\. They’ve asked for \$28\.75 for 30 minutes of extra time\.[\s\S]*Note from Harbour Kitchen: Fryer cleanup$/);
    expect(sessionExtensionCopy('sxGrantedStartChef', 'en-CA', facts).title).toBe('Harbour Kitchen let you start at 4:30 p.m. Newfoundland Time');
    for (const locale of ['fr-CA', 'uk']) expect(sessionExtensionCopy('sxOfferedChef', locale, facts).title).toContain('Harbour Kitchen');
  });
  it('tells both sides what Local Cooks decided on a disputed charge, with the pay-by and its note, in all three languages', async () => {
    await ensureServerI18n();
    expect(sessionExtensionAudiences('dispute_upheld', 'extra_time')).toEqual([['chef', 'sxUpheldChef'], ['manager', 'sxUpheldManager']]);
    expect(sessionExtensionAudiences('dispute_waived', 'extra_time').map(([who]) => who)).toEqual(['chef', 'manager']);
    const decided = { ...facts, note: 'Checkout time is recorded.' };
    expect(sessionExtensionCopy('sxUpheldChef', 'en-CA', decided).message)
      .toBe('Local Cooks reviewed your concern about the extra-time charge from Harbour Kitchen and decided $28.75 is due. Pay by Oct 29 on your booking so you can keep making new bookings.\nNote from Local Cooks: Checkout time is recorded.');
    expect(sessionExtensionCopy('sxWaivedManager', 'en-CA', decided).message).toMatch(/^Local Cooks reviewed Maya Chen’s concern and waived/);
    for (const locale of ['fr-CA', 'uk']) for (const prefix of ['sxUpheldChef', 'sxUpheldManager', 'sxWaivedChef', 'sxWaivedManager']) {
      const copy = sessionExtensionCopy(prefix, locale, decided);
      expect(copy.title).not.toContain('sx');
      expect(copy.message).toContain('Checkout time is recorded.');
    }
  });
  it('explains another-card recovery and automatic refunds in all three languages', async () => {
    await ensureServerI18n();
    expect(sessionExtensionAudiences('refunded', 'early_start')).toEqual([['chef', 'sxRefundedChef']]);
    for (const locale of ['en-CA', 'fr-CA', 'uk']) {
      const failure = sessionExtensionCopy('sxCardFailedChef', locale, facts);
      const refunded = sessionExtensionCopy('sxRefundedChef', locale, facts);
      expect(failure.message).toContain('$28.75'); expect(failure.message).toContain('Harbour Kitchen');
      expect(refunded.message).toContain('$28.75'); expect(refunded.message).not.toContain('sxRefunded');
      expect(refunded.message).not.toContain('?');
    }
    expect(sessionExtensionCopy('sxCardFailedChef', 'en-CA', facts).message).toContain('Pay with another card');
    expect(sessionExtensionCopy('sxRefundedChef', 'en-CA', facts).message).toContain('You were refunded $28.75');
  });
});
