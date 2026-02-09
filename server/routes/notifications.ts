/**
 * Manager Notifications API Routes
 * 
 * Enterprise-grade notification center for the manager portal.
 * Provides CRUD operations for notifications with filtering, pagination,
 * and real-time unread count support.
 */

import { Router, Request, Response } from "express";
import { eq, and, desc, count, sql, isNull, or, lte } from "drizzle-orm";
import { db } from "../db";
import { requireFirebaseAuthWithUser, requireManager } from "../firebase-auth-middleware";
import { logger } from "../logger";
import { errorResponse } from "../api-response";

const router = Router();

// ===================================
// NOTIFICATION TYPES & INTERFACES
// ===================================

type NotificationType = 
  | 'booking_new' 
  | 'booking_cancelled' 
  | 'booking_confirmed'
  | 'application_new' 
  | 'application_approved' 
  | 'application_rejected'
  | 'storage_expiring' 
  | 'storage_expired'
  | 'payment_received' 
  | 'payment_failed'
  | 'license_expiring' 
  | 'license_approved' 
  | 'license_rejected'
  | 'system_announcement' 
  | 'message_received';

type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

interface CreateNotificationParams {
  managerId: number;
  locationId?: number;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  actionUrl?: string;
  actionLabel?: string;
  expiresAt?: Date;
}

// ===================================
// NOTIFICATION SERVICE
// ===================================

/**
 * Create a new notification for a manager
 */
async function createNotification(params: CreateNotificationParams) {
  const {
    managerId,
    locationId,
    type,
    priority = 'normal',
    title,
    message,
    metadata = {},
    actionUrl,
    actionLabel,
    expiresAt
  } = params;

  const result = await db.execute(sql`
    INSERT INTO manager_notifications 
    (manager_id, location_id, type, priority, title, message, metadata, action_url, action_label, expires_at)
    VALUES (
      ${managerId}, 
      ${locationId || null}, 
      ${type}::notification_type, 
      ${priority}::notification_priority, 
      ${title}, 
      ${message}, 
      ${JSON.stringify(metadata)}::jsonb, 
      ${actionUrl || null}, 
      ${actionLabel || null}, 
      ${expiresAt ? expiresAt.toISOString() : null}
    )
    RETURNING *
  `);

  return result.rows[0];
}

/**
 * Get notifications for a manager with filtering and pagination
 */
async function getNotifications(
  managerId: number,
  options: {
    page?: number;
    limit?: number;
    filter?: 'all' | 'unread' | 'read' | 'archived';
    type?: NotificationType;
    locationId?: number;
  } = {}
) {
  const { 
    page = 1, 
    limit = 20, 
    filter = 'all',
    type,
    locationId 
  } = options;
  
  const offset = (page - 1) * limit;

  // CRIT-2 Security: Build filter conditions using parameterized queries (no sql.raw)
  let filterCondition = sql`AND is_archived = false`;
  if (filter === 'unread') {
    filterCondition = sql`AND is_read = false AND is_archived = false`;
  } else if (filter === 'read') {
    filterCondition = sql`AND is_read = true AND is_archived = false`;
  } else if (filter === 'archived') {
    filterCondition = sql`AND is_archived = true`;
  }

  const typeCondition = type ? sql`AND type = ${type}::notification_type` : sql``;
  const locationCondition = locationId ? sql`AND (location_id = ${locationId} OR location_id IS NULL)` : sql``;

  // Get notifications with pagination
  const notificationsResult = await db.execute(sql`
    SELECT 
      id, manager_id, location_id, type, priority, title, message, 
      metadata, is_read, read_at, is_archived, archived_at, 
      action_url, action_label, created_at, expires_at
    FROM manager_notifications
    WHERE manager_id = ${managerId}
      AND (expires_at IS NULL OR expires_at > NOW())
      ${filterCondition}
      ${typeCondition}
      ${locationCondition}
    ORDER BY 
      CASE WHEN priority = 'urgent' THEN 0
           WHEN priority = 'high' THEN 1
           WHEN priority = 'normal' THEN 2
           ELSE 3 END,
      created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  // Get total count
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as total
    FROM manager_notifications
    WHERE manager_id = ${managerId}
      AND (expires_at IS NULL OR expires_at > NOW())
      ${filterCondition}
      ${typeCondition}
      ${locationCondition}
  `);

  const total = parseInt((countResult.rows[0] as any)?.total || '0', 10);

  return {
    notifications: notificationsResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total
    }
  };
}

/**
 * Get unread notification count for a manager
 * When locationId is provided, includes both location-specific AND global (null location) notifications
 */
async function getUnreadCount(managerId: number, locationId?: number) {
  // CRIT-2 Security: Parameterized query — no sql.raw()
  const locationCondition = locationId 
    ? sql`AND (location_id = ${locationId} OR location_id IS NULL)` 
    : sql``;
  
  const result = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM manager_notifications
    WHERE manager_id = ${managerId}
      AND is_read = false
      AND is_archived = false
      AND (expires_at IS NULL OR expires_at > NOW())
      ${locationCondition}
  `);

  return parseInt((result.rows[0] as any)?.count || '0', 10);
}

/**
 * Mark notification(s) as read
 */
async function markAsRead(managerId: number, notificationIds: number[]) {
  if (notificationIds.length === 0) return { updated: 0 };

  const result = await db.execute(sql`
    UPDATE manager_notifications
    SET is_read = true, read_at = NOW()
    WHERE manager_id = ${managerId}
      AND id IN (${sql.join(notificationIds.map(id => sql`${id}`), sql`, `)})
      AND is_read = false
  `);

  return { updated: result.rowCount || 0 };
}

/**
 * Mark all notifications as read for a manager
 */
async function markAllAsRead(managerId: number, locationId?: number) {
  const locationCondition = locationId ? sql`AND location_id = ${locationId}` : sql``;
  
  const result = await db.execute(sql`
    UPDATE manager_notifications
    SET is_read = true, read_at = NOW()
    WHERE manager_id = ${managerId}
      AND is_read = false
      ${locationCondition}
  `);

  return { updated: result.rowCount || 0 };
}

/**
 * Archive notification(s)
 */
async function archiveNotifications(managerId: number, notificationIds: number[]) {
  if (notificationIds.length === 0) return { updated: 0 };

  const result = await db.execute(sql`
    UPDATE manager_notifications
    SET is_archived = true, archived_at = NOW()
    WHERE manager_id = ${managerId}
      AND id IN (${sql.join(notificationIds.map(id => sql`${id}`), sql`, `)})
      AND is_archived = false
  `);

  return { updated: result.rowCount || 0 };
}

/**
 * Unarchive notification(s)
 */
async function unarchiveNotifications(managerId: number, notificationIds: number[]) {
  if (notificationIds.length === 0) return { updated: 0 };

  const result = await db.execute(sql`
    UPDATE manager_notifications
    SET is_archived = false, archived_at = NULL
    WHERE manager_id = ${managerId}
      AND id IN (${sql.join(notificationIds.map(id => sql`${id}`), sql`, `)})
      AND is_archived = true
  `);

  return { updated: result.rowCount || 0 };
}

/**
 * Delete old archived notifications (cleanup job)
 */
async function cleanupOldNotifications(daysOld: number = 90) {
  const result = await db.execute(sql`
    DELETE FROM manager_notifications
    WHERE is_archived = true
      AND archived_at < NOW() - INTERVAL '${sql.raw(String(daysOld))} days'
  `);

  return { deleted: result.rowCount || 0 };
}

// ===================================
// API ROUTES
// ===================================

/**
 * GET /api/manager/notifications
 * Get notifications for the authenticated manager
 */
router.get("/", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const managerId = req.neonUser!.id;
    const { page, limit, filter, type, locationId } = req.query;

    const result = await getNotifications(managerId, {
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      filter: filter as any,
      type: type as NotificationType,
      locationId: locationId ? parseInt(locationId as string) : undefined
    });

    res.json(result);
  } catch (error) {
    logger.error("Error fetching notifications:", error);
    return errorResponse(res, error);
  }
});

/**
 * GET /api/manager/notifications/unread-count
 * Get unread notification count
 */
router.get("/unread-count", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const managerId = req.neonUser!.id;
    const { locationId } = req.query;

    const count = await getUnreadCount(
      managerId, 
      locationId ? parseInt(locationId as string) : undefined
    );

    res.json({ count });
  } catch (error) {
    logger.error("Error fetching unread count:", error);
    return errorResponse(res, error);
  }
});

/**
 * POST /api/manager/notifications/mark-read
 * Mark specific notifications as read
 */
router.post("/mark-read", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const managerId = req.neonUser!.id;
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds)) {
      return res.status(400).json({ error: "notificationIds must be an array" });
    }

    const result = await markAsRead(managerId, notificationIds);
    res.json(result);
  } catch (error) {
    logger.error("Error marking notifications as read:", error);
    return errorResponse(res, error);
  }
});

/**
 * POST /api/manager/notifications/mark-all-read
 * Mark all notifications as read
 */
router.post("/mark-all-read", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const managerId = req.neonUser!.id;
    const { locationId } = req.body;

    const result = await markAllAsRead(
      managerId,
      locationId ? parseInt(locationId) : undefined
    );
    res.json(result);
  } catch (error) {
    logger.error("Error marking all as read:", error);
    return errorResponse(res, error);
  }
});

/**
 * POST /api/manager/notifications/archive
 * Archive specific notifications
 */
router.post("/archive", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const managerId = req.neonUser!.id;
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds)) {
      return res.status(400).json({ error: "notificationIds must be an array" });
    }

    const result = await archiveNotifications(managerId, notificationIds);
    res.json(result);
  } catch (error) {
    logger.error("Error archiving notifications:", error);
    return errorResponse(res, error);
  }
});

/**
 * POST /api/manager/notifications/unarchive
 * Unarchive specific notifications
 */
router.post("/unarchive", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const managerId = req.neonUser!.id;
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds)) {
      return res.status(400).json({ error: "notificationIds must be an array" });
    }

    const result = await unarchiveNotifications(managerId, notificationIds);
    res.json(result);
  } catch (error) {
    logger.error("Error unarchiving notifications:", error);
    return errorResponse(res, error);
  }
});

/**
 * POST /api/manager/notifications/message-received
 * Trigger a notification when a manager receives a new message from a chef
 * Called by the client after a message is sent in the chat
 */
router.post("/message-received", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const { managerId, locationId, senderName, messagePreview, conversationId } = req.body;

    if (!managerId || !senderName || !conversationId) {
      return res.status(400).json({ error: "managerId, senderName, and conversationId are required" });
    }

    // Create notification for the manager
    await createNotification({
      managerId,
      locationId,
      type: 'message_received',
      priority: 'normal',
      title: `Message from ${senderName}`,
      message: messagePreview?.length > 100 
        ? `${messagePreview.substring(0, 100)}...` 
        : (messagePreview || "You have a new message"),
      metadata: {
        senderName,
        conversationId
      },
      actionUrl: `/manager/booking/:id`,
      actionLabel: 'View Message'
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Error creating message notification:", error);
    return errorResponse(res, error);
  }
});

/**
 * DELETE /api/manager/notifications/:id
 * Delete a specific notification (permanently)
 */
router.delete("/:id", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
  try {
    const managerId = req.neonUser!.id;
    const notificationId = parseInt(req.params.id);

    const result = await db.execute(sql`
      DELETE FROM manager_notifications
      WHERE id = ${notificationId}
        AND manager_id = ${managerId}
    `);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ deleted: true });
  } catch (error) {
    logger.error("Error deleting notification:", error);
    return errorResponse(res, error);
  }
});

// ===================================
// EXPORTED SERVICE FUNCTIONS
// ===================================

export { 
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotifications,
  cleanupOldNotifications,
  NotificationType,
  NotificationPriority,
  CreateNotificationParams
};

export default router;
