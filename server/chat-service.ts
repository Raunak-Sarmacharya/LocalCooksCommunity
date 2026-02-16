import { logger } from "./logger";
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from './firebase-setup';
import { db } from './db';
import { chefKitchenApplications, locations } from '@shared/schema';
import { eq } from 'drizzle-orm';

let adminDb: FirebaseFirestore.Firestore | null = null;

/**
 * Initialize Firebase Admin for server-side chat operations
 */
async function getAdminDb() {
  if (!adminDb) {
    const app = initializeFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    adminDb = getFirestore(app);
    // Explicitly set settings to ignore undefined values globally for this instance
    adminDb.settings({ ignoreUndefinedProperties: true });
  }
  return adminDb;
}

export interface SystemMessageData {
  eventType: string;
  data?: any;
}

/**
 * Initialize a conversation for an application
 * Called when an application is created or approved
 */
export async function initializeConversation(applicationData: {
  id: number;
  chefId: number;
  locationId: number;
}): Promise<string | null> {
  try {
    const adminDb = await getAdminDb();

    // Get manager ID from location using Drizzle ORM
    const [location] = await db
      .select({ managerId: locations.managerId })
      .from(locations)
      .where(eq(locations.id, applicationData.locationId))
      .limit(1);

    if (!location || !location.managerId) {
      logger.error('Location not found or has no manager');
      return null;
    }

    const managerId = location.managerId;

    // Check if conversation already exists
    const existingQuery = await adminDb
      .collection('conversations')
      .where('applicationId', '==', applicationData.id)
      .limit(1)
      .get();

    if (!existingQuery.empty) {
      return existingQuery.docs[0].id;
    }

    // Create new conversation
    const conversationRef = await adminDb.collection('conversations').add({
      applicationId: applicationData.id,
      chefId: applicationData.chefId,
      managerId: managerId,
      locationId: applicationData.locationId,
      createdAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      unreadChefCount: 0,
      unreadManagerCount: 0,
    });

    // Update application with conversation ID
    await db
      .update(chefKitchenApplications)
      .set({ chat_conversation_id: conversationRef.id })
      .where(eq(chefKitchenApplications.id, applicationData.id));

    return conversationRef.id;
  } catch (error) {
    logger.error('Error initializing conversation:', error);
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
      case 'TIER1_APPROVED':
        content = `✅ Step 1 Approved: Your food handler certificate has been verified. You can now proceed to Step 2 - Kitchen Coordination.`;
        break;
      case 'TIER1_REJECTED':
        content = `❌ Step 1 Rejected: ${data?.reason || 'Your application did not meet the requirements.'}`;
        break;
      case 'TIER2_COMPLETE':
        content = `✅ Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved.`;
        break;
      case 'TIER3_SUBMITTED':
        content = `📋 Step 3 Submitted: Your government application has been submitted. We'll notify you once it's approved.`;
        break;
      case 'TIER4_APPROVED':
        content = `🎉 Step 4 Approved: Congratulations! Your license has been entered and you're fully approved to use the kitchen.`;
        break;
      case 'DOCUMENT_UPLOADED':
        content = `📄 Document Uploaded: ${data?.fileName || 'A document'} has been uploaded for review.`;
        break;
      case 'DOCUMENT_VERIFIED':
        content = `✅ Document Verified: ${data?.documentName || 'Your document'} has been verified.`;
        break;
      case 'STATUS_CHANGED':
        content = `📊 Status Changed: Application status updated to ${data?.status || 'new status'}.`;
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
 * Helper: Send tier transition notifications
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
      logger.error('Application not found for tier transition notification');
      return;
    }

    let conversationId = application.chat_conversation_id;

    // Initialize conversation if it doesn't exist
    if (!conversationId) {
      conversationId = await initializeConversation({
        id: applicationId,
        chefId: application.chefId,
        locationId: application.locationId,
      });
      if (!conversationId) {
        logger.error('Failed to initialize conversation for tier transition');
        return;
      }
    }

    let eventType = '';
    if (toTier === 2 && fromTier === 1) {
      eventType = 'TIER1_APPROVED';
    } else if (toTier === 3 && fromTier === 2) {
      eventType = 'TIER2_COMPLETE';
    } else if (toTier === 4) {
      eventType = 'TIER4_APPROVED';
    }

    if (eventType && conversationId) {
      await sendSystemNotification(conversationId, eventType, { reason });
    }
  } catch (error) {
    logger.error('Error notifying tier transition:', error);
  }
}
