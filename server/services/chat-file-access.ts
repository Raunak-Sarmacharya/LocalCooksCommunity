import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { chefKitchenApplications, locationRequirements, locations } from '@shared/schema';
import { db } from '../db';
import { getAdminDb } from '../chat-service';
import { ChatAccessError, type ChatActor } from './participant-chat';

export const attachmentKey = (url: string) => createHash('sha256').update(url).digest('hex');
export function storedFileUrl(url: string) {
  if (/^\/api\/files\/chat-attachments\/[a-f0-9-]{36}$/.test(url)) return true;
  if (url.startsWith('/api/files/documents/')) {
    const name = url.slice('/api/files/documents/'.length);
    return !!name && !/[\\/]/.test(name) && name !== '.' && name !== '..';
  }
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.search && !parsed.hash &&
    (parsed.hostname === 'files.localcooks.ca' || parsed.hostname.endsWith('.r2.cloudflarestorage.com')); }
  catch { return false; }
}
export async function authorizeChatAttachment(actor: ChatActor, id: string, data: any, applicationIds: number[], url: string) {
  if (!storedFileUrl(url)) throw new ChatAccessError(403, 'Attachment is unavailable');
  const receipt = await (await getAdminDb()).collection('chatAttachments').doc(attachmentKey(url)).get();
  if (receipt.exists && receipt.data()?.conversationId === id && receipt.data()?.uploaderId === actor.id) return;
  // Existing document sharing is scoped to a genuinely approved application at
  // this location. Tour membership alone never grants document access.
  if (applicationIds.length) {
    const [requirements] = await db.select().from(locationRequirements).where(eq(locationRequirements.locationId, data.locationId)).limit(1);
    const [location] = await db.select().from(locations).where(eq(locations.id, data.locationId)).limit(1);
    const facilityUrls = [requirements?.floor_plans_url, requirements?.ventilation_specs_url, location?.kitchenLicenseUrl, location?.kitchenTermsUrl];
    if (actor.role === 'manager' && facilityUrls.includes(url)) return;
    const applications = await db.select().from(chefKitchenApplications).where(and(
      eq(chefKitchenApplications.chefId, data.chefId), eq(chefKitchenApplications.locationId, data.locationId),
      eq(chefKitchenApplications.status, 'approved')));
    if (applications.some(app => [app.foodSafetyLicenseUrl, app.foodEstablishmentCertUrl,
      ...Object.values((app.tier_data as any)?.tierFiles || {})].includes(url))) return;
  }
  throw new ChatAccessError(403, 'Upload a chat attachment or select a permitted application document');
}
