import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, storageOverstayRecords, storageBookings, storageListings, kitchenBookings, kitchenBookingVisits,
  kitchens, locations, users, platformSettings } from '@shared/schema';
import { DEFAULT_TIMEZONE, formatInTimezone } from '@shared/timezone-utils';
import { chefIssuesHref, managerDashboardView } from '@shared/notification-deep-links';
import type { Reminder, ReminderPolicy, ReminderSource } from './advance-reminders';
import { readVisitDuties } from '@shared/visit-duties';
import { lifecycleSettings } from './lifecycle-settings';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Task = { source: ReminderSource; id: number; resource: string; opened: Date; deadline: Date; ownerId: number | null;
  role: 'chef' | 'manager'; timezone: string; path: string; title: string; inspection: boolean };

export function deadlineWarningDue(opened: Date, deadline: Date, leadHours: number) {
  if (!Number.isFinite(leadHours) || leadHours <= 0 || deadline <= opened) throw new Error('Invalid warning window');
  return new Date(Math.max(opened.getTime() + (deadline.getTime() - opened.getTime()) / 2, deadline.getTime() - leadHours * 3600000));
}

/** Only actual existing post-confirmation tasks. No invented qualification or initial approval deadlines. */
export async function currentDeadlineReminders(tx: Transaction, source: ReminderSource, id: number, policy?: ReminderPolicy): Promise<Reminder[]> {
  const tasks: Task[] = [];
  const setting = async (key: string, fallback: number) => {
    const [row] = await tx.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
    const value = Number(row?.value ?? fallback);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid deadline setting: ${key}`);
    return value;
  };
  if (source === 'claim') {
    const [claim] = await tx.select().from(damageClaims).where(eq(damageClaims.id, id)).limit(1);
    if (!claim || claim.status !== 'submitted' || claim.chefRespondedAt || !claim.submittedAt) return [];
    const [location] = await tx.select({ timezone: locations.timezone }).from(locations).where(eq(locations.id, claim.locationId)).limit(1);
    // Owning resource can be kitchen or standalone storage; recipient remains the claim's chef.
    tasks.push({ source, id, resource: `claim-${id}`, opened: claim.submittedAt, deadline: claim.chefResponseDeadline,
      ownerId: claim.chefId, role: 'chef', timezone: location?.timezone || DEFAULT_TIMEZONE, path: chefIssuesHref('damage-claims'),
      title: `Damage claim #${id}: response due`, inspection: false });
  } else if (source === 'penalty') {
    const [row] = await tx.select({ penalty: storageOverstayRecords, storage: storageBookings, location: locations })
      .from(storageOverstayRecords).innerJoin(storageBookings, eq(storageBookings.id, storageOverstayRecords.storageBookingId))
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageOverstayRecords.id, id)).limit(1);
    if (!row || row.penalty.status !== 'penalty_approved' || row.penalty.chefDisputedAt || !row.penalty.chefDisputeDeadline || !row.penalty.penaltyNoticeSentAt) return [];
    tasks.push({ source, id, resource: `storage-${row.storage.id}-penalty-${id}`, opened: row.penalty.penaltyNoticeSentAt,
      deadline: row.penalty.chefDisputeDeadline, ownerId: row.storage.chefId, role: 'chef', timezone: row.location.timezone || DEFAULT_TIMEZONE,
      path: chefIssuesHref('overstay-penalties'), title: `Storage penalty #${id}: dispute window`, inspection: false });
  } else if (source === 'storage_review' || source === 'storage_cancellation_review') {
    const [row] = await tx.select({ storage: storageBookings, location: locations }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageBookings.id, id)).limit(1);
    if (!row) return [];
    const cancellation = source === 'storage_cancellation_review';
    const opened = cancellation ? row.storage.cancellationRequestedAt : row.storage.checkoutRequestedAt;
    if (!opened || (cancellation ? row.storage.status !== 'cancellation_requested' || !['paid', 'partially_refunded'].includes(row.storage.paymentStatus || '') : row.storage.checkoutStatus !== 'checkout_requested')) return [];
    const hours = !cancellation && readVisitDuties(row.storage.visitDuties)
      ? readVisitDuties(row.storage.visitDuties)!.checkoutReviewWindowMinutes / 60
      : await setting(cancellation ? 'cancellation_request_auto_accept_hours' : 'storage_checkout_review_window_hours', cancellation ? 24 : 2);
    if (!hours) return [];
    tasks.push({ source, id, resource: `storage-${id}`, opened,
      deadline: new Date(opened.getTime() + hours * 3600000), ownerId: row.location.managerId,
      role: 'manager', timezone: row.location.timezone || DEFAULT_TIMEZONE, path: managerDashboardView(cancellation ? 'storage-bookings' : 'storage-checkouts'),
      title: `Storage #${id}: ${cancellation ? 'cancellation decision' : 'inspection response'} due`, inspection: !cancellation });
  } else {
    const [row] = await tx.select({ booking: kitchenBookings, location: locations }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, id)).limit(1);
    if (!row) return [];
    const base = { source, id, ownerId: row.location.managerId, role: 'manager' as const,
      timezone: row.location.timezone || DEFAULT_TIMEZONE, path: `/manager/booking/${id}` };
    if (source === 'cancellation_review') {
      if (row.booking.status !== 'cancellation_requested' || !row.booking.cancellationRequestedAt || !['paid', 'partially_refunded'].includes(row.booking.paymentStatus || '')) return [];
      const hours = await setting('cancellation_request_auto_accept_hours', 24);
      if (hours === 0) return [];
      tasks.push({ ...base, resource: `booking-${id}-cancellation`, opened: row.booking.cancellationRequestedAt,
        deadline: new Date(row.booking.cancellationRequestedAt.getTime() + hours * 3600000), title: `Booking #${id}: cancellation decision due`, inspection: false });
    } else {
      if (row.booking.status !== 'confirmed') return [];
      const minutes = readVisitDuties(row.booking.visitDuties)?.checkoutReviewWindowMinutes ?? await setting('kitchen_checkout_review_window_minutes', 60);
      // Zero is supported by the existing checkout settings. There is no
      // advance-warning opportunity, and scheduling must not reject checkout.
      if (minutes === 0) return [];
      const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, id));
      const reviews = visits.length ? visits : [row.booking];
      for (const review of reviews) if (review.checkinStatus === 'checkout_requested' && review.checkoutRequestedAt)
        tasks.push({ ...base, resource: `booking-${id}-visit-${visits.length ? review.id : 'legacy'}`, opened: review.checkoutRequestedAt,
          deadline: new Date(review.checkoutRequestedAt.getTime() + minutes * 60000), title: `Booking #${id}: inspection response due`, inspection: true });
    }
  }
  const reminders: Reminder[] = [];
  for (const task of tasks) {
    const lead = task.inspection ? policy?.inspectionWarning === 'halfway' ? (task.deadline.getTime() - task.opened.getTime()) * (1 - (policy.inspectionWarningPercent ?? 50) / 100) / 3600000 : undefined
      : source === 'cancellation_review' || source === 'storage_cancellation_review' ? policy?.cancellationWarningHours : policy?.responseWarningHours;
    if (lead == null) continue; // Unknown policy does not activate a new warning.
    if (!task.ownerId) throw new Error('Deadline warning has no assigned action owner');
    const [person] = await tx.select().from(users).where(eq(users.id, task.ownerId)).limit(1);
    const due = (task.inspection
      ? new Date(task.opened.getTime() + (task.deadline.getTime() - task.opened.getTime()) * (policy?.inspectionWarningPercent ?? 50) / 100)
      : deadlineWarningDue(task.opened, task.deadline, lead)).toISOString();
    // Timing edits move unsent work without re-sending an accepted warning for
    // the same recorded task. Retain the original default-policy key format.
    const identityDue = task.inspection
      ? new Date(task.opened.getTime() + (task.deadline.getTime() - task.opened.getTime()) / 2).toISOString()
      : deadlineWarningDue(task.opened, task.deadline, source === 'cancellation_review' || source === 'storage_cancellation_review'
        ? lifecycleSettings.cancellationWarningHours.defaultValue : lifecycleSettings.responseWarningHours.defaultValue).toISOString();
    reminders.push({ source, reservationId: id, resource: task.resource, kind: 'deadline', recipientId: task.ownerId,
      role: task.role, email: person?.username || '', timezone: task.timezone, start: task.opened.toISOString(), end: task.deadline.toISOString(), due,
      revision: createHash('sha256').update(JSON.stringify([task.resource, task.opened, task.deadline, identityDue, task.ownerId, person?.username])).digest('hex'),
      path: task.path, title: task.title, message: `${task.title}. Recorded deadline: ${formatInTimezone(task.deadline, 'yyyy-MM-dd HH:mm', task.timezone)} (${task.timezone}). Open the current task to respond or inspect. This warning does not extend the deadline, establish a charge, prove that a visit happened or confirm physical removal.`, shortVisit: false });
  }
  return reminders;
}

/** Bounded callable reconciliation; 2C owns pagination, fairness and whole-worker budget. */
export async function reconcileReminderSource(source: ReminderSource, ids: number[], policy?: ReminderPolicy) {
  if (ids.length > 50) throw new Error('Reminder reconciliation accepts at most 50 IDs per invocation');
  const { scheduleAdvanceReminders } = await import('./advance-reminders');
  for (const id of ids) await db.transaction(tx => scheduleAdvanceReminders(tx, source, id, policy));
}
