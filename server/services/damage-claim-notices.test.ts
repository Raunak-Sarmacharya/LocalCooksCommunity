import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ notices: [] as any[], emails: [] as any[] }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Sam' }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (value: any) => { state.notices.push(value); } } }));
vi.mock('./admin-email-preferences', () => ({ operationalEmailAllowed: () => true }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://example.invalid' }));
import { queueDamageClaimNotice } from './damage-claim-notices';
const people = [{ id: 2, role: 'manager', username: 'manager@example.invalid', preferredLocale: 'en-CA' },
  { id: 5, role: 'chef', username: 'chef@example.invalid', preferredLocale: 'en-CA' },
  { id: 99, role: 'admin', username: 'staff@example.invalid', preferredLocale: 'uk' }];
const tx: any = { select: () => ({ from: () => ({ where: async (query: any) => {
  const { params } = new PgDialect().sqlToQuery(query);
  return people.filter(person => params.includes(person.id) || params.includes(person.role));
} }) }), insert: () => ({ values: async (value: any) => { state.emails.push(value); } }) };
const claim = (status: string, visible = false) => ({ id: 1, status, claimVersion: 2, chefId: 5, managerId: 2, kitchenBookingId: 7,
  chefVisibleAt: visible ? new Date() : null, claimedAmountCents: 2000, finalAmountCents: 1500,
  chefResponseDeadline: new Date('2026-10-17T18:00:00Z'), visitEvidence: { kitchenName: 'Maya’s kitchen', timezone: 'America/St_Johns' } } as any);
const history = (action: string) => ({ id: 1, action, metadata: { publicMessage: 'We reviewed the receipts.' } } as any);
beforeEach(() => { state.notices = []; state.emails = []; people[0].preferredLocale = 'en-CA'; people[1].preferredLocale = 'en-CA'; people[2].preferredLocale = 'uk'; });
describe('claim recipient privacy and notices', () => {
  it('alerts kitchen + admins, never the chef, for first review', async () => {
    await queueDamageClaimNotice(tx, claim('in_review'), history('submitted'));
    expect(state.notices.map(item => item.userId).sort()).toEqual([2, 99]);
    expect(state.emails.map(item => item.recipientUserId).sort()).toEqual([99]);
    expect(state.notices[0].message).toContain('2 business days');
    expect(state.notices[1].actionUrl).toBe('/admin?section=booking-support&booking=7');
  });
  it.each(['awaiting_kitchen', 'resolved'])('first-stage %s never contacts the chef', async status => {
    await queueDamageClaimNotice(tx, claim(status), history(status === 'resolved' ? 'claim_close' : 'claim_ask_info'));
    expect(state.notices.map(item => item.userId)).toEqual([2]); expect(state.emails.map(item => item.recipientUserId)).toEqual([2]);
  });
  it('only an approved visible claim reaches both people, with a kitchen-local 12-hour deadline', async () => {
    await queueDamageClaimNotice(tx, claim('submitted', true), history('claim_send'));
    expect(state.notices.map(item => item.userId)).toEqual([2, 5]); expect(state.notices[0].message).toMatch(/3:30\s?p\.m\./);
    expect(state.notices[1].message).toContain('reported damage or extra cleaning: $15.00. Pay or dispute by'); expect(state.notices[1].message).not.toContain('dcV2');
    expect(state.notices[0].message).not.toContain('internal');
  });
});


describe('final decision reason reaches the chef', () => {
  it('includes the shared decision message in the chef notice and email, as the kitchen gets it', async () => {
    await queueDamageClaimNotice(tx, claim('partially_approved', true), history('claim_reduce'));
    for (const id of [2, 5]) {
      expect(state.notices.find(row => row.userId === id)?.message).toContain('We reviewed the receipts.');
      expect(state.emails.find(row => row.recipientUserId === id)?.textBody).toContain('We reviewed the receipts.');
    }
  });
});

describe('recipient-specific claim outcomes in app and email', () => {
  it.each([
    ['claim_send', 'submitted', [2, 5], 'Local Cooks sent your claim to Sam for $15.00 (of $20.00 requested).', 'reported damage or extra cleaning: $15.00'],
    ['claim_ask_info', 'awaiting_kitchen', [2], 'Local Cooks needs more information about your claim: “We reviewed the receipts.”', null],
    ['chef_paid', 'charge_succeeded', [5], null, 'You paid $15.00. This claim is closed.'],
    ['kitchen_paid', 'charge_succeeded', [2], 'Sam paid your $15.00 claim. It’s on its way to your bank.', null],
    ['claim_reject', 'rejected', [2, 5], 'Local Cooks closed your claim', 'Local Cooks closed this claim — nothing to pay.'],
    ['claim_close', 'resolved', [2, 5], 'Local Cooks closed your claim', 'Local Cooks closed this claim — nothing to pay.'],
  ] as const)('%s addresses only its intended recipients', async (action, status, ids, kitchenText, chefText) => {
    await queueDamageClaimNotice(tx, claim(status, true), history(action));
    expect(state.notices.map(row => row.userId)).toEqual(ids);
    expect(state.emails.map(row => row.recipientUserId)).toEqual(ids);
    for (const [id, wording] of [[2, kitchenText], [5, chefText]] as const) {
      if (!wording) continue;
      expect(state.notices.find(row => row.userId === id)?.message).toContain(wording);
      expect(state.emails.find(row => row.recipientUserId === id)?.textBody).toContain(wording);
    }
    const chefCopy = state.notices.filter(row => row.userId === 5).map(row => row.message).join(' ');
    expect(chefCopy).not.toMatch(/on its way|your bank|Your booking payout|We reviewed the receipts|from the kitchen|The chef|new-booking pause/);
  });
  it('confirms Local Cooks funding only to the kitchen after the transfer', async () => {
    await queueDamageClaimNotice(tx, { ...claim('resolved', true), fundedBy: 'local_cooks' }, history('kitchen_paid'));
    expect(state.notices.map(row => row.userId)).toEqual([2]);
    expect(state.notices[0].message).toBe('Local Cooks paid your $15.00 claim. It’s on its way to your bank.');
    expect(state.emails[0].textBody).toContain(state.notices[0].message);
  });
  it.each(['en-CA', 'fr-CA', 'uk'])('renders every participant event without missing keys (%s)', async locale => {
    for (const person of people) person.preferredLocale = locale;
    for (const [action, status] of [['submitted','in_review'], ['claim_ask_info','awaiting_kitchen'], ['claim_send','submitted'], ['chef_disputed','under_review'],
      ['claim_uphold','approved'], ['claim_reject','rejected'], ['claim_withdrawn','resolved'], ['claim_compensate','resolved'], ['chef_paid','charge_succeeded'],
      ['kitchen_paid','charge_succeeded'], ['booking_hold_started','approved'], ['claim_release_hold','approved']]) {
      await queueDamageClaimNotice(tx, claim(status, true), history(action));
    }
    for (const row of state.notices) expect(row.message).not.toMatch(/dcV2|\{\w+\}/);
  });
});

it('a visible claim written off by Local Cooks closes only the chef debt; kitchen hears when funded', async () => {
  await queueDamageClaimNotice(tx, { ...claim('resolved', true), fundedBy: 'local_cooks', chefOwes: false }, history('claim_compensate'));
  expect(state.notices.map(row => row.userId)).toEqual([5]);
  expect(state.notices[0].message).toContain('nothing to pay');
  expect(state.notices[0].message).not.toMatch(/kitchen|bank|Local Cooks paid/);
  state.notices = []; state.emails = [];
  await queueDamageClaimNotice(tx, { ...claim('approved', true), fundedBy: 'local_cooks', chefOwes: true }, history('claim_compensate'));
  expect(state.notices).toEqual([]);
});

it('routes storage claim notices to the rental, retaining first-review privacy', async () => {
  await queueDamageClaimNotice(tx, { ...claim('in_review'), kitchenBookingId: null, storageBookingId: 7 }, history('submitted'));
  expect(state.notices.map(row => row.userId)).toEqual([2, 99]);
  expect(state.notices.find(row => row.userId === 2)?.actionUrl).toBe('/manager/storage/7');
  expect(state.notices.find(row => row.userId === 99)?.actionUrl).toBe('/admin?section=storage-rentals&rental=7');
  state.notices = []; state.emails = [];
  await queueDamageClaimNotice(tx, { ...claim('submitted', true), kitchenBookingId: null, storageBookingId: 7 }, history('claim_send'));
  expect(state.notices.find(row => row.userId === 5)?.actionUrl).toBe('/storage/7');
});
