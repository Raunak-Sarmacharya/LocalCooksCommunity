import { and, eq } from 'drizzle-orm';
import { chefKitchenApplications, kitchenViewings, locations } from '@shared/schema';
import { hasTourConfirmation } from '@shared/tour-outcome';
import { db } from '../db';

export function tourGrantsChat(tour: { status: string; adminReviewDecision: string | null; outcomeHistory?: unknown }) {
  if (tour.adminReviewDecision === 'denied' || tour.status === 'pending_local_cooks') return false;
  return tour.adminReviewDecision === 'approved' || (!tour.adminReviewDecision && hasTourConfirmation(tour));
}

export function isChatParticipant(actor: { id: number; role: string | null }, chefId: number, managerId: number | null) {
  return actor.role === 'chef' && actor.id === chefId || actor.role === 'manager' && actor.id === managerId;
}

export async function sharedChatEligibility(chefId: number, locationId: number) {
  const [location] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1);
  if (!location?.managerId) return null;
  const applications = await db.select().from(chefKitchenApplications).where(and(
    eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId),
    eq(chefKitchenApplications.status, 'approved')));
  const tours = await db.select({ id: kitchenViewings.id, status: kitchenViewings.status,
    adminReviewDecision: kitchenViewings.adminReviewDecision, outcomeHistory: kitchenViewings.outcomeHistory })
    .from(kitchenViewings).where(and(
    eq(kitchenViewings.chefId, chefId), eq(kitchenViewings.locationId, locationId)));
  const viewingIds = tours.filter(tourGrantsChat).map(tour => tour.id);
  return applications.length || viewingIds.length ? { location, applications, viewingIds } : null;
}

export async function participantChatRelationships(actor: { id: number; role: string | null }) {
  const ownedLocations = actor.role === 'manager'
    ? await db.select({ id: locations.id }).from(locations).where(eq(locations.managerId, actor.id)) : [];
  const pairs = new Map<string, { chefId: number; locationId: number }>();
  if (actor.role !== 'chef' && actor.role !== 'manager') return [];
  // Both source tables are needed: tour-only chefs have no application row.
  for (const table of [chefKitchenApplications, kitchenViewings] as const) {
    const rows = actor.role === 'chef'
      ? await db.select({ chefId: table.chefId, locationId: table.locationId }).from(table).where(eq(table.chefId, actor.id))
      : (await Promise.all(ownedLocations.map(location => db.select({ chefId: table.chefId, locationId: table.locationId })
        .from(table).where(eq(table.locationId, location.id))))).flat();
    for (const row of rows) pairs.set(`${row.chefId}:${row.locationId}`, row);
  }
  return Array.from(pairs.values());
}
