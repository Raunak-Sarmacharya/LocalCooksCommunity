/**
 * Email Template Preview Generator
 * 
 * Run with: npx tsx scripts/preview-emails.ts
 * Then open the generated HTML file in your browser.
 * 
 * This script imports all email template functions, calls them with
 * sample data, and serves an interactive preview gallery.
 */

import express from 'express';
import {
  generateStatusChangeEmail,
  generateFullVerificationEmail,
  generateApplicationWithDocumentsEmail,
  generateApplicationWithoutDocumentsEmail,
  generateDocumentStatusChangeEmail,
  generatePasswordResetEmail,
  generateEmailVerificationEmail,
  generateWelcomeEmail,
  generateDocumentUpdateEmail,
  generatePromoCodeEmail,
  generateChefAllDocumentsApprovedEmail,
  generateManagerMagicLinkEmail,
  generateManagerCredentialsEmail,
  generateBookingNotificationEmail,
  generateBookingCancellationNotificationEmail,
  generateBookingStatusChangeNotificationEmail,
  generateBookingRequestEmail,
  generateBookingConfirmationEmail,
  generateBookingCancellationEmail,
  generateKitchenAvailabilityChangeEmail,
  generateKitchenSettingsChangeEmail,
  generateChefProfileRequestEmail,
  generateChefLocationAccessApprovedEmail,
  generateChefKitchenAccessApprovedEmail,
  generateLocationEmailChangedEmail,
  generateStorageExtensionPendingApprovalEmail,
  generateStorageExtensionPaymentReceivedEmail,
  generateStorageExtensionApprovedEmail,
  generateStorageExtensionRejectedEmail,
  generateStorageExpiringWarningEmail,
  generateOverstayDetectedEmail,
  generatePenaltyChargedEmail,
  generateOverstayManagerNotificationEmail,
  generateNewKitchenApplicationManagerEmail,
  generateKitchenApplicationSubmittedChefEmail,
  generateKitchenApplicationApprovedEmail,
  generateKitchenApplicationRejectedEmail,
  generateKitchenLicenseApprovedEmail,
  generateKitchenLicenseRejectedEmail,
  generateKitchenLicenseSubmittedAdminEmail,
  generateDamageClaimFiledEmail,
  generateDamageClaimResponseEmail,
  generateDamageClaimDisputedAdminEmail,
  generateDamageClaimDecisionEmail,
  generateDamageClaimChargedEmail,
  generateNewUserRegistrationAdminEmail,
} from '../server/email';

// Set minimal env vars for template rendering
process.env.EMAIL_USER = process.env.EMAIL_USER || 'noreply@localcooks.ca';
process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localcooks.ca';
process.env.NODE_ENV = 'development';

// Sample data
const sampleDate = new Date('2026-03-15T10:00:00');
const sampleEndDate = new Date('2026-04-15T10:00:00');

interface TemplateEntry {
  name: string;
  category: string;
  recipient: string;
  subject: string;
  html: string;
}

function generateAllTemplates(): TemplateEntry[] {
  const templates: TemplateEntry[] = [];

  const add = (name: string, category: string, recipient: string, fn: () => { subject: string; html?: string }) => {
    try {
      const result = fn();
      templates.push({
        name,
        category,
        recipient,
        subject: result.subject,
        html: result.html || '<p>No HTML content</p>',
      });
    } catch (e: any) {
      templates.push({
        name,
        category,
        recipient,
        subject: `ERROR: ${e.message}`,
        html: `<pre style="color:red;padding:20px;">${e.stack}</pre>`,
      });
    }
  };

  // ── Application & Onboarding ──
  add('Status Change (Approved)', 'Application', 'Chef', () =>
    generateStatusChangeEmail({ fullName: 'Jane Doe', email: 'jane@example.com', status: 'approved' })
  );
  add('Status Change (Rejected)', 'Application', 'Chef', () =>
    generateStatusChangeEmail({ fullName: 'Jane Doe', email: 'jane@example.com', status: 'rejected' })
  );
  add('Status Change (Pending)', 'Application', 'Chef', () =>
    generateStatusChangeEmail({ fullName: 'Jane Doe', email: 'jane@example.com', status: 'pending' })
  );
  add('Full Verification', 'Application', 'Chef', () =>
    generateFullVerificationEmail({
      fullName: 'Jane Doe', email: 'jane@example.com',
      phone: '7095551234',
    })
  );
  add('Application With Documents', 'Application', 'Chef', () =>
    generateApplicationWithDocumentsEmail({ fullName: 'Jane Doe', email: 'jane@example.com' })
  );
  add('Application Without Documents', 'Application', 'Chef', () =>
    generateApplicationWithoutDocumentsEmail({ fullName: 'Jane Doe', email: 'jane@example.com' })
  );
  add('Document Status Change (Approved)', 'Application', 'Chef', () =>
    generateDocumentStatusChangeEmail({
      fullName: 'Jane Doe', email: 'jane@example.com',
      documentType: 'foodSafetyLicenseStatus', status: 'approved',
    })
  );
  add('Document Status Change (Rejected)', 'Application', 'Chef', () =>
    generateDocumentStatusChangeEmail({
      fullName: 'Jane Doe', email: 'jane@example.com',
      documentType: 'foodSafetyLicenseStatus', status: 'rejected', adminFeedback: 'The document is expired. Please upload a current version.',
    })
  );
  add('Chef All Documents Approved', 'Application', 'Chef', () =>
    generateChefAllDocumentsApprovedEmail({
      fullName: 'Jane Doe', email: 'jane@example.com',
      approvedDocuments: ['Food Safety License', 'Food Establishment Certificate'],
    })
  );
  add('Document Update Received', 'Application', 'Chef', () =>
    generateDocumentUpdateEmail({ fullName: 'Jane Doe', email: 'jane@example.com' })
  );

  // ── Auth & Account ──
  add('Email Verification', 'Auth', 'User', () =>
    generateEmailVerificationEmail({
      fullName: 'Jane Doe', email: 'jane@example.com',
      verificationToken: 'abc123', verificationUrl: 'https://localcooks.ca/verify?token=abc123',
    })
  );
  add('Password Reset', 'Auth', 'User', () =>
    generatePasswordResetEmail({
      fullName: 'Jane Doe', email: 'jane@example.com',
      resetToken: 'xyz789', resetUrl: 'https://localcooks.ca/reset?token=xyz789',
    })
  );
  add('Welcome Email (Chef)', 'Auth', 'Chef', () =>
    generateWelcomeEmail({ fullName: 'Jane Doe', email: 'jane@example.com', role: 'chef' })
  );
  add('Welcome Email (Manager)', 'Auth', 'Manager', () =>
    generateWelcomeEmail({ fullName: 'John Manager', email: 'john@example.com', role: 'manager' })
  );
  add('Manager Magic Link', 'Auth', 'Manager', () =>
    generateManagerMagicLinkEmail({ email: 'john@example.com', name: 'John Manager', resetToken: 'mgr-token-123' })
  );
  add('Manager Credentials', 'Auth', 'Manager', () =>
    generateManagerCredentialsEmail({ email: 'john@example.com', name: 'John Manager', username: 'john.manager', password: 'TempPass123!' })
  );
  add('New User Registration (Admin)', 'Auth', 'Admin', () =>
    generateNewUserRegistrationAdminEmail({
      adminEmail: 'admin@localcooks.ca', newUserName: 'Jane Doe',
      newUserEmail: 'jane@example.com', userRole: 'chef', registrationDate: sampleDate,
    })
  );

  // ── Kitchen Bookings ──
  add('New Booking Request (Manager)', 'Booking', 'Manager', () =>
    generateBookingNotificationEmail({
      managerEmail: 'manager@example.com', managerName: 'John Manager', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', bookingDate: '2026-03-20',
      startTime: '09:00', endTime: '14:00', specialNotes: 'Need extra prep area',
      timezone: 'America/St_Johns', locationName: 'Downtown Location', bookingId: 201,
    })
  );
  add('Booking Request Submitted (Chef)', 'Booking', 'Chef', () =>
    generateBookingRequestEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', bookingDate: '2026-03-20',
      startTime: '09:00', endTime: '14:00', specialNotes: 'Need extra prep area',
      timezone: 'America/St_Johns', locationName: 'Downtown Location',
    })
  );
  add('Booking Confirmed (Chef)', 'Booking', 'Chef', () =>
    generateBookingConfirmationEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', bookingDate: '2026-03-20',
      startTime: '09:00', endTime: '14:00',
      timezone: 'America/St_Johns', locationName: 'Downtown Location',
      locationAddress: '123 Water St, St. John\'s, NL',
      addons: 'Commercial Mixer, Cold Storage (Mar 20–22)',
    })
  );
  add('Booking Cancelled (Chef)', 'Booking', 'Chef', () =>
    generateBookingCancellationEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', bookingDate: '2026-03-20',
      startTime: '09:00', endTime: '14:00', cancellationReason: 'Kitchen maintenance scheduled',
    })
  );
  add('Booking Cancellation Notification (Manager)', 'Booking', 'Manager', () =>
    generateBookingCancellationNotificationEmail({
      managerEmail: 'manager@example.com', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', bookingDate: '2026-03-20',
      startTime: '09:00', endTime: '14:00', cancellationReason: 'Schedule conflict',
    })
  );
  add('Booking Confirmed (Manager)', 'Booking', 'Manager', () =>
    generateBookingStatusChangeNotificationEmail({
      managerEmail: 'manager@example.com', managerName: 'John Manager', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', bookingDate: '2026-03-20',
      startTime: '09:00', endTime: '14:00', status: 'confirmed',
      timezone: 'America/St_Johns', locationName: 'Downtown Location',
      addons: 'Commercial Mixer, Cold Storage (Mar 20–22)',
    })
  );

  // ── Kitchen Settings & Access ──
  add('Kitchen Availability Change', 'Kitchen', 'Chef', () =>
    generateKitchenAvailabilityChangeEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', changeType: 'Hours Updated',
      details: 'New hours: Mon-Fri 8AM-6PM (previously 9AM-5PM)',
    })
  );
  add('Kitchen Settings Change (Chef)', 'Kitchen', 'Chef', () =>
    generateKitchenSettingsChangeEmail({
      email: 'jane@example.com', name: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', changes: 'Hourly rate updated to $25/hr', isChef: true,
    })
  );
  add('Kitchen Settings Change (Manager)', 'Kitchen', 'Manager', () =>
    generateKitchenSettingsChangeEmail({
      email: 'manager@example.com', name: 'John Manager',
      kitchenName: 'Downtown Kitchen A', changes: 'Hourly rate updated to $25/hr', isChef: false,
    })
  );
  add('Chef Profile Request (Manager)', 'Kitchen', 'Manager', () =>
    generateChefProfileRequestEmail({
      managerEmail: 'manager@example.com', chefName: 'Jane Doe',
      chefEmail: 'jane@example.com', locationName: 'Downtown Location', locationId: 1,
    })
  );
  add('Chef Location Access Approved', 'Kitchen', 'Chef', () =>
    generateChefLocationAccessApprovedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      locationName: 'Downtown Location', locationId: 1,
    })
  );
  add('Chef Kitchen Access Approved', 'Kitchen', 'Chef', () =>
    generateChefKitchenAccessApprovedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      kitchenName: 'Downtown Kitchen A', kitchenId: 10,
    })
  );
  add('Location Email Changed', 'Kitchen', 'Manager', () =>
    generateLocationEmailChangedEmail({
      email: 'newmanager@example.com', locationName: 'Downtown Location', locationId: 1,
    })
  );

  // ── Kitchen Applications ──
  add('New Kitchen Application (Manager)', 'Kitchen Application', 'Manager', () =>
    generateNewKitchenApplicationManagerEmail({
      managerEmail: 'manager@example.com', chefName: 'Jane Doe',
      chefEmail: 'jane@example.com', locationName: 'Downtown Location',
      applicationId: 42, submittedAt: sampleDate,
    })
  );
  add('Step 1 Approved (Chef)', 'Kitchen Application', 'Chef', () =>
    generateKitchenApplicationSubmittedChefEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      locationName: 'Downtown Location', locationAddress: '123 Water St, St. John\'s, NL',
    })
  );
  add('Step 2 Fully Approved (Chef)', 'Kitchen Application', 'Chef', () =>
    generateKitchenApplicationApprovedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      locationName: 'Downtown Location', kitchenName: 'Downtown Kitchen A',
    })
  );
  add('Kitchen Application Rejected', 'Kitchen Application', 'Chef', () =>
    generateKitchenApplicationRejectedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      locationName: 'Downtown Location', feedback: 'Missing food handler certificate. Please reapply after completing training.',
    })
  );

  // ── Kitchen License ──
  add('Kitchen License Approved (Manager)', 'License', 'Manager', () =>
    generateKitchenLicenseApprovedEmail({
      managerEmail: 'manager@example.com', managerName: 'John Manager',
      locationName: 'Downtown Location', approvedAt: sampleDate,
    })
  );
  add('Kitchen License Rejected (Manager)', 'License', 'Manager', () =>
    generateKitchenLicenseRejectedEmail({
      managerEmail: 'manager@example.com', managerName: 'John Manager',
      locationName: 'Downtown Location', feedback: 'License is expired. Please upload a renewed document.',
    })
  );
  add('Kitchen License Submitted (Admin)', 'License', 'Admin', () =>
    generateKitchenLicenseSubmittedAdminEmail({
      adminEmail: 'admin@localcooks.ca', managerName: 'John Manager',
      managerEmail: 'manager@example.com', locationName: 'Downtown Location',
      locationId: 1, submittedAt: sampleDate,
    })
  );

  // ── Storage Extensions ──
  add('Storage Extension Pending Approval (Manager)', 'Storage', 'Manager', () =>
    generateStorageExtensionPendingApprovalEmail({
      managerEmail: 'manager@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', extensionDays: 14,
      newEndDate: sampleEndDate, totalPrice: 5600, locationName: 'Downtown Location',
    })
  );
  add('Storage Extension Payment Received (Chef)', 'Storage', 'Chef', () =>
    generateStorageExtensionPaymentReceivedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', extensionDays: 14,
      newEndDate: sampleEndDate, totalPrice: 5600,
    })
  );
  add('Storage Extension Approved (Chef)', 'Storage', 'Chef', () =>
    generateStorageExtensionApprovedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', extensionDays: 14, newEndDate: sampleEndDate,
    })
  );
  add('Storage Extension Rejected (Chef)', 'Storage', 'Chef', () =>
    generateStorageExtensionRejectedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', extensionDays: 14,
      rejectionReason: 'Storage unit is reserved for maintenance.', refundAmount: 5600,
    })
  );

  // ── Overstay Penalties ──
  add('Storage Expiring Warning (Chef)', 'Overstay', 'Chef', () =>
    generateStorageExpiringWarningEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', endDate: sampleEndDate,
      daysUntilExpiry: 2, gracePeriodDays: 3, penaltyRate: 1.5, dailyRateCents: 400,
    })
  );
  add('Overstay Detected — Grace Period (Chef)', 'Overstay', 'Chef', () =>
    generateOverstayDetectedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', endDate: sampleEndDate,
      daysOverdue: 1, gracePeriodEndsAt: new Date('2026-04-18'),
      isInGracePeriod: true, calculatedPenaltyCents: 600,
    })
  );
  add('Overstay Detected — Past Grace (Chef)', 'Overstay', 'Chef', () =>
    generateOverstayDetectedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', endDate: sampleEndDate,
      daysOverdue: 5, gracePeriodEndsAt: new Date('2026-04-18'),
      isInGracePeriod: false, calculatedPenaltyCents: 3000,
    })
  );
  add('Penalty Charged (Chef)', 'Overstay', 'Chef', () =>
    generatePenaltyChargedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      storageName: 'Cold Storage Unit B', penaltyAmountCents: 3000,
      daysOverdue: 5, chargeDate: sampleDate,
    })
  );
  add('Overstay Manager Notification — Grace Period', 'Overstay', 'Manager', () =>
    generateOverstayManagerNotificationEmail({
      managerEmail: 'manager@example.com', chefName: 'Jane Doe',
      chefEmail: 'jane@example.com', storageName: 'Cold Storage Unit B',
      kitchenName: 'Downtown Kitchen A', endDate: sampleEndDate,
      daysOverdue: 1, gracePeriodEndsAt: new Date('2026-04-18'),
      isInGracePeriod: true, calculatedPenaltyCents: 600,
    })
  );
  add('Overstay Manager Notification — Action Required', 'Overstay', 'Manager', () =>
    generateOverstayManagerNotificationEmail({
      managerEmail: 'manager@example.com', chefName: 'Jane Doe',
      chefEmail: 'jane@example.com', storageName: 'Cold Storage Unit B',
      kitchenName: 'Downtown Kitchen A', endDate: sampleEndDate,
      daysOverdue: 5, gracePeriodEndsAt: new Date('2026-04-18'),
      isInGracePeriod: false, calculatedPenaltyCents: 3000,
    })
  );

  // ── Damage Claims ──
  add('Damage Claim Filed (Chef)', 'Damage Claim', 'Chef', () =>
    generateDamageClaimFiledEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      managerName: 'John Manager', locationName: 'Downtown Location',
      claimTitle: 'Stove top damage', claimedAmount: '$150.00 CAD',
      damageDate: 'March 15, 2026', responseDeadline: 'March 22, 2026', claimId: 10,
    })
  );
  add('Damage Claim Response — Accepted (Manager)', 'Damage Claim', 'Manager', () =>
    generateDamageClaimResponseEmail({
      managerEmail: 'manager@example.com', managerName: 'John Manager',
      chefName: 'Jane Doe', claimTitle: 'Stove top damage',
      claimedAmount: '$150.00 CAD', response: 'accepted', claimId: 10,
    })
  );
  add('Damage Claim Response — Disputed (Manager)', 'Damage Claim', 'Manager', () =>
    generateDamageClaimResponseEmail({
      managerEmail: 'manager@example.com', managerName: 'John Manager',
      chefName: 'Jane Doe', claimTitle: 'Stove top damage',
      claimedAmount: '$150.00 CAD', response: 'disputed',
      chefResponse: 'The damage was pre-existing. I documented the stove condition before use.', claimId: 10,
    })
  );
  add('Damage Claim Disputed (Admin)', 'Damage Claim', 'Admin', () =>
    generateDamageClaimDisputedAdminEmail({
      adminEmail: 'admin@localcooks.ca', chefName: 'Jane Doe',
      chefEmail: 'jane@example.com', managerName: 'John Manager',
      locationName: 'Downtown Location', claimTitle: 'Stove top damage',
      claimedAmount: '$150.00 CAD',
      chefResponse: 'The damage was pre-existing. I documented the stove condition before use.', claimId: 10,
    })
  );
  add('Damage Claim Decision — Approved (Chef)', 'Damage Claim', 'Chef', () =>
    generateDamageClaimDecisionEmail({
      recipientEmail: 'jane@example.com', recipientName: 'Jane Doe', recipientRole: 'chef',
      claimTitle: 'Stove top damage', claimedAmount: '$150.00 CAD',
      decision: 'approved', decisionReason: 'Evidence supports the claim.', claimId: 10,
    })
  );
  add('Damage Claim Decision — Partially Approved (Manager)', 'Damage Claim', 'Manager', () =>
    generateDamageClaimDecisionEmail({
      recipientEmail: 'manager@example.com', recipientName: 'John Manager', recipientRole: 'manager',
      claimTitle: 'Stove top damage', claimedAmount: '$150.00 CAD',
      decision: 'partially_approved', finalAmount: '$75.00 CAD',
      decisionReason: 'Partial wear existed prior to this booking.', claimId: 10,
    })
  );
  add('Damage Claim Decision — Rejected (Chef)', 'Damage Claim', 'Chef', () =>
    generateDamageClaimDecisionEmail({
      recipientEmail: 'jane@example.com', recipientName: 'Jane Doe', recipientRole: 'chef',
      claimTitle: 'Stove top damage', claimedAmount: '$150.00 CAD',
      decision: 'rejected', decisionReason: 'Insufficient evidence to support the claim.', claimId: 10,
    })
  );
  add('Damage Claim Charged (Chef)', 'Damage Claim', 'Chef', () =>
    generateDamageClaimChargedEmail({
      chefEmail: 'jane@example.com', chefName: 'Jane Doe',
      claimTitle: 'Stove top damage', chargedAmount: '$150.00 CAD',
      locationName: 'Downtown Location', claimId: 10,
    })
  );

  // ── Promo Code ──
  add('Promo Code Email', 'Marketing', 'Customer', () =>
    generatePromoCodeEmail({
      email: 'customer@example.com', promoCode: 'SAVE20',
      customMessage: 'Enjoy 20% off your next order!',
      greeting: 'Hey Food Lover! 🍕',
    })
  );

  return templates;
}

// ── Serve the preview ──
const app = express();
const PORT = 3847;

app.get('/', (_req, res) => {
  const templates = generateAllTemplates();

  // Group by category
  const categories: Record<string, TemplateEntry[]> = {};
  for (const t of templates) {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(t);
  }

  const categoryOrder = Object.keys(categories).sort();

  const sidebarHtml = categoryOrder.map(cat => {
    const items = categories[cat].map((t, i) => {
      const globalIdx = templates.indexOf(t);
      const recipientBadge = t.recipient === 'Chef' ? '🧑‍🍳' :
        t.recipient === 'Manager' ? '🏢' :
        t.recipient === 'Admin' ? '🛡️' :
        t.recipient === 'Customer' ? '🛒' : '👤';
      return `<a class="nav-item" data-idx="${globalIdx}" onclick="showTemplate(${globalIdx})" title="${t.subject}">
        <span class="recipient-badge">${recipientBadge}</span>
        <span class="nav-name">${t.name}</span>
      </a>`;
    }).join('');
    return `<div class="nav-category">${cat} <span class="cat-count">${categories[cat].length}</span></div>${items}`;
  }).join('');

  const templatesJson = JSON.stringify(templates.map(t => ({
    name: t.name,
    category: t.category,
    recipient: t.recipient,
    subject: t.subject,
    html: t.html,
  })));

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Template Preview — Local Cooks (${templates.length} templates)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; height: 100vh; overflow: hidden; }
    
    /* Sidebar */
    .sidebar { width: 340px; min-width: 340px; background: #1e293b; border-right: 1px solid #334155; display: flex; flex-direction: column; overflow: hidden; }
    .sidebar-header { padding: 20px; border-bottom: 1px solid #334155; }
    .sidebar-header h1 { font-size: 18px; color: #f8fafc; margin-bottom: 4px; }
    .sidebar-header p { font-size: 13px; color: #94a3b8; }
    .search-box { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: 14px; margin-top: 12px; outline: none; }
    .search-box:focus { border-color: #f43f5e; }
    .search-box::placeholder { color: #64748b; }
    .nav { flex: 1; overflow-y: auto; padding: 8px; }
    .nav::-webkit-scrollbar { width: 6px; }
    .nav::-webkit-scrollbar-track { background: transparent; }
    .nav::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
    .nav-category { padding: 12px 12px 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #f43f5e; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center; }
    .cat-count { background: #334155; color: #94a3b8; font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: 600; }
    .nav-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; color: #cbd5e1; text-decoration: none; transition: all 0.15s; }
    .nav-item:hover { background: #334155; color: #f8fafc; }
    .nav-item.active { background: #f43f5e22; color: #f43f5e; border-left: 3px solid #f43f5e; }
    .recipient-badge { font-size: 14px; flex-shrink: 0; }
    .nav-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    
    /* Main Content */
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .toolbar { padding: 12px 20px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    .toolbar-subject { flex: 1; font-size: 14px; color: #f8fafc; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar-meta { font-size: 12px; color: #94a3b8; white-space: nowrap; }
    .toolbar-btn { padding: 6px 14px; background: #334155; border: none; color: #e2e8f0; font-size: 12px; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.15s; }
    .toolbar-btn:hover { background: #475569; }
    .toolbar-btn.active { background: #f43f5e; color: white; }
    
    .preview-container { flex: 1; display: flex; overflow: hidden; }
    .preview-frame-wrap { flex: 1; background: #f1f5f9; display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 24px; }
    .preview-frame-wrap.desktop iframe { width: 100%; max-width: 700px; height: 100%; border: none; background: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .preview-frame-wrap.mobile iframe { width: 375px; height: 667px; border: none; background: white; border-radius: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    
    .source-panel { width: 0; overflow: hidden; transition: width 0.2s; background: #0f172a; border-left: 1px solid #334155; }
    .source-panel.open { width: 500px; }
    .source-panel textarea { width: 100%; height: 100%; background: #0f172a; color: #a5f3fc; border: none; padding: 16px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; line-height: 1.5; resize: none; outline: none; }
    
    .empty-state { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; color: #64748b; gap: 8px; }
    .empty-state .icon { font-size: 48px; }
    .empty-state p { font-size: 14px; }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>📧 Email Templates</h1>
      <p>${templates.length} templates across ${categoryOrder.length} categories</p>
      <input type="text" class="search-box" placeholder="Search templates..." oninput="filterTemplates(this.value)" />
    </div>
    <div class="nav" id="nav">
      ${sidebarHtml}
    </div>
  </div>
  <div class="main">
    <div class="toolbar" id="toolbar">
      <div class="toolbar-subject" id="toolbar-subject">Select a template to preview</div>
      <div class="toolbar-meta" id="toolbar-meta"></div>
      <button class="toolbar-btn" id="btn-mobile" onclick="toggleView('mobile')">📱 Mobile</button>
      <button class="toolbar-btn active" id="btn-desktop" onclick="toggleView('desktop')">🖥️ Desktop</button>
      <button class="toolbar-btn" id="btn-source" onclick="toggleSource()">{ } Source</button>
    </div>
    <div class="preview-container">
      <div class="preview-frame-wrap desktop" id="preview-wrap">
        <div class="empty-state" id="empty-state">
          <div class="icon">📬</div>
          <p>Click a template from the sidebar to preview it</p>
        </div>
        <iframe id="preview-frame" class="hidden"></iframe>
      </div>
      <div class="source-panel" id="source-panel">
        <textarea id="source-code" readonly></textarea>
      </div>
    </div>
  </div>

  <script>
    const templates = ${templatesJson};
    let currentIdx = -1;
    let viewMode = 'desktop';

    function showTemplate(idx) {
      currentIdx = idx;
      const t = templates[idx];
      
      // Update active nav
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      const navItem = document.querySelector('.nav-item[data-idx="' + idx + '"]');
      if (navItem) navItem.classList.add('active');
      
      // Update toolbar
      document.getElementById('toolbar-subject').textContent = t.subject;
      document.getElementById('toolbar-meta').textContent = t.category + ' → ' + t.recipient;
      
      // Update preview
      const frame = document.getElementById('preview-frame');
      const empty = document.getElementById('empty-state');
      empty.classList.add('hidden');
      frame.classList.remove('hidden');
      
      frame.srcdoc = t.html;
      
      // Update source
      document.getElementById('source-code').value = t.html;
    }

    function toggleView(mode) {
      viewMode = mode;
      const wrap = document.getElementById('preview-wrap');
      wrap.className = 'preview-frame-wrap ' + mode;
      document.getElementById('btn-desktop').classList.toggle('active', mode === 'desktop');
      document.getElementById('btn-mobile').classList.toggle('active', mode === 'mobile');
    }

    function toggleSource() {
      const panel = document.getElementById('source-panel');
      const btn = document.getElementById('btn-source');
      panel.classList.toggle('open');
      btn.classList.toggle('active');
    }

    function filterTemplates(query) {
      const q = query.toLowerCase();
      document.querySelectorAll('.nav-item').forEach(el => {
        const name = el.querySelector('.nav-name').textContent.toLowerCase();
        const idx = parseInt(el.dataset.idx);
        const t = templates[idx];
        const match = name.includes(q) || t.category.toLowerCase().includes(q) || t.recipient.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
        el.style.display = match ? '' : 'none';
      });
      // Show/hide category headers
      document.querySelectorAll('.nav-category').forEach(cat => {
        let next = cat.nextElementSibling;
        let anyVisible = false;
        while (next && !next.classList.contains('nav-category')) {
          if (next.style.display !== 'none') anyVisible = true;
          next = next.nextElementSibling;
        }
        cat.style.display = anyVisible ? '' : 'none';
      });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowDown' && currentIdx < templates.length - 1) {
        showTemplate(currentIdx + 1);
        document.querySelector('.nav-item.active')?.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'ArrowUp' && currentIdx > 0) {
        showTemplate(currentIdx - 1);
        document.querySelector('.nav-item.active')?.scrollIntoView({ block: 'nearest' });
      }
    });

    // Auto-select first template
    if (templates.length > 0) showTemplate(0);
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`\\n📧 Email Template Preview Server`);
  console.log(`   ${templates.length} templates loaded`);
  console.log(`   Open: http://localhost:${PORT}\\n`);
});

const templates = generateAllTemplates();
