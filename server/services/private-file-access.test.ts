import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ logoUrl: '' }));
vi.mock('../db', () => ({ db: { select: (fields: any) => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => chain,
    then: (resolve: any) => resolve(fields?.logoUrl ? [{ logoUrl: state.logoUrl }] : []) };
  return chain;
} } }));
import { canReadPrivateFile } from './private-file-access';
const logo = 'https://files.localcooks.ca/location-logos/353_file_1790536347939_LoCo_Red.png';
beforeEach(() => { state.logoUrl = logo; });
it('allows stored location branding without authentication but denies arbitrary files', async () => {
  expect(await canReadPrivateFile(undefined, logo)).toBe(true);
  expect(await canReadPrivateFile(undefined, logo.replace('LoCo_Red', 'other'))).toBe(false);
  expect(await canReadPrivateFile(undefined, 'https://files.localcooks.ca/documents/private.png')).toBe(false);
  state.logoUrl = '';
  expect(await canReadPrivateFile(undefined, logo)).toBe(false);
});
