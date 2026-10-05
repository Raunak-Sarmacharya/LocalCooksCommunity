import { logger } from "./logger";
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from './firebase-setup';
import { db } from './db';
import { chefKitchenApplications, users } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { sharedChatEligibility } from './services/shared-chat-access';
import { firestoreDatabaseId } from '@shared/firestore-database';

let adminDb: FirebaseFirestore.Firestore | null = null;

/**
 * Initialize Firebase Admin for server-side chat operations
 */
export async function getAdminDb() {
  if (!adminDb) {
    const app = initializeFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    adminDb = getFirestore(app, firestoreDatabaseId(process.env.FIRESTORE_DATABASE_ID, process.env.VERCEL_ENV));
    // Explicitly set settings to ignore undefined values globally for this instance
    adminDb.settings({ ignoreUndefinedProperties: true });
  }
  return adminDb;
}

export interface SystemMessageData {
  eventType: string;
  data?: any;
}

/** Compatibility entry point; caller data never establishes ownership. */
export async function initializeConversation(applicationData: { id: number; chefId: number; locationId: number }): Promise<string | null> {
  try {
  const [application] = await db.select().from(chefKitchenApplications)
    .where(eq(chefKitchenApplications.id, applicationData.id)).limit(1);
  if (!application || application.status !== 'approved' || application.chefId !== applicationData.chefId
      || application.locationId !== applicationData.locationId) return null;
  return initializeSharedConversation(application.chefId, application.locationId);
  } catch (error) {
    logger.error('Error resolving chat application:', error);
    return null;
  }
}

/** Server-owned mapping serializes tour/application opens without merging histories. */
export async function initializeSharedConversation(chefId: number, locationId: number): Promise<string | null> {
  try {
    const eligibility = await sharedChatEligibility(chefId, locationId);
    if (!eligibility) return null;
    const { location, applications } = eligibility;
    const managerId = location.managerId!;
    const participants = await db.select({ id: users.id, firebaseUid: users.firebaseUid }).from(users)
      .where(inArray(users.id, [chefId, managerId]));
    const chefFirebaseUid = participants.find(user => user.id === chefId)?.firebaseUid;
    const managerFirebaseUid = participants.find(user => user.id === managerId)?.firebaseUid;
    if (!chefFirebaseUid || !managerFirebaseUid) return null;
    const firestore = await getAdminDb();
    const conversations = firestore.collection('conversations');
    const key = `chef-${chefId}-location-${locationId}`;
    const mapping = firestore.collection('chatRelationships').doc(key);
    const approvedIds = new Set(applications.map(application => application.id));
    const valid = (data: FirebaseFirestore.DocumentData | undefined) => !!data
      && (data.chefId === chefId && data.locationId === locationId
        || approvedIds.has(data.applicationId) && (data.chefId == null || data.chefId === chefId)
          && (data.locationId == null || data.locationId === locationId));
    const candidates: string[] = [];
    for (const application of [...applications].sort((a, b) => a.id - b.id)) {
      if (application.chat_conversation_id) candidates.push(application.chat_conversation_id);
    }
    for (const application of applications) {
      const recorded = application.chat_conversation_id
        ? await conversations.doc(application.chat_conversation_id).get() : null;
      if (recorded?.exists && valid(recorded.data())) continue;
      const matches = await conversations.where('applicationId', '==', application.id).get();
      candidates.push(...matches.docs.map(doc => doc.id).sort());
    }
    const conversationId = await firestore.runTransaction(async transaction => {
      const mapped = await transaction.get(mapping);
      const mappedData = mapped.data();
      if (mapped.exists && (mappedData?.chefId !== chefId || mappedData?.locationId !== locationId
          || typeof mappedData?.conversationId !== 'string')) throw new Error('Invalid shared chat mapping');
      const ids = Array.from(new Set([...(mapped.exists ? [mappedData!.conversationId as string] : []), ...candidates, key]));
      const snapshots = await Promise.all(ids.map(id => transaction.get(conversations.doc(id))));
      if (mapped.exists && (!snapshots[0].exists || !valid(snapshots[0].data())))
        throw new Error('Invalid mapped conversation');
      const adopted = snapshots.find(snapshot => snapshot.exists && valid(snapshot.data()));
      const stable = snapshots.find(snapshot => snapshot.id === key)!;
      if (!adopted && stable.exists) throw new Error('Shared conversation ID has foreign ownership');
      const ref = adopted?.ref || conversations.doc(key);
      const metadata = { chefId, locationId, managerId, chefFirebaseUid, managerFirebaseUid,
        ...(!adopted?.data()?.applicationId && applications[0] ? { applicationId: applications[0].id } : {}),
        relationshipKey: key, identityVersion: 1,
        linkedApplicationIds: applications.map(application => application.id),
        eligibleViewingIds: eligibility.viewingIds };
      transaction.set(ref, adopted ? metadata : { ...metadata,
        ...(applications[0] ? { applicationId: applications[0].id } : {}),
        createdAt: FieldValue.serverTimestamp(), lastMessageAt: FieldValue.serverTimestamp(),
        unreadChefCount: 0, unreadManagerCount: 0 }, { merge: true });
      transaction.set(mapping, { chefId, locationId, conversationId: ref.id });
      return ref.id;
    });
    for (const application of applications) await db.update(chefKitchenApplications)
      .set({ chat_conversation_id: conversationId }).where(eq(chefKitchenApplications.id, application.id));
    return conversationId;
  } catch (error) {
    logger.error('Error initializing shared conversation:', error);
    return null;
  }
}

/**
 * Send a system notification message
 */
export async function sendSystemNotification(
  conversationId: string,
  eventType: string,
  data?: any
): Promise<void> {
  try {
    const adminDb = await getAdminDb();

    let content = '';
    switch (eventType) {
      // New flow: request to apply → admin approves (chat opens) → kitchen coordination docs → manager approves booking
      case 'TIER1_APPROVED':
        content = 'Request to apply approved. Chat is open, and kitchen documents can be submitted next.';
        break;
      case 'TIER1_REJECTED':
        content = `Request to apply was not approved. ${data?.reason || 'The request did not meet the requirements.'}`;
        break;
      case 'TIER2_COMPLETE':
        content = "You're approved to book this kitchen.";
        break;
      case 'TIER3_SUBMITTED':
        content = 'Kitchen documents submitted for review.';
        break;
      case 'TIER4_APPROVED':
        content = "You're approved to book this kitchen.";
        break;
      case 'DOCUMENT_UPLOADED':
        content = `${data?.fileName || 'A document'} was uploaded for review.`;
        break;
      case 'DOCUMENT_VERIFIED':
        content = `${data?.documentName || 'Document'} approved.`;
        break;
      case 'STATUS_CHANGED':
        content = `Application status: ${data?.status || 'updated'}.`;
        break;
      default:
        content = data?.message || 'System notification';
    }

    // Prevent duplicate system messages with same content within a short time (10s)
    const recentMessages = await adminDb
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .where('type', '==', 'system')
      .where('content', '==', content)
      .get();

    if (!recentMessages.empty) {
      const now = new Date().getTime();
      const isDuplicate = recentMessages.docs.some((doc: any) => {
        const msg = doc.data();
        const createdAt = msg.createdAt?.toDate?.() || (msg.createdAt instanceof Date ? msg.createdAt : null);
        return createdAt && (now - createdAt.getTime()) < 10000;
      });

      if (isDuplicate) {
        logger.info(`[CHAT] Skipping duplicate system message: "${content.substring(0, 30)}..."`);
        return;
      }
    }

    await adminDb
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .add({
        senderId: 0,
        senderRole: 'system',
        content,
        type: 'system',
        createdAt: FieldValue.serverTimestamp(),
        readAt: null,
      });

    // Update conversation's lastMessageAt
    await adminDb
      .collection('conversations')
      .doc(conversationId)
      .update({
        lastMessageAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logger.error('Error sending system notification:', error);
  }
}

/**
 * Get unread counts for a user
 */
export async function getUnreadCounts(
  userId: number,
  role: 'chef' | 'manager'
): Promise<number> {
  try {
    const adminDb = await getAdminDb();
    const field = role === 'chef' ? 'chefId' : 'managerId';
    const unreadField = role === 'chef' ? 'unreadChefCount' : 'unreadManagerCount';

    // Use aggregation to count total unread messages across all conversations
    // efficient: O(1) document reads (billed as 1 read per 1000 index entries)
    // Note: Depends on firebase-admin >= 11.?, we are on 13.4.0 so it is supported.
    // However, if strict types fail, we can fallback to old method or cast.

    // Check if AggregateField is supported (runtime check not needed if types pass)
    const { AggregateField } = await import('firebase-admin/firestore');

    const snapshot = await adminDb
      .collection('conversations')
      .where(field, '==', userId)
      .aggregate({
        totalUnread: AggregateField.sum(unreadField)
      })
      .get();

    return snapshot.data().totalUnread || 0;
  } catch (error) {
    logger.error('Error getting unread counts:', error);
    return 0;
  }
}

/**
 * Delete a conversation and all its messages from Firestore
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  try {
    const adminDb = await getAdminDb();

    // Delete all messages in the conversation
    const messagesRef = adminDb.collection('conversations').doc(conversationId).collection('messages');
    const messagesSnapshot = await messagesRef.get();

    // Delete messages in batches
    const batchSize = 10;
    for (let i = 0; i < messagesSnapshot.docs.length; i += batchSize) {
      const batch = adminDb.batch();
      const batchDocs = messagesSnapshot.docs.slice(i, i + batchSize);

      for (const doc of batchDocs) {
        batch.delete(doc.ref);
      }

      await batch.commit();
    }

    // Delete the conversation document
    await adminDb.collection('conversations').doc(conversationId).delete();

    logger.info(`Successfully deleted conversation ${conversationId} and all its messages`);
  } catch (error) {
    logger.error('Error deleting conversation:', error);
    throw error;
  }
}

/**
 * Map internal tier jumps to chat system events.
 * User-facing phases: request to apply → kitchen coordination → ready to book.
 */
export function phaseTransitionEvent(fromTier: number, toTier: number): string | null {
  if (toTier === 2 && fromTier === 1) return 'TIER1_APPROVED';
  if (toTier >= 3 && fromTier >= 2 && fromTier < 3) return 'TIER2_COMPLETE';
  return null;
}

/**
 * Notify chat of application-phase transitions.
 * Internal tier numbers stay for DB compatibility; user-facing copy uses:
 * request to apply → kitchen coordination → ready to book.
 */
export async function notifyTierTransition(
  applicationId: number,
  fromTier: number,
  toTier: number,
  reason?: string
): Promise<void> {
  try {
    // Get application to find conversation ID
    const [application] = await db
      .select()
      .from(chefKitchenApplications)
      .where(eq(chefKitchenApplications.id, applicationId))
      .limit(1);

    if (!application) {
      logger.error('Application not found for phase transition notification');
      return;
    }

    let conversationId = application.chat_conversation_id;

    // Chat opens when request-to-apply is approved (tier 1 → 2)
    if (!conversationId) {
      conversationId = await initializeConversation({
        id: applicationId,
        chefId: application.chefId,
        locationId: application.locationId,
      });
      if (!conversationId) {
        logger.error('Failed to initialize conversation for phase transition');
        return;
      }
    }

    const eventType = phaseTransitionEvent(fromTier, toTier);
    if (eventType === 'TIER2_COMPLETE' &&
        (application.status !== 'approved' || (application.current_tier ?? 1) < 3 || !application.tier2_completed_at)) {
      logger.warn('Skipping booking approval chat message before kitchen documents and final approval', { applicationId });
      return;
    }
    if (eventType && conversationId) {
      await sendSystemNotification(conversationId, eventType, { reason });
    }
  } catch (error) {
    logger.error('Error notifying phase transition:', error);
  }
}
