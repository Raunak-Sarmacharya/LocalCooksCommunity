import { afterEach, expect, it, vi } from 'vitest';
import { isOwnDocumentUpload } from './r2-storage';

afterEach(() => vi.unstubAllEnvs());

it("accepts only this user's own document uploads", () => {
  vi.stubEnv('CLOUDFLARE_R2_PUBLIC_URL', 'https://files.localcooks.ca/');
  expect(isOwnDocumentUpload('https://files.localcooks.ca/documents/7_foodSafetyLicense_1_cert.pdf', 7)).toBe(true);
  expect(isOwnDocumentUpload('/api/files/documents/7_1_cert.pdf', 7)).toBe(true);
  for (const url of ['https://files.localcooks.ca/documents/71_x.pdf', 'https://files.localcooks.ca/profiles/7_x.png',
    'https://evil.example/documents/7_x.pdf', 'https://files.localcooks.ca/documents/7_/../8_x.pdf', 'javascript:alert(1)']) {
    expect(isOwnDocumentUpload(url, 7)).toBe(false);
  }
});
