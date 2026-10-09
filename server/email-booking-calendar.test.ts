import { describe, expect, it } from 'vitest';
import { generateBookingConfirmationEmail } from './email';

describe('kitchen booking calendar invite', () => {
  const base = {
    chefEmail: 'chef@example.com', chefName: 'Chef', kitchenName: 'Kitchen',
    bookingDate: '2026-09-25', startTime: '09:00', endTime: '15:00',
    timezone: 'America/St_Johns', operatingWindowStartTime: '08:00',
  };
  it.each([false, true])('advertises only existing role-appropriate actions (staff=%s)', isStaff => {
    const email = generateBookingConfirmationEmail({ ...base, bookingId: 10, isStaff, contactEmail: 'manager@example.test' });
    for (const content of [email.html, email.text]) {
      expect(content).not.toContain('reschedule or cancel');
      expect(content).not.toContain('chat in your dashboard');
      expect(content).toContain('date/time change');
      expect(content).toContain(isStaff ? 'support@localcooks.ca' : 'manager@example.test');
      expect(content).toContain(isStaff ? 'review its current status' : 'request cancellation');
    }
    if (isStaff) expect(email.text).not.toContain('Arrival tracking is off');
  });

  it('keeps separate booked hours as separate busy events and links', () => {
    const email = generateBookingConfirmationEmail({
      ...base,
      selectedSlots: [
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '14:00', endTime: '15:00' },
      ],
    });
    const ics = String(email.attachments?.[0]?.content || '');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART:20260925T113000Z');
    expect(ics).toContain('DTEND:20260925T123000Z');
    expect(ics).toContain('DTSTART:20260925T163000Z');
    expect(ics).toContain('DTEND:20260925T173000Z');
    expect(email.text).toContain('09:00–10:00, 14:00–15:00');
    expect(email.html).toContain('Add 09:00–10:00 to calendar');
    expect(email.html).toContain('Add 14:00–15:00 to calendar');
  });

  it('keeps an overnight continuous booking in one event on the correct calendar dates', () => {
    const email = generateBookingConfirmationEmail({
      ...base, startTime: '23:00', endTime: '01:00',
      selectedSlots: [
        { startTime: '23:00', endTime: '00:00' },
        { startTime: '00:00', endTime: '01:00' },
      ],
    });
    const ics = String(email.attachments?.[0]?.content || '');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTSTART:20260926T013000Z');
    expect(ics).toContain('DTEND:20260926T033000Z');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(email.attachments?.[0]?.contentType).toContain('method=PUBLISH');
  });
  it('preserves legacy string slots and gives different reservations distinct retry-stable identities', () => {
    const email = generateBookingConfirmationEmail({ ...base, bookingId: 41, selectedSlots: ['09:00', '14:00'] });
    const ics = String(email.attachments?.[0]?.content);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:booking-41@localcooks.com-1');
    const other = generateBookingConfirmationEmail({ ...base, bookingId: 42, selectedSlots: ['09:00', '14:00'] });
    expect(String(other.attachments?.[0]?.content)).not.toContain('UID:booking-41@localcooks.com-1');
    expect(email.text).toContain('Arrival tracking is off');
  });

  it('describes the effective check-in lead and no-show grace without calling grace a closing time', () => {
    const email = generateBookingConfirmationEmail({
      ...base, checkinEnabled: true, checkInWindowMinutesBefore: 20, noShowGraceMinutes: 45,
    });
    expect(email.text).toContain('20 minutes before');
    expect(email.text).toContain('may be marked a no-show 45 minutes after');
    expect(email.text).not.toContain('closes 45 minutes after');
  });
});
