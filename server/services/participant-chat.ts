import { and, eq, inArray } from 'drizzle-orm';
import { locations, users, chefKitchenApplications, kitchenBookings, kitchens, kitchenViewings } from '@shared/schema';
import { tourGrantsChat } from './shared-chat-access';
import { db } from '../db';
import { getAdminDb } from '../chat-service';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '../logger';

export class ChatAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
// Distinct from identity/provision failures: discovery may omit revoked access.
export class ChatEligibilityError extends ChatAccessError {
  constructor() { super(403, 'Messaging requires an approved application or a qualifying tour'); }
}
// A retained noncanonical duplicate whose mapped canonical thread exists for the
// same relationship. Direct access is still denied; discovery simply ignores it.
export class ChatSupersededError extends ChatAccessError {
  constructor() { super(409, 'Open messaging from your tour or application to repair this conversation'); }
}
export type ChatActor = { id: number; role: string | null; firebaseUid: string | null };
export function assertChatActor(actor: ChatActor, uid: string, conversation: any, location: any, participants: ChatActor[]) {
  const current = participants.find(user => user.id === actor.id);
  if (!current || current.firebaseUid !== uid || current.role !== actor.role || !location ||
      !(current.role === 'chef' && current.id === conversation.chefId ||
        current.role === 'manager' && current.id === location.managerId))
    throw new ChatAccessError(404, 'Conversation is unavailable for this account');
}

/** Every operation holds SQL share locks until Firestore finishes. Assignment,
 * UID/role updates and deletion serialize with these locks; there is no cross-store commit. */
export async function withParticipantChat<T>(actor: ChatActor, uid: string, id: string,
  action: (context: { firestore: FirebaseFirestore.Firestore; ref: FirebaseFirestore.DocumentReference;
    data: FirebaseFirestore.DocumentData; role: 'chef' | 'manager'; live: boolean;
    applicationIds: number[]; managerId: number | null }) => Promise<T>,
  options: { discovery?: boolean; admin?: boolean } = {}): Promise<T> {
  if (!id || id.includes('/') || id.length > 300) throw new ChatAccessError(400, 'Invalid conversation');
  const firestore = await getAdminDb(), ref = firestore.collection('conversations').doc(id);
  const snapshot = await ref.get(), data = snapshot.data();
  if (!data) throw new ChatAccessError(404, 'Conversation not found');
  return db.transaction(async tx => {
    const [location] = await tx.select().from(locations).where(eq(locations.id, data.locationId)).for('share');
    const participants = await tx.select().from(users).where(inArray(users.id,
      Array.from(new Set([data.chefId, location?.managerId, actor.id].filter((id): id is number => Number.isSafeInteger(id)))))).for('share');
    if (options.admin) {
      if (actor.role !== 'admin' || !participants.some(user => user.id === actor.id && user.role === 'admin' && user.firebaseUid === uid) || !location)
        throw new ChatAccessError(404, 'Conversation is unavailable for this account');
    } else assertChatActor(actor, uid, data, location, participants);
    const mapping = await firestore.collection('chatRelationships').doc(`chef-${data.chefId}-location-${data.locationId}`).get();
    // Orphan history has no provisioning source; it remains readable for its survivor.
    const live = participants.some(user => user.id === data.chefId && user.role === 'chef' && !!user.firebaseUid) &&
      participants.some(user => user.id === location.managerId && user.role === 'manager' && !!user.firebaseUid);
    if (options.admin && !live) throw new ChatAccessError(409, 'The other account is no longer available');
    const applications = await tx.select({ id: chefKitchenApplications.id }).from(chefKitchenApplications).where(and(
      eq(chefKitchenApplications.chefId, data.chefId), eq(chefKitchenApplications.locationId, data.locationId),
      eq(chefKitchenApplications.status, 'approved'))).for('share');
    const tours = await tx.select({ status: kitchenViewings.status, adminReviewDecision: kitchenViewings.adminReviewDecision,
      outcomeHistory: kitchenViewings.outcomeHistory }).from(kitchenViewings).where(and(
      eq(kitchenViewings.chefId, data.chefId), eq(kitchenViewings.locationId, data.locationId))).for('share');
    // Mapping chooses history only. Lock qualifying source rows until the
    // operation completes so rejection/outcome changes cannot race this grant.
    // Live relationships are listed only through the authoritative C1 resolver;
    // discovery must not pre-validate (and fail on) unmapped or duplicate live threads.
    if (options.discovery && live) throw new ChatSupersededError();
    if (live && !applications.length && !tours.some(tourGrantsChat)) throw new ChatEligibilityError();
    if (mapping.exists ? mapping.data()?.conversationId !== id : live) {
      const canonicalId = mapping.exists ? mapping.data()?.conversationId : null;
      const canonical = typeof canonicalId === 'string' && canonicalId && !canonicalId.includes('/')
        ? (await firestore.collection('conversations').doc(canonicalId).get()).data() : null;
      if (canonical && canonical.chefId === data.chefId && canonical.locationId === data.locationId) throw new ChatSupersededError();
      throw new ChatAccessError(409, 'Open messaging from your tour or application to repair this conversation');
    }
    if (!mapping.exists && !live) {
      const history = await firestore.collection('conversations').where('chefId', '==', data.chefId).get();
      const candidates = history.docs.filter(doc => doc.data().locationId === data.locationId);
      if (candidates.length !== 1 || candidates[0].id !== id)
        throw new ChatAccessError(409, 'Multiple historical threads need Local Cooks review before a shared history can be selected');
    }
    return action({ firestore, ref, data, role: actor.role as 'chef' | 'manager', live,
      applicationIds: applications.map(app => app.id), managerId: location.managerId });
  });
}

export async function orphanChatHistory(actor: ChatActor, uid: string) {
  const firestore = await getAdminDb();
  const ownedLocations = actor.role === 'manager' ? await db.select({ id: locations.id }).from(locations).where(eq(locations.managerId, actor.id)) : [];
  const snapshots = actor.role === 'chef'
    ? [await firestore.collection('conversations').where('chefId', '==', actor.id).get()]
    : await Promise.all(ownedLocations.map(location => firestore.collection('conversations').where('locationId', '==', location.id).get()));
  const rows: any[] = [];
  const history = snapshots.flatMap(snapshot => snapshot.docs).sort((a, b) =>
    (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0) || a.id.localeCompare(b.id));
  for (const snapshot of history) {
    try {
      const row = await withParticipantChat(actor, uid, snapshot.id, async ({ live, data, managerId, applicationIds }) => {
        if (live) return null;
        return { id: snapshot.id, conversationId: snapshot.id, chefId: data.chefId, locationId: data.locationId, managerId,
          linkedApplicationIds: applicationIds, eligibleViewingIds: [], conversation: serializeChat({ ...data, id: snapshot.id, unavailable: true,
            unavailableRole: actor.role === 'chef' ? 'manager' : 'chef' }) };
      }, { discovery: true });
      if (row && !rows.some(previous => previous.chefId === row.chefId && previous.locationId === row.locationId)) rows.push(row);
    } catch (error) {
      if (!(error instanceof ChatEligibilityError || error instanceof ChatSupersededError ||
        error instanceof ChatAccessError && error.status === 404)) throw error;
    }
  }
  return rows;
}

export function serializeChat(data: any): any {
  if (data?.toDate instanceof Function) return data.toDate().toISOString();
  if (Array.isArray(data)) return data.map(serializeChat);
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, serializeChat(value)]));
  return data;
}

export function validateParticipantMessage(body: any) {
  if (!body || Object.keys(body).some(key => !['content', 'type', 'fileUrl', 'fileName', 'bookingId'].includes(key)) ||
      typeof body.content !== 'string' || body.content.length > 10000 || !['text', 'file'].includes(body.type) ||
      (!body.content.trim() && !body.fileUrl) || (body.type === 'text' && (body.fileUrl || body.fileName)) ||
      (body.type === 'file' && (typeof body.fileUrl !== 'string' || body.fileUrl.length > 2000 ||
        typeof body.fileName !== 'string' || !body.fileName.trim() || body.fileName.length > 255)) ||
      (body.bookingId != null && (!Number.isSafeInteger(body.bookingId) || body.bookingId <= 0)))
    throw new ChatAccessError(400, 'Invalid message');
}

export async function sendParticipantMessage(actor: ChatActor, uid: string, id: string, body: any) {
  validateParticipantMessage(body);
  const sent = await withParticipantChat(actor, uid, id, async ({ firestore, ref, role, live, applicationIds, data, managerId }) => {
    if (!live) throw new ChatAccessError(409, 'The other account is no longer available');
    if (body.bookingId) {
      const [booking] = await db.select({ chefId: kitchenBookings.chefId, locationId: kitchens.locationId }).from(kitchenBookings)
        .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id)).where(eq(kitchenBookings.id, body.bookingId)).limit(1);
      if (!booking || booking.chefId !== data.chefId || booking.locationId !== data.locationId || !applicationIds.length)
        throw new ChatAccessError(403, 'Booking context is unavailable');
    }
    if (body.type === 'file') {
      const { authorizeChatAttachment } = await import('./chat-file-access');
      await authorizeChatAttachment(actor, id, data, applicationIds, body.fileUrl);
    }
    return persistChatMessage(firestore, ref, { senderId: actor.id, senderRole: role, senderFirebaseUid: uid,
      content: body.content.trim(), type: body.type, fileUrl: body.fileUrl || null, fileName: body.fileName || null,
      ...(body.bookingId ? { bookingId: body.bookingId } : {}) }, role === 'chef' ? managerId! : data.chefId);
  });
  if (process.env.NODE_ENV === 'development' && !process.env.VERCEL) {
    try {
      const { queueLocalChatMessageEmail } = await import('./local-chat-emails');
      await queueLocalChatMessageEmail(id, sent.id, actor.id);
    } catch (error) {
      // The message is already saved. Returning an error would invite a duplicate send.
      logger.error('Local chat email could not be queued', { err: error, conversationId: id, messageId: sent.id });
    }
  }
  return sent;
}

/** Caller has already authorized the sender. The message and unread episode
 * commit together; Firestore retries competing sends/reads against this document. */
export async function persistChatMessage(firestore: FirebaseFirestore.Firestore, ref: FirebaseFirestore.DocumentReference,
  payload: { senderId: number; senderRole: 'chef' | 'manager' | 'admin'; senderFirebaseUid: string;
    content: string; type: string; fileUrl: string | null; fileName: string | null; bookingId?: number }, recipientId: number, managerId?: number) {
  const message = ref.collection('messages').doc();
  await firestore.runTransaction(async tx => {
    const snapshot = await tx.get(ref), conversation = snapshot.data();
    if (!conversation || conversation.unavailable) throw new ChatAccessError(409, 'Conversation is unavailable');
    if (payload.senderRole === 'admin' && managerId != null) {
      const recipientStates: Record<string, any> = {}, updates: Record<string, any> = {};
      for (const [role, id] of [['Chef', recipientId], ['Manager', managerId]] as const) {
        const prior = conversation[`email${role}Episode`];
        const episodeId = prior?.recipientId === id && typeof prior.id === 'string' && prior.id && !prior.id.includes('/') ? prior.id : message.id;
        recipientStates[role.toLowerCase()] = { recipientId: id, episodeId, readAt: null };
        updates[`unread${role}Count`] = FieldValue.increment(1);
        updates[`archived${role}At`] = FieldValue.delete();
        updates[`email${role}Episode`] = { id: episodeId, recipientId: id };
      }
      tx.set(message, { ...payload, adminAudience: 'both', recipientStates, createdAt: FieldValue.serverTimestamp(), readAt: null });
      tx.update(ref, { ...updates, lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageText: payload.type === 'file' ? payload.fileName || 'Attachment' : payload.content.slice(0, 240) });
      return;
    }
    const recipientRole = payload.senderRole === 'chef' ? 'Manager' : 'Chef';
    const field = `email${recipientRole}Episode`;
    const prior = conversation[field];
    const episodeId = prior?.recipientId === recipientId && typeof prior.id === 'string' && prior.id && !prior.id.includes('/') ? prior.id : message.id;
    tx.set(message, { ...payload, emailEpisodeId: episodeId, emailRecipientId: recipientId,
      createdAt: FieldValue.serverTimestamp(), readAt: null });
    tx.update(ref, { lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: payload.type === 'file' ? payload.fileName || 'Attachment' : payload.content.slice(0, 240),
      [`unread${recipientRole}Count`]: FieldValue.increment(1), [`archived${recipientRole}At`]: FieldValue.delete(),
      [field]: { id: episodeId, recipientId },
      // Replying ends the sender's pending notification episode, even if some
      // older messages remain unread. Admin replies don't acknowledge a chef.
      ...(payload.senderRole === 'admin' ? {} : { [`email${payload.senderRole === 'chef' ? 'Chef' : 'Manager'}Episode`]: FieldValue.delete() }) });
  });
  return { id: message.id };
}

export async function readParticipantMessages(actor: ChatActor, uid: string, id: string, ids: unknown) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id || id.includes('/')))
    throw new ChatAccessError(400, 'Invalid visible messages');
  return withParticipantChat(actor, uid, id, async ({ firestore, ref, role }) => {
    await firestore.runTransaction(async tx => {
      const conversation = await tx.get(ref);
      const messages = await Promise.all(Array.from(new Set(ids)).map(id => tx.get(ref.collection('messages').doc(id))));
      const unread = messages.filter(message => {
        const data = message.data();
        if (!message.exists) return false;
        if (data?.senderRole === 'admin' && data.adminAudience === 'both') {
          const recipient = data.recipientStates?.[role];
          return recipient?.recipientId === actor.id && !recipient.readAt;
        }
        return !data?.readAt && (role === 'chef' ? ['manager', 'admin'].includes(data!.senderRole) : data!.senderRole === 'chef');
      });
      unread.forEach(message => tx.update(message.ref, {
        [message.data()?.senderRole === 'admin' && message.data()?.adminAudience === 'both' ? `recipientStates.${role}.readAt` : 'readAt']: FieldValue.serverTimestamp()
      }));
      const field = role === 'chef' ? 'unreadChefCount' : 'unreadManagerCount';
      const remaining = Math.max(0, (conversation.data()?.[field] || 0) - unread.length);
      tx.update(ref, { [field]: remaining,
        ...(remaining === 0 ? { [`email${role === 'chef' ? 'Chef' : 'Manager'}Episode`]: FieldValue.delete() } : {}) });
    });
  });
}
