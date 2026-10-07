import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { kitchenViewings, locations, tourFeedbackResponses, users, type TourFeedbackResponse } from '@shared/schema';
import { tourFeedbackClosed, tourFeedbackInputSchema, tourFeedbackOpen } from '@shared/tour-feedback';
import { DomainError } from '../shared/errors/domain-error';
import { queueTourEvent } from './tour-delivery-service';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Connection = Transaction | typeof db;
type Tour = typeof kitchenViewings.$inferSelect;
type Viewer = { id: number; role?: string | null };

/** Full internal status; never return these private rows directly to a participant. */
export async function readTourFeedbackStatus(connection: Connection, tour: Tour) {
  const [location] = await connection.select({ managerId: locations.managerId }).from(locations)
    .where(eq(locations.id, tour.locationId)).limit(1);
  const currentPeople = await connection.select({ id: users.id, role: users.role }).from(users)
    .where(inArray(users.id, [tour.chefId, location?.managerId].filter((id): id is number => id != null)));
  const responses = await connection.select().from(tourFeedbackResponses)
    .where(eq(tourFeedbackResponses.viewingId, tour.id)).orderBy(tourFeedbackResponses.id);
  const current = responses.filter(response => response.appointmentRevision === (tour.appointmentRevision || 1)
    && new Date(response.scheduledAt).getTime() === new Date(tour.scheduledAt).getTime());
  const chefResponse = currentPeople.some(person => person.id === tour.chefId && person.role === 'chef')
    ? current.find(response => response.respondentRole === 'chef' && response.respondentId === tour.chefId) : undefined;
  const managerResponse = currentPeople.some(person => person.id === location?.managerId && person.role === 'manager')
    ? current.find(response => response.respondentRole === 'manager' && response.respondentId === location?.managerId) : undefined;
  return { chef: Boolean(chefResponse), manager: Boolean(managerResponse),
    conflict: Boolean(chefResponse && managerResponse && chefResponse.happened !== managerResponse.happened),
    bothReady: Boolean(chefResponse && managerResponse), missing: !chefResponse || !managerResponse,
    closed: tourFeedbackClosed(tour), responses, current, managerId: location?.managerId ?? null };
}

async function authorizedRole(connection: Connection, tour: Tour, viewer: Viewer, lock = false) {
  const personQuery = connection.select({ role: users.role }).from(users).where(eq(users.id, viewer.id)).limit(1);
  const [person] = await (lock ? personQuery.for('share') : personQuery);
  if (person?.role === 'admin' && (!viewer.role || viewer.role === 'admin')) return 'admin' as const;
  if (person?.role === 'chef' && viewer.id === tour.chefId && (!viewer.role || viewer.role === 'chef')) return 'chef' as const;
  if (person?.role === 'manager' && (!viewer.role || viewer.role === 'manager')) {
    const locationQuery = connection.select({ managerId: locations.managerId }).from(locations)
      .where(eq(locations.id, tour.locationId)).limit(1);
    const [location] = await (lock ? locationQuery.for('share') : locationQuery);
    if (location?.managerId === viewer.id) return 'manager' as const;
  }
  throw new DomainError('TOUR_FEEDBACK_NOT_FOUND', 'Tour feedback not found.', 404);
}

/** A participant sees only their own answers. Conflict is private because it reveals the other answer. */
export async function getTourFeedback(connection: Connection, tour: Tour, viewer: Viewer, now = new Date()) {
  const role = await authorizedRole(connection, tour, viewer);
  const status = await readTourFeedbackStatus(connection, tour);
  const response = role === 'admin' ? null : status.current.find(value => value.respondentId === viewer.id && value.respondentRole === role) ?? null;
  const available = role !== 'admin' && !response && tourFeedbackOpen(tour, now);
  const reason = response ? 'Your feedback has been submitted.' : status.closed ? 'Local Cooks has recorded the tour result.'
    : role === 'admin' ? 'Review the participant feedback and record the tour result.'
    : available ? undefined : 'Feedback is available after the confirmed tour ends.';
  return { available, ...(reason ? { reason } : {}), scheduledAt: new Date(tour.scheduledAt).toISOString(),
    appointmentRevision: tour.appointmentRevision || 1, response,
    ...(role === 'admin' ? { responses: status.responses.map(value => ({ ...value,
      currentAppointment: status.current.some(current => current.id === value.id),
      currentRespondent: value.respondentRole === 'chef' ? value.respondentId === tour.chefId : value.respondentId === status.managerId })) } : {}),
    chefSubmitted: status.chef, managerSubmitted: status.manager, conflict: role === 'admin' && status.conflict,
    closed: status.closed, bothReady: status.bothReady };
}

/** Serialize against reschedules, admin closure and simultaneous retries using the tour row lock. */
export async function submitTourFeedback(tx: Transaction, tour: Tour, viewer: Viewer, rawInput: unknown, now = new Date()) {
  const [current] = await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, tour.id)).for('update');
  if (!current) throw new DomainError('TOUR_FEEDBACK_NOT_FOUND', 'Tour feedback not found.', 404);
  const role = await authorizedRole(tx, current, viewer, true);
  if (role === 'admin') throw new DomainError('TOUR_FEEDBACK_PARTICIPANT_REQUIRED', 'Feedback must be submitted by the chef or current kitchen manager.', 403);
  const parsed = tourFeedbackInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new DomainError('INVALID_TOUR_FEEDBACK', 'Check the feedback answers and try again.', 400, { issues: parsed.error.issues });
  const input = parsed.data;
  if (new Date(input.scheduledAt).getTime() !== new Date(current.scheduledAt).getTime()
    || input.appointmentRevision !== (current.appointmentRevision || 1))
    throw new DomainError('STALE_TOUR_FEEDBACK', 'This appointment has changed. Reload the tour before submitting feedback.', 409);
  const [existing] = await tx.select().from(tourFeedbackResponses).where(and(
    eq(tourFeedbackResponses.viewingId, current.id), eq(tourFeedbackResponses.appointmentRevision, input.appointmentRevision),
    eq(tourFeedbackResponses.respondentRole, role), eq(tourFeedbackResponses.respondentId, viewer.id))).limit(1);
  const answers = { happened: input.happened, rating: input.rating, comments: input.comments, suggestions: input.suggestions, reason: input.reason };
  if (existing) {
    if (new Date(existing.scheduledAt).getTime() !== new Date(input.scheduledAt).getTime()
      || Object.entries(answers).some(([key, value]) => existing[key as keyof TourFeedbackResponse] !== value))
      throw new DomainError('TOUR_FEEDBACK_ALREADY_SUBMITTED', 'Feedback has already been submitted for this appointment.', 409);
    return { response: existing, changed: false, feedback: await getTourFeedback(tx, current, viewer, now) };
  }
  if (!tourFeedbackOpen(current, now))
    throw new DomainError('TOUR_FEEDBACK_UNAVAILABLE', 'This appointment no longer accepts feedback, or the confirmed tour has not ended.', 409);
  const [response] = await tx.insert(tourFeedbackResponses).values({ viewingId: current.id, respondentId: viewer.id,
    respondentRole: role, scheduledAt: current.scheduledAt, appointmentRevision: input.appointmentRevision,
    ...answers, createdAt: now }).returning();
  const status = await readTourFeedbackStatus(tx, current);
  if (status.bothReady || status.conflict) {
    await queueTourEvent(tx, { kind: 'feedback_submitted', before: current, after: current, actorId: viewer.id,
      actorRole: role, feedbackRespondent: { role, id: viewer.id },
      feedbackStatus: { chef: status.chef, manager: status.manager, conflict: status.conflict } });
  }
  return { response, changed: true, feedback: await getTourFeedback(tx, current, viewer, now) };
}
