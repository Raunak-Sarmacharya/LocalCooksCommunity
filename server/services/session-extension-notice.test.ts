import { describe, expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ db: {} }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
import { ensureServerI18n } from '../i18n';
import { sessionExtensionAudiences, sessionExtensionCopy } from './session-extension-notice';

const facts = { chef: 'Maya Chen', kitchen: 'Harbour Kitchen', reference: 'KB-10', end: '4:30 p.m. Newfoundland Time', originalEnd: '3:30 p.m. Newfoundland Time',
  expires: '3:45 p.m. Newfoundland Time', amount: '$28.75', payout: '$27.32', duration: '1 more hour', billed: '30 minutes', stayed: '40 minutes', early: '30 minutes', note: null };

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
});
