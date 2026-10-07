import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./phone-utils', () => ({ stripCountryCode: (value: string) => value }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { generateTourConfirmedEmail, generateTourRequestedChefEmail, generateTourRequestedManagerEmail,
  generateTourRequestedLocalCooksEmail, generateTourRejectedChefEmail, generateTourManagerChangeEmail, getSubdomainUrl, renderTransactionalEmail } from './email';

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

const base = { tourId: 42, durationMinutes: 30, isManager: false, email: 'chef@example.com',
  recipientName: 'Chef', otherPartyName: 'Manager', kitchenName: 'Kitchen', locationAddress: 'Harbour Road',
  tourDate: '2026-10-07T11:30:00Z', timezone: 'Asia/Kolkata' };
const calendar = (email: ReturnType<typeof generateTourConfirmedEmail>) => String(email.attachments?.[0]?.content);

describe('tour time and downloadable calendar', () => {
  it('opens manager review and alternative-time actions from pending request emails', () => {
    const email = generateTourRequestedManagerEmail({ ...base, tourDate: '2099-10-07T11:30:00Z', managerEmail: 'manager@example.test', managerName: 'Morgan', chefName: 'Alex' });
    expect(email.text).toContain('Confirm tour:');
    expect(email.text).toContain('viewing=42&action=confirm');
    expect(email.text).toContain('Offer alternative times:');
    expect(email.text).toContain('viewing=42&action=reschedule');
    expect(email.text).toContain('Decline request:');
    expect(email.text).toContain('viewing=42&action=cancel');
  });
  it('offers role-specific scheduling actions and closes chef rescheduling at Newfoundland midnight', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T02:29:59Z'));
    const beforeCutoff = generateTourConfirmedEmail(base);
    expect(beforeCutoff.text).toContain('Reschedule tour:');
    expect(beforeCutoff.text).toContain('viewing=42&action=reschedule');
    expect(beforeCutoff.text).toContain('Cancel tour:');
    expect(beforeCutoff.text).toContain('viewing=42&action=cancel');
    vi.setSystemTime(new Date('2026-10-07T02:30:00Z'));
    expect(generateTourConfirmedEmail(base).text).not.toContain('Reschedule tour:');
    expect(generateTourConfirmedEmail({ ...base, isManager: true }).text).toContain('Reschedule tour:');
    expect(generateTourConfirmedEmail({ ...base, isManager: true, canReschedule: false }).text).not.toContain('Reschedule tour:');
    vi.setSystemTime(new Date('2026-10-07T11:30:00Z'));
    expect(generateTourConfirmedEmail({ ...base, isManager: true }).text).not.toContain('Cancel tour:');
  });
  it('states pending confirmation without describing internal review routing', () => {
    const details = { ...base, chefEmail: base.email, chefName: 'Alex Chen', managerEmail: 'manager@example.test', managerName: 'Morgan Lee' };
    const chef = generateTourRequestedChefEmail(details), manager = generateTourRequestedManagerEmail(details);
    expect(chef.text).toContain('requested time is not yet confirmed');
    expect(manager.text).toContain('Alex Chen requested a tour');
    for (const email of [chef, manager]) {
      expect(email.html).toContain('<h1'); expect(email.html).toContain('<h2');
      expect(email.text).not.toMatch(/review it first|reviewed and forwarded|If forwarded/);
      expect(email.html).not.toContain('application/ld+json');
    }
  });
  it.each(['preview', 'production'])('uses the visitor portal independently of callback origin in %s', environment => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('BASE_DOMAIN', 'localcooks.ca');
    vi.stubEnv('BASE_URL', 'https://callback.example.test');
    const actionUrl = `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=42`;
    const expected = `https://${environment === 'preview' ? 'dev-' : ''}chef.localcooks.ca/dashboard?view=viewings&viewing=42`;
    const email = renderTransactionalEmail({ to: base.email, subject: 'Tour decision', recipientName: 'Chef',
      message: 'Your tour time change was approved.', facts: [], actionLabel: 'View updated tour', actionUrl });
    expect(email.text).toContain(expected);
    expect(email.html).toContain(`href="${expected.replace(/&/g, '&amp;')}"`);
    expect(email.html).not.toContain('callback.example.test');
  });
  it.each(['preview', 'production'])('brands confirmation for both roles with exact links in %s', environment => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('BASE_DOMAIN', 'localcooks.ca'); vi.stubEnv('BASE_URL', 'https://callback.example.test');
    for (const isManager of [false, true]) {
      const email = generateTourConfirmedEmail({ ...base, isManager, recipientName: 'Pat <script>',
        kitchenName: 'Room <b>A</b>', notes: 'Door & "bell"', contactEmail: 'host@example.test' });
      const role = isManager ? 'kitchen' : 'chef';
      const url = `https://${environment === 'preview' ? 'dev-' : ''}${role}.localcooks.ca${isManager ? '/manager/dashboard' : '/dashboard'}?view=viewings&viewing=42`;
      expect(email.text).toContain(url); expect(email.html).toContain(`href="${url.replace(/&/g, '&amp;')}" class="cta-button"`);
      expect(email.html).toContain('>View details</a>');
      expect(email.html).toContain('Pat &lt;script&gt;'); expect(email.html).toContain('Room &lt;b&gt;A&lt;/b&gt;');
      expect(email.html).toContain('Door &amp; &quot;bell&quot;'); expect(email.html).not.toContain('<script>');
      for (const content of [email.text!, email.html!]) {
        expect(content).toContain('TOUR-42'); expect(content).toContain('host@example.test');
        expect(content).toContain('Add to Google Calendar'); expect(content).toContain('NDT');
      }
      expect(email.text).toContain('Door & "bell"'); expect(email.html).toContain('emailHeader.png');
      expect(email.html).not.toContain('callback.example.test');
    }
  });
  it('keeps arrival help available without a host contact, including in plain text', () => {
    vi.stubEnv('EMAIL_USER', 'notifications@example.test');
    const email = generateTourConfirmedEmail(base);
    expect(email.text).toContain('Arrival help: support@example.test');
    expect(email.html).toContain('<strong>Arrival help:</strong> support@example.test');
  });
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
    expect(email.html).toMatch(/N[DS]T/);
    expect(email.html).not.toContain('Asia/Kolkata');
    const url = new URL(email.html!.replace(/&amp;/g, '&').match(/href="(https:\/\/calendar.google.com[^\"]+)"/)![1]);
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

  it('describes a cancelled confirmed tour without identifying who cancelled', () => {
    const email = generateTourRejectedChefEmail({ tourId: 42, durationMinutes: 30, chefEmail: base.email, chefName: 'Chef', kitchenName: base.kitchenName,
      tourDate: base.tourDate, startTime: 'ignored', cancelled: true });
    expect(email.subject).toContain('Kitchen Tour Cancelled');
    expect(email.html).toContain('confirmed kitchen tour');
    expect(email.html).toContain('confirmed kitchen tour was cancelled.');
    expect(email.text + email.html).not.toMatch(/cancelled by|\badmin\b/i);
    expect(email.html).toContain('remove the cancelled tour from your calendar');
  });

  it('formats request, review and rejection mail from the instant rather than supplied display text', () => {
    const details = { tourId: 42, durationMinutes: 30, chefEmail: base.email, managerEmail: 'manager@example.com', recipientEmail: 'admin@example.com',
      chefName: 'Chef', managerName: 'Manager', kitchenName: base.kitchenName, tourDate: '2026-10-08T02:15:00Z',
      startTime: 'WRONG LOCAL CLOCK', timezone: 'Asia/Kolkata' };
    for (const generate of [generateTourRequestedChefEmail, generateTourRequestedLocalCooksEmail,
      generateTourRequestedManagerEmail, generateTourRejectedChefEmail]) {
      const email = generate(details);
      expect(email.html).toContain('Oct 7, 2026');
      expect(email.html).toContain('11:45 PM');
      expect(email.html).not.toContain('WRONG LOCAL CLOCK');
    }
    const change = generateTourManagerChangeEmail({ ...details, tourId: 42, kind: 'reschedule_requested',
      scheduledAt: new Date(details.tourDate), requestedAt: new Date(base.tourDate) });
    expect(change.text).toContain('Oct 7, 2026');
    expect(change.text).toContain('11:45');
  });

  it.each(['preview', 'production'])('uses exact request/review links and literal saved facts on %s recipient hosts', environment => {
    vi.stubEnv('VERCEL_ENV', environment);
    const details = { tourId: 42, durationMinutes: 30, chefEmail: 'chef@example.test', managerEmail: 'manager@example.test', recipientEmail: 'admin@example.test',
      chefName: 'Ada <Chef>', managerName: 'Pat & Lee', kitchenName: 'Room <A>', locationName: 'Harbour & Main', address: '12 Harbour Road',
      tourDate: '2026-11-01T04:15:00Z', chefNotes: '<door> & bell', startTime: 'ignored' };
    for (const [generate, role, path] of [[generateTourRequestedChefEmail, 'chef', '/dashboard?view=viewings&viewing=42'],
      [generateTourRequestedLocalCooksEmail, 'admin', '/admin?section=tour-requests&viewing=42'],
      [generateTourRequestedManagerEmail, 'kitchen', '/manager/dashboard?view=viewings&viewing=42']] as const) {
      const email = generate(details), url = `https://${environment === 'preview' ? 'dev-' : ''}${role}.localcooks.ca${path}`;
      expect(email.text).toContain(url); expect(email.html).toContain(url.replace(/&/g, '&amp;'));
      expect(email.text).toContain('Room <A>'); expect(email.html).toContain('Room &lt;A&gt;');
      expect(email.html).toContain('Harbour &amp; Main'); expect(email.text).toContain('1:45 AM NDT – 1:15 AM NST');
      expect(email.text).toContain('12 Harbour Road'); expect(email.attachments).toBeUndefined();
    }
    const confirmed = generateTourConfirmedEmail({ ...base, calendarSequence: 101, updatedAt: new Date('2026-10-05T10:00:00Z'), notes: 'Door\r\nSTATUS:CANCELLED, <A>; bell' });
    expect(calendar(confirmed)).toContain('SEQUENCE:101'); expect(calendar(confirmed)).toContain('DTSTAMP:20261005T100000Z');
    expect(calendar(confirmed)).toContain('Door\\nSTATUS:CANCELLED\\, <A>\\; bell');
    expect(calendar(confirmed).split('\r\n').filter(line => line.startsWith('STATUS:'))).toEqual(['STATUS:CONFIRMED']);
    const google = new URL(confirmed.html!.replace(/&amp;/g, '&').match(/href="(https:\/\/calendar.google.com[^\"]+)"/)![1]);
    expect(google.searchParams.get('details')).toContain('\n\nNotes: Door\r\nSTATUS:CANCELLED, <A>; bell');
  });
});


describe('separate public confirmation guidance', () => {
  it.each([[undefined, undefined], ['Front door <&> Олена', undefined], [undefined, 'Return badge'], ['Front door <&> Олена', 'Return badge']])('preserves public notes in email and both calendars (%s / %s)', (arrivalNotes, departureNotes) => {
    const email = generateTourConfirmedEmail({ ...base, arrivalNotes, departureNotes, sharedManagerNotes: 'Public message', confirmedAt: new Date('2026-10-01T12:00:00Z') });
    expect(email.text).toContain('Message from the kitchen manager');
    expect(email.text).toContain('Public message');
    const ics = calendar(email).replace(/\r\n /g, '');
    const google = email.text!.match(/https:\/\/calendar.google.com[^\s]+/)?.[0];
    expect(google).toBeDefined();
    const details = new URL(google!).searchParams.get('details');
    for (const value of [arrivalNotes, departureNotes].filter(Boolean)) {
      expect(email.text).toContain(value);
      expect(ics).toContain(value);
      expect(details).toContain(value);
    }
    if (arrivalNotes) expect(email.html).toContain('&lt;&amp;&gt;');
    else expect(email.text).not.toContain('Arrival instructions:');
    if (!departureNotes) expect(email.text).not.toContain('Departure instructions:');
  });
});
