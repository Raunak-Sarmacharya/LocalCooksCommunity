/** Minimal RFC 5545 calendar file for one booked kitchen visit (UTC times, no recurrence). */
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function bookingIcs({ uid, title, start, end, location, description }: {
  uid: string; title: string; start: Date; end: Date; location?: string | null; description?: string | null;
}) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Local Cooks//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escape(uid)}@localcooks.ca`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(title)}`,
    ...(location ? [`LOCATION:${escape(location)}`] : []),
    ...(description ? [`DESCRIPTION:${escape(description)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function downloadBookingIcs(fileName: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = fileName; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

/** Separate events preserve gaps between operating days; stable visit IDs survive schedule changes. */
export function bookingDaysIcs(days: Array<{ uid: string; title: string; start: Date; end: Date; location?: string | null; description?: string | null;
  cancelled?: boolean; revision: number }>) {
  const events = days.map(day => 'BEGIN:VEVENT\r\n' + bookingIcs(day).split('BEGIN:VEVENT\r\n')[1].split('END:VEVENT')[0]
    + `SEQUENCE:${day.revision}\r\nSTATUS:${day.cancelled ? 'CANCELLED' : 'CONFIRMED'}\r\nEND:VEVENT\r\n`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Local Cooks//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...events, 'END:VCALENDAR', ''].join('\r\n').replace(/\r\n\r\n/g, '\r\n');
}
