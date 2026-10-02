import { describe, expect, it, vi } from 'vitest';
vi.mock('./phone-utils', () => ({ stripCountryCode: (value: string) => value }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { generateTourConfirmedEmail, generateTourRequestedChefEmail, generateTourRequestedManagerEmail,
  generateTourRequestedLocalCooksEmail, generateTourRejectedChefEmail, generateTourManagerChangeEmail } from './email';

const base = { tourId: 42, durationMinutes: 30, isManager: false, email: 'chef@example.com',
  recipientName: 'Chef', otherPartyName: 'Manager', kitchenName: 'Kitchen', locationAddress: 'Harbour Road',
  tourDate: '2026-10-07T11:30:00Z', timezone: 'Asia/Kolkata' };
const calendar = (email: ReturnType<typeof generateTourConfirmedEmail>) => String(email.attachments?.[0]?.content);

describe('tour time and downloadable calendar', () => {
  it.each([
    ['2026-10-07T11:30:00Z', 'Oct 7, 2026', '9:00 AM', '20261007T120000Z'],
    ['2026-01-07T12:30:00Z', 'Jan 7, 2026', '9:00 AM', '20260107T130000Z'],
    ['2026-10-08T02:15:00Z', 'Oct 7, 2026', '11:45 PM', '20261008T024500Z'],
    ['2026-03-08T05:15:00Z', 'Mar 8, 2026', '1:45 AM', '20260308T054500Z'],
    ['2026-11-01T04:15:00Z', 'Nov 1, 2026', '1:45 AM', '20261101T044500Z'],
  ])('uses the stored instant and elapsed duration: %s', (tourDate, date, time, end) => {
    const email = generateTourConfirmedEmail({ ...base, tourDate });
    const ics = calendar(email);
    expect(ics).toContain(`DTSTART:${tourDate.replace(/[-:]/g, '')}`);
    expect(ics).toContain(`DTEND:${end}`);
    expect(ics).not.toContain('NaN');
    expect(email.html).toContain(date);
    expect(email.html).toContain(time);
    expect(email.html).toContain('(America/St_Johns)');
    expect(email.html).not.toContain('Asia/Kolkata');
    const url = new URL(email.html!.match(/href="(https:\/\/calendar.google.com[^\"]+)"/)![1]);
    expect(url.searchParams.get('dates')).toBe(`${tourDate.replace(/[-:]/g, '')}/${end}`);
  });

  it('keeps identity across recipients/retries and matches the published MIME method', () => {
    for (const isManager of [true, false]) {
      const email = generateTourConfirmedEmail({ ...base, isManager });
      expect(calendar(email)).toContain('UID:tour-42@localcooks.com');
      expect(calendar(email)).toContain('METHOD:PUBLISH');
      expect(email.attachments?.[0]?.contentType).toContain('method=PUBLISH');
      expect(email.html).toContain('do not update automatically');
    }
  });
  it('names the overnight end date and distinguishes repeated daylight-saving clocks', () => {
    const overnight = generateTourConfirmedEmail({ ...base, tourDate: '2026-10-08T02:15:00Z' });
    expect(overnight.html).toContain('Oct 8, 2026, 12:15 AM NDT');
    const fold = generateTourConfirmedEmail({ ...base, tourDate: '2026-11-01T04:15:00Z' });
    expect(fold.html).toContain('1:45 AM NDT – 1:15 AM NST');
  });

  it.each([{ tourDate: 'invalid' }, { durationMinutes: 0 }, { durationMinutes: NaN },
    { durationMinutes: Infinity }, { tourId: 0 }])('rejects invalid calendar details: %j', (change) => {
    expect(() => generateTourConfirmedEmail({ ...base, ...change })).toThrow('Invalid tour calendar details');
  });

  it('describes a cancelled confirmed tour and identifies Local Cooks accurately', () => {
    const email = generateTourRejectedChefEmail({ chefEmail: base.email, chefName: 'Chef', kitchenName: base.kitchenName,
      tourDate: base.tourDate, startTime: 'ignored', cancelled: true, reviewer: 'Local Cooks' });
    expect(email.subject).toContain('Kitchen Tour Cancelled');
    expect(email.html).toContain('confirmed kitchen tour');
    expect(email.html).toContain('cancelled by Local Cooks');
    expect(email.html).toContain('remove the cancelled tour from your calendar');
  });

  it('formats request, review and rejection mail from the instant rather than supplied display text', () => {
    const details = { chefEmail: base.email, managerEmail: 'manager@example.com', recipientEmail: 'admin@example.com',
      chefName: 'Chef', managerName: 'Manager', kitchenName: base.kitchenName, tourDate: '2026-10-08T02:15:00Z',
      startTime: 'WRONG LOCAL CLOCK', timezone: 'Asia/Kolkata' };
    for (const generate of [generateTourRequestedChefEmail, generateTourRequestedLocalCooksEmail,
      generateTourRequestedManagerEmail, generateTourRejectedChefEmail]) {
      const email = generate(details);
      expect(email.html).toContain('Oct 7, 2026');
      expect(email.html).toContain('11:45 PM');
      expect(email.html).not.toContain('WRONG LOCAL CLOCK');
    }
    const change = generateTourManagerChangeEmail({ ...details, kind: 'reschedule_requested',
      scheduledAt: new Date(details.tourDate), requestedAt: new Date(base.tourDate) });
    expect(change.text).toContain('Oct 7, 2026');
    expect(change.text).toContain('11:45');
  });
});
