/**
 * Manager Notification Service
 * 
 * Enterprise-grade service for creating and managing manager notifications.
 * Provides typed helper functions for all notification types.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

// ===================================
// TYPES
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
// CORE NOTIFICATION CREATION
// ===================================

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

  try {
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

    logger.info(`[NotificationService] Created ${type} notification for manager ${managerId}`);
    return result.rows[0];
  } catch (error) {
    logger.error(`[NotificationService] Failed to create notification:`, error);
    throw error;
  }
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
  return createNotification({
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
    actionUrl: `/manager/booking-dashboard?view=bookings`,
    actionLabel: 'Review Booking'
  });
}

async function notifyBookingConfirmed(data: BookingNotificationData) {
  return createNotification({
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
    actionUrl: `/manager/booking-dashboard?view=bookings`,
    actionLabel: 'View Booking'
  });
}

async function notifyBookingCancelled(data: BookingNotificationData & { cancelledBy: 'chef' | 'manager' }) {
  const isByChef = data.cancelledBy === 'chef';
  return createNotification({
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
    actionUrl: `/manager/booking-dashboard?view=bookings`,
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
  return createNotification({
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
  return createNotification({
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
    actionUrl: `/manager/booking-dashboard?view=bookings`,
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
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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
  return createNotification({
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

    const managerIds = result.rows.map((row: any) => row.id);
    
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
// EXPORTS
// ===================================

export const notificationService = {
  // Core
  create: createNotification,
  
  // Booking
  notifyNewBooking,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  
  // Payment
  notifyPaymentReceived,
  notifyPaymentFailed,
  
  // Application
  notifyNewApplication,
  notifyApplicationApproved,
  
  // Storage & License
  notifyStorageExpiring,
  notifyLicenseApproved,
  notifyLicenseRejected,
  notifyLicenseExpiring,
  
  // Message & System
  notifyNewMessage,
  notifySystemAnnouncement,
  broadcastSystemAnnouncement
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
