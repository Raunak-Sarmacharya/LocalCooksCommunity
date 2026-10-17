import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { kitchenBookings, kitchens, locations, users } from '@shared/schema';
import { responseDeadlineForBooking, MIN_RESPONSE_MINUTES } from '@shared/booking-response-deadline';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { emailLocalDateTimeSentence } from '../email';
import { db } from '../db';
import { getLifecycleSettings } from './lifecycle-settings';
import { getUserDisplayName } from '../utils/user-display';
import type { Reminder } from './advance-reminders';

export function managerDecisionDueTimes(createdAt: Date, deadline: Date, offsets = [12, 2]) {
  return offsets.map((hours, index) => ({ index, due: new Date(deadline.getTime() - hours * 3_600_000) }))
    .filter(({ due }) => due.getTime() >= createdAt.getTime() + MIN_RESPONSE_MINUTES * 60_000);
}

export async function currentManagerDecisionReminders(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: number, now: Date): Promise<Reminder[]> {
  const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, id)).limit(1);
  if (!row || row.booking.status !== 'pending' || row.booking.paymentStatus !== 'authorized' || row.booking.paymentDecision || !row.location.managerId
    // Waiting for the chef's answer to the kitchen's new total: nothing is left for the kitchen to do.
    || (row.booking.partialAcceptance as { state?: string } | null)?.state === 'waiting') return [];
  const timing = await getLifecycleSettings(tx);
  const timezone = row.location.timezone || DEFAULT_TIMEZONE;
  const deadline = responseDeadlineForBooking(row.booking, timezone, timing.managerResponseBufferHours);
  if (now >= deadline) return [];
  const [manager] = await tx.select().from(users).where(eq(users.id, row.location.managerId)).limit(1);
  const chef = row.booking.chefId ? await getUserDisplayName(row.booking.chefId, 'chef', tx) : 'The chef';
  const start = (await import('@shared/booking-response-deadline')).firstBookingVisitStart(row.booking, timezone);
  const deadlineText = emailLocalDateTimeSentence(deadline, timezone);
  const title = `Reminder: respond to ${chef}'s request by ${deadlineText}`;
  const message = `${chef} asked for ${row.kitchen.name} on ${emailLocalDateTimeSentence(start, timezone)}. If you don't respond by ${deadlineText}, the request expires and their card hold is released.`;
  return managerDecisionDueTimes(row.booking.createdAt, deadline, [timing.managerDecisionFirstReminderHours, timing.managerDecisionFinalReminderHours])
    .map(({ index, due }) => ({ source: 'manager_decision', reservationId: id, resource: `booking-${id}-decision-${index}`,
      kind: 'manager_decision', recipientId: row.location.managerId!, role: 'manager', email: manager?.username || '', timezone,
      start: start.toISOString(), end: deadline.toISOString(), due: due.toISOString(),
      revision: createHash('sha256').update(JSON.stringify([row.booking.createdAt, start, deadline, index, manager?.id, manager?.username])).digest('hex'),
      path: `/manager/booking/${id}`, title, message, shortVisit: false }));
}
