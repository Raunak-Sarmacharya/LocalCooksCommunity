import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ notices: [] as any[], emails: [] as any[] }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (value: any) => { state.notices.push(value); } } }));
vi.mock('./admin-email-preferences', () => ({ operationalEmailAllowed: () => true }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://example.invalid' }));
import { queueDamageClaimNotice } from './damage-claim-notices';
const people = [{ id: 2, role: 'manager', username: 'manager@example.invalid', preferredLocale: 'en-CA' },
  { id: 5, role: 'chef', username: 'chef@example.invalid', preferredLocale: 'fr-CA' },
  { id: 99, role: 'admin', username: 'staff@example.invalid', preferredLocale: 'uk' }];
const tx: any = { select: () => ({ from: () => ({ where: async (query: any) => {
  const { params } = new PgDialect().sqlToQuery(query);
  return people.filter(person => params.includes(person.id) || params.includes(person.role));
} }) }), insert: () => ({ values: async (value: any) => { state.emails.push(value); } }) };
const claim = (status: string, visible = false) => ({ id: 1, status, claimVersion: 2, chefId: 5, managerId: 2, kitchenBookingId: 7,
  chefVisibleAt: visible ? new Date() : null, claimedAmountCents: 2000, finalAmountCents: 1500,
  chefResponseDeadline: new Date('2026-10-17T18:00:00Z'), visitEvidence: { kitchenName: 'Maya’s kitchen', timezone: 'America/St_Johns' } } as any);
const history = (action: string) => ({ id: 1, action, metadata: { publicMessage: 'We reviewed the receipts.' } } as any);
beforeEach(() => { state.notices = []; state.emails = []; });
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
    expect(state.notices[1].message).toContain('Local Cooks'); expect(state.notices[1].message).not.toContain('dcV2');
    expect(state.notices[0].message).not.toContain('internal');
  });
});
