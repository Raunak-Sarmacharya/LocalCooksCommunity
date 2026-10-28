import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { kitchenBookingChanges, kitchenBookings, kitchens, locations, users } from '@shared/schema';
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Reminders for the kitchen to answer: a new request, and (owner, Oct 28) a customer's request to change a confirmed booking. */
export async function currentManagerDecisionReminders(tx: Tx, id: number, now: Date): Promise<Reminder[]> {
  const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, id)).limit(1);
  if (!row?.location.managerId) return [];
  return [...await requestReminders(tx, id, now, row), ...await changeReminders(tx, id, now, row)];
}

type DecisionRow = { booking: typeof kitchenBookings.$inferSelect; kitchen: typeof kitchens.$inferSelect; location: typeof locations.$inferSelect };

/** Same 12 h / 2 h timing as a new request, before the kitchen's answer deadline; the change keeps its own resource per request. */
async function changeReminders(tx: Tx, id: number, now: Date, row: DecisionRow): Promise<Reminder[]> {
  if (row.booking.status !== 'confirmed') return [];
  const [change] = await tx.select().from(kitchenBookingChanges)
    .where(and(eq(kitchenBookingChanges.bookingId, id), eq(kitchenBookingChanges.state, 'requested'))).limit(1);
  if (!change || now >= change.decisionBy) return [];
  const timing = await getLifecycleSettings(tx);
  const timezone = row.location.timezone || DEFAULT_TIMEZONE;
  const [manager] = await tx.select().from(users).where(eq(users.id, row.location.managerId!)).limit(1);
  const chef = row.booking.chefId ? await getUserDisplayName(row.booking.chefId, 'chef', tx) : 'The customer';
  const deadlineText = emailLocalDateTimeSentence(change.decisionBy, timezone);
  const reference = row.booking.referenceCode || `#${id}`;
  const title = `Reminder: answer ${chef}'s change request by ${deadlineText}`;
  const message = `${chef} asked to change ${reference} at ${row.kitchen.name}. If you don't answer by ${deadlineText}, the request expires and the booking stays as it is.`;
  const start = (await import('@shared/booking-response-deadline')).bookingFirstStart(row.booking, timezone);
  return managerDecisionDueTimes(change.createdAt, change.decisionBy, [timing.managerDecisionFirstReminderHours, timing.managerDecisionFinalReminderHours])
    .map(({ index, due }) => ({ source: 'manager_decision', reservationId: id, resource: `booking-${id}-change-${change.id}-${index}`,
      kind: 'manager_decision', recipientId: row.location.managerId!, role: 'manager', email: manager?.username || '', timezone,
      start: start.toISOString(), end: change.decisionBy.toISOString(), due: due.toISOString(),
      revision: createHash('sha256').update(JSON.stringify([change.id, change.createdAt, change.decisionBy, index, manager?.id, manager?.username])).digest('hex'),
      path: `/manager/booking/${id}`, title, message, shortVisit: false }));
}

async function requestReminders(tx: Tx, id: number, now: Date, row: DecisionRow): Promise<Reminder[]> {
  if (row.booking.status !== 'pending' || row.booking.paymentStatus !== 'authorized' || row.booking.paymentDecision || !row.location.managerId
    // Waiting for the chef's answer to the kitchen's new total: nothing is left for the kitchen to do.
    || (row.booking.partialAcceptance as { state?: string } | null)?.state === 'waiting') return [];
  const timing = await getLifecycleSettings(tx);
  const timezone = row.location.timezone || DEFAULT_TIMEZONE;
  const deadline = responseDeadlineForBooking(row.booking, timezone, timing.managerResponseBufferHours);
  if (now >= deadline) return [];
  const [manager] = await tx.select().from(users).where(eq(users.id, row.location.managerId)).limit(1);
  const chef = row.booking.chefId ? await getUserDisplayName(row.booking.chefId, 'chef', tx) : 'The customer';
  const start = (await import('@shared/booking-response-deadline')).bookingFirstStart(row.booking, timezone);
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
