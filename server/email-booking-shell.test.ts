import { describe, expect, it } from 'vitest';
import * as emails from './email';

const fixture = {
  email: 'chef@example.test', chefEmail: 'chef@example.test', managerEmail: 'manager@example.test', adminEmail: 'admin@example.test',
  chefName: 'Alex Chen', managerName: 'Morgan Lee', name: 'Alex Chen', kitchenName: 'Harbour Kitchen',
  locationName: 'Harbour', locationAddress: '1 Harbour Road', timezone: 'America/St_Johns',
  bookingId: 12, referenceCode: 'KB-EXAMPLE', locationId: 1, bookingDate: '2026-10-20', startTime: '09:00', endTime: '13:00',
  responseDeadline: '2026-10-19T14:00:00Z', totalCents: 12200, payoutCents: 10750,
  paymentSummary: 'Payment captured: CAD $122.00 (tax CAD $13.00, service fee CAD $7.00).',
  storageName: 'Cold storage', extensionDays: 2, totalPrice: 12200, refundAmount: 12200,
  newEndDate: new Date('2026-10-25'), endDate: new Date('2026-10-23'), gracePeriodEndsAt: new Date('2026-10-26'),
  approvedAt: new Date('2026-10-18'), chargeDate: new Date('2026-10-26'), stage: '7_day', expiryDate: '2026-10-25', daysLeft: 7,
  daysOverdue: 2, isInGracePeriod: false, calculatedPenaltyCents: 1200, penaltyAmountCents: 1200,
  claimId: 67, claimTitle: 'Cleaning claim', chargedAmount: '12.00',
  feedback: 'Upload a readable copy.', rejectionReason: 'Storage is unavailable.', changes: 'Contact details updated.', isChef: true,
  instructionsReleased: false, instructionsReleaseAt: '2026-10-18T11:30:00Z',
  arrivalInstructions: 'UNRELEASED-SENTINEL', departureInstructions: 'UNRELEASED-SENTINEL',
  visitCode: '918273', serviceFeeCents: 700, taxCents: 1300,
};

const renderers = [
  ['generateBookingRequestEmail', 'Request sent to Harbour Kitchen', 'View request'],
  ['generateBookingNotificationEmail', 'New booking request · Alex Chen', 'Review request'],
  ['generateBookingConfirmationEmail', 'Your kitchen booking is confirmed', 'Open booking'],
  ['generateBookingCancellationEmail', 'Kitchen booking cancelled', 'Browse kitchens'],
  ['generateBookingCancellationNotificationEmail', 'Kitchen booking cancelled', 'View bookings'],
  ['generateKitchenSettingsChangeEmail', 'Kitchen settings updated · Harbour Kitchen', 'View kitchen'],
  ['generateChefProfileRequestEmail', 'Kitchen access requested · Alex Chen', 'Review application'],
  ['generateChefLocationAccessApprovedEmail', 'Kitchen access approved · Harbour Kitchen', 'Browse kitchens'],
  ['generateLocationEmailChangedEmail', 'Kitchen notification email updated', 'View kitchen'],
  ['generateStorageExtensionPendingApprovalEmail', 'Storage extension requested · Cold storage', 'Review storage'],
  ['generateStorageExtensionPaymentReceivedEmail', 'Storage extension payment received · Cold storage', 'View storage booking'],
  ['generateStorageExtensionApprovedEmail', 'Storage extension approved · Cold storage', 'View storage booking'],
  ['generateStorageExtensionRejectedEmail', 'Storage extension declined · Cold storage', 'View storage booking'],
  ['generateOverstayDetectedEmail', 'Storage removal needs attention · Cold storage', 'View storage booking'],
  ['generatePenaltyChargedEmail', 'Storage overstay charged · Cold storage', 'View storage booking'],
  ['generateDamageClaimChargedEmail', 'Claim payment recorded', 'View claim'],
  ['generateOverstayManagerNotificationEmail', 'Storage removal overdue · Alex Chen', 'Review storage'],
  ['generateKitchenLicenseApprovedEmail', 'Kitchen licence approved · Harbour Kitchen', 'Update kitchen licence'],
  ['generateKitchenLicenseRejectedEmail', 'Kitchen licence needs an update · Harbour Kitchen', 'Update kitchen licence'],
  ['generateKitchenLicenseSubmittedAdminEmail', 'Kitchen licence ready for review · Harbour Kitchen', 'Review kitchen licence'],
  ['generateKitchenLicenseExpiringEmail', 'Kitchen licence renewal · Harbour Kitchen', 'Update kitchen licence'],
];

function body(content: string) {
  return content.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/https?:\/\/\S+/g, '');
}

describe('booking email notice shell', () => {
  it.each(renderers)('%s has a heading, primary button, details and readable text without fee math', (name, heading, button) => {
    const render = (emails as Record<string, any>)[name];
    const email = render(fixture);
    expect(email.html).toContain('class="email-title"');
    expect(email.html).toContain('max-width:560px');
    expect(email.html.match(/class="cta-button/g)).toHaveLength(1);
    for (const part of [email.html, email.text]) {
      const visible = body(part);
      expect(visible).toContain(heading);
      expect(visible).toContain(button);
      expect(visible).toContain('Details');
      expect(visible).toContain('Harbour Kitchen');
      expect(visible).toContain('1 Harbour Road');
      expect(visible).toContain('KB-EXAMPLE');
      expect(visible).toContain('Newfoundland Time');
      expect(visible).toContain('9:00 a.m.');
      expect(visible).not.toMatch(/Service fee|%|\bHST\b|\bTax\b|America\/|09:00|13:00|918273|UNRELEASED-SENTINEL/i);
    }
    expect(email.text).toContain('support@localcooks.ca');
  });

  it.each(['fr-CA', 'uk'])('translates new booking copy and facts in %s without encoding loss', locale => {
    const email = emails.generateBookingRequestEmail({ ...fixture, locale });
    expect(email.text).not.toContain('Request sent to');
    expect(email.text).not.toMatch(/booking\w+|\?{2,}|\{deadline\}|\{kitchen\}/);
    expect(email.text).toContain(locale === 'fr-CA' ? 'Demande envoyée' : 'Запит надіслано');
  });

  it('uses the supplied response deadline and captured hold total', () => {
    const email = emails.generateBookingRequestEmail(fixture);
    expect(email.text).toContain('Oct 19, 2026, 11:30 a.m.');
    expect(email.text).toContain('Total on hold: CAD $122.00');
  });

  it('keeps the confirmation calendar and links the authenticated PDF receipt', () => {
    const email = emails.generateBookingConfirmationEmail({ ...fixture, receiptUrl: 'https://chef.example.test/api/bookings/12/invoice' });
    expect(email.attachments?.[0].contentType).toContain('method=PUBLISH');
    expect(email.text).toContain('Download PDF receipt: https://chef.example.test/api/bookings/12/invoice');
    expect(email.text).toContain('Total paid: CAD $122.00');
    expect(email.html).toContain('Add to Google Calendar');
  });

  it('uses self arrival copy for managers without showing a check-in code', () => {
    const email = emails.generateBookingConfirmationEmail({ ...fixture, isStaff: true, arrivalMode: 'self', reservationChefName: 'Alex' });
    expect(email.text).toContain('Self check-in is on for Alex');
    expect(email.text).toContain('Estimated payout: CAD $107.50');
    expect(email.text).not.toContain('share it with the chef');
    expect(email.text).not.toContain('918273');
  });
  it.each(['staffed', 'mixed', 'legacy'] as const)('keeps the manager arrival guidance appropriate for %s', arrivalMode => {
    const email = emails.generateBookingConfirmationEmail({ ...fixture, isStaff: true, arrivalMode, reservationChefName: 'Alex' });
    expect(email.text).toContain('Alex');
    expect(email.text).toContain(arrivalMode === 'staffed' ? 'share it with the chef in person'
      : arrivalMode === 'mixed' ? 'Arrival method varies by visit' : 'Review the arrival arrangements');
    expect(email.text).not.toContain('918273');
  });

  it.each(['lifecycle_outcome_attempt', 'storage-request', 'storage-claim'])('wraps legacy %s delivery in the notice shell', kind => {
    const subject = kind === 'storage-request' ? 'Storage Checkout Request - Cold storage'
      : kind === 'storage-claim' ? 'Storage Checkout — Claim Filed - Cold storage' : 'Problem resolved · KB-12';
    const email = emails.bookingDeliveryEmail({ to: 'chef@example.test', subject,
      text: 'The current record needs your attention.\nKitchen: Harbour Kitchen\nStorage: Cold storage\n\nhttps://chef.example.test/dashboard?view=bookings' }, kind);
    expect(email.html).toContain('class="email-title"');
    expect(email.html).toContain('max-width:560px');
    expect(email.text).toContain('Harbour Kitchen');
    expect(email.text).toContain('https://chef.example.test/dashboard?view=bookings');
  });
  it.each(['request', 'claim'] as const)('renders current storage checkout %s with escaped details and its correct destination', kind => {
    const email = emails.generateStorageCheckoutEmail({ ...fixture, to: 'chef@example.test', recipientName: 'Alex',
      kind, storageBookingId: 45, claimId: 67, claimTitle: '<Unsafe title>' });
    expect(email.html).toContain('class="email-title"');
    expect(email.html).toContain('max-width:560px');
    expect(email.html.match(/class="cta-button/g)).toHaveLength(1);
    expect(email.html).not.toContain('<Unsafe title>');
    expect(email.text).toContain('Harbour Kitchen');
    expect(email.text).toContain('1 Harbour Road');
    expect(email.text).toContain(kind === 'request' ? 'view=storage-checkouts' : 'view=damage-claims&claimId=67');
    expect(body(email.text)).not.toMatch(/Service fee|\bTax\b|%|918273|America\//i);
  });
  it.each(['pending', 'paid'] as const)('does not claim a card hold for a %s legacy/portal request', paymentState => {
    const email = emails.generateBookingRequestEmail({ ...fixture, paymentState });
    expect(email.text).not.toContain('card is on hold');
    expect(email.text).toContain(paymentState === 'paid' ? 'Your payment is recorded' : 'current payment status');
  });
});
