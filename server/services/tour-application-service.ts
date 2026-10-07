import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, chefLocationAccess, kitchens, kitchenViewings, locations, users } from '@shared/schema';
import { kitchenIsVisibleToChefs } from '@shared/kitchen-license';
import { hasTourConfirmation } from '@shared/tour-outcome';
import type { TourApplicationNextStep } from '@shared/tour-application';
import { projectVisitEvidence } from '@shared/tour-visit-evidence';
import { visitEvents } from './tour-visit-events';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Connection = Transaction | typeof db;

/** Tour links resolve current access; an elapsed confirmed tour may associate an application pending admin review. */
export async function resolveTourApplicationNextStep(connection: Connection, tour: typeof kitchenViewings.$inferSelect,
  chef: { id: number; role?: string | null }, now = new Date()): Promise<TourApplicationNextStep> {
  const unavailable: TourApplicationNextStep = { action: 'unavailable', href: `/dashboard?view=viewings&viewing=${tour.id}`,
    sourceTourId: tour.id, applicationId: null, locationId: tour.locationId, kitchenId: tour.targetedKitchenId };
  if (tour.chefId !== chef.id) return unavailable;
  const [person] = await connection.select({ role: users.role }).from(users).where(eq(users.id, chef.id)).limit(1);
  if (person?.role !== 'chef') return unavailable;
  if (!tour.visitEvidenceMigratedAt) return unavailable;
  const evidence = projectVisitEvidence(tour, await visitEvents(connection, tour.id), now);
  const current = { ...tour, ...evidence };
  const result = evidence.effective.find(event => event.kind === 'result');
  const outcomeVerified = current.status === 'completed' && current.visitResult === 'completed'
    && current.lifecycleState === 'ended' && !!result && Number.isFinite(new Date(result.recordedAt).getTime())
    && new Date(result.recordedAt).getTime() <= now.getTime()
    && new Date(result.scheduledAt).getTime() === new Date(tour.scheduledAt).getTime()
    && result.appointmentRevision === (tour.appointmentRevision || 1);
  const pendingReview = current.status === 'confirmed' && !current.visitResult && !result
    && ['confirmed', 'ended'].includes(current.lifecycleState)
    && new Date(current.scheduledAt).getTime() + current.durationMinutes * 60000 <= now.getTime();
  if ((!outcomeVerified && !pendingReview) || current.visitEvidenceState !== 'ready'
    || current.disruptionReason || current.requestExpiredAt || !hasTourConfirmation(current)) return unavailable;
  const [location] = await connection.select().from(locations).where(eq(locations.id, current.locationId)).limit(1);
  if (!location?.isActive) return unavailable;
  const candidates = await connection.select().from(kitchens).where(and(eq(kitchens.locationId, current.locationId),
    ...(current.targetedKitchenId ? [eq(kitchens.id, current.targetedKitchenId)] : [])));
  if (!candidates.some(kitchen => kitchenIsVisibleToChefs(kitchen, location, now))) return unavailable;
  const [application] = await connection.select().from(chefKitchenApplications).where(and(
    eq(chefKitchenApplications.chefId, chef.id), eq(chefKitchenApplications.locationId, current.locationId))).limit(1);
  const [access] = await connection.select().from(chefLocationAccess).where(and(
    eq(chefLocationAccess.chefId, chef.id), eq(chefLocationAccess.locationId, current.locationId))).limit(1);
  const action = application
    ? ['rejected', 'cancelled'].includes(application.status) || application.status === 'approved' && (application.current_tier ?? 1) < 3
      || application.status === 'inReview' && (application.current_tier ?? 1) >= 2 && !application.tier2_completed_at ? 'continue' : 'view'
    : access ? 'view' : 'apply';
  const intake = (current.intakeData && typeof current.intakeData === 'object' ? current.intakeData : {}) as Record<string, unknown>;
  const answer = (key: string) => typeof intake[key] === 'string' ? (intake[key] as string).trim() : '';
  return { action, outcomeVerified, applicationId: application?.id || null, sourceTourId: current.id, locationId: current.locationId, kitchenId: current.targetedKitchenId,
    href: `/apply-kitchen/${current.locationId}?tourId=${current.id}${current.targetedKitchenId ? `&kitchenId=${current.targetedKitchenId}` : ''}`,
    prefill: { intendedUse: answer('intendedUse'), estimatedWeeklyHours: answer('estimatedWeeklyHours'),
      hasLicense: typeof intake.hasLicense === 'boolean' ? intake.hasLicense : null, targetStartDate: answer('targetStartDate'),
      chefNotes: current.chefNotes || '', sharedManagerNotes: current.sharedManagerNotes || '', additionalInfo: answer('additionalInfo') } };
}
