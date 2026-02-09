/**
 * Chef Notifications API Routes
 * 
 * Enterprise-grade notification center for the chef portal.
 * Uses the UNIFIED notification service from notification.service.ts
 * to ensure consistency with the manager notification system.
 * 
 * Database queries for reading notifications are kept here since they're
 * specific to the chef_notifications table, but notification creation
 * uses the shared service.
 */

import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { logger } from "../logger";
import { errorResponse } from "../api-response";
import { notificationService } from "../services/notification.service";
import type { NotificationType, NotificationPriority } from "../services/notification.service";

const router = Router();

// ===================================
// DATABASE QUERY FUNCTIONS
// These are specific to reading from chef_notifications table
// For creating notifications, use notificationService.createForChef()
// ===================================

/**
 * Get notifications for a chef with filtering and pagination
 */
async function getNotifications(
  chefId: number,
  options: {
    page?: number;
    limit?: number;
    filter?: 'all' | 'unread' | 'read' | 'archived';
    type?: NotificationType;
  } = {}
) {
  const {
    page = 1,
    limit = 20,
    filter = 'all',
    type
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

  const typeCondition = type ? sql`AND type = ${type}::chef_notification_type` : sql``;

  // Get notifications
  const notificationsResult = await db.execute(sql`
    SELECT 
      id, chef_id, type, priority, title, message, 
      metadata, is_read, read_at, is_archived, archived_at, 
      action_url, action_label, created_at, expires_at
    FROM chef_notifications
    WHERE chef_id = ${chefId}
      AND (expires_at IS NULL OR expires_at > NOW())
      ${filterCondition}
      ${typeCondition}
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
    FROM chef_notifications
    WHERE chef_id = ${chefId}
      AND (expires_at IS NULL OR expires_at > NOW())
      ${filterCondition}
      ${typeCondition}
  `);

  const total = parseInt((countResult.rows[0] as { total: string })?.total || '0', 10);

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
 * Get unread notification count for a chef
 */
async function getUnreadCount(chefId: number) {
  // CRIT-2 Security: Parameterized query — no sql.raw()
  const result = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM chef_notifications
    WHERE chef_id = ${chefId}
      AND is_read = false
      AND is_archived = false
      AND (expires_at IS NULL OR expires_at > NOW())
  `);

  return { count: parseInt((result.rows[0] as { count: string })?.count || '0', 10) };
}

/**
 * Mark notification(s) as read
 */
async function markAsRead(chefId: number, notificationIds: number[]) {
  if (notificationIds.length === 0) return { updated: 0 };

  const result = await db.execute(sql`
    UPDATE chef_notifications
    SET is_read = true, read_at = NOW()
    WHERE chef_id = ${chefId}
      AND id IN (${sql.join(notificationIds.map(id => sql`${id}`), sql`, `)})
      AND is_read = false
  `);

  return { updated: result.rowCount || 0 };
}

/**
 * Mark all notifications as read for a chef
 */
async function markAllAsRead(chefId: number) {
  const result = await db.execute(sql`
    UPDATE chef_notifications
    SET is_read = true, read_at = NOW()
    WHERE chef_id = ${chefId}
      AND is_read = false
      AND is_archived = false
  `);

  return { updated: result.rowCount || 0 };
}

/**
 * Archive notification(s)
 */
async function archiveNotifications(chefId: number, notificationIds: number[]) {
  if (notificationIds.length === 0) return { updated: 0 };

  const result = await db.execute(sql`
    UPDATE chef_notifications
    SET is_archived = true, archived_at = NOW()
    WHERE chef_id = ${chefId}
      AND id IN (${sql.join(notificationIds.map(id => sql`${id}`), sql`, `)})
      AND is_archived = false
  `);

  return { updated: result.rowCount || 0 };
}

// ===================================
// API ROUTES
// ===================================

/**
 * GET /api/chef/notifications
 * Get notifications for the authenticated chef
 */
router.get("/", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const chefId = req.neonUser!.id;
    const { page, limit, filter, type } = req.query;

    const result = await getNotifications(chefId, {
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      filter: filter as 'all' | 'unread' | 'read' | 'archived' | undefined,
      type: type as NotificationType | undefined
    });

    res.json(result);
  } catch (error) {
    logger.error("Error fetching chef notifications:", error);
    return errorResponse(res, "Failed to fetch notifications", 500);
  }
});

/**
 * GET /api/chef/notifications/unread-count
 * Get unread notification count
 */
router.get("/unread-count", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const chefId = req.neonUser!.id;
    const result = await getUnreadCount(chefId);
    res.json(result);
  } catch (error) {
    logger.error("Error fetching chef unread count:", error);
    return errorResponse(res, "Failed to fetch unread count", 500);
  }
});

/**
 * POST /api/chef/notifications/mark-read
 * Mark specific notifications as read
 */
router.post("/mark-read", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const chefId = req.neonUser!.id;
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds)) {
      return res.status(400).json({ error: "notificationIds must be an array" });
    }

    const result = await markAsRead(chefId, notificationIds);
    res.json(result);
  } catch (error) {
    logger.error("Error marking chef notifications as read:", error);
    return errorResponse(res, "Failed to mark as read", 500);
  }
});

/**
 * POST /api/chef/notifications/mark-all-read
 * Mark all notifications as read
 */
router.post("/mark-all-read", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const chefId = req.neonUser!.id;
    const result = await markAllAsRead(chefId);
    res.json(result);
  } catch (error) {
    logger.error("Error marking all chef notifications as read:", error);
    return errorResponse(res, "Failed to mark all as read", 500);
  }
});

/**
 * POST /api/chef/notifications/archive
 * Archive specific notifications
 */
router.post("/archive", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const chefId = req.neonUser!.id;
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds)) {
      return res.status(400).json({ error: "notificationIds must be an array" });
    }

    const result = await archiveNotifications(chefId, notificationIds);
    res.json(result);
  } catch (error) {
    logger.error("Error archiving chef notifications:", error);
    return errorResponse(res, "Failed to archive notifications", 500);
  }
});

/**
 * POST /api/chef/notifications/message-received
 * Trigger a notification when a chef receives a new message from a manager
 * Called by the client after a message is sent in the chat
 */
router.post("/message-received", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const { chefId, senderName, messagePreview, conversationId } = req.body;

    if (!chefId || !senderName || !conversationId) {
      return res.status(400).json({ error: "chefId, senderName, and conversationId are required" });
    }

    // Create notification for the chef
    await notificationService.notifyChefMessage({
      chefId,
      senderName,
      messagePreview: messagePreview || "You have a new message",
      conversationId
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Error creating message notification:", error);
    return errorResponse(res, "Failed to create notification", 500);
  }
});

/**
 * DELETE /api/chef/notifications/:id
 * Delete a specific notification
 */
router.delete("/:id", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const chefId = req.neonUser!.id;
    const notificationId = parseInt(req.params.id);

    const result = await db.execute(sql`
      DELETE FROM chef_notifications
      WHERE id = ${notificationId}
        AND chef_id = ${chefId}
    `);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ deleted: true });
  } catch (error) {
    logger.error("Error deleting chef notification:", error);
    return errorResponse(res, "Failed to delete notification", 500);
  }
});

// ===================================
// EXPORTS
// ===================================

// Export router as default
export default router;

// Re-export the unified notification service for creating chef notifications
// Usage: notificationService.createForChef({ chefId, type, title, message, ... })
// Usage: notificationService.notifyChefBookingConfirmed({ chefId, bookingId, ... })
export { notificationService };
export type { NotificationType, NotificationPriority };

// Export query functions for use in other modules if needed
export {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotifications
};
