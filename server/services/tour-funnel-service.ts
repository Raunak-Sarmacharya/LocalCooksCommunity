import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, kitchenBookings, kitchens, kitchenViewings, locations, tourVisitEvents, tourFeedbackResponses, users } from '@shared/schema';
import { buildTourFunnel, tourFunnelRange } from '@shared/tour-funnel';
import { DomainError } from '../shared/errors/domain-error';

/** Aggregate only: current location ownership governs every query, never saved tour managerId. */
export async function getTourFunnel(input: { role: string; userId: number; from?: unknown; to?: unknown; locationId?: unknown }, now = new Date()) {
  if (!['manager', 'admin'].includes(input.role)) throw new DomainError('FORBIDDEN', 'Staff access is required', 403);
  let range;
  try { range = tourFunnelRange(input.from, input.to, now); }
  catch (error) { throw new DomainError('TOUR_INPUT_INVALID', (error as Error).message, 400); }
  let locationId: number | undefined;
  if (input.locationId !== undefined) {
    if (typeof input.locationId !== 'string' || !/^[1-9]\d*$/.test(input.locationId) || !Number.isSafeInteger(Number(input.locationId)))
      throw new DomainError('TOUR_INPUT_INVALID', 'Choose a valid location', 400);
    locationId = Number(input.locationId);
  }
  // One repeatable-read snapshot prevents ownership/outcome corrections between the related reads.
  return db.transaction(async tx => {
    const owned = await tx.select({ id: locations.id, managerId: locations.managerId }).from(locations).where(and(
      input.role === 'manager' ? eq(locations.managerId, input.userId) : undefined,
      locationId === undefined ? undefined : eq(locations.id, locationId)));
    if (locationId !== undefined && !owned.length) throw new DomainError('FORBIDDEN', 'Location is unavailable', 403);
    const ids = owned.map(location => location.id);
    if (!ids.length) return buildTourFunnel({ tours: [], events: [], applications: [], bookings: [], range, now });
    // Read all requests in scope: range-limiting before grouping would incorrectly admit repeat requests.
    const tours = await tx.select().from(kitchenViewings).where(inArray(kitchenViewings.locationId, ids));
    const tourIds = tours.map(tour => tour.id);
    const events = tourIds.length ? await tx.select().from(tourVisitEvents).where(inArray(tourVisitEvents.viewingId, tourIds)) : [];
    const feedback = tourIds.length ? await tx.select({ viewingId: tourFeedbackResponses.viewingId,
      respondentId: tourFeedbackResponses.respondentId, respondentRole: tourFeedbackResponses.respondentRole,
      scheduledAt: tourFeedbackResponses.scheduledAt, appointmentRevision: tourFeedbackResponses.appointmentRevision,
      happened: tourFeedbackResponses.happened, createdAt: tourFeedbackResponses.createdAt }).from(tourFeedbackResponses)
      .innerJoin(users, and(eq(users.id, tourFeedbackResponses.respondentId), sql`${users.role}::text = ${tourFeedbackResponses.respondentRole}`))
      .where(inArray(tourFeedbackResponses.viewingId, tourIds)) : [];
    const applications = await tx.select().from(chefKitchenApplications).where(inArray(chefKitchenApplications.locationId, ids));
    const bookingRows = await tx.select({ booking: kitchenBookings }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).where(inArray(kitchens.locationId, ids));
    return buildTourFunnel({ tours: tours.map(tour => ({ ...tour, managerId: owned.find(location => location.id === tour.locationId)?.managerId })),
      events, feedback, applications, bookings: bookingRows.map(row => row.booking), range, now });
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
