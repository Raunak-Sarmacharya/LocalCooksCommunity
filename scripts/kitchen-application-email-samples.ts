import {
  generateKitchenApplicationAdminEmail, generateKitchenApplicationReceivedChefEmail,
  generateKitchenApplicationSubmittedChefEmail, generateKitchenApplicationClearedManagerEmail,
  generateKitchenApplicationStep2ReceivedChefEmail, generateKitchenCoordinationSubmittedManagerEmail,
  generateKitchenApplicationApprovedEmail, generateKitchenAccessConfirmedManagerEmail,
  generateKitchenApplicationRejectedEmail,
} from '../server/email';
import type { TourEmailSample } from './tour-email-samples';

/** Fixture renderers only: no database reads, outbound messages, or delivery calls. */
export function buildKitchenApplicationEmailSamples() {
  const details = {
    applicationId: 57, chefName: 'Alex Chen', chefEmail: 'alex.chen@example.com',
    managerName: 'Morgan Lee', managerEmail: 'morgan@example.com', recipientEmail: 'operations@example.com',
    locationName: 'Harbour House', locationAddress: '123 Water Street, St. John’s, NL A1C 1A5, Canada',
    locationId: 5, conversationId: 'fixture-kitchen-chat-57', submittedAt: new Date('2026-10-10T12:00:00Z'),
  };
  const samples: TourEmailSample[] = [];
  const add = (id: string, scenario: string, group: string, role: TourEmailSample['role'], email: ReturnType<typeof generateKitchenApplicationReceivedChefEmail>) =>
    samples.push({ id, scenario, group, role, ...email, attachments: [] });
  add('request-chef', 'Request received', 'Request to apply', 'Chef', generateKitchenApplicationReceivedChefEmail(details));
  add('request-admin', 'New request', 'Request to apply', 'Local Cooks', generateKitchenApplicationAdminEmail(details));
  add('coordination-chef', 'Request approved, coordinate and submit documents', 'Kitchen coordination', 'Chef', generateKitchenApplicationSubmittedChefEmail(details));
  add('coordination-manager', 'Kitchen coordination available', 'Kitchen coordination', 'Manager', generateKitchenApplicationClearedManagerEmail(details));
  add('documents-chef', 'Documents received', 'Kitchen documents', 'Chef', generateKitchenApplicationStep2ReceivedChefEmail(details));
  add('documents-manager', 'Documents available', 'Kitchen documents', 'Manager', generateKitchenCoordinationSubmittedManagerEmail(details));
  add('documents-admin', 'Documents available', 'Kitchen documents', 'Local Cooks', generateKitchenApplicationAdminEmail({ ...details, documentsSubmitted: true }));
  add('access-chef', 'Kitchen access confirmed', 'Access confirmation', 'Chef', generateKitchenApplicationApprovedEmail(details));
  add('access-manager', 'Kitchen access confirmed', 'Access confirmation', 'Manager', generateKitchenAccessConfirmedManagerEmail(details));
  add('declined-chef', 'Application declined with feedback', 'Application update', 'Chef', generateKitchenApplicationRejectedEmail({ ...details, feedback: 'Please renew your certificate before applying again.' }));
  add('coordination-unavailable', 'Request approved, chat temporarily unavailable', 'Kitchen coordination', 'Chef', generateKitchenApplicationSubmittedChefEmail({ ...details, conversationId: null }));
  return { samples, notificationOnly: [] };
}
