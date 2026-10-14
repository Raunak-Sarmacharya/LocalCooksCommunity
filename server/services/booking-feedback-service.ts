import { and, asc, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { bookingFeedbackResponses, kitchenBookings, kitchens, locations, users } from '@shared/schema';
import { feedbackDue, feedbackFlagged, feedbackInputForRole, feedbackOpen, feedbackReminderMs, feedbackWindowMs,
  type BookingFeedbackRole, type BookingFeedbackState } from '@shared/booking-feedback';
import { DomainError } from '../shared/errors/domain-error';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { ensureServerI18n, tLocale } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { renderTransactionalEmail } from '../email';
import { getAppBaseUrl } from '../config';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Connection = Pick<typeof db, 'select'>;
type Viewer = { id: number; role: BookingFeedbackRole | 'admin'; locale?: string | null };
const fail = (viewer: Viewer, code: string, key: string, status: number): never => {
  throw new DomainError(code, tLocale(viewer.locale, `privateFeedback.${key}`, { ns: 'booking' }), status);
};
async function context(connection: Connection, bookingId: number, viewer: Viewer, lock = false) {
  const [row] = await connection.select({ booking: kitchenBookings, managerId: locations.managerId }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row) return fail(viewer, 'BOOKING_FEEDBACK_NOT_FOUND', 'notFound', 404);
  const personQuery = connection.select({ role: users.role }).from(users).where(eq(users.id, viewer.id)).limit(1);
  const [person] = await (lock ? personQuery.for('share') : personQuery);
  if (person?.role !== viewer.role || !(viewer.role === 'admin' || viewer.role === 'chef' && row.booking.chefId === viewer.id
    || viewer.role === 'manager' && row.managerId === viewer.id)) return fail(viewer, 'BOOKING_FEEDBACK_NOT_FOUND', 'notFound', 404);
  if (lock && viewer.role === 'manager') {
    const [location] = await connection.select({ managerId: locations.managerId }).from(locations)
      .innerJoin(kitchens, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, row.booking.kitchenId)).limit(1).for('share', { of: locations });
    if (location?.managerId !== viewer.id) return fail(viewer, 'BOOKING_FEEDBACK_NOT_FOUND', 'notFound', 404);
  }
  return row;
}
async function ownResponse(connection: Connection, bookingId: number, respondentId: number, role: BookingFeedbackRole) {
  const [response] = await connection.select().from(bookingFeedbackResponses).where(and(
    eq(bookingFeedbackResponses.bookingId, bookingId), eq(bookingFeedbackResponses.respondentId, respondentId),
    eq(bookingFeedbackResponses.respondentRole, role))).limit(1);
  return response ?? null;
}
export async function getBookingFeedback(connection: Connection, bookingId: number, viewer: Viewer, now = new Date()): Promise<BookingFeedbackState> {
  await ensureServerI18n();
  const { booking } = await context(connection, bookingId, viewer);
  if (viewer.role === 'admin') return fail(viewer, 'BOOKING_FEEDBACK_PARTICIPANT_REQUIRED', 'participantRequired', 403);
  const response = await ownResponse(connection, bookingId, viewer.id, viewer.role);
  const [sentByRole] = response ? [response] : await connection.select({ id: bookingFeedbackResponses.id }).from(bookingFeedbackResponses)
    .where(and(eq(bookingFeedbackResponses.bookingId, bookingId), eq(bookingFeedbackResponses.respondentRole, viewer.role))).limit(1);
  return { available: !sentByRole && feedbackOpen(booking, now), response, requestedAt: booking.feedbackRequestedAt,
    closesAt: booking.feedbackRequestedAt ? new Date(booking.feedbackRequestedAt.getTime() + feedbackWindowMs).toISOString() : null };
}
export async function getAdminBookingFeedback(connection: Connection, bookingId: number, viewer: Viewer) {
  await ensureServerI18n();
  if (viewer.role !== 'admin') return fail(viewer, 'BOOKING_FEEDBACK_NOT_FOUND', 'notFound', 404);
  const { booking } = await context(connection, bookingId, viewer);
  const responses = await connection.select().from(bookingFeedbackResponses).where(eq(bookingFeedbackResponses.bookingId, bookingId)).orderBy(asc(bookingFeedbackResponses.id));
  return { bookingId, requestedAt: booking.feedbackRequestedAt, remindedAt: booking.feedbackRemindedAt,
    closesAt: booking.feedbackRequestedAt ? new Date(booking.feedbackRequestedAt.getTime() + feedbackWindowMs).toISOString() : null,
    responses: responses.map(response => ({ ...response, flagged: feedbackFlagged(response) })) };
}
export async function submitBookingFeedback(tx: Transaction, bookingId: number, viewer: Viewer, rawInput: unknown, now = new Date()) {
  await ensureServerI18n();
  await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
  const { booking } = await context(tx, bookingId, viewer, true);
  if (viewer.role === 'admin') return fail(viewer, 'BOOKING_FEEDBACK_PARTICIPANT_REQUIRED', 'participantRequired', 403);
  const parsed = feedbackInputForRole(viewer.role).safeParse(rawInput);
  if (!parsed.success) return fail(viewer, 'INVALID_BOOKING_FEEDBACK', 'invalid', 400);
  // Uniqueness is per side even if a manager/account changes; never replace historical answers.
  const [existing] = await tx.select({ id: bookingFeedbackResponses.id }).from(bookingFeedbackResponses).where(and(
    eq(bookingFeedbackResponses.bookingId, bookingId), eq(bookingFeedbackResponses.respondentRole, viewer.role))).limit(1);
  if (existing) return fail(viewer, 'BOOKING_FEEDBACK_ALREADY_SUBMITTED', 'alreadySent', 409);
  if (!feedbackOpen(booking, now)) return fail(viewer, 'BOOKING_FEEDBACK_CLOSED', 'closed', 409);
  await tx.insert(bookingFeedbackResponses).values({ bookingId, respondentId: viewer.id, respondentRole: viewer.role,
    rating: parsed.data.rating, tags: parsed.data.tags, comment: parsed.data.comment || null, createdAt: now });
  if (feedbackFlagged(parsed.data)) await queueBookingLifecycleEvent(tx, bookingId, 'feedback_flagged',
    tEmail('en-CA', 'bookingFeedbackFlagTitle'), tEmail('en-CA', 'bookingFeedbackFlagBody'), viewer.id,
    { recipientPolicy: 'admins', supportCase: true, feedbackRole: viewer.role });
  return getBookingFeedback(tx, bookingId, viewer, now);
}

/** Same partial-index predicate as 0078. Empty ticks perform one query; at most three locked bookings. */
export async function sweepBookingFeedback(limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Feedback batch must be between one and three');
  const rows = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).where(and(
    eq(kitchenBookings.status, 'completed'), isNotNull(kitchenBookings.feedbackRequestedAt), isNull(kitchenBookings.feedbackRemindedAt),
    lte(kitchenBookings.feedbackRequestedAt, new Date(now.getTime() - feedbackReminderMs)),
    gt(kitchenBookings.feedbackRequestedAt, new Date(now.getTime() - feedbackWindowMs))))
    .orderBy(asc(kitchenBookings.feedbackRequestedAt), asc(kitchenBookings.id)).limit(limit);
  let reminded = 0;
  if (rows.length) await ensureServerI18n();
  for (const row of rows) await db.transaction(async tx => {
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, row.id)).for('update');
    if (!booking || !feedbackDue(booking, now)) return;
    const [place] = await tx.select({ managerId: locations.managerId, kitchenName: kitchens.name }).from(kitchens)
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, booking.kitchenId)).limit(1);
    const responses = await tx.select({ respondentRole: bookingFeedbackResponses.respondentRole }).from(bookingFeedbackResponses)
      .where(eq(bookingFeedbackResponses.bookingId, row.id));
    const recipientIds = [!responses.some(r => r.respondentRole === 'chef') ? booking.chefId : null,
      !responses.some(r => r.respondentRole === 'manager') ? place?.managerId : null].filter((id): id is number => id != null);
    if (recipientIds.length) {
      await queueBookingLifecycleEvent(tx, row.id, 'feedback_requested', tEmail('en-CA', 'bookingFeedbackTitle'),
        tEmail('en-CA', 'bookingFeedbackReminder', { kitchen: place?.kitchenName || '' }), undefined, { recipientPolicy: 'participants', recipientIds });
      reminded++;
    }
    await tx.update(kitchenBookings).set({ feedbackRemindedAt: now }).where(eq(kitchenBookings.id, row.id));
  });
  return { processed: rows.length, reminded };
}

export function bookingFeedbackNoticeCopy(kind: string, kitchen: string, locale?: string | null) {
  return { title: tEmail(locale, kind === 'feedback_flagged' ? 'bookingFeedbackFlagTitle' : 'bookingFeedbackTitle'),
    message: tEmail(locale, kind === 'feedback_flagged' ? 'bookingFeedbackFlagBody' : 'bookingFeedbackReminder', { kitchen }),
    actionLabel: tEmail(locale, kind === 'feedback_flagged' ? 'bookingFeedbackSupport' : 'bookingFeedbackRate') };
}
/** A delayed reminder must still belong to this person and still be unanswered and open. */
export async function currentBookingFeedbackEmail(bookingId: number, recipientId: number, to: string, reader: Connection = db, now = new Date()) {
  const [row] = await reader.select({ booking: kitchenBookings, kitchenName: kitchens.name, managerId: locations.managerId }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || !feedbackOpen(row.booking, now)) return null;
  const [person] = await reader.select({ role: users.role, username: users.username, locale: users.preferredLocale }).from(users).where(eq(users.id, recipientId)).limit(1);
  if (!person || person.username.toLowerCase() !== to.toLowerCase() || !(person.role === 'chef' && row.booking.chefId === recipientId
    || person.role === 'manager' && row.managerId === recipientId)) return null;
  const [answer] = await reader.select({ id: bookingFeedbackResponses.id }).from(bookingFeedbackResponses).where(and(
    eq(bookingFeedbackResponses.bookingId, bookingId), eq(bookingFeedbackResponses.respondentRole, person.role))).limit(1);
  if (answer) return null;
  await ensureServerI18n();
  const copy = bookingFeedbackNoticeCopy('feedback_requested', row.kitchenName, person.locale);
  const chef = person.role === 'chef';
  return renderTransactionalEmail({ to, locale: person.locale, recipientName: '', subject: copy.title, heading: copy.title,
    message: copy.message, facts: [], actionLabel: copy.actionLabel,
    actionUrl: `${getAppBaseUrl(chef ? 'chef' : 'kitchen')}${chef ? '' : '/manager'}/booking/${bookingId}#feedback` });
}
