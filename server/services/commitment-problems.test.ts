import { describe, expect, it, vi } from 'vitest';
import { canReportProblem } from './commitment-problems';
import { reminderVisitTimes } from './advance-reminders';
import type { kitchenBookings } from '@shared/schema';

describe('participant reporting opens at the scheduled start without an end cutoff', () => {
  const start = new Date('2026-10-04T12:00:00Z');
  const context = { chefId: 3, managerId: 2, wasConfirmed: true, scheduledStart: start };
  it('denies before start, permits the exact start and afterwards for only the two participant roles', () => {
    const clock = vi.spyOn(Date, 'now');
    try {
      for (const actor of [{ id: 3, role: 'chef' }, { id: 2, role: 'manager' }]) {
        clock.mockReturnValue(start.getTime() - 1); expect(canReportProblem(context, actor)).toBe(false);
        clock.mockReturnValue(start.getTime()); expect(canReportProblem(context, actor)).toBe(true);
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
