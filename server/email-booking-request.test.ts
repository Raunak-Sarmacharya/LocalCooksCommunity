import { describe, expect, it } from 'vitest';
import { generateBookingRequestEmail, generateBookingNotificationEmail } from './email';

const booking = { bookingId: 112, referenceCode: 'KB-EST8DN', chefName: 'Alex Chen', kitchenName: 'Kitchen North',
  bookingDate: '2026-10-11', startTime: '09:00', endTime: '11:00', locationName: 'Moonlight Kitchens',
  selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }] };

describe('booking request email alignment', () => {
  it.each(['chef', 'manager'])('uses the shared template and correct booking link for %s', role => {
    const email = role === 'chef' ? generateBookingRequestEmail({ ...booking, chefEmail: 'alex@example.test' })
      : generateBookingNotificationEmail({ ...booking, managerName: 'Morgan Lee', managerEmail: 'morgan@example.test' });
    expect(email.html).toContain('class="email-title"');
    for (const content of [email.html, email.text]) {
      expect(content).toContain('KB-EST8DN');
      expect(content).toContain('100% refund of any amount paid, including taxes and fees');
      expect(content).toContain('hold will be released instead');
      expect(content).toContain('not yet confirmed');
      expect(content).toContain('For your safety, always communicate through Local Cooks');
      expect(content).toContain(role === 'chef' ? '/booking/112' : '/manager/booking/112');
      expect(content).not.toMatch(/24.{0,10}48|built-in chat|View Chef.s Profile|Pending Manager Confirmation/);
    }
    expect(email.text).toContain('Sunday, October 11, 2026');
    expect(email.text).toContain('09:00–11:00');
    // Pending requests should not appear as confirmed reservations in calendar apps.
    expect(email.attachments).toBeUndefined();
  });
  it('escapes names and notes in HTML while preserving readable plain text', () => {
    const email = generateBookingRequestEmail({ ...booking, chefEmail: 'alex@example.test', chefName: '<Alex>', specialNotes: '<script>notes</script>' });
    expect(email.html).not.toContain('<script>notes</script>');
    expect(email.html).toContain('&lt;script&gt;notes&lt;/script&gt;');
    expect(email.text).toContain('<script>notes</script>');
  });
});
