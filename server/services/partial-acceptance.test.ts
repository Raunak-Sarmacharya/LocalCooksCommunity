import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as s from '@shared/schema';
import { partialAcceptanceAllowed, partialAcceptanceDeadlineText, waitingPartialAcceptance, PARTIAL_ACCEPTANCE_MIN_HOURS } from '@shared/partial-acceptance';
import { resolveResponseDeadline } from '@shared/booking-response-deadline';
import { partialAcceptanceNotice, type PartialAcceptanceNotice } from './partial-acceptance-notice';
import { adminBookingNotice } from './admin-booking-notice';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const H = 3_600_000, M = 60_000;
const now = new Date('2026-10-20T12:00:00Z');
/** The proposal deadline the server computes: the request rule measured from the proposal (24 h, 1 h before the refund deadline). */
const deadlineFor = (start: Date, freeCancelHours: number | null) => resolveResponseDeadline({ createdAt: now, startAt: start, freeCancelHours });

describe('last-minute guard (owner, Oct 17): under 3 h for the chef to answer, the kitchen accepts everything or declines', () => {
  it('is three hours', () => expect(PARTIAL_ACCEPTANCE_MIN_HOURS).toBe(3));
  it.each([
    ['refund deadline cap: 2 h 59 min left', 24, 24 * H + H + 2 * H + 59 * M, false],
    ['refund deadline cap: exactly 3 h left', 24, 24 * H + H + 3 * H, true],
    ['no free cancellation, 1 h start buffer: 2 h 59 min left', null, H + 2 * H + 59 * M, false],
    ['no free cancellation, 1 h start buffer: exactly 3 h left', null, H + 3 * H, true],
    ['far away: the 24 h window applies', 24, 10 * 24 * H, true],
  ] as const)('%s', (_name, freeCancel, untilStart, allowed) => {
    const start = new Date(now.getTime() + untilStart);
    const deadline = deadlineFor(start, freeCancel);
    expect(partialAcceptanceAllowed(deadline, start, now)).toBe(allowed);
  });
  it('the boundary itself: 2 h 59 min 59 s refused, 3 h 00 min allowed', () => {
    const start = new Date(now.getTime() + 48 * H);
    expect(partialAcceptanceAllowed(new Date(now.getTime() + 3 * H - 1000), start, now)).toBe(false);
    expect(partialAcceptanceAllowed(new Date(now.getTime() + 3 * H), start, now)).toBe(true);
  });
  it('refuses a deadline after the first booked start, however long it is', () => {
    const start = new Date(now.getTime() + 5 * H);
    expect(partialAcceptanceAllowed(new Date(start.getTime() + 1), start, now)).toBe(false);
    expect(partialAcceptanceAllowed(start, start, now)).toBe(true);
  });
});

describe('waiting proposal', () => {
  const proposal = { id: 'p', state: 'waiting' };
  it('is open only while the request is pending on a held card with no decision', () => {
    expect(waitingPartialAcceptance({ partialAcceptance: proposal, status: 'pending', paymentStatus: 'authorized', paymentDecision: null })).toBe(proposal);
    expect(waitingPartialAcceptance({ partialAcceptance: proposal, status: 'cancelled', paymentStatus: 'failed' })).toBeNull();
    expect(waitingPartialAcceptance({ partialAcceptance: proposal, status: 'pending', paymentStatus: 'authorized', paymentDecision: { state: 'pending' } })).toBeNull();
    expect(waitingPartialAcceptance({ partialAcceptance: { ...proposal, state: 'accepted' }, status: 'pending', paymentStatus: 'authorized' })).toBeNull();
  });
});

describe('migration 0102 (executed in PGlite)', () => {
  it('adds the nullable JSONB column idempotently and keeps existing rows NULL', async () => {
    const { client } = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings]);
    try {
      await client.exec('ALTER TABLE kitchen_bookings DROP COLUMN partial_acceptance');
      await client.exec(`INSERT INTO users (id, username, password, role) VALUES (1, 'm@test.invalid', 'x', 'manager'), (2, 'c@test.invalid', 'x', 'chef');
        INSERT INTO locations (id, manager_id, name, address) VALUES (1, 1, 'L', 'A');
        INSERT INTO kitchens (id, location_id, name) VALUES (1, 1, 'K');
        INSERT INTO kitchen_bookings (id, chef_id, kitchen_id, booking_date, start_time, end_time) VALUES (1, 2, 1, '2099-01-01', '10:00', '12:00');`);
      const sql = readFileSync('migrations/0102_partial_acceptance.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      const column = await client.query<{ data_type: string; is_nullable: string }>(
        "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'kitchen_bookings' AND column_name = 'partial_acceptance'");
      expect(column.rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }]);
      expect((await client.query('SELECT partial_acceptance FROM kitchen_bookings WHERE id = 1')).rows).toEqual([{ partial_acceptance: null }]);
      await client.exec(`UPDATE kitchen_bookings SET partial_acceptance = '{"state":"waiting","newTotalCents":1220}' WHERE id = 1`);
      expect((await client.query("SELECT partial_acceptance->>'state' AS state FROM kitchen_bookings")).rows).toEqual([{ state: 'waiting' }]);
    } finally { await client.close(); }
  }, 60_000);
});

describe('partial acceptance notices', () => {
  const notice: PartialAcceptanceNotice = { variant: 'proposed', items: [{ name: 'Mixer' }, { name: 'Oven', date: '2026-10-22' }],
    newCents: 11109, oldCents: 11232, deadlineAt: '2026-10-22T00:30:00Z' };
  const names = { chefName: 'Sam Taylor', kitchenName: 'Harbour Kitchen', timezone: 'America/St_Johns' };
  it('chef: names the kitchen, items, both totals, the exact deadline in the kitchen zone and what happens without an answer', async () => {
    const copy = await partialAcceptanceNotice('chef', 'en-CA', notice, names);
    expect(copy.title).toBe('Accept the new total?');
    expect(copy.message).toBe('Harbour Kitchen can host you, but can’t provide Mixer and Oven (Thu, Oct 22). New total $111.09 (was $112.32). '
      + 'Accept or decline by Wed, Oct 21, 10:00 p.m. Newfoundland Time. Nothing is charged until you accept. '
      + 'If you don’t answer, the request closes and your card hold is released.');
    expect(copy.actionLabel).toBe('Review the new total');
  });
  it('formats the deadline like the owner’s example ("Tue, Oct 21, 9:00 p.m. Newfoundland Time"; Oct 21, 2026 is a Wednesday)', () => {
    expect(partialAcceptanceDeadlineText('2026-10-21T23:30:00Z', 'en-CA', 'America/St_Johns')).toBe('Wed, Oct 21, 9:00 p.m. Newfoundland Time');
  });
  it.each(['en-CA', 'fr-CA', 'uk'])('every variant and side is fully worded (%s)', async locale => {
    for (const variant of ['proposed', 'declined', 'expired'] as const) for (const role of ['chef', 'manager'] as const) {
      if (variant === 'proposed' && role === 'manager') continue;
      const copy = await partialAcceptanceNotice(role, locale, { ...notice, variant }, names);
      expect(copy.title, `${variant}/${role}`).not.toMatch(/^pa[A-Z]|\{\w+\}/);
      expect(copy.message, `${variant}/${role}`).not.toMatch(/^pa[A-Z]|\{\w+\}|undefined|NaN/);
      expect(copy.message).toContain(role === 'chef' ? 'Harbour Kitchen' : 'Sam Taylor');
      if (locale === 'uk') expect(copy.message).toMatch(/[Ѐ-ӿ]/);
    }
  });
  it('kitchen: declined and expired say the request closed and the hold was released', async () => {
    expect((await partialAcceptanceNotice('manager', 'en-CA', { ...notice, variant: 'declined' }, names)).message)
      .toBe('Sam Taylor chose not to book without Mixer and Oven (Thu, Oct 22). The request is closed and their card hold was released.');
    expect((await partialAcceptanceNotice('manager', 'en-CA', { ...notice, variant: 'expired' }, names)).title).toBe('Sam Taylor didn’t answer the new total');
  });
  it('Local Cooks: its own factual line for a declined or unanswered new total', () => {
    const facts = { chef: 'Sam Taylor', kitchen: 'Harbour Kitchen', reference: 'KB-1', when: 'Oct 22, 10:00 a.m.', message: '' };
    expect(adminBookingNotice('cancelled', { ...facts, partialAcceptance: { ...notice, variant: 'declined' } })).toEqual({ title: 'New total declined · Sam Taylor',
      message: 'Sam Taylor at Harbour Kitchen · Oct 22, 10:00 a.m. · KB-1. Harbour Kitchen offered to host without Mixer, Oven for $111.09 (was $112.32); the chef declined. The card hold was released.' });
    expect(adminBookingNotice('cancelled', { ...facts, partialAcceptance: { ...notice, variant: 'expired' } })?.title).toBe('New total not answered · Sam Taylor');
  });
});
