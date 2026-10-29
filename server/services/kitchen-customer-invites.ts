/**
 * Kitchen "Add customer" (owner, Oct 24).
 *
 * The kitchen enters a name and email, picks how booking requirements are handled, and we email an invitation. The
 * customer accepts by signing in or creating an account with that email; nobody is linked to a kitchen without saying
 * yes, and the kitchen never chooses their password. The kitchen only learns about its own matches (already its
 * customer, or already has a request with it), never whether an address has a Local Cooks account.
 *
 * Accepting skips Request to apply and Local Cooks' first-step review (decided Oct 22); admins are told and can end
 * access. The link token proves the inbox, so accepting also verifies the email of a new account.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getAuth } from 'firebase-admin/auth';
import { db } from '../db';
import { chefKitchenApplications, kitchenCustomerInvites, kitchens, locations, users } from '@shared/schema';
import { customDocumentId, DOCUMENT_KEYS, documentLabel, isCustomDocumentKey, kitchenDocumentFields, type BuiltInDocumentKey } from '@shared/location-booking-eligibility';
import { DomainError } from '../shared/errors/domain-error';
import { logger } from '../logger';
import { getAppBaseUrl } from '../config';
import { renderTransactionalEmail, sendEmail } from '../email';
import { notificationService } from './notification.service';
import { notifyAdmins, recordDocumentWaiver } from './document-waivers';
import { locationService } from '../domains/locations/location.service';
import { initializeFirebaseAdmin } from '../firebase-setup';

export type RequirementsChoice = 'customer' | 'uploaded' | 'waived';
export type InviteDocuments = Record<string, { url: string; expiry: string | null }>;
const INVITE_DAYS = 14;
const DAILY_LIMIT = 40;
const RESEND_GAP_MS = 10 * 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const expiresAt = () => new Date(Date.now() + INVITE_DAYS * 86_400_000);
export const inviteIsOpen = (invite: { status: string; expiresAt: Date }, now = new Date()) => invite.status === 'sent' && invite.expiresAt.getTime() > now.getTime();
const statusOf = (invite: { status: string; expiresAt: Date }) => invite.status === 'sent' && !inviteIsOpen(invite) ? 'expired' : invite.status;

async function ownedLocation(managerId: number, locationId: number) {
  const [location] = await db.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.managerId, managerId))).limit(1);
  if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404);
  return location;
}

/** What this kitchen already has for this email at this location. Never says whether the address has an account. */
export async function inviteEmailMatch(managerId: number, locationId: number, rawEmail: string) {
  await ownedLocation(managerId, locationId);
  const email = normalizeEmail(rawEmail);
  if (!EMAIL.test(email)) return { match: null as null };
  const [app] = await db.select({ id: chefKitchenApplications.id, chefId: chefKitchenApplications.chefId, status: chefKitchenApplications.status, tier: chefKitchenApplications.current_tier })
    .from(chefKitchenApplications).innerJoin(users, eq(users.id, chefKitchenApplications.chefId))
    .where(and(eq(chefKitchenApplications.locationId, locationId), sql`lower(${users.username}) = ${email}`)).limit(1);
  if (app && app.status === 'approved' && (app.tier ?? 1) >= 3) return { match: 'customer' as const, chefId: app.chefId, applicationId: app.id };
  // A request still waiting on Local Cooks' first step is not the kitchen's yet, so it reads as nothing here.
  if (app && app.status === 'approved') return { match: 'request' as const, applicationId: app.id };
  const [open] = await db.select().from(kitchenCustomerInvites)
    .where(and(eq(kitchenCustomerInvites.locationId, locationId), eq(kitchenCustomerInvites.status, 'sent'), sql`lower(${kitchenCustomerInvites.email}) = ${email}`)).limit(1);
  if (open && inviteIsOpen(open)) return { match: 'invited' as const, inviteId: open.id };
  return { match: null as null };
}

/** The documents the kitchen uploaded, checked against what this location asks for. */
export function checkInviteDocuments(documents: InviteDocuments, requirements: Parameters<typeof kitchenDocumentFields>[0]) {
  for (const [key, document] of Object.entries(documents)) {
    const own = isCustomDocumentKey(key) ? kitchenDocumentFields(requirements).find(field => field.id === customDocumentId(key)) : null;
    if (!(DOCUMENT_KEYS as string[]).includes(key) && !own) throw new DomainError('UNKNOWN_DOCUMENT', 'This kitchen no longer asks for one of those documents.', 400);
    const needsExpiry = !own || !!own.expires;
    if (needsExpiry && !(document.expiry && /^\d{4}-\d{2}-\d{2}$/.test(document.expiry) && Date.parse(`${document.expiry}T00:00:00Z`) > Date.now())) {
      throw new DomainError('EXPIRY_REQUIRED', `Enter a future expiry date for the ${documentLabel(key, requirements).toLowerCase()}.`, 400);
    }
  }
}

async function sendInviteEmail(invite: typeof kitchenCustomerInvites.$inferSelect, token: string, locationName: string) {
  const content = renderTransactionalEmail({ to: invite.email, recipientName: invite.fullName, subject: `${locationName} invited you to book its kitchen`,
    message: `${locationName} added you as a customer on Local Cooks. Accept to join; you can then ${invite.requirementsChoice === 'customer' ? 'send the kitchen its booking requirements and book once they’re approved' : 'book kitchen time'}. The invitation is open for ${INVITE_DAYS} days.`,
    facts: [{ label: 'Kitchen', value: locationName }, { label: 'Sent to', value: invite.email }],
    actionLabel: `Join ${locationName}`, // The token rides in the fragment, which browsers never send to a server, so no access log holds it.
    actionUrl: `${getAppBaseUrl('chef')}/join#${token}`,
    note: 'If you weren’t expecting this, you can ignore it. Nothing happens unless you accept.' });
  return sendEmail(content, { trackingId: `kitchen_customer_invite_${invite.id}_${invite.sentAt.getTime()}` });
}

export async function createInvite(managerId: number, input: { locationId: number; email: string; fullName: string; phone?: string; businessName?: string; choice: RequirementsChoice; documents?: InviteDocuments; confirmResponsibility?: boolean }) {
  const location = await ownedLocation(managerId, input.locationId);
  const email = normalizeEmail(input.email);
  const fullName = String(input.fullName ?? '').trim();
  if (!EMAIL.test(email) || email.length > 254) throw new DomainError('EMAIL_INVALID', 'Enter a valid email address.', 400);
  if (!fullName || fullName.length > 120) throw new DomainError('NAME_REQUIRED', 'Enter the customer’s name.', 400);
  if (!['customer', 'uploaded', 'waived'].includes(input.choice)) throw new DomainError('CHOICE_INVALID', 'Choose how booking requirements are handled.', 400);
  if (input.choice === 'waived' && input.confirmResponsibility !== true) throw new DomainError('CONFIRM_REQUIRED', 'Confirm that you take responsibility for approving this customer without booking requirements.', 400);
  const documents = input.choice === 'uploaded' ? input.documents ?? {} : {};
  if (input.choice === 'uploaded' && !Object.keys(documents).length) throw new DomainError('DOCUMENTS_REQUIRED', 'Upload at least one document, or choose another option.', 400);
  checkInviteDocuments(documents, await locationService.getLocationRequirementsWithDefaults(input.locationId));
  const existing = await inviteEmailMatch(managerId, input.locationId, email);
  if (existing.match === 'customer') throw new DomainError('ALREADY_CUSTOMER', 'This person is already your customer at this location.', 409);
  if (existing.match === 'request') throw new DomainError('ALREADY_REQUESTED', 'This person already has a request with you. Open it from Access requests.', 409);
  if (existing.match === 'invited') throw new DomainError('ALREADY_INVITED', 'You’ve already invited this person. Resend the invitation from Access requests.', 409);
  // Invitations are emails to people who may not use Local Cooks yet: a daily cap keeps this from being used to spam.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(kitchenCustomerInvites)
    .where(and(eq(kitchenCustomerInvites.invitedBy, managerId), gte(kitchenCustomerInvites.createdAt, new Date(Date.now() - 86_400_000))));
  if (count >= DAILY_LIMIT) throw new DomainError('INVITE_LIMIT', 'You’ve sent a lot of invitations today. Try again tomorrow, or contact Local Cooks.', 429);
  // A closed earlier invitation for the same person stays as history.
  const token = newToken();
  const [invite] = await db.insert(kitchenCustomerInvites).values({ locationId: input.locationId, invitedBy: managerId, email, fullName,
    phone: input.phone?.trim() || null, businessName: input.businessName?.trim() || null, requirementsChoice: input.choice, documents,
    tokenHash: hashToken(token), expiresAt: expiresAt() }).returning();
  const sent = await sendInviteEmail(invite, token, location.name);
  if (!sent) logger.warn('[Customer invites] Invitation email was not sent', { inviteId: invite.id });
  return invite;
}

/** Admin read-only list (QA and support): newest 200 links across every kitchen. */
export async function listInvitesForAdmin() {
  const rows = await db.select({ invite: kitchenCustomerInvites, locationName: locations.name, kitchenName: sql<string | null>`(SELECT min(${kitchens.name}) FROM ${kitchens} WHERE ${kitchens.locationId} = ${locations.id})` })
    .from(kitchenCustomerInvites).innerJoin(locations, eq(locations.id, kitchenCustomerInvites.locationId)).orderBy(desc(kitchenCustomerInvites.sentAt)).limit(200);
  return rows.map(({ invite, locationName, kitchenName }) => ({ id: invite.id, locationId: invite.locationId, locationName, displayName: kitchenName || locationName,
    fullName: invite.fullName, email: invite.email, status: statusOf(invite), sentAt: invite.sentAt, expiresAt: invite.expiresAt }));
}

export async function listInvites(managerId: number) {
  const rows = await db.select({ invite: kitchenCustomerInvites, locationName: locations.name }).from(kitchenCustomerInvites)
    .innerJoin(locations, eq(locations.id, kitchenCustomerInvites.locationId))
    .where(and(eq(locations.managerId, managerId), inArray(kitchenCustomerInvites.status, ['sent'])))
    .orderBy(desc(kitchenCustomerInvites.sentAt));
  return rows.map(({ invite, locationName }) => ({ id: invite.id, locationId: invite.locationId, locationName, email: invite.email, fullName: invite.fullName,
    requirementsChoice: invite.requirementsChoice, documents: Object.keys((invite.documents || {}) as InviteDocuments), status: statusOf(invite),
    sentAt: invite.sentAt, expiresAt: invite.expiresAt }));
}

async function ownedInvite(managerId: number, inviteId: number) {
  const [row] = await db.select({ invite: kitchenCustomerInvites, location: locations }).from(kitchenCustomerInvites)
    .innerJoin(locations, eq(locations.id, kitchenCustomerInvites.locationId))
    .where(and(eq(kitchenCustomerInvites.id, inviteId), eq(locations.managerId, managerId))).limit(1);
  if (!row) throw new DomainError('INVITE_NOT_FOUND', 'Invitation not found', 404);
  return row;
}

/** A fresh link (the old one stops working) and another two weeks. */
export async function resendInvite(managerId: number, inviteId: number) {
  const { invite, location } = await ownedInvite(managerId, inviteId);
  if (invite.status !== 'sent') throw new DomainError('INVITE_CLOSED', 'This invitation is no longer open.', 409);
  if (Date.now() - invite.sentAt.getTime() < RESEND_GAP_MS) throw new DomainError('RESEND_TOO_SOON', 'You just sent it. Give it a few minutes before sending again.', 429);
  const token = newToken();
  const [updated] = await db.update(kitchenCustomerInvites).set({ tokenHash: hashToken(token), sentAt: new Date(), expiresAt: expiresAt() })
    .where(eq(kitchenCustomerInvites.id, inviteId)).returning();
  await sendInviteEmail(updated, token, location.name);
  return updated;
}

export async function withdrawInvite(managerId: number, inviteId: number) {
  const { invite } = await ownedInvite(managerId, inviteId);
  if (invite.status !== 'sent') throw new DomainError('INVITE_CLOSED', 'This invitation is no longer open.', 409);
  await db.update(kitchenCustomerInvites).set({ status: 'withdrawn' }).where(eq(kitchenCustomerInvites.id, inviteId));
}

/** What the Join page shows. The link holder already has the email, so the address is shown in full. */
export async function readInvite(token: string) {
  const [row] = await db.select({ invite: kitchenCustomerInvites, location: locations }).from(kitchenCustomerInvites)
    .innerJoin(locations, eq(locations.id, kitchenCustomerInvites.locationId))
    .where(eq(kitchenCustomerInvites.tokenHash, hashToken(String(token || '')))).limit(1);
  if (!row) return null;
  // The kitchen's own photo for the invitation page (the first active kitchen that has one).
  const [photo] = await db.select({ imageUrl: kitchens.imageUrl }).from(kitchens)
    .where(and(eq(kitchens.locationId, row.location.id), eq(kitchens.isActive, true), sql`${kitchens.imageUrl} IS NOT NULL`)).orderBy(kitchens.id).limit(1);
  return { status: statusOf(row.invite), imageUrl: photo?.imageUrl ?? null, email: row.invite.email, fullName: row.invite.fullName, locationId: row.location.id, locationName: row.location.name,
    address: row.location.address, termsUrl: (row.location as any).kitchenTermsUrl ?? null, requirementsChoice: row.invite.requirementsChoice };
}

/**
 * The customer says yes. Their account's email must be the invited one; the link proves that inbox, so a new
 * account is marked verified. Returns where the customer stands next.
 */
export async function acceptInvite(token: string, user: { id: number; username: string; firebaseUid?: string | null; isVerified?: boolean; phoneNumber?: string | null; role?: string | null; isChef?: boolean | null }) {
  const outcome = await db.transaction(async tx => {
    const [invite] = await tx.select().from(kitchenCustomerInvites).where(eq(kitchenCustomerInvites.tokenHash, hashToken(String(token || '')))).limit(1).for('update');
    if (!invite) throw new DomainError('INVITE_NOT_FOUND', 'This invitation link isn’t valid. Ask the kitchen to send it again.', 404);
    if (invite.status === 'accepted' && invite.acceptedBy === user.id) return { invite, applicationId: invite.applicationId!, canBook: null as boolean | null, already: true };
    if (!inviteIsOpen(invite)) throw new DomainError('INVITE_CLOSED', invite.status === 'withdrawn' ? 'The kitchen withdrew this invitation.' : 'This invitation has expired. Ask the kitchen to send it again.', 410);
    if (normalizeEmail(user.username) !== normalizeEmail(invite.email)) {
      throw new DomainError('INVITE_EMAIL_MISMATCH', `This invitation was sent to ${invite.email}. Sign in with that email to accept it.`, 403);
    }
    if (!(user.isChef === true || user.role === 'chef' || user.role === 'admin')) throw new DomainError('NOT_A_CUSTOMER_ACCOUNT', 'Sign in with a customer account to accept this invitation.', 403);

    const requirements = await locationService.getLocationRequirementsWithDefaults(invite.locationId);
    const now = new Date();
    const documents = (invite.documents || {}) as InviteDocuments;
    const builtIn = (key: BuiltInDocumentKey) => documents[key];
    const custom = Object.fromEntries(Object.entries(documents).filter(([key]) => isCustomDocumentKey(key)).map(([key, value]) => [customDocumentId(key), value]));
    const customAnswers: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(custom)) { customAnswers[id] = value.url; if (value.expiry) customAnswers[`${id}__expiry`] = value.expiry; }
    const verification = Object.fromEntries(Object.keys(documents).map(key => [key, 'manager']));
    const fields = {
      fullName: invite.fullName, email: user.username, phone: invite.phone || user.phoneNumber || '',
      shopName: invite.businessName || 'Shop Not Named', businessDescription: JSON.stringify({ businessName: invite.businessName || undefined }),
      kitchenPreference: 'commercial' as const, status: 'approved' as const, current_tier: 1,
      foodSafetyLicense: builtIn('foodSafetyLicense') ? 'yes' as const : 'notSure' as const,
      foodEstablishmentCert: builtIn('foodEstablishmentCert') ? 'yes' as const : 'notSure' as const,
      ...(builtIn('foodSafetyLicense') ? { foodSafetyLicenseUrl: builtIn('foodSafetyLicense').url, foodSafetyLicenseExpiry: builtIn('foodSafetyLicense').expiry, foodSafetyLicenseStatus: 'approved' as const } : {}),
      ...(builtIn('foodEstablishmentCert') ? { foodEstablishmentCertUrl: builtIn('foodEstablishmentCert').url, foodEstablishmentCertExpiry: builtIn('foodEstablishmentCert').expiry, foodEstablishmentCertStatus: 'approved' as const } : {}),
      ...(builtIn('insurance') ? { insuranceUrl: builtIn('insurance').url, insuranceExpiry: builtIn('insurance').expiry, insuranceStatus: 'approved' } : {}),
      tier_data: { addedByKitchen: { inviteId: invite.id, by: invite.invitedBy, at: now.toISOString() }, documentVerification: verification,
        tier2_custom_fields_data: customAnswers, customDocumentStatus: Object.fromEntries(Object.keys(custom).map(id => [id, 'approved'])) },
      reviewedBy: invite.invitedBy, reviewedAt: now, tier1_completed_at: now, updatedAt: now,
    };
    const [existing] = await tx.select().from(chefKitchenApplications)
      .where(and(eq(chefKitchenApplications.chefId, user.id), eq(chefKitchenApplications.locationId, invite.locationId))).limit(1).for('update');
    // An earlier declined or withdrawn request is replaced; an open one belongs to the kitchen already (shouldn't happen: the kitchen was told).
    if (existing && existing.status === 'approved') throw new DomainError('ALREADY_REQUESTED', 'You already have a request with this kitchen. Open it from your applications.', 409);
    const [app] = existing
      ? await tx.update(chefKitchenApplications).set(fields).where(eq(chefKitchenApplications.id, existing.id)).returning()
      : await tx.insert(chefKitchenApplications).values({ chefId: user.id, locationId: invite.locationId, ...fields } as any).returning();

    let canBook = false;
    if (invite.requirementsChoice === 'waived') {
      await recordDocumentWaiver(tx as any, app.id, { id: invite.invitedBy ?? user.id, role: 'manager' });
      canBook = true;
    } else if (invite.requirementsChoice === 'uploaded') {
      // Everything the kitchen requires is already here: nothing for the customer to send.
      const { tierValidationService } = await import('../domains/applications/tier-validation');
      canBook = tierValidationService.validateTierRequirements(app as any, requirements as any, 2).valid;
    }
    if (canBook) await tx.update(chefKitchenApplications).set({ current_tier: 3, tier2_completed_at: now, updatedAt: now }).where(eq(chefKitchenApplications.id, app.id));
    await tx.update(kitchenCustomerInvites).set({ status: 'accepted', acceptedAt: now, acceptedBy: user.id, applicationId: app.id }).where(eq(kitchenCustomerInvites.id, invite.id));
    return { invite, applicationId: app.id, canBook, already: false };
  });
  if (outcome.already) return { applicationId: outcome.applicationId, locationId: outcome.invite.locationId, canBook: null };

  // The link proved this inbox.
  if (!user.isVerified) {
    await db.update(users).set({ isVerified: true }).where(eq(users.id, user.id));
    if (user.firebaseUid) await getAuth(initializeFirebaseAdmin()!).updateUser(user.firebaseUid, { emailVerified: true })
      .catch(error => logger.error('[Customer invites] Could not mark the Firebase email verified', { userId: user.id, error }));
  }
  const after = async (label: string, work: () => Promise<unknown>) => { try { await work(); } catch (error) { logger.error(`[Customer invites] ${label} failed`, { inviteId: outcome.invite.id, error }); } };
  const { invite } = outcome;
  const [location] = await db.select().from(locations).where(eq(locations.id, invite.locationId)).limit(1);
  if (outcome.canBook) await after('access grant', async () => { const { chefService } = await import('../domains/users/chef.service'); await chefService.grantLocationAccess(user.id, invite.locationId, invite.invitedBy ?? user.id); });
  await after('chat', async () => { const { initializeConversation } = await import('../chat-service'); await initializeConversation({ id: outcome.applicationId, chefId: user.id, locationId: invite.locationId }); });
  if (location?.managerId) await after('kitchen notice', () => notificationService.createForManager({ managerId: location.managerId!, type: 'application_new', priority: 'normal',
    title: `${invite.fullName} joined`, message: outcome.canBook ? `${invite.fullName} accepted your invitation and can book at ${location.name}.` : `${invite.fullName} accepted your invitation. They’ll send your booking requirements next.`,
    metadata: { applicationId: outcome.applicationId, locationId: invite.locationId, workflow: 'kitchen' },
    actionUrl: outcome.canBook ? `/manager/customers/${user.id}?location=${invite.locationId}` : `/manager/dashboard?view=applications&application=${outcome.applicationId}`, actionLabel: 'View' }));
  await after('admin notice', () => notifyAdmins({
    subject: `${location?.name || 'A kitchen'} added ${invite.fullName} as a customer`,
    message: `${location?.name || 'A kitchen'} added ${invite.fullName} directly${invite.requirementsChoice === 'waived' ? ', without booking requirements (the kitchen took responsibility)' : invite.requirementsChoice === 'uploaded' ? ', with documents the kitchen uploaded' : ''}. They skipped the first-step review. You can end their access from the application.`,
    facts: [{ label: 'Customer', value: `${invite.fullName} (${invite.email})` }, { label: 'Location', value: location?.name || '' }, { label: 'Application', value: `APPLICATION-${outcome.applicationId}` }],
    path: `/admin?section=kitchen-applications-step1&application=${outcome.applicationId}`, trackingPrefix: `kitchen_added_customer_${outcome.applicationId}`,
    metadata: { applicationId: outcome.applicationId, locationId: invite.locationId, workflow: 'kitchen', addedByKitchen: true, documentsWaived: invite.requirementsChoice === 'waived' } }));
  return { applicationId: outcome.applicationId, locationId: invite.locationId, canBook: outcome.canBook };
}
