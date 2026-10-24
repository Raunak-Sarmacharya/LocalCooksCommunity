import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Owner, Oct 22: one phone per account, the one verified at registration. No business or application phone anywhere.
describe('booking contact phones come only from the verified account', () => {
  // Windows checkouts use CRLF; compare as LF.
  const bookings = readFileSync(new URL('./bookings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const manager = readFileSync(new URL('./manager.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('chef booking details: the manager phone only when verified and booked', () => {
    expect(bookings).not.toContain('businessPhone');
    expect(bookings).toContain("phone: (kitchenContact.phoneVerifiedAt && ['confirmed', 'cancellation_requested', 'completed'].includes(booking.status) ? kitchenContact.phone : null)");
  });

  it('manager booking details: the customer phone only when verified and booked, never the application phone', () => {
    expect(manager).not.toContain('chefApp?.phone');
    expect(manager).toContain("phone: ['confirmed', 'cancellation_requested', 'completed'].includes(booking.status)\n              ? (chefUser.phoneVerifiedAt ? chefUser.phoneNumber : null) : null,");
  });
});
