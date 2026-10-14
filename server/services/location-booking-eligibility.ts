import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { chefKitchenApplications, chefLocationAccess, locations } from '@shared/schema';
import { locationBookingEligibility } from '@shared/location-booking-eligibility';
import { readDocumentRenewals } from './document-renewals';
import { locationService } from '../domains/locations/location.service';

export async function readLocationBookingEligibility(chefId: number, locationId: number) {
  const [app] = await db.select().from(chefKitchenApplications).where(and(eq(chefKitchenApplications.chefId, chefId), eq(chefKitchenApplications.locationId, locationId))).limit(1);
  const [access] = await db.select().from(chefLocationAccess).where(and(eq(chefLocationAccess.chefId, chefId), eq(chefLocationAccess.locationId, locationId))).limit(1);
  const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(eq(locations.id, locationId)).limit(1);
  const requirements = await locationService.getLocationRequirementsWithDefaults(locationId);
  const renewals = app ? await readDocumentRenewals(app.id) : [];
  const eligibility = locationBookingEligibility(app, !!access, requirements, locationId, location?.timezone || undefined, new Date(), renewals);
  // Lets the chef's renewal form say what happened to their last upload (waiting, or why it was not accepted).
  return { ...eligibility, renewals: renewals.filter(renewal => renewal.status !== 'approved').map(({ key, status, expiry, rejectionReason }) => ({ key, status, expiry, rejectionReason })) };
}
