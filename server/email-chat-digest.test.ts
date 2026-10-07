import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateChatDigestEmail } from './email';
import { getAppBaseUrl } from './config';
afterEach(() => vi.unstubAllEnvs());
describe('real red shared conversation digest', () => {
  it('escapes names/URL attributes, preserves useful plain text and has one primary action across bookings', () => {
    const url = 'https://chef.example.test/dashboard?view=messages&conversation=history%23one&extra="quoted"';
    const email = generateChatDigestEmail('chef@example.test', 2, 'Sam <Manager>', 'Harbour & Kitchen', url, [10, 11]);
    expect(email.html).toContain('Sam &lt;Manager&gt;'); expect(email.html).toContain('Harbour &amp; Kitchen');
    expect(email.html).toContain('&amp;extra=&quot;quoted&quot;');
    expect(email.html!.match(/class="[^"]*\bcta-button\b[^"]*"/g)).toHaveLength(1);
    expect(email.html).toContain('background:#e11d48');
    expect(email.text).toContain('Read messages and reply: ' + url);
    expect(email.text).toContain('- Booking #10'); expect(email.text).toContain('- Booking #11');
    expect(email.subject).not.toContain('undefined');
  });
  it.each([
    ['chef', 'production', '', 'https://chef.localcooks.ca'],
    ['kitchen', 'production', '', 'https://kitchen.localcooks.ca'],
    ['chef', 'production', 'preview', 'https://dev-chef.localcooks.ca'],
    ['kitchen', 'production', 'preview', 'https://dev-kitchen.localcooks.ca'],
    ['chef', 'development', '', 'http://chef.localhost:5001'],
    ['kitchen', 'development', '', 'http://kitchen.localhost:5001'],
  ] as const)('uses actual %s recipient/environment host and encoded exact thread', (role, environment, vercelEnvironment, expectedHost) => {
    vi.stubEnv('NODE_ENV', environment); vi.stubEnv('VERCEL', vercelEnvironment ? '1' : ''); vi.stubEnv('VERCEL_ENV', vercelEnvironment);
    vi.stubEnv('APP_BASE_DOMAIN', 'localcooks.ca'); vi.stubEnv('PORT', '5001');
    const path = `${role === 'chef' ? '' : '/manager'}/dashboard?view=messages&conversation=${encodeURIComponent('original#history')}`;
    const email = generateChatDigestEmail('recipient@example.test', 1, 'Local Cooks', 'Harbour Kitchen', getAppBaseUrl(role) + path, []);
    expect(email.text).toContain('Read messages and reply: ' + expectedHost + path); expect(email.html).not.toContain('Booking context');
    expect(email.text).toContain('1 unread message from Local Cooks');
  });
});
