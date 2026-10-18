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
    expect(email.text).toContain('9:00 a.m.–10:00 a.m., 2:00 p.m.–3:00 p.m.');
    expect(email.html).toContain('Add to Google Calendar · 9:00 a.m.–10:00 a.m.');
    expect(email.html).toContain('Add to Google Calendar · 2:00 p.m.–3:00 p.m.');
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
    // Arrival/departure is always on (tracking switch removed Oct13); no opt-out wording remains.
    expect(email.text).not.toContain('Arrival tracking is off');
  });

  it('describes the effective check-in lead and no-show grace without calling grace a closing time', () => {
    const email = generateBookingConfirmationEmail({
      ...base, checkinEnabled: true, checkInWindowMinutesBefore: 20, noShowGraceMinutes: 45,
    });
    expect(email.text).toContain('Follow the arrival instructions');
    expect(email.text).not.toContain('Request checkout for each visit');
    expect(email.text).not.toContain('closes 45 minutes after');
  });
});

describe('staff confirmation payout line', () => {
  const base = { chefEmail: 'admin@example.test', chefName: 'Admin', kitchenName: 'Kitchen', bookingDate: '2026-09-25', startTime: '09:00', endTime: '15:00',
    timezone: 'America/St_Johns', isStaff: true, isAdmin: true, bookingId: 10 };
  it('shows manager revenue minus the processing fee, matching the kitchen page', () => {
    const email = generateBookingConfirmationEmail({ ...base, payoutCents: 5750, processingFeeCents: 256 });
    expect(email.text).toContain('CAD $54.94');
    expect(email.text).not.toContain('$57.50');
  });
  it('keeps the stored figure when no fee is supplied and never goes negative', () => {
    expect(generateBookingConfirmationEmail({ ...base, payoutCents: 5750 }).text).toContain('CAD $57.50');
    expect(generateBookingConfirmationEmail({ ...base, payoutCents: 100, processingFeeCents: 500 }).text).toContain('CAD $0.00');
  });
});


it('CP9: dated email calendars preserve gaps, visit identity, revision and cancelled days', () => {
  const email = generateBookingConfirmationEmail({ chefEmail: 'chef@example.test', chefName: 'Sam', kitchenName: 'Kitchen',
    bookingId: 42, bookingDate: '2030-01-15', startTime: '22:00', endTime: '02:00', timezone: 'UTC', scheduleRevision: 3,
    days: [{ id: 8, date: '2030-01-15', startTime: '22:00', endTime: '02:00', operatingWindowStartTime: '20:00' },
      { id: 9, date: '2030-01-18', startTime: '09:00', endTime: '10:00', cancelled: true }] });
  const ics = String(email.attachments?.[0]?.content);
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(ics).toContain('UID:booking-42-visit-8@localcooks.ca'); expect(ics).toContain('UID:booking-42-visit-9@localcooks.ca');
  expect(ics).toContain('DTSTART:20300115T220000Z'); expect(ics).toContain('DTEND:20300116T020000Z');
  expect(ics).toContain('SEQUENCE:3'); expect(ics).toContain('STATUS:CANCELLED');
  expect(email.text).toContain('Jan 15'); expect(email.text).toContain('Jan 18'); expect(email.text).toContain('2 days');
});

it('CP9: cancelling the first date never makes the calendar cancel the remaining dates', () => {
 const email = generateBookingConfirmationEmail({ chefEmail: 'chef@example.test', chefName: 'Sam', kitchenName: 'Kitchen', bookingId: 42,
  bookingDate: '2030-01-15', startTime: '09:00', endTime: '10:00', timezone: 'UTC', scheduleRevision: 2,
  days: [{ id: 8, date: '2030-01-15', startTime: '09:00', endTime: '10:00', cancelled: true }, { id: 9, date: '2030-01-18', startTime: '09:00', endTime: '10:00' }] });
 const ics = String(email.attachments?.[0]?.content);
 expect(ics).toContain('METHOD:PUBLISH'); expect(ics).not.toContain('METHOD:CANCEL');
 expect(ics).toContain('STATUS:CANCELLED'); expect(ics).toContain('STATUS:CONFIRMED'); expect(ics).toContain('SEQUENCE:3');
});

it('a multi-day confirmation tells the chef each day has its own check-in (not for one day or the kitchen)', () => {
  const base = { chefEmail: 'chef@example.com', chefName: 'Chef', kitchenName: 'Kitchen', bookingDate: '2030-01-15', startTime: '09:00', endTime: '10:00',
    timezone: 'America/St_Johns', bookingId: 10, arrivalMode: 'staffed' as const, scheduleRevision: 1 };
  const days = [{ id: 8, date: '2030-01-15', startTime: '09:00', endTime: '10:00' }, { id: 9, date: '2030-01-18', startTime: '09:00', endTime: '10:00' }];
  expect(generateBookingConfirmationEmail({ ...base, days }).text).toContain('Each day of this booking has its own check-in and code.');
  expect(generateBookingConfirmationEmail({ ...base, days: [days[0], { ...days[1], cancelled: true }] }).text).not.toContain('Each day of this booking');
  expect(generateBookingConfirmationEmail({ ...base, days, isStaff: true }).text).not.toContain('Each day of this booking');
});
