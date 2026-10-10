import { and, eq, or, like, sql } from 'drizzle-orm';
import { chefKitchenApplications, locations, locationRequirements, kitchens } from '@shared/schema';
import { db } from '../db';
import { storedFileUrl } from './chat-file-access';
import type { ChatActor } from './participant-chat';

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
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (filename.startsWith(`${actor.id}_`)) return true;
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
  for (const { application, managerId } of apps) {
    const participant = actor.role === 'manager' && managerId === actor.id || actor.role === 'chef' && application.chefId === actor.id;
    if (!participant) continue;
    const urls = [application.foodSafetyLicenseUrl, application.foodEstablishmentCertUrl,
      ...Object.values((application.tier_data as any)?.tierFiles || {}),
      ...Object.values((application.customFieldsData as Record<string, unknown>) || {}),
      ...Object.values((application.tier_data as any)?.tier2_custom_fields_data || {})];
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
