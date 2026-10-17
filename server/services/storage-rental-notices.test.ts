import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({ notices: [] as any[], emails: [] as any[], people: [] as any[], rental: null as any }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (value: any) => { state.notices.push(value); } } }));
// The real gate: participants are always allowed; admins only when their toggle is on.
vi.mock('./admin-email-preferences', () => ({ operationalEmailAllowed: (person: any) => person.role !== 'admin' || person.adminEmailNotifications }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://example.invalid' }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async (_id: number, role: string) => role === 'chef' ? 'Maya Chen' : 'Dana Manager' }));
vi.mock('../email', () => ({ renderTransactionalEmail: ({ to, subject, message }: any) => ({ to, subject, text: message, html: `<p>${message}</p>` }) }));

import { storageNoticeAudiences, storageAdminKind, queueStorageRentalNotice, type StorageNoticeEvent, type StorageNoticeFacts } from './storage-rental-notices';

const name = (table: any) => table[Symbol.for('drizzle:Name')];
const dialect = new PgDialect();
function tx() {
  return {
    select: () => {
      let table = '', condition: any;
      const chain: any = {
        from: (value: any) => { table = name(value); return chain; },
        innerJoin: () => chain, leftJoin: () => chain, orderBy: () => chain,
        where: (value: any) => { condition = value; return chain; }, limit: () => chain,
        then: (resolve: any) => {
          if (table === 'users') {
            const { params } = dialect.sqlToQuery(condition);
            return resolve(state.people.filter((person: any) => params.includes(person.id) || params.includes(person.role)));
          }
          return resolve([state.rental]);
        },
      };
      return chain;
    },
    insert: () => ({ values: async (value: any) => { state.emails.push(value); } }),
  } as any;
}

const facts: StorageNoticeFacts = { eventKey: 'fixture', listingName: 'Shelf 2', unitLabel: 'Shelf 2',
  startOn: '2026-10-20', endOn: '2026-10-27', paidThrough: '2026-10-27', deadline: new Date('2026-10-17T18:00:00Z'),
  amountCents: 3000, dailyCents: 1000, days: 7, photos: 2, reference: 'SB-X1' };

beforeEach(() => {
  state.notices = []; state.emails = [];
  state.rental = { rental: { id: 5, chefId: 5, storageListingId: 9, referenceCode: 'SB-X1' },
    listingName: 'Shelf 2', kitchenName: 'Harbour Kitchen', managerId: 2, timezone: 'America/St_Johns' };
  state.people = [
    { id: 5, role: 'chef', username: 'chef@example.test', preferredLocale: 'en-CA', adminEmailNotifications: false },
    { id: 2, role: 'manager', username: 'manager@example.test', preferredLocale: 'en-CA', adminEmailNotifications: false },
    { id: 1, role: 'admin', username: 'admin@example.test', preferredLocale: 'en-CA', adminEmailNotifications: true },
    { id: 4, role: 'admin', username: 'off-admin@example.test', preferredLocale: 'en-CA', adminEmailNotifications: false },
  ];
});

const locale = (value: string) => { for (const person of state.people) person.preferredLocale = value; };
const notice = (userId: number) => state.notices.find(row => row.userId === userId);
const email = (userId: number) => state.emails.find(row => row.recipientUserId === userId);

describe('storage notice routing', () => {
  it('sends each event to the readers the WP-ST3 table names', () => {
    expect(storageNoticeAudiences('requested')).toEqual(['chef', 'manager', 'admins']);
    expect(storageNoticeAudiences('approved')).toEqual(['chef', 'admins']);
    expect(storageNoticeAudiences('declined')).toEqual(['chef']);
    expect(storageNoticeAudiences('moved_in')).toEqual(['manager']);
    expect(storageNoticeAudiences('holdover_charge')).toEqual(['chef', 'admins']);
    expect(storageNoticeAudiences('payout_scheduled')).toEqual(['manager']);
    expect(storageNoticeAudiences('kitchen_debt')).toEqual(['manager', 'admins']);
    expect(storageNoticeAudiences('offer_extension')).toEqual(['chef']);
  });
  it('only tracks money and legal events for Local Cooks', () => {
    expect(storageAdminKind('requested')).toBe('storage_requested');
    expect(storageAdminKind('extended')).toBe('storage_extension_paid');
    expect(storageAdminKind('final_notice')).toBe('storage_removal_review');
    expect(storageAdminKind('ending')).toBeUndefined();
    expect(storageAdminKind('move_in_due')).toBeUndefined();
  });
});

describe('per-reader wording', () => {
  it('addresses the chef and the kitchen in English with the rental timezone and CAD amounts', async () => {
    await queueStorageRentalNotice(tx(), 5, 'requested', facts);
    expect(notice(5)).toMatchObject({ target: 'chef', actionUrl: '/storage/5' });
    expect(notice(5)!.title).toBe('Request sent · Harbour Kitchen');
    expect(notice(5)!.message).toBe('Your card is on hold for $30.00. Harbour Kitchen answers by Oct 17, 2026, 3:30 p.m.');
    expect(notice(2)).toMatchObject({ target: 'manager', actionUrl: '/manager/storage/5' });
    expect(notice(2)!.title).toBe('Maya Chen wants storage · Shelf 2');
    expect(notice(2)!.message).toBe('Maya Chen asked for Shelf 2 Oct 20, 2026–Oct 27, 2026. Answer by Oct 17, 2026, 3:30 p.m.');
  });
  it('shows the chef the approved unit and charge, and gives Local Cooks a factual summary', async () => {
    await queueStorageRentalNotice(tx(), 5, 'approved', facts);
    expect(notice(5)!.message).toBe('Shelf 2 at Harbour Kitchen. Starts Oct 20, 2026. Your card was charged $30.00.');
    expect(notice(1)).toMatchObject({ target: 'manager', actionUrl: '/admin?section=storage-rentals&rental=5' });
    expect(notice(1)!.message).toContain('Maya Chen at Harbour Kitchen · Shelf 2 · SB-X1');
    expect(notice(1)!.message).toContain("The kitchen accepted and the chef's card was charged $30.00.");
  });
  it('words the end-of-term payout for the kitchen and the admin', async () => {
    await queueStorageRentalNotice(tx(), 5, 'payout_scheduled', { ...facts, eventKey: 'term1', payoutDate: '2026-10-28', amountCents: 6792 });
    expect(notice(5)).toBeUndefined();
    expect(notice(2)!.title).toBe('You’ll be paid $67.92');
    expect(notice(2)!.message).toBe('You’ll be paid $67.92 on Oct 28, 2026 for Maya Chen’s storage Oct 20, 2026–Oct 27, 2026.');
  });
  it.each(['fr-CA', 'uk'])('renders every reader in %s without raw keys or placeholders', async (value) => {
    locale(value);
    const events: StorageNoticeEvent[] = ['requested', 'approved', 'declined', 'expired', 'withdrawn', 'authorization_lapsed', 'move_in_due', 'moved_in', 'ending',
      'extended', 'grace_started', 'holdover_started', 'holdover_charge', 'reclaim', 'move_out_requested', 'cleared',
      'auto_cleared', 'reopened', 'removal_review', 'final_notice', 'refund_issued', 'payout_scheduled', 'payout_released',
      'payout_on_hold', 'kitchen_debt', 'offer_extension'];
    for (const event of events) await queueStorageRentalNotice(tx(), 5, event, facts);
    expect(state.notices.length).toBeGreaterThan(events.length);
    for (const row of state.notices) expect(row.message).not.toMatch(/st[A-Z]\w*_|\{[a-zA-Z]+\}/);
    // The chef reads the kitchen's name and the amount; the kitchen reads the chef's name.
    expect(notice(5)!.message).toContain('Harbour Kitchen');
    expect(notice(5)!.message).toContain('30,00');
    expect(notice(2)!.message).toContain('Maya Chen');
  });
  it('keeps support details admin-only and limits a platform-funded refund to chef/admin readers', async () => {
    await queueStorageRentalNotice(tx(), 5, 'support_flag', { ...facts, message: 'Respond to the dispute in Stripe. The kitchen is still paid.' });
    expect(state.notices.map(row => row.userId).sort()).toEqual([1, 4]);
    expect(notice(1)!.message).toContain('The kitchen is still paid');
    state.notices = []; state.emails = [];
    await queueStorageRentalNotice(tx(), 5, 'refund_issued', { ...facts, only: ['chef', 'admins'] });
    expect(state.notices.map(row => row.userId).sort()).toEqual([1, 4, 5]);
    expect(state.emails.map(row => row.recipientUserId).sort()).toEqual([1, 5]);
  });
  it('routes the overdue payout alert to every admin, emailing only opted-in admins', async () => {
    await queueStorageRentalNotice(tx(), 5, 'payout_overdue', { ...facts, holdReason: 'Unpaid 10 days after its eligible date.' });
    expect(state.notices.map(row => row.userId).sort()).toEqual([1, 4]);
    expect(state.emails.map(row => row.recipientUserId)).toEqual([1]);
    expect(notice(1)!.message).toContain('10 days');
  });
  it('reads naturally on the last paid day, when no extension length is suggested', async () => {
    await queueStorageRentalNotice(tx(), 5, 'ending', { ...facts, eventKey: 'd0', days: 0, amountCents: 1000 });
    expect(notice(5)!.message).toBe('Extend now · $10.00.');
  });
  it('keeps the kitchen’s offer of more days with the price in the chef’s language', async () => {
    await queueStorageRentalNotice(tx(), 5, 'offer_extension', { ...facts, days: 14, amountCents: 14000 });
    expect(notice(5)!.message).toBe('Harbour Kitchen offers 14 more days for $140.00. Extend to keep your items.');
    expect(state.notices.some(row => row.userId === 2)).toBe(false);
  });
});

describe('email gates', () => {
  it('emails participants and only the admins with the operational toggle on', async () => {
    await queueStorageRentalNotice(tx(), 5, 'requested', facts);
    expect(state.emails.map(row => row.recipientUserId).sort()).toEqual([1, 2, 5]);
    expect(state.emails.find(row => row.recipientUserId === 1)).toMatchObject({ recipientRole: 'admin', category: 'lifecycle_outcome', status: 'queued' });
    expect(state.emails.find(row => row.recipientUserId === 1)!.trackingId).toBe('storage-rental:5:requested:fixture:1');
    // The opted-out admin still gets the in-app bell alert.
    expect(notice(4)).toBeDefined();
    expect(email(4)).toBeUndefined();
  });
});

describe('no Stripe identifiers', () => {
  it('never leaks pi_/ch_/tr_/cs_ references into any notice or email', async () => {
    const events: StorageNoticeEvent[] = ['requested', 'approved', 'declined', 'expired', 'withdrawn', 'authorization_lapsed', 'move_in_due', 'moved_in', 'ending',
      'extended', 'grace_started', 'holdover_started', 'holdover_charge', 'reclaim', 'move_out_requested', 'cleared',
      'auto_cleared', 'reopened', 'removal_review', 'final_notice', 'refund_issued', 'payout_scheduled', 'payout_released',
      'payout_on_hold', 'kitchen_debt', 'offer_extension'];
    for (const event of events) await queueStorageRentalNotice(tx(), 5, event, facts);
    const rendered = [...state.notices.flatMap(row => [row.title, row.message]),
      ...state.emails.flatMap(row => [row.subject, row.textBody, row.htmlBody])];
    for (const text of rendered) expect(String(text)).not.toMatch(/pi_|ch_|tr_|cs_/);
  });
});

it('says when a move-out cleared automatically, without claiming the kitchen inspected it', async () => {
  await queueStorageRentalNotice(tx(), 5, 'auto_cleared', { ...facts, date: '2026-10-27' });
  expect(notice(5)?.message).toContain('ended on Oct 27, 2026');
  expect(notice(2)?.message).toContain('cleared automatically');
});
