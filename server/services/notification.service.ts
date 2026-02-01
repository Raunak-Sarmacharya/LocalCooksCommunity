/**
 * Unified Notification Service
 * 
 * Enterprise-grade service for creating and managing notifications for ALL user types.
 * Supports both managers and chefs with a unified interface.
 * Provides typed helper functions for all notification types.
 * 
 * @module NotificationService
 * @version 2.0.0
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

// ===================================
// TYPES
// ===================================

// Unified notification types for all user roles
type NotificationType = 
  // Booking notifications (both managers and chefs)
  | 'booking_new' 
  | 'booking_cancelled' 
  | 'booking_confirmed'
  | 'booking_reminder'
  // Application notifications
  | 'application_new' 
  | 'application_approved' 
  | 'application_rejected'
  | 'application_pending'
  // Storage notifications
  | 'storage_expiring' 
  | 'storage_expired'
  | 'storage_extension_approved'
  | 'storage_extension_rejected'
  // Payment notifications
  | 'payment_received' 
  | 'payment_failed'
  | 'payment_refunded'
  // License notifications
  | 'license_expiring' 
  | 'license_approved' 
  | 'license_rejected'
  // Communication
  | 'system_announcement' 
  | 'message_received'
  // Chef-specific
  | 'welcome'
  | 'training_reminder';

type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

// Target user type for notifications
type NotificationTarget = 'manager' | 'chef';

interface CreateNotificationParams {
  userId: number;
  target: NotificationTarget;
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

// Legacy interface for backward compatibility
interface CreateManagerNotificationParams {
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

interface CreateChefNotificationParams {
  chefId: number;
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
// CORE NOTIFICATION CREATION
// ===================================

/**
 * Unified notification creation - supports both managers and chefs
 * Uses the appropriate table based on target type
 */
async function createNotification(params: CreateNotificationParams) {
  const {
    userId,
    target,
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

  try {
    let result;
    
    if (target === 'manager') {
      // Insert into manager_notifications table
      result = await db.execute(sql`
        INSERT INTO manager_notifications 
        (manager_id, location_id, type, priority, title, message, metadata, action_url, action_label, expires_at)
        VALUES (
          ${userId}, 
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
      logger.info(`[NotificationService] Created ${type} notification for manager ${userId}`);
    } else {
      // Insert into chef_notifications table
      result = await db.execute(sql`
        INSERT INTO chef_notifications 
        (chef_id, type, priority, title, message, metadata, action_url, action_label, expires_at)
        VALUES (
          ${userId}, 
          ${type}::chef_notification_type, 
          ${priority}::chef_notification_priority, 
          ${title}, 
          ${message}, 
          ${JSON.stringify(metadata)}::jsonb, 
          ${actionUrl || null}, 
          ${actionLabel || null}, 
          ${expiresAt ? expiresAt.toISOString() : null}
        )
        RETURNING *
      `);
      logger.info(`[NotificationService] Created ${type} notification for chef ${userId}`);
    }

    return result.rows[0];
  } catch (error) {
    logger.error(`[NotificationService] Failed to create ${target} notification:`, error);
    throw error;
  }
}

/**
 * Legacy function for backward compatibility - creates manager notification
 */
async function createManagerNotification(params: CreateManagerNotificationParams) {
  return createNotification({
    userId: params.managerId,
    target: 'manager',
    locationId: params.locationId,
    type: params.type,
    priority: params.priority,
    title: params.title,
    message: params.message,
    metadata: params.metadata,
    actionUrl: params.actionUrl,
    actionLabel: params.actionLabel,
    expiresAt: params.expiresAt
  });
}

/**
 * Create chef notification
 */
async function createChefNotification(params: CreateChefNotificationParams) {
  return createNotification({
    userId: params.chefId,
    target: 'chef',
    type: params.type,
    priority: params.priority,
    title: params.title,
    message: params.message,
    metadata: params.metadata,
    actionUrl: params.actionUrl,
    actionLabel: params.actionLabel,
    expiresAt: params.expiresAt
  });
}

// ===================================
// BOOKING NOTIFICATIONS
// ===================================

interface BookingNotificationData {
  managerId: number;
  locationId: number;
  bookingId: number;
  chefName: string;
  kitchenName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}

async function notifyNewBooking(data: BookingNotificationData) {
  const actionUrl = `/manager/booking/${data.bookingId}`;
  logger.info(`[NotificationService] Creating booking_new notification with actionUrl: ${actionUrl}`);
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'booking_new',
    priority: 'high',
    title: 'New Booking Request',
    message: `${data.chefName} requested to book ${data.kitchenName} on ${data.bookingDate} from ${data.startTime} to ${data.endTime}. Awaiting your approval.`,
    metadata: {
      bookingId: data.bookingId,
      chefName: data.chefName,
      kitchenName: data.kitchenName,
      bookingDate: data.bookingDate,
      startTime: data.startTime,
      endTime: data.endTime
    },
    actionUrl:'/manager/booking/${data.bookingId}',
    actionLabel: 'Review Booking'
  });
}

async function notifyBookingConfirmed(data: BookingNotificationData) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'booking_confirmed',
    priority: 'normal',
    title: 'Booking Confirmed',
    message: `You confirmed ${data.chefName}'s booking at ${data.kitchenName} on ${data.bookingDate}.`,
    metadata: {
      bookingId: data.bookingId,
      chefName: data.chefName,
      kitchenName: data.kitchenName
    },
    actionUrl: `/manager/booking/${data.bookingId}`,
    actionLabel: 'View Booking'
  });
}

async function notifyBookingCancelled(data: BookingNotificationData & { cancelledBy: 'chef' | 'manager' }) {
  const isByChef = data.cancelledBy === 'chef';
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'booking_cancelled',
    priority: 'high',
    title: isByChef ? 'Booking Cancelled by Chef' : 'Booking Cancelled',
    message: isByChef 
      ? `${data.chefName} cancelled their booking at ${data.kitchenName} on ${data.bookingDate}.`
      : `Booking at ${data.kitchenName} on ${data.bookingDate} was cancelled.`,
    metadata: {
      bookingId: data.bookingId,
      chefName: data.chefName,
      kitchenName: data.kitchenName,
      cancelledBy: data.cancelledBy
    },
    actionUrl: `/manager/booking/${data.bookingId}`,
    actionLabel: 'View Details'
  });
}

// ===================================
// PAYMENT NOTIFICATIONS
// ===================================

interface PaymentNotificationData {
  managerId: number;
  locationId: number;
  bookingId: number;
  amount: number; // in cents
  currency: string;
  chefName: string;
  kitchenName: string;
}

async function notifyPaymentReceived(data: PaymentNotificationData) {
  const formattedAmount = (data.amount / 100).toFixed(2);
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'payment_received',
    priority: 'normal',
    title: 'Payment Received',
    message: `Received $${formattedAmount} ${data.currency} from ${data.chefName} for booking at ${data.kitchenName}.`,
    metadata: {
      bookingId: data.bookingId,
      amount: data.amount,
      currency: data.currency,
      chefName: data.chefName
    },
    actionUrl: `/manager/booking-dashboard?view=revenue`,
    actionLabel: 'View Revenue'
  });
}

async function notifyPaymentFailed(data: PaymentNotificationData & { reason?: string }) {
  const formattedAmount = (data.amount / 100).toFixed(2);
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'payment_failed',
    priority: 'urgent',
    title: 'Payment Failed',
    message: `Payment of $${formattedAmount} ${data.currency} from ${data.chefName} failed.${data.reason ? ` Reason: ${data.reason}` : ''}`,
    metadata: {
      bookingId: data.bookingId,
      amount: data.amount,
      currency: data.currency,
      chefName: data.chefName,
      reason: data.reason
    },
    actionUrl: `/manager/booking/${data.bookingId}`,
    actionLabel: 'View Booking'
  });
}

// ===================================
// APPLICATION NOTIFICATIONS
// ===================================

interface ApplicationNotificationData {
  managerId: number;
  locationId: number;
  applicationId: number;
  chefName: string;
  chefEmail: string;
}

async function notifyNewApplication(data: ApplicationNotificationData) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'application_new',
    priority: 'high',
    title: 'New Chef Application',
    message: `${data.chefName} (${data.chefEmail}) has applied to use your kitchen. Review their application to approve or reject.`,
    metadata: {
      applicationId: data.applicationId,
      chefName: data.chefName,
      chefEmail: data.chefEmail
    },
    actionUrl: `/manager/booking-dashboard?view=applications`,
    actionLabel: 'Review Application'
  });
}

async function notifyApplicationApproved(data: ApplicationNotificationData) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'application_approved',
    priority: 'normal',
    title: 'Application Approved',
    message: `You approved ${data.chefName}'s application. They can now book your kitchen.`,
    metadata: {
      applicationId: data.applicationId,
      chefName: data.chefName
    },
    actionUrl: `/manager/booking-dashboard?view=applications`,
    actionLabel: 'View Applications'
  });
}

// ===================================
// STORAGE & LICENSE NOTIFICATIONS
// ===================================

interface StorageExpiringData {
  managerId: number;
  locationId: number;
  storageBookingId: number;
  chefName: string;
  storageName: string;
  expiryDate: string;
  daysUntilExpiry: number;
}

async function notifyStorageExpiring(data: StorageExpiringData) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'storage_expiring',
    priority: 'high',
    title: 'Storage Booking Expiring',
    message: `${data.chefName}'s storage booking for "${data.storageName}" expires in ${data.daysUntilExpiry} day${data.daysUntilExpiry !== 1 ? 's' : ''} (${data.expiryDate}).`,
    metadata: {
      storageBookingId: data.storageBookingId,
      chefName: data.chefName,
      storageName: data.storageName,
      expiryDate: data.expiryDate,
      daysUntilExpiry: data.daysUntilExpiry
    },
    actionUrl: `/manager/booking-dashboard?view=storage`,
    actionLabel: 'View Storage'
  });
}

interface LicenseNotificationData {
  managerId: number;
  locationId: number;
  locationName: string;
  expiryDate?: string;
  feedback?: string;
}

async function notifyLicenseApproved(data: LicenseNotificationData) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'license_approved',
    priority: 'normal',
    title: 'Kitchen License Approved',
    message: `Your kitchen license for ${data.locationName} has been approved by the admin.${data.expiryDate ? ` Valid until ${data.expiryDate}.` : ''}`,
    metadata: {
      locationName: data.locationName,
      expiryDate: data.expiryDate
    },
    actionUrl: `/manager/booking-dashboard?view=settings`,
    actionLabel: 'View Settings'
  });
}

async function notifyLicenseRejected(data: LicenseNotificationData) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'license_rejected',
    priority: 'urgent',
    title: 'Kitchen License Rejected',
    message: `Your kitchen license for ${data.locationName} was rejected.${data.feedback ? ` Feedback: ${data.feedback}` : ' Please upload a new license.'}`,
    metadata: {
      locationName: data.locationName,
      feedback: data.feedback
    },
    actionUrl: `/manager/booking-dashboard?view=settings`,
    actionLabel: 'Upload New License'
  });
}

async function notifyLicenseExpiring(data: LicenseNotificationData & { daysUntilExpiry: number }) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'license_expiring',
    priority: 'high',
    title: 'Kitchen License Expiring Soon',
    message: `Your kitchen license for ${data.locationName} expires in ${data.daysUntilExpiry} day${data.daysUntilExpiry !== 1 ? 's' : ''} (${data.expiryDate}). Please renew to avoid service interruption.`,
    metadata: {
      locationName: data.locationName,
      expiryDate: data.expiryDate,
      daysUntilExpiry: data.daysUntilExpiry
    },
    actionUrl: `/manager/booking-dashboard?view=settings`,
    actionLabel: 'Renew License'
  });
}

// ===================================
// MESSAGE & SYSTEM NOTIFICATIONS
// ===================================

interface MessageNotificationData {
  managerId: number;
  locationId?: number;
  senderName: string;
  messagePreview: string;
  conversationId: string;
}

async function notifyNewMessage(data: MessageNotificationData) {
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'message_received',
    priority: 'normal',
    title: `Message from ${data.senderName}`,
    message: data.messagePreview.length > 100 
      ? `${data.messagePreview.substring(0, 100)}...` 
      : data.messagePreview,
    metadata: {
      senderName: data.senderName,
      conversationId: data.conversationId
    },
    actionUrl: `/manager/booking-dashboard?view=messages`,
    actionLabel: 'View Message'
  });
}

interface SystemAnnouncementData {
  title: string;
  message: string;
  priority?: NotificationPriority;
  actionUrl?: string;
  actionLabel?: string;
}

async function notifySystemAnnouncement(managerId: number, data: SystemAnnouncementData) {
  return createManagerNotification({
    managerId,
    type: 'system_announcement',
    priority: data.priority || 'normal',
    title: data.title,
    message: data.message,
    metadata: { isSystemAnnouncement: true },
    actionUrl: data.actionUrl,
    actionLabel: data.actionLabel
  });
}

// Broadcast system announcement to all managers
async function broadcastSystemAnnouncement(data: SystemAnnouncementData) {
  try {
    // Get all manager IDs
    const result = await db.execute(sql`
      SELECT id FROM users WHERE is_manager = true
    `);

    const managerIds = result.rows.map((row) => (row as { id: number }).id);
    
    // Create notifications for all managers
    const notifications = await Promise.all(
      managerIds.map(managerId => notifySystemAnnouncement(managerId, data))
    );

    logger.info(`[NotificationService] Broadcasted system announcement to ${managerIds.length} managers`);
    return notifications;
  } catch (error) {
    logger.error(`[NotificationService] Failed to broadcast announcement:`, error);
    throw error;
  }
}

// ===================================
// CHEF-SPECIFIC NOTIFICATION HELPERS
// ===================================

interface ChefBookingNotificationData {
  chefId: number;
  bookingId: number;
  kitchenName: string;
  locationName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
}

async function notifyChefBookingConfirmed(data: ChefBookingNotificationData) {
  return createChefNotification({
    chefId: data.chefId,
    type: 'booking_confirmed',
    priority: 'high',
    title: 'Booking Confirmed!',
    message: `Your booking at ${data.kitchenName} on ${data.bookingDate} from ${data.startTime} to ${data.endTime} has been confirmed.`,
    metadata: {
      bookingId: data.bookingId,
      kitchenName: data.kitchenName,
      locationName: data.locationName,
      bookingDate: data.bookingDate
    },
    actionUrl: `/dashboard?view=bookings`,
    actionLabel: 'View Booking'
  });
}

async function notifyChefBookingCancelled(data: ChefBookingNotificationData & { cancelledBy: 'chef' | 'manager'; reason?: string }) {
  const isByManager = data.cancelledBy === 'manager';
  return createChefNotification({
    chefId: data.chefId,
    type: 'booking_cancelled',
    priority: 'high',
    title: isByManager ? 'Booking Cancelled by Manager' : 'Booking Cancelled',
    message: isByManager 
      ? `Your booking at ${data.kitchenName} on ${data.bookingDate} was cancelled by the manager.${data.reason ? ` Reason: ${data.reason}` : ''}`
      : `Your booking at ${data.kitchenName} on ${data.bookingDate} has been cancelled.`,
    metadata: {
      bookingId: data.bookingId,
      kitchenName: data.kitchenName,
      cancelledBy: data.cancelledBy,
      reason: data.reason
    },
    actionUrl: `/dashboard?view=bookings`,
    actionLabel: 'View Details'
  });
}

async function notifyChefApplicationApproved(data: { chefId: number; kitchenName: string; locationName: string }) {
  return createChefNotification({
    chefId: data.chefId,
    type: 'application_approved',
    priority: 'high',
    title: 'Application Approved!',
    message: `Congratulations! Your application to ${data.kitchenName} at ${data.locationName} has been approved. You can now book this kitchen.`,
    metadata: {
      kitchenName: data.kitchenName,
      locationName: data.locationName
    },
    actionUrl: `/dashboard?view=discover`,
    actionLabel: 'Book Now'
  });
}

async function notifyChefApplicationRejected(data: { chefId: number; kitchenName: string; locationName: string; reason?: string }) {
  return createChefNotification({
    chefId: data.chefId,
    type: 'application_rejected',
    priority: 'normal',
    title: 'Application Update',
    message: `Your application to ${data.kitchenName} at ${data.locationName} was not approved.${data.reason ? ` Reason: ${data.reason}` : ''}`,
    metadata: {
      kitchenName: data.kitchenName,
      locationName: data.locationName,
      reason: data.reason
    },
    actionUrl: `/dashboard?view=applications`,
    actionLabel: 'View Details'
  });
}

async function notifyChefWelcome(chefId: number, chefName: string) {
  return createChefNotification({
    chefId,
    type: 'welcome',
    priority: 'normal',
    title: `Welcome to LocalCooks, ${chefName}!`,
    message: 'Your account is set up. Start by exploring available kitchens and submitting your first application.',
    metadata: { isWelcome: true },
    actionUrl: `/dashboard?view=discover`,
    actionLabel: 'Explore Kitchens'
  });
}

async function notifyChefPaymentReceived(data: { chefId: number; amount: number; currency: string; bookingId: number; kitchenName: string }) {
  const formattedAmount = (data.amount / 100).toFixed(2);
  return createChefNotification({
    chefId: data.chefId,
    type: 'payment_received',
    priority: 'normal',
    title: 'Payment Confirmed',
    message: `Your payment of $${formattedAmount} ${data.currency} for ${data.kitchenName} has been processed.`,
    metadata: {
      amount: data.amount,
      currency: data.currency,
      bookingId: data.bookingId
    },
    actionUrl: `/dashboard?view=bookings`,
    actionLabel: 'View Booking'
  });
}

async function notifyChefMessage(data: { chefId: number; senderName: string; messagePreview: string; conversationId: string }) {
  return createChefNotification({
    chefId: data.chefId,
    type: 'message_received',
    priority: 'normal',
    title: `Message from ${data.senderName}`,
    message: data.messagePreview.length > 100 
      ? `${data.messagePreview.substring(0, 100)}...` 
      : data.messagePreview,
    metadata: {
      senderName: data.senderName,
      conversationId: data.conversationId
    },
    actionUrl: `/dashboard?view=messages`,
    actionLabel: 'View Message'
  });
}

// Broadcast system announcement to all chefs
async function broadcastChefAnnouncement(data: SystemAnnouncementData) {
  try {
    const result = await db.execute(sql`
      SELECT id FROM users WHERE is_chef = true OR role = 'chef'
    `);

    const chefIds = result.rows.map((row) => (row as { id: number }).id);
    
    const notifications = await Promise.all(
      chefIds.map(chefId => createChefNotification({
        chefId,
        type: 'system_announcement',
        priority: data.priority || 'normal',
        title: data.title,
        message: data.message,
        metadata: { isSystemAnnouncement: true },
        actionUrl: data.actionUrl,
        actionLabel: data.actionLabel
      }))
    );

    logger.info(`[NotificationService] Broadcasted system announcement to ${chefIds.length} chefs`);
    return notifications;
  } catch (error) {
    logger.error(`[NotificationService] Failed to broadcast chef announcement:`, error);
    throw error;
  }
}

// ===================================
// STORAGE EXTENSION NOTIFICATIONS
// ===================================

interface StorageExtensionNotificationData {
  chefId?: number;
  managerId?: number;
  locationId?: number;
  storageBookingId: number;
  storageName: string;
  extensionDays: number;
  newEndDate: string;
}

async function notifyManagerStorageExtensionPending(data: StorageExtensionNotificationData & { chefName: string }) {
  if (!data.managerId) return;
  return createManagerNotification({
    managerId: data.managerId,
    locationId: data.locationId,
    type: 'storage_extension_approved', // Using existing type
    priority: 'high',
    title: 'Storage Extension Request',
    message: `${data.chefName} has requested a ${data.extensionDays}-day extension for "${data.storageName}". Payment received - awaiting your approval.`,
    metadata: {
      storageBookingId: data.storageBookingId,
      storageName: data.storageName,
      extensionDays: data.extensionDays,
      newEndDate: data.newEndDate,
      chefName: data.chefName
    },
    actionUrl: `/manager/booking-dashboard?view=storage`,
    actionLabel: 'Review Extension'
  });
}

async function notifyChefStorageExtensionApproved(data: StorageExtensionNotificationData) {
  if (!data.chefId) return;
  return createChefNotification({
    chefId: data.chefId,
    type: 'storage_extension_approved',
    priority: 'high',
    title: 'Storage Extension Approved!',
    message: `Your ${data.extensionDays}-day extension for "${data.storageName}" has been approved. New end date: ${data.newEndDate}.`,
    metadata: {
      storageBookingId: data.storageBookingId,
      storageName: data.storageName,
      extensionDays: data.extensionDays,
      newEndDate: data.newEndDate
    },
    actionUrl: `/dashboard?view=bookings`,
    actionLabel: 'View Booking'
  });
}

async function notifyChefStorageExtensionRejected(data: StorageExtensionNotificationData & { reason?: string }) {
  if (!data.chefId) return;
  return createChefNotification({
    chefId: data.chefId,
    type: 'storage_extension_rejected',
    priority: 'high',
    title: 'Storage Extension Declined',
    message: `Your extension request for "${data.storageName}" was declined.${data.reason ? ` Reason: ${data.reason}` : ''} A refund will be processed.`,
    metadata: {
      storageBookingId: data.storageBookingId,
      storageName: data.storageName,
      extensionDays: data.extensionDays,
      reason: data.reason
    },
    actionUrl: `/dashboard?view=bookings`,
    actionLabel: 'View Details'
  });
}

// ===================================
// EXPORTS
// ===================================

export const notificationService = {
  // Core - Unified
  create: createNotification,
  createForManager: createManagerNotification,
  createForChef: createChefNotification,
  
  // Manager: Booking
  notifyNewBooking,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  
  // Manager: Payment
  notifyPaymentReceived,
  notifyPaymentFailed,
  
  // Manager: Application
  notifyNewApplication,
  notifyApplicationApproved,
  
  // Manager: Storage & License
  notifyStorageExpiring,
  notifyLicenseApproved,
  notifyLicenseRejected,
  notifyLicenseExpiring,
  
  // Manager: Message & System
  notifyNewMessage,
  notifySystemAnnouncement,
  broadcastSystemAnnouncement,
  
  // Chef: Booking
  notifyChefBookingConfirmed,
  notifyChefBookingCancelled,
  
  // Chef: Application
  notifyChefApplicationApproved,
  notifyChefApplicationRejected,
  
  // Chef: Other
  notifyChefWelcome,
  notifyChefPaymentReceived,
  notifyChefMessage,
  broadcastChefAnnouncement,
  
  // Storage Extension
  notifyManagerStorageExtensionPending,
  notifyChefStorageExtensionApproved,
  notifyChefStorageExtensionRejected
};

export type {
  NotificationType,
  NotificationPriority,
  CreateNotificationParams,
  BookingNotificationData,
  PaymentNotificationData,
  ApplicationNotificationData,
  StorageExpiringData,
  LicenseNotificationData,
  MessageNotificationData,
  SystemAnnouncementData
};
