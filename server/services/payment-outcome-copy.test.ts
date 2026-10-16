import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ notices: [] as any[], emails: [] as any[] }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn(async (notice: any) => { state.notices.push(notice); }) } }));
vi.mock('./admin-email-preferences', () => ({ operationalEmailAllowed: () => true, operationalEmailAllowedForUser: () => true, adminEmailAllowedForUser: () => true }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn(async () => 'TestSprite chef') }));
vi.mock('../config', () => ({ getAppBaseUrl: (app: string) => `https://${app}.example` }));
import { queuePaymentOutcome } from './outcome-delivery';

const people = [{ id: 380, role: 'chef', username: 'chef@example.test' }, { id: 379, role: 'manager', username: 'kitchen@example.test' }];
const tx: any = {
  select: () => ({ from: () => ({ where: async () => people }) }),
  execute: async () => ({ rows: [{ id: 183, reference_code: 'KB-X7QBRV', kitchen_name: 'PHASE0 Main Kitchen' }] }),
  insert: () => ({ values: async (row: any) => { state.emails.push(row); } }),
};
const record = { id: 153, chef_id: 380, manager_id: 379, booking_id: 183, booking_type: 'kitchen', currency: 'CAD', amount: '3050',
  refund_amount: '500', status: 'partially_refunded', payment_intent_id: 'pi_x', refund_id: 're_x' };

beforeEach(() => { state.notices = []; state.emails = []; });
describe('a kitchen refund reads like a person wrote it (live #183: "Payment #153: partially refunded … Provider payment reference")', () => {
  it('chef and kitchen get plain role copy with the amount, reference and the kitchen note; no ledger ids', async () => {
    await queuePaymentOutcome(tx, 1, { ...record, refundDeltaCents: 500, refundNote: 'Sorry — the walk-in cooler is down this week.' });
    const chef = state.notices.find(notice => notice.userId === 380), kitchen = state.notices.find(notice => notice.userId === 379);
    expect(chef).toMatchObject({ title: 'PHASE0 Main Kitchen refunded you $5.00 · KB-X7QBRV', actionUrl: '/booking/183' });
    expect(chef.message).toBe('PHASE0 Main Kitchen sent you a refund of $5.00 for booking KB-X7QBRV. Note from the kitchen: "Sorry — the walk-in cooler is down this week." Banks usually show it within 5–10 business days.');
    expect(kitchen).toMatchObject({ title: 'You refunded TestSprite chef $5.00 · KB-X7QBRV', actionUrl: '/manager/booking/183' });
    for (const text of [...state.notices.map(notice => notice.message), ...state.emails.map(email => email.textBody)]) expect(text).not.toMatch(/pi_|re_|Provider payment reference/);
  });
  it('the default reason is not shown as a note', async () => {
    await queuePaymentOutcome(tx, 1, { ...record, refundDeltaCents: 500, refundNote: 'Refund sent by the kitchen' });
    expect(state.notices.find(notice => notice.userId === 380).message).not.toContain('Note from the kitchen');
  });
  it('anything that is not a completed kitchen-booking refund keeps the ledger wording', async () => {
    await queuePaymentOutcome(tx, 1, { ...record, status: 'failed' });
    expect(state.notices[0].title).toBe('Payment #153: failed');
  });
});
