/**
 * Firebase Cloud Functions for LocalCooks
 * 
 * This module contains Firestore triggers for real-time notifications:
 * - onNewChatMessage: Triggers when a new message is added to a conversation
 * 
 * Enterprise-grade implementation with:
 * - Proper error handling and logging
 * - Database connection pooling
 * - Idempotency checks to prevent duplicate notifications
 * - Type safety throughout
 */

import { onDocumentCreated, FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { Pool } from "pg";

// Initialize Firebase Admin SDK
admin.initializeApp();

// Firestore reference
const firestore = admin.firestore();

// PostgreSQL connection pool for Neon database
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    // Read from environment variable (set via .env file or Firebase config)
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error("DATABASE_URL not configured. Set it in .env file.");
    }

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5, // Limit connections for serverless
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

type NotificationPriority = "low" | "normal" | "high" | "urgent";

interface CreateInAppNotificationParams {
  userId: number;
  target: "chef" | "manager";
  locationId?: number;
  title: string;
  message: string;
  priority?: NotificationPriority;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create an in-app notification in Neon (manager_notifications or chef_notifications).
 */
async function createInAppNotification(params: CreateInAppNotificationParams): Promise<number | null> {
  const {
    userId,
    target,
    locationId,
    title,
    message,
    priority = "normal",
    actionUrl,
    metadata,
  } = params;

  try {
    const db = getPool();
    const metaJson = metadata ? JSON.stringify(metadata) : null;

    if (target === "manager") {
      const result = await db.query(
        `INSERT INTO manager_notifications 
         (manager_id, location_id, type, title, message, priority, action_url, metadata, is_read, is_archived, created_at)
         VALUES ($1, $2, 'message_received'::notification_type, $3, $4, $5::notification_priority, $6, $7, false, false, NOW())
         RETURNING id`,
        [userId, locationId || null, title, message, priority, actionUrl || null, metaJson]
      );
      const notificationId = result.rows[0]?.id;
      logger.info(`Created manager notification ${notificationId} for ${userId}`);
      return notificationId;
    }

    const result = await db.query(
      `INSERT INTO chef_notifications 
       (chef_id, type, title, message, priority, action_url, metadata, is_read, is_archived, created_at)
       VALUES ($1, 'message_received'::chef_notification_type, $2, $3, $4::chef_notification_priority, $5, $6, false, false, NOW())
       RETURNING id`,
      [userId, title, message, priority, actionUrl || null, metaJson]
    );
    const notificationId = result.rows[0]?.id;
    logger.info(`Created chef notification ${notificationId} for ${userId}`);
    return notificationId;
  } catch (error) {
    logger.error("Error creating notification:", error);
    return null;
  }
}

/**
 * Get user details from the database
 */
async function getUserById(userId: number): Promise<{ id: number; username: string } | null> {
  try {
    const db = getPool();
    const result = await db.query(
      "SELECT id, username FROM users WHERE id = $1",
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error("Error getting user:", error);
    return null;
  }
}

/**
 * Check if a notification was already created for this message (idempotency)
 */
async function notificationExists(messageId: string, conversationId: string): Promise<boolean> {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id FROM manager_notifications 
       WHERE type = 'message_received' 
       AND metadata->>'messageId' = $1 
       AND metadata->>'conversationId' = $2
       UNION ALL
       SELECT id FROM chef_notifications 
       WHERE type = 'message_received' 
       AND metadata->>'messageId' = $1 
       AND metadata->>'conversationId' = $2
       LIMIT 1`,
      [messageId, conversationId]
    );
    return result.rows.length > 0;
  } catch (error) {
    logger.error("Error checking notification existence:", error);
    return false; // Proceed with creation on error
  }
}

/**
 * Firestore Trigger: When a new message is added to a conversation
 * 
 * Path: conversations/{conversationId}/messages/{messageId}
 * 
 * This function:
 * 1. Reads the new message data
 * 2. Gets the conversation to find the recipient
 * 3. Creates a notification in the Neon database for the recipient
 * 4. Skips system messages and self-notifications
 */
export const onNewChatMessage = onDocumentCreated(
  {
    document: "conversations/{conversationId}/messages/{messageId}",
    region: "us-east1", // Match your Neon region for lower latency
    memory: "256MiB",
    timeoutSeconds: 30,
    maxInstances: 10,
  },
  async (event: FirestoreEvent<QueryDocumentSnapshot | undefined, { conversationId: string; messageId: string }>) => {
    const snap = event.data;
    if (!snap) {
      logger.warn("No data in event");
      return;
    }

    const { conversationId, messageId } = event.params;
    const messageData = snap.data();

    logger.info(`New message in conversation ${conversationId}:`, {
      messageId,
      senderId: messageData.senderId,
      senderRole: messageData.senderRole,
      type: messageData.type,
    });

    // Skip system messages - they don't need notifications
    if (messageData.senderRole === "system" || messageData.type === "system") {
      logger.info("Skipping system message notification");
      return;
    }

    // Skip if sender ID is invalid
    if (!messageData.senderId || messageData.senderId === 0) {
      logger.warn("Skipping message with invalid senderId");
      return;
    }

    // Idempotency check - prevent duplicate notifications on retries
    const alreadyNotified = await notificationExists(messageId, conversationId);
    if (alreadyNotified) {
      logger.info("Notification already exists for this message, skipping");
      return;
    }

    try {
      // Get the conversation to find recipient
      const conversationRef = firestore.collection("conversations").doc(conversationId);
      const conversationSnap = await conversationRef.get();

      if (!conversationSnap.exists) {
        logger.error(`Conversation ${conversationId} not found`);
        return;
      }

      const conversation = conversationSnap.data();
      if (!conversation) {
        logger.error("Conversation data is empty");
        return;
      }

      // Determine recipient based on sender role
      let recipientId: number;
      let recipientRole: "chef" | "manager";

      if (messageData.senderRole === "chef") {
        // Chef sent message -> notify manager
        recipientId = conversation.managerId;
        recipientRole = "manager";
      } else if (messageData.senderRole === "manager") {
        // Manager sent message -> notify chef
        recipientId = conversation.chefId;
        recipientRole = "chef";
      } else {
        logger.warn(`Unknown sender role: ${messageData.senderRole}`);
        return;
      }

      // Validate recipient ID
      if (!recipientId || recipientId === 0) {
        logger.warn(`Invalid recipient ID for ${recipientRole}: ${recipientId}`);
        return;
      }

      // Get sender details for the notification
      const sender = await getUserById(messageData.senderId);
      const senderName = sender?.username || "Someone";

      // Truncate message content for notification preview
      const contentPreview = messageData.content?.length > 100 
        ? messageData.content.substring(0, 100) + "..." 
        : messageData.content || "Sent a message";

      const actionUrl =
        recipientRole === "chef"
          ? `/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}`
          : `/manager/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}`;

      await createInAppNotification({
        userId: recipientId,
        target: recipientRole,
        locationId: conversation.locationId || undefined,
        title: `New message from ${senderName}`,
        message: contentPreview,
        priority: "normal",
        actionUrl,
        metadata: {
          conversationId,
          messageId,
          applicationId: conversation.applicationId,
          senderId: messageData.senderId,
          senderName,
          senderRole: messageData.senderRole,
        },
      });

      logger.info(`Message notification created for ${recipientRole} ${recipientId}`);
    } catch (error) {
      logger.error("Error processing new message:", error);
      throw error; // Rethrow to trigger retry
    }
  }
);

/**
 * Cleanup: Close pool on function termination
 * Note: In Cloud Functions, this is handled automatically,
 * but we include it for completeness
 */
process.on("SIGTERM", async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
});
