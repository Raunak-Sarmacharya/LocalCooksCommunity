import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { bookingLifecycleEvents, users, kitchens, locations, kitchenBookings, emailLogs } from '@shared/schema';
import { db } from '../db';
import { notificationService } from './notification.service';
import { sendEmail } from '../email';
import { escapeHtml } from '../security';
import { getAppBaseUrl } from '../config';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Email = { key: string; to: string; url: string };

/** Notifications and durable email/history evidence commit with the decision. */
export async function queueBookingLifecycleEvent(tx: Transaction, bookingId: number, kind: string, title: string,
  message: string, actorId?: number, metadata: Record<string, unknown> = {}) {
  const [context] = await tx.select({ chefId: kitchenBookings.chefId, managerId: locations.managerId })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!context) throw new Error('Booking delivery context not found');
  const recipients = await tx.select({ id: users.id, email: users.username, role: users.role }).from(users)
    .where(or(eq(users.role, 'admin'), context.chefId ? eq(users.id, context.chefId) : undefined,
      context.managerId ? eq(users.id, context.managerId) : undefined));
  const emails: Email[] = [];
  for (const person of recipients) {
    const chef = person.id === context.chefId;
    const localCooks = person.role === 'admin';
    const path = chef ? `/booking/${bookingId}` : localCooks ? `/admin?section=transactions&bookingId=${bookingId}` : `/manager/booking/${bookingId}`;
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager',
      type: kind === 'confirmed' ? 'booking_confirmed' : kind === 'cancelled' ? 'booking_cancelled' : 'system_announcement',
      title, message, actionUrl: path, actionLabel: 'View booking', metadata: { bookingId, ...metadata } }, tx);
    if (person.email) emails.push({ key: String(person.id), to: person.email, url: `${getAppBaseUrl(chef ? 'chef' : localCooks ? 'admin' : 'kitchen')}${path}` });
  }
  await tx.insert(bookingLifecycleEvents).values({ bookingId, kind, actorId, title, message, metadata, emails });
}

export async function deliverBookingLifecycleEvents(limit = 10, budgetMs = 20_000, onlyBookingId?: number) {
  // A suppressed test send is not delivery evidence. Leave the outbox retryable.
  if (isE2eOutboundSuppressed()) return { completed: 0 };
  const deadline = Date.now() + budgetMs;
  let completed = 0;
  for (let index = 0; index < limit && deadline - Date.now() >= 10_000; index++) {
    const token = randomUUID();
    const event = await db.transaction(async tx => {
      const [row] = await tx.select().from(bookingLifecycleEvents).where(and(onlyBookingId === undefined ? undefined : eq(bookingLifecycleEvents.bookingId, onlyBookingId), isNull(bookingLifecycleEvents.completedAt),
        lte(bookingLifecycleEvents.nextAttemptAt, new Date()), or(isNull(bookingLifecycleEvents.leaseUntil), lte(bookingLifecycleEvents.leaseUntil, new Date())),
        sql`NOT EXISTS (SELECT 1 FROM booking_lifecycle_events earlier WHERE earlier.booking_id = ${bookingLifecycleEvents.bookingId} AND earlier.id < ${bookingLifecycleEvents.id} AND earlier.completed_at IS NULL)`))
        .orderBy(asc(bookingLifecycleEvents.id)).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const [claimed] = await tx.update(bookingLifecycleEvents).set({ leaseToken: token, leaseUntil: new Date(Date.now() + 600_000) })
        .where(eq(bookingLifecycleEvents.id, row.id)).returning();
      return claimed;
    });
    if (!event) break;
    const delivered = event.deliveredEmailKeys as string[];
    let failed = false;
    for (const email of event.emails as Email[]) {
      if (delivered.includes(email.key)) continue;
      if (deadline - Date.now() < 10_000) { failed = true; break; }
      const trackingId = `booking-event:${event.id}:${email.key}`;
      try {
        const [sent] = await db.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.trackingId, trackingId), eq(emailLogs.status, 'sent'))).limit(1);
        if (!sent && !await sendEmail({ to: email.to, subject: event.title,
          text: `${event.message}\n\nView booking: ${email.url}`,
          html: `<h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.message)}</p><p><a href="${escapeHtml(email.url)}">View booking</a></p>` },
          { trackingId, emailType: 'booking', durableDelivery: true })) throw new Error('Email not accepted');
        delivered.push(email.key);
        await db.update(bookingLifecycleEvents).set({ deliveredEmailKeys: [...delivered] })
          .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token)));
      } catch { failed = true; }
    }
    await db.update(bookingLifecycleEvents).set({ leaseToken: null, leaseUntil: null,
      ...(failed ? { nextAttemptAt: new Date(Date.now() + 60_000) } : { completedAt: new Date() }) })
      .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token)));
    if (!failed) completed++;
  }
  return { completed };
}
