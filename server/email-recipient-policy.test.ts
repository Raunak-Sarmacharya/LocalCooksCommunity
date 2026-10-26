import { describe, expect, it } from 'vitest';
import { isReservedTestRecipient } from './email-recipient-policy';

describe('reserved test recipients', () => {
  it('never hands synthetic RFC 2606 addresses to SMTP, but keeps real ones', () => {
    for (const to of ['phase0-chef@localcooks.test', 'Sam <a@b.example>', 'x@y.invalid', 'dev@localhost.localhost'])
      expect(isReservedTestRecipient(to)).toBe(true);
    for (const to of ['sam@gmail.com', 'admin@localcooks.ca', 'someone@test.com', 'a@example.com', ''])
      expect(isReservedTestRecipient(to)).toBe(false);
    // A real recipient alongside a test one still goes out.
    expect(isReservedTestRecipient('a@b.test, sam@gmail.com')).toBe(false);
  });
});
