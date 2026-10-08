import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, kitchenViewings, tourRepeatAuthorizations } from '@shared/schema';
import { kitchenTourRequestBlock, tourRequestBlock, type TourRequestAccess } from '@shared/tour-request-access';
import { DomainError } from '../shared/errors/domain-error';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Connection = Transaction | typeof db;
type Tour = typeof kitchenViewings.$inferSelect;
export const repeatTourPermissionDays = 30;

/** Booking callers hold the kitchen advisory locks; reads supply the same policy to both UI entry points. */
export async function readTourRequestAccess(connection: Connection, chefId: number, kitchenId: number, locationId: number,
  now = new Date()): Promise<TourRequestAccess> {
  const tours = await connection.select().from(kitchenViewings).where(and(eq(kitchenViewings.chefId, chefId),
    eq(kitchenViewings.targetedKitchenId, kitchenId))).orderBy(desc(kitchenViewings.id));
  const block = kitchenTourRequestBlock(tours, kitchenId, now.getTime());
  const detail = block?.tour || tours[0];
  const tour: TourRequestAccess['tour'] = detail ? { id: detail.id, kind: block?.kind || 'failed', scheduledAt: new Date(detail.scheduledAt).toISOString(),
    durationMinutes: detail.durationMinutes ?? 30 } : null;
  const [application] = await connection.select({ id: chefKitchenApplications.id }).from(chefKitchenApplications)
    .where(and(eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId))).limit(1);
  if (application) return { canRequest: false, reason: 'application', tour, authorization: null };
  if (!block) return { canRequest: true, reason: null, tour, authorization: null };
  if (!['completed', 'unverified'].includes(block.kind)) return { canRequest: false, reason: block.kind, tour, authorization: null };
  const grants = await connection.select().from(tourRepeatAuthorizations)
    .where(eq(tourRepeatAuthorizations.sourceTourId, block.tour.id)).orderBy(desc(tourRepeatAuthorizations.id));
  const grant = grants.find(value => {
    if (value.revokedAt) return false;
    if (!value.usedAt) return value.expiresAt.getTime() > now.getTime();
    // A failed approved repeat retains recovery. An older unapproved repeat cannot unlock completion.
    const first = tours.find(attempt => attempt.id === value.usedByTourId && attempt.repeatAuthorizationId === value.id);
    return !!first && ['cancelled', 'no_show', 'pending', 'pending_local_cooks'].includes(first.status)
      && !tourRequestBlock(first, now.getTime());
  });
  return { canRequest: !!grant, reason: grant ? null : block.kind, tour,
    authorization: grant ? { id: grant.id, expiresAt: grant.expiresAt.toISOString(), recovery: !!grant.usedAt } : null };
}

export function requireTourRequestAccess(access: TourRequestAccess) {
  if (!access.canRequest) throw new DomainError('TOUR_REQUEST_BLOCKED', access.tour
    ? 'You already have a tour for this kitchen. Open its details for the current status.'
    : 'You have already applied to this kitchen location. Continue through My Applications.', 409,
  { code: 'TOUR_REQUEST_BLOCKED', tourId: access.tour?.id ?? null, reason: access.reason });
}

/** The new tour, first permission usage and delivery intent commit together, or all roll back. */
export async function useRepeatTourPermission(tx: Transaction, access: TourRequestAccess, tourId: number) {
  if (!access.authorization || access.authorization.recovery) return;
  const [used] = await tx.update(tourRepeatAuthorizations).set({ usedAt: new Date(), usedByTourId: tourId })
    .where(and(eq(tourRepeatAuthorizations.id, access.authorization.id), isNull(tourRepeatAuthorizations.usedAt),
      isNull(tourRepeatAuthorizations.revokedAt), sql`${tourRepeatAuthorizations.expiresAt} > clock_timestamp()`)).returning();
  if (!used) throw new DomainError('TOUR_PERMISSION_CHANGED', 'Your tour permission changed. Refresh the kitchen and try again.', 409);
}

function explanation(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 10 || value.trim().length > 2000)
    throw new DomainError('TOUR_PERMISSION_REASON_REQUIRED', 'Explain the decision in 10–2000 characters.', 400);
  return value.trim();
}

/** Caller has verified the admin and locks the current source tour using the booking lock order. */
export async function grantRepeatTourPermission(tx: Transaction, tour: Tour, adminId: number, input: { reason?: unknown; requestKey?: unknown }) {
  const reason = explanation(input.reason);
  if (typeof input.requestKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestKey))
    throw new DomainError('TOUR_PERMISSION_KEY_REQUIRED', 'A valid request key is required.', 400);
  const [existing] = await tx.select().from(tourRepeatAuthorizations).where(eq(tourRepeatAuthorizations.requestKey, input.requestKey)).limit(1);
  if (existing) {
    if (existing.sourceTourId !== tour.id || existing.grantedBy !== adminId || existing.reason !== reason)
      throw new DomainError('TOUR_PERMISSION_KEY_REUSED', 'This request key belongs to another permission decision.', 409);
    return existing;
  }
  if (!tour.targetedKitchenId || tour.visitEvidenceState === 'review')
    throw new DomainError('TOUR_PERMISSION_UNAVAILABLE', 'Resolve the kitchen or visit records before granting another tour.', 409);
  const access = await readTourRequestAccess(tx, tour.chefId, tour.targetedKitchenId, tour.locationId);
  if (access.reason === 'application') throw new DomainError('TOUR_PERMISSION_UNAVAILABLE', 'Applicants and approved chefs cannot request another tour.', 409);
  if (access.canRequest || access.tour?.id !== tour.id || !['completed', 'unverified'].includes(access.reason || ''))
    throw new DomainError('TOUR_PERMISSION_UNAVAILABLE', 'Review the latest tour. Another permission is not needed or the current tour is unresolved.', 409);
  const now = new Date();
  // Keep the expired permission's audit record; replacing it is an explained admin revocation.
  await tx.update(tourRepeatAuthorizations).set({ revokedAt: now, revokedBy: adminId, revokeReason: 'Expired unused permission replaced by a new admin grant.' })
    .where(and(eq(tourRepeatAuthorizations.sourceTourId, tour.id), isNull(tourRepeatAuthorizations.usedAt), isNull(tourRepeatAuthorizations.revokedAt)));
  const [grant] = await tx.insert(tourRepeatAuthorizations).values({ sourceTourId: tour.id,
    sourceVersion: tour.updatedAt.toISOString(), requestKey: input.requestKey, grantedBy: adminId, reason, grantedAt: now,
    expiresAt: new Date(now.getTime() + repeatTourPermissionDays * 86400000) }).returning();
  return grant;
}

export async function revokeRepeatTourPermission(tx: Transaction, tour: Tour, grantId: number, adminId: number, reasonInput: unknown) {
  const reason = explanation(reasonInput);
  const [grant] = await tx.select().from(tourRepeatAuthorizations)
    .where(and(eq(tourRepeatAuthorizations.id, grantId), eq(tourRepeatAuthorizations.sourceTourId, tour.id))).limit(1).for('update');
  if (!grant) throw new DomainError('TOUR_PERMISSION_NOT_FOUND', 'Tour permission not found.', 404);
  if (grant.usedAt) throw new DomainError('TOUR_PERMISSION_USED', 'This permission has already been used. Review the resulting tour instead.', 409);
  if (grant.revokedAt) return grant;
  const [revoked] = await tx.update(tourRepeatAuthorizations).set({ revokedAt: new Date(), revokedBy: adminId, revokeReason: reason })
    .where(eq(tourRepeatAuthorizations.id, grant.id)).returning();
  return revoked;
}
