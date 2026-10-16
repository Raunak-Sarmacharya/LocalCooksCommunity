import { describe, expect, it, vi } from 'vitest';
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: async () => ({ checkinWindowMinutesBefore: 15 }) }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn(async () => {}) } }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Sam Chef' }));
import { canReportProblem } from './commitment-problems';
import { reminderVisitTimes } from './advance-reminders';
import type { kitchenBookings } from '@shared/schema';

describe('participant reporting opens at check-in opening without an end cutoff', () => {
  const start = new Date('2026-10-04T12:00:00Z');
  const context = { chefId: 3, managerId: 2, wasConfirmed: true, scheduledStart: start, checkinWindowMinutesBefore: 15 };
  it('denies before check-in opening, permits exact opening and afterwards for only the two participant roles', () => {
    const clock = vi.spyOn(Date, 'now');
    try {
      for (const actor of [{ id: 3, role: 'chef' }, { id: 2, role: 'manager' }]) {
        clock.mockReturnValue(start.getTime() - 15 * 60_000 - 1); expect(canReportProblem(context, actor)).toBe(false);
        clock.mockReturnValue(start.getTime() - 15 * 60_000); expect(canReportProblem(context, actor)).toBe(true);
        clock.mockReturnValue(start.getTime() + 365 * 86400000); expect(canReportProblem(context, actor)).toBe(true);
      }
      for (const actor of [{ id: 4, role: 'chef' }, { id: 1, role: 'admin' }, { id: 3, role: 'manager' }, { id: 2, role: 'chef' }]) {
        expect(canReportProblem(context, actor)).toBe(false);
      }
      expect(canReportProblem({ ...context, wasConfirmed: false }, { id: 3, role: 'chef' })).toBe(false);
      expect(canReportProblem({ ...context, scheduledStart: null }, { id: 3, role: 'chef' })).toBe(false);
      expect(canReportProblem({ ...context, scheduledStart: new Date(NaN) }, { id: 3, role: 'chef' })).toBe(false);
      expect(canReportProblem(undefined, { id: 3, role: 'chef' })).toBe(false);
    } finally { clock.mockRestore(); }
  });
  it('uses the first legacy visit and the location operating day for overnight bookings', () => {
    const booking = { bookingDate: new Date('2026-10-04T12:00:00Z'), startTime: '23:00', endTime: '03:00',
      operatingWindowStartTime: '18:00', selectedSlots: ['02:00', '23:00'] } as typeof kitchenBookings.$inferSelect;
    const visits = reminderVisitTimes(booking, 'America/St_Johns');
    expect(visits.map(visit => visit.start.toISOString())).toEqual(['2026-10-05T01:30:00.000Z', '2026-10-05T04:30:00.000Z']);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-05T03:00:00Z'));
    try { expect(canReportProblem({ ...context, scheduledStart: visits[0].start }, { id: 3, role: 'chef' })).toBe(true); }
    finally { clock.mockRestore(); }
  });
});

describe('problem category', () => {
  it.each(['equipment', 'safety', 'access'] as const)('queues a useful %s report email per reader: reporter, kitchen, Local Cooks', async category => {
    const { createProblem } = await import('./commitment-problems');
    const emails: any[] = [];
    const booking = { id: 10, referenceCode: 'KB-TEST10', chefId: 3, kitchenId: 4, status: 'confirmed', bookingDate: new Date('2026-10-04'), startTime: '09:00', endTime: '12:00' };
    const tx: any = {
      execute: vi.fn(async () => {}),
      select: () => {
        let table = '';
        const q: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return q; },
          innerJoin: () => q, where: () => q, limit: () => q,
          then: (resolve: any) => resolve(table === 'kitchen_bookings' ? [{ booking, managerId: 2, timezone: 'America/St_Johns', kitchenName: 'Harbour Kitchen' }]
            : table === 'users' ? [{ id: 3, username: 'chef@example.test', role: 'chef' }, ...(category === 'access' ? [{ id: 2, username: 'kitchen@example.test', role: 'manager' }, { id: 1, username: 'staff@example.test', role: 'admin', adminEmailNotifications: true }] : [])] : []) };
        return q;
      },
      insert: (table: any) => ({ values: (value: any) => {
        if (table[Symbol.for('drizzle:Name')] === 'email_logs') { emails.push(value); return Promise.resolve(); }
        return { returning: async () => [{ ...value, id: 9, revision: 1, status: 'reported', createdAt: new Date('2026-10-04T12:10:00Z') }] };
      } }),
    };
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:30:00Z'));
    try {
      await createProblem(tx, { kind: 'live', commitment: 'booking', id: 10, actor: { id: 3, role: 'chef' },
        description: 'The cooler stopped working.', category, sourceKey: 'test-report' });
      expect(emails).toHaveLength(category === 'access' ? 3 : 1);
      if (category === 'access') expect(emails.map(row => row.recipientRole)).toEqual(['chef', 'manager', 'admin']);
      // The reporter: what was sent, to whom, when (kitchen-local, with the zone), under the booking's real reference.
      expect(emails[0].subject).toBe('Report sent · KB-TEST10');
      expect(emails[0].textBody).toContain('We sent your report to Harbour Kitchen and Local Cooks');
      expect(emails[0].textBody).toContain('Newfoundland Time');
      expect(emails[0].textBody).toContain('9:40');
      expect(emails[0].textBody).toContain('Reference: KB-TEST10');
      expect(emails[0].textBody).toContain('/booking/10');
      expect(emails[0].textBody).not.toMatch(/KB-10|#10/);
      if (category === 'access') {
        // The kitchen: who, that they're at the door now, and what to do.
        expect(emails[1].subject).toBe('Sam Chef can’t get in · KB-TEST10');
        expect(emails[1].textBody).toContain('The cooler stopped working.');
        expect(emails[1].textBody).toContain('They’re trying to get in for their 9:00 a.m. booking. Let them in or message them now.');
        expect(emails[1].textBody).toContain('/manager/booking/10');
        expect(emails[2].subject).toBe('Access problem · Sam Chef at Harbour Kitchen · KB-TEST10');
      }
    } finally { vi.useRealTimers(); }
  });
  it('accepts the five categories, treats absence as null and rejects anything else', async () => {
    const { parseProblemCategory, problemCategories, problemCategoryLabel } = await import('@shared/commitment-problems');
    expect(problemCategories).toEqual(['safety', 'access', 'equipment', 'cleanliness', 'other']);
    for (const category of problemCategories) expect(parseProblemCategory(category)).toBe(category);
    for (const absent of [undefined, null, '']) expect(parseProblemCategory(absent)).toBeNull();
    for (const bad of ['Safety', 'fire', 7, {}, ['safety']]) expect(parseProblemCategory(bad)).toBeUndefined();
    expect(problemCategoryLabel('safety')).toBe('Safety');
    expect(problemCategoryLabel(null)).toBe('');
  });
  it('rejects an invalid category before touching the database', async () => {
    const { reportProblem } = await import('./commitment-problems');
    await expect(reportProblem('booking', 1, { id: 3, role: 'chef' }, 'The cooler stopped working', 'retry-key-0123456789', 'bogus'))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('category') });
  });
});
