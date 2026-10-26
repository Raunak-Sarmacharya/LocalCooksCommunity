import { describe, expect, it } from 'vitest';
import { generateSignInCodeEmail } from './email';

describe('sign-up code email', () => {
  it('names the purpose and carries nothing a visitor typed (no name in the greeting)', () => {
    const mail = generateSignInCodeEmail({ fullName: '<b>Sam</b>', email: 'sam@example.com', code: '482913', signUp: true });
    expect(mail.subject).toBe('482913 is your Local Cooks confirmation code');
    expect(mail.html).toContain('Enter this code to confirm your email and create your account.');
    expect(mail.html).toContain('no account is created without it');
    expect(mail.html).not.toContain('Sam');
    expect(mail.text).toMatch(/^Hi,/);
  });
  it('keeps the sign-in wording and greeting for an existing account', () => {
    const mail = generateSignInCodeEmail({ fullName: 'Sam Rivera', email: 'sam@example.com', code: '482913', locale: 'fr-CA' });
    expect(mail.subject).toBe('482913 est votre code de connexion Local Cooks');
    expect(mail.text).toMatch(/^Bonjour Sam,/);
  });
});
