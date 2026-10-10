import { generateBookingRequestEmail, generateBookingNotificationEmail } from '../server/email';
import type { TourEmailSample } from './tour-email-samples';

/** Fixture renderers only: no database access or email delivery. */
export function buildKitchenBookingEmailSamples() {
  const details = {
    bookingId: 112, referenceCode: 'KB-EST8DN', chefName: 'Alex Chen', kitchenName: 'Kitchen North',
    bookingDate: '2026-11-11', startTime: '09:00', endTime: '11:00', timezone: 'America/St_Johns',
    locationName: 'Moonlight Kitchens', locationAddress: '123 Water Street, St. John’s, NL, Canada',
    selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }],
    specialNotes: 'I will be preparing baked goods and have requested the commercial oven.',
  };
  const samples: TourEmailSample[] = [
    { id: 'request-chef', scenario: 'Booking request received', group: 'Booking requests', role: 'Chef',
      ...generateBookingRequestEmail({ ...details, chefEmail: 'alex.chen@example.com' }), attachments: [] },
    { id: 'request-manager', scenario: 'New booking request', group: 'Booking requests', role: 'Manager',
      ...generateBookingNotificationEmail({ ...details, managerName: 'Morgan Lee', managerEmail: 'morgan@example.com' }), attachments: [] },
  ];
  return { samples, notificationOnly: [] };
}
