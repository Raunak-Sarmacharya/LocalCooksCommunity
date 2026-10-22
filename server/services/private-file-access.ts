import { and, eq, or, like, sql } from 'drizzle-orm';
import { chefKitchenApplications, locations, locationRequirements, kitchens, storageListings } from '@shared/schema';
import { db } from '../db';
import { storedFileUrl } from './chat-file-access';
import type { ChatActor } from './participant-chat';
import { readDocumentRenewals } from './document-renewals';

/** Generic file proxies must not turn knowledge of a private URL into a grant. */
export async function canReadPrivateFile(actor: ChatActor | undefined, url: string): Promise<boolean> {
  if (!storedFileUrl(url)) return false;
  if (url.startsWith('/api/files/chat-attachments/')) return false;
  const pathname = url.startsWith('/') ? url : new URL(url).pathname;
  if (/^\/(public|kitchens)\//.test(pathname)) return true;
  // Public listing images are public because of their stored use, not extension.
  const filename = pathname.split('/').pop()!;
  const listings = await db.select({ imageUrl: kitchens.imageUrl, galleryImages: kitchens.galleryImages }).from(kitchens)
    .where(or(like(kitchens.imageUrl, `%${filename}`), sql`${kitchens.galleryImages} @> ${JSON.stringify([url])}::jsonb`));
  if (listings.some(row => row.imageUrl === url || (row.galleryImages as string[] | null)?.includes(url))) return true;
  // Location branding is displayed to visitors and chefs without document grants.
  const logos = await db.select({ logoUrl: locations.logoUrl }).from(locations)
    .where(eq(locations.logoUrl, url)).limit(1);
  if (logos.some(row => row.logoUrl === url)) return true;
  // Storage listing photos are listing images too (the kitchen page and the rent dialog show them to chefs).
  const storagePhotos = await db.select({ photos: storageListings.photos }).from(storageListings)
    .where(sql`${storageListings.photos} @> ${JSON.stringify([url])}::jsonb`).limit(1);
  if (storagePhotos.some(row => Array.isArray(row.photos) && (row.photos as string[]).includes(url))) return true;
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (filename.startsWith(`${actor.id}_`)) return true;
  // Visit and storage condition photos are evidence for both people on that booking: the customer and the kitchen's manager.
  if (await isBookingPhotoParticipant(actor.id, url)) return true;
  // Chefs must read the listed kitchen's terms before they have an application.
  // This grants only the exact terms URL, never the other facility documents.
  if (actor.role === 'chef') {
    const terms = await db.select({ termsUrl: locations.kitchenTermsUrl }).from(locations)
      .innerJoin(kitchens, eq(kitchens.locationId, locations.id))
      .where(and(eq(locations.kitchenTermsUrl, url), eq(locations.isActive, true),
        eq(kitchens.isActive, true), eq(kitchens.listingStatus, 'active'))).limit(1);
    if (terms.some(row => row.termsUrl === url)) return true;
  }
  const apps = await db.select({ application: chefKitchenApplications, managerId: locations.managerId }).from(chefKitchenApplications)
    .innerJoin(locations, eq(chefKitchenApplications.locationId, locations.id))
    .where(or(eq(chefKitchenApplications.chefId, actor.id), eq(locations.managerId, actor.id)));
  // A renewed document waiting for review is as private as the current one, and the manager must be able to open it.
  const renewals = await readDocumentRenewals(apps.map(row => row.application.id));
  for (const { application, managerId } of apps) {
    const participant = actor.role === 'manager' && managerId === actor.id || actor.role === 'chef' && application.chefId === actor.id;
    if (!participant) continue;
    const urls = [application.foodSafetyLicenseUrl, application.foodEstablishmentCertUrl,
      ...Object.values((application.tier_data as any)?.tierFiles || {}),
      ...Object.values((application.customFieldsData as Record<string, unknown>) || {}),
      ...Object.values((application.tier_data as any)?.tier2_custom_fields_data || {}),
      ...renewals.filter(renewal => renewal.applicationId === application.id).map(renewal => renewal.url)];
    if (urls.includes(url)) return true;
  }
  const owned = actor.role === 'manager'
    ? await db.select().from(locations).where(eq(locations.managerId, actor.id))
    : actor.role === 'chef' ? (await db.select({ location: locations }).from(chefKitchenApplications).innerJoin(locations,
      eq(chefKitchenApplications.locationId, locations.id)).where(and(eq(chefKitchenApplications.chefId, actor.id),
        eq(chefKitchenApplications.status, 'approved')))).map(row => row.location) : [];
  for (const location of owned) {
    const [requirements] = await db.select().from(locationRequirements).where(eq(locationRequirements.locationId, location.id)).limit(1);
    if ([location.kitchenLicenseUrl, location.kitchenTermsUrl, requirements?.floor_plans_url, requirements?.ventilation_specs_url].includes(url)) return true;
  }
  return false;
}

/** True when the URL is a check-in/out or handover photo on a kitchen booking, visit or storage rental the actor is party to. */
async function isBookingPhotoParticipant(actorId: number, url: string) {
  const has = (column: string) => sql.raw(`COALESCE(${column}, '[]'::jsonb)`);
  const value = JSON.stringify([url]);
  const result = await db.execute(sql`
    SELECT 1 FROM kitchen_bookings b JOIN kitchens k ON k.id = b.kitchen_id JOIN locations l ON l.id = k.location_id
      WHERE (b.chef_id = ${actorId} OR l.manager_id = ${actorId})
        AND (${has('b.checkin_photo_urls')} @> ${value}::jsonb OR ${has('b.checkout_photo_urls')} @> ${value}::jsonb)
    UNION ALL
    SELECT 1 FROM kitchen_booking_visits v JOIN kitchen_bookings b ON b.id = v.booking_id JOIN kitchens k ON k.id = b.kitchen_id
      JOIN locations l ON l.id = k.location_id
      WHERE (b.chef_id = ${actorId} OR l.manager_id = ${actorId})
        AND (${has('v.checkin_photo_urls')} @> ${value}::jsonb OR ${has('v.checkout_photo_urls')} @> ${value}::jsonb)
    UNION ALL
    SELECT 1 FROM storage_bookings s JOIN storage_listings sl ON sl.id = s.storage_listing_id JOIN kitchens k ON k.id = sl.kitchen_id
      JOIN locations l ON l.id = k.location_id
      WHERE (s.chef_id = ${actorId} OR l.manager_id = ${actorId})
        AND (${has('s.checkin_photo_urls')} @> ${value}::jsonb OR ${has('s.checkout_photo_urls')} @> ${value}::jsonb
          OR ${has('s.handover_photo_urls')} @> ${value}::jsonb)
    LIMIT 1`);
  return result.rows.length > 0;
}
